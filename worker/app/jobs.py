"""Extrações em andamento: um subprocesso Python por extração, igual ao
server.js do multiextrator (payload em arquivo, eventos NDJSON no stdout,
comandos no stdin). A diferença é que aqui o resultado volta pela API.

Estados: na_fila → executando ⇄ aguardando_codigo (só 2 VIA) → concluido.
"""

from __future__ import annotations

import base64
import json
import os
import shutil
import signal
import subprocess
import sys
import threading
import time
import uuid
from collections import deque
from pathlib import Path
from typing import Any

from . import config
from .fluxos import FLUXOS, Apuracao, apurar_evento, apurar_final, referencia_do_arquivo

ESTADOS_DE_PAUSA = ("aguardando_codigo", "concluido")


class ErroDeEstado(RuntimeError):
    """Operação que não cabe no estado atual da extração (vira HTTP 409)."""


class Job:
    def __init__(self, fluxo: str, payload: dict[str, Any], referencias: list[str], uc: str | None):
        self.id = uuid.uuid4().hex
        self.fluxo = fluxo
        self.payload = payload
        self.referencias = referencias
        self.uc = uc
        self.dir = config.JOBS_DIR / self.id
        self.pdf_dir = self.dir / "pdfs"
        self.estado = "na_fila"
        self.criado_em = time.time()
        self.iniciado_em: float | None = None
        self.concluido_em: float | None = None
        self.aguardando_desde: float | None = None
        self.tempo_aguardando = 0.0
        self.codigos_enviados = 0
        self.aviso_codigo: str | None = None
        self.apuracao = Apuracao()
        self.logs: deque[str] = deque(maxlen=200)
        self.status: str | None = None
        self.observacao: str | None = None
        self.arquivos: list[Path] = []
        self.proc: subprocess.Popen | None = None
        self.motivo_fim: str | None = None
        self.cond = threading.Condition()

    # ── estado ──

    def _mudar(self, estado: str) -> None:
        with self.cond:
            if self.estado == "aguardando_codigo" and self.aguardando_desde:
                self.tempo_aguardando += time.time() - self.aguardando_desde
                self.aguardando_desde = None
            self.estado = estado
            if estado == "aguardando_codigo":
                self.aguardando_desde = time.time()
            self.cond.notify_all()

    def aguardar(self, estados: tuple[str, ...] = ESTADOS_DE_PAUSA, timeout: float | None = None) -> None:
        with self.cond:
            self.cond.wait_for(lambda: self.estado in estados, timeout=timeout)

    def _comando(self, cmd: dict[str, Any]) -> None:
        proc = self.proc
        if not proc or proc.poll() is not None or not proc.stdin:
            return
        try:
            proc.stdin.write(json.dumps(cmd) + "\n")
            proc.stdin.flush()
        except OSError:
            pass

    # ── resposta da API ──

    def resposta(self, incluir_pdf: bool = True, incluir_logs: bool = False) -> dict[str, Any]:
        r: dict[str, Any] = {"job_id": self.id, "fluxo": self.fluxo, "uc": self.uc, "estado": self.estado}
        if self.estado == "concluido":
            r["status"] = self.status
            r["observacao"] = self.observacao
            r["arquivos"] = [self._arquivo(p, incluir_pdf) for p in self.arquivos if p.exists()]
            if self.iniciado_em and self.concluido_em:
                r["duracao_s"] = round(self.concluido_em - self.iniciado_em, 1)
        elif self.estado == "aguardando_codigo":
            restante = config.OTP_TIMEOUT_S - (time.time() - (self.aguardando_desde or time.time()))
            r["status"] = "aguardando_codigo"
            r["observacao"] = self.aviso_codigo or (
                "A ENEL enviou o código de segurança para o cliente. "
                f"Envie o código em até {config.OTP_TIMEOUT_S // 60} minutos."
            )
            r["expira_em_s"] = max(0, int(restante))
        else:
            r["status"] = "processando"
            r["observacao"] = "Extração na fila." if self.estado == "na_fila" else "Extração em andamento."
        if incluir_logs:
            r["logs"] = list(self.logs)
        return r

    @staticmethod
    def _arquivo(path: Path, incluir_pdf: bool) -> dict[str, Any]:
        item: dict[str, Any] = {
            "nome": path.name,
            "referencia": referencia_do_arquivo(path.name),
            "tamanho_bytes": path.stat().st_size,
        }
        if incluir_pdf:
            item["pdf_base64"] = base64.b64encode(path.read_bytes()).decode("ascii")
        return item


class JobManager:
    def __init__(self) -> None:
        self.jobs: dict[str, Job] = {}
        self.lock = threading.Lock()
        self.vagas = threading.Semaphore(config.MAX_JOBS_SIMULTANEOS)
        config.JOBS_DIR.mkdir(parents=True, exist_ok=True)
        threading.Thread(target=self._limpar_antigos, daemon=True, name="limpeza").start()

    def criar(self, fluxo: str, payload: dict[str, Any], referencias: list[str], uc: str | None) -> Job:
        job = Job(fluxo, payload, referencias, uc)
        with self.lock:
            self.jobs[job.id] = job
        threading.Thread(target=self._executar, args=(job,), daemon=True, name=f"job-{job.id[:8]}").start()
        return job

    def obter(self, job_id: str) -> Job | None:
        with self.lock:
            return self.jobs.get(job_id)

    def enviar_codigo(self, job: Job, codigo: str) -> None:
        """Código vazio = "não chegou, reenviar" (a 2 VIA pede outro código à ENEL)."""
        with job.cond:
            if job.estado != "aguardando_codigo":
                raise ErroDeEstado(f"a extração não está aguardando código (estado: {job.estado})")
            job.codigos_enviados += 1
            job._comando({"type": "code", "code": codigo})
            job.aviso_codigo = None
        job._mudar("executando")

    def cancelar(self, job: Job, motivo: str = "Extração cancelada.") -> None:
        if job.estado == "concluido":
            return
        job.motivo_fim = job.motivo_fim or motivo
        job._comando({"type": "stop"})
        if job.proc is None:
            # Ainda na fila: _executar vê o motivo e encerra sem abrir navegador.
            return
        threading.Thread(target=self._matar_depois, args=(job, 20), daemon=True).start()

    # ── execução ──

    def _executar(self, job: Job) -> None:
        with self.vagas:
            if job.motivo_fim:
                self._finalizar(job, None)
                return
            job.iniciado_em = time.time()
            job._mudar("executando")
            fluxo = FLUXOS[job.fluxo][0]
            job.pdf_dir.mkdir(parents=True, exist_ok=True)
            payload_path = job.dir / "payload.json"
            payload_path.write_text(json.dumps(job.payload, ensure_ascii=False), encoding="utf-8")
            # Senhas e chaves: o payload só existe no disco enquanto o script lê.
            job.payload = {}
            codigo_saida = None
            try:
                job.proc = self._iniciar_processo(fluxo, payload_path, job)
                threading.Thread(target=self._ler_stderr, args=(job,), daemon=True).start()
                threading.Thread(target=self._vigiar, args=(job,), daemon=True).start()
                self._ler_stdout(job)
                codigo_saida = job.proc.wait()
            except Exception as exc:
                job.apuracao.problema("erro", f"Falha ao executar o extrator: {exc}")
            finally:
                payload_path.unlink(missing_ok=True)
                self._matar_arvore(job, signal.SIGKILL if hasattr(signal, "SIGKILL") else signal.SIGTERM)
                self._finalizar(job, codigo_saida)

    def _iniciar_processo(self, fluxo, payload_path: Path, job: Job) -> subprocess.Popen:
        env = {
            **os.environ,
            **fluxo.env,
            "DOWNLOAD_DIR": str(job.pdf_dir),
            "HEADLESS": os.environ.get("HEADLESS", "true"),
            # Sem backend do Status Energy: os scripts pulam logextracao,
            # faturasextraidas e afins (e não usam nada salvo lá).
            "ENEL_INTERNAL_TOKEN": "",
            "BACKEND_BEARER_TOKEN": "",
            "PYTHONUNBUFFERED": "1",
            "PYTHONIOENCODING": "utf-8",
        }
        extra: dict[str, Any] = {}
        if sys.platform == "win32":
            extra["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP
        else:
            extra["start_new_session"] = True
        return subprocess.Popen(
            [config.PYTHON_BIN, str(config.EXTRATORES_DIR / fluxo.script), "--batch", str(payload_path)],
            cwd=str(config.EXTRATORES_DIR),
            env=env,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
            **extra,
        )

    def _ler_stdout(self, job: Job) -> None:
        assert job.proc and job.proc.stdout
        for linha in job.proc.stdout:
            linha = linha.strip()
            if not linha:
                continue
            try:
                evento = json.loads(linha)
            except json.JSONDecodeError:
                job.logs.append(linha)
                continue
            if not isinstance(evento, dict):
                continue
            tipo = evento.get("type")
            if tipo in ("screenshot", "url", "progress", "qa_bandwidth"):
                continue
            if tipo == "log":
                job.logs.append(str(evento.get("message") or ""))
            if tipo == "qa_awaiting_code":
                if job.codigos_enviados:
                    job.aviso_codigo = (
                        "A ENEL não aceitou o código anterior (ou ele não chegou) e enviou um novo. "
                        f"Envie o novo código em até {config.OTP_TIMEOUT_S // 60} minutos."
                    )
                job._mudar("aguardando_codigo")
            apurar_evento(evento, job.apuracao)

    def _ler_stderr(self, job: Job) -> None:
        assert job.proc and job.proc.stderr
        for linha in job.proc.stderr:
            if linha.strip():
                job.logs.append(f"[stderr] {linha.rstrip()}")

    def _vigiar(self, job: Job) -> None:
        """Tempo limite da extração (sem contar a espera do código) e do código OTP."""
        while job.proc and job.proc.poll() is None:
            agora = time.time()
            if job.estado == "aguardando_codigo" and job.aguardando_desde:
                if agora - job.aguardando_desde > config.OTP_TIMEOUT_S:
                    self.cancelar(
                        job,
                        f"Código de segurança não informado em {config.OTP_TIMEOUT_S // 60} minutos.",
                    )
                    return
            else:
                ativo = agora - (job.iniciado_em or agora) - job.tempo_aguardando
                if ativo > config.JOB_TIMEOUT_S:
                    self.cancelar(
                        job, f"Tempo limite da extração ({config.JOB_TIMEOUT_S // 60} min) excedido."
                    )
                    return
            time.sleep(1)

    def _matar_depois(self, job: Job, espera_s: float) -> None:
        proc = job.proc
        if not proc:
            return
        try:
            proc.wait(timeout=espera_s)
            return
        except subprocess.TimeoutExpired:
            pass
        self._matar_arvore(job, signal.SIGTERM)
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            self._matar_arvore(job, signal.SIGKILL if hasattr(signal, "SIGKILL") else signal.SIGTERM)

    @staticmethod
    def _matar_arvore(job: Job, sinal: int) -> None:
        """Navegador e Xvfb ficam no grupo do processo: mata o grupo todo."""
        proc = job.proc
        if not proc:
            return
        try:
            if sys.platform == "win32":
                subprocess.run(
                    ["taskkill", "/PID", str(proc.pid), "/T", "/F"],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
            else:
                os.killpg(proc.pid, sinal)
        except (ProcessLookupError, PermissionError, OSError):
            pass

    def _finalizar(self, job: Job, codigo_saida: int | None) -> None:
        job.arquivos = sorted(job.pdf_dir.glob("*.pdf")) if job.pdf_dir.exists() else []
        job.status, job.observacao = apurar_final(
            job.apuracao, [p.name for p in job.arquivos], job.referencias, codigo_saida, job.motivo_fim
        )
        job.concluido_em = time.time()
        job._mudar("concluido")

    def _limpar_antigos(self) -> None:
        while True:
            time.sleep(60)
            limite = time.time() - config.JOB_TTL_S
            with self.lock:
                velhos = [
                    j for j in self.jobs.values()
                    if j.estado == "concluido" and (j.concluido_em or 0) < limite
                ]
                for j in velhos:
                    del self.jobs[j.id]
            for j in velhos:
                shutil.rmtree(j.dir, ignore_errors=True)
