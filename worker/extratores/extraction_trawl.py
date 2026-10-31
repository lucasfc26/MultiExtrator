"""
2ª via Enel CE — fluxo completo no estilo TRAWL (Camoufox).

Fluxo por UC:
  abrir página → rolar 600–700px → hCaptcha (mouse humanize) →
  se check OK: preencher UC/CPF → Solicitar → canal → Outlook → PDF.
  se o check falhar: Ctrl+R (até 2x); depois fecha o Camoufox e recomeça.

Modos:
  # Interativo (só captcha, debug):
  python extraction_trawl.py --interactive

  # Produção (orquestrado pelo Extractor-JS):
  python extraction_trawl.py --batch payload.json

Eventos NDJSON em stdout (um por linha) para o facade Node retransmitir no WS.
Comandos no stdin (JSON por linha): {"type":"channel","radio":"..."},
{"type":"stop"}, {"type":"pause"}, {"type":"resume"}.
"""

from __future__ import annotations

import argparse
import base64
import importlib.util
import json
import os
import random
import re
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from urllib.parse import quote, urljoin, urlparse
from pathlib import Path
from typing import Any

try:
    from zoneinfo import ZoneInfo
except ImportError:  # pragma: no cover
    ZoneInfo = None  # type: ignore

from hcaptcha_solver import has_hcaptcha_widget, solve_hcaptcha, trigger_lazy_widgets
from trawl_browser import (
    attach_trawl_init_script,
    open_camoufox,
    safe_evaluate,
    segunda_via_proxy,
)
from trawl_browser import request_fetch as _browser_request_fetch

URL = "https://www.eneldistribuicao.com.br/ce/AcessoRapidoSegundaVia.aspx"

QA_SEL = {
    "submit_step1": "#CONTENT_Formulario_Solicitar",
    "submit_step2": "#CONTENT_Formulario_EnviarSt2",
    "continue_step3": "#CONTENT_Formulario_ContinuarSt3",
    "codigo_seguranca": "#CONTENT_Formulario_CodigoSeguranca",
    "submit_codigo": "#CONTENT_Formulario_ProximoSt4",
    "resend_codigo": "#CONTENT_Formulario_EnviarNovoCodigoSt4",
    "step2": ".step-2",
    "step3": ".step-3",
    "step4": ".step-4",
    "doc_invalido": "#CONTENT_Formulario_DocVal",
    "doc_obrigatorio": "#CONTENT_Formulario_DocObr",
    "pnaviso": "#pnaviso",
    "pmaviso": "#pmaviso",
}

QA_CHANNELS = [
    {
        "row": ".metodo-envio-email1",
        "radio": "CONTENT_Formulario_RdEmail1",
        "value_sel": "#CONTENT_Formulario_Email1",
        "kind": "email",
    },
    {
        "row": ".metodo-envio-email2",
        "radio": "CONTENT_Formulario_RdEmail2",
        "value_sel": "#CONTENT_Formulario_Email2",
        "kind": "email",
    },
    {
        "row": ".metodo-envio-tel1",
        "radio": "CONTENT_Formulario_RdTelefone1",
        "value_sel": "#CONTENT_Formulario_Telefone1",
        "kind": "telefone",
    },
    {
        "row": ".metodo-envio-tel2",
        "radio": "CONTENT_Formulario_RdTelefone2",
        "value_sel": "#CONTENT_Formulario_Telefone2",
        "kind": "telefone",
    },
]

QA_GRID_SEL = "#CONTENT_segviarapida_PnGridFaturas"
QA_TABLE_SEL = "#CONTENT_segviarapida_GridViewSegVia"
QA_SALVAR_PDF_SEL = "#CONTENT_segviarapida_btnSalvarPDF"
QA_SEGVIA_URL = (
    "https://www.eneldistribuicao.com.br/agencia/SegundaViaAcessoRapido.aspx"
)
QA_CHECK_PANEL = "ctl00$CONTENT$segviarapida$PnGridFaturas"

_ASPNET_DELTA_TYPES = (
    "updatePanel",
    "hiddenField",
    "asyncPostBackControlIDs",
    "postBackControlIDs",
    "updatePanelIDs",
    "childUpdatePanelIDs",
    "panelsToRefreshIDs",
    "asyncPostBackTimeout",
    "formAction",
    "pageRedirect",
    "error",
    "pageTitle",
    "scriptBlock",
    "dataItem",
    "dataItemJson",
    "arrayDeclaration",
    "expando",
    "onSubmit",
)

BACKEND_API_URL = os.environ.get("BACKEND_API_URL", "http://localhost:3000/api").rstrip(
    "/"
)
ENEL_INTERNAL_TOKEN = os.environ.get("ENEL_INTERNAL_TOKEN", "")
# MultiExtrator do desktop (ExtratorPlumber): sem token interno, mas com o JWT
# do login — usa as rotas /desktop/* (mesmo efeito das /internal/*). Rotas sem
# espelho (ex.: faturasextraidas — o PDF vai pelo MSEWeb Sync) sao puladas.
BACKEND_BEARER_TOKEN = os.environ.get("BACKEND_BEARER_TOKEN", "")
_ROTAS_DESKTOP = {
    "/enel/internal/logextracao": "/enel/desktop/logextracao",
    "/ucs/internal/from-enel": "/ucs/desktop/from-enel",
    "/ucs/internal/dados-invalidos-2via": "/ucs/desktop/dados-invalidos-2via",
}


def backend_integrado() -> bool:
    return bool(ENEL_INTERNAL_TOKEN or BACKEND_BEARER_TOKEN)


def _rota_backend(pathname: str) -> tuple[str, dict[str, str]] | None:
    """(pathname, headers de auth) — None quando a rota nao esta disponivel."""
    if ENEL_INTERNAL_TOKEN:
        return pathname, {"x-enel-token": ENEL_INTERNAL_TOKEN}
    if BACKEND_BEARER_TOKEN and pathname in _ROTAS_DESKTOP:
        return _ROTAS_DESKTOP[pathname], {"Authorization": f"Bearer {BACKEND_BEARER_TOKEN}"}
    return None
DOWNLOAD_DIR = Path(
    os.environ.get(
        "DOWNLOAD_DIR",
        str(Path.home() / "Downloads"),
    )
)
EXTRACTION_TZ = os.environ.get("EXTRACTION_TIMEZONE", "America/Fortaleza")
HEADLESS = os.environ.get("HEADLESS", "false").lower() in ("1", "true", "yes")
# Extrator offline (ExtratorPlumber): sem backend/Outlook, o código OTP da
# ENEL é digitado na interface e chega por stdin ({"type": "code"}).
OTP_MANUAL = os.environ.get("OTP_MANUAL", "false").lower() in ("1", "true", "yes")

# Controle compartilhado entre threads (stdin → automação)
_control_lock = threading.Lock()
_stopped = False
_paused = False
_channel_choice: str | None = None
_channel_event = threading.Event()
_manual_code: str | None = None
_code_event = threading.Event()
_login_gate_event = threading.Event()


# ── Medição de tráfego (temporária) ──────────────────────────────────────────
# Soma o que o Camoufox trafega por UC: requisições da página (requestfinished
# + request.sizes(), tamanho no fio) e os fetch diretos via page.request
# (postbacks e PDF), que não disparam eventos da página.
_net_lock = threading.Lock()
_net = {"page_bytes": 0, "page_requests": 0, "api_bytes": 0, "api_requests": 0}
_net_contexts: set[int] = set()
_net_proxy_base = 0


def _trafego_proxy_chrome() -> int | None:
    """Bytes do Chrome pelo proxy (NetLog); None no Camoufox ou sem proxy."""
    modulo = sys.modules.get("chrome_cdp_browser")
    return modulo.trafego_proxy() if modulo else None


def net_reset() -> None:
    global _net_proxy_base
    with _net_lock:
        for key in _net:
            _net[key] = 0
    _net_proxy_base = _trafego_proxy_chrome() or 0


def net_snapshot() -> dict[str, int]:
    with _net_lock:
        return dict(_net)


def _on_request_finished(request) -> None:
    total = 0
    try:
        sizes = request.sizes()
        total = sum(
            max(int(sizes.get(k) or 0), 0)
            for k in (
                "requestBodySize",
                "requestHeadersSize",
                "responseBodySize",
                "responseHeadersSize",
            )
        )
    except Exception:
        try:
            response = request.response()
            if response is not None:
                total = int(response.headers.get("content-length") or 0)
        except Exception:
            total = 0
    with _net_lock:
        _net["page_bytes"] += total
        _net["page_requests"] += 1


def net_track_context(context) -> None:
    key = id(context)
    if key in _net_contexts:
        return
    _net_contexts.add(key)
    try:
        context.on("requestfinished", _on_request_finished)
    except Exception:
        pass


def request_fetch(page, url: str, **kwargs) -> dict[str, Any]:
    res = _browser_request_fetch(page, url, **kwargs)
    sent = len(str(kwargs.get("data") or "").encode("utf-8"))
    with _net_lock:
        _net["api_bytes"] += sent + len(res.get("raw") or b"")
        _net["api_requests"] += 1
    return res


def _fmt_mb(n: int) -> str:
    return f"{n / (1024 * 1024):.2f} MB"


def log_net_usage(numero_cliente: str) -> None:
    snap = net_snapshot()
    proxy = _trafego_proxy_chrome()
    if proxy is not None:
        total = proxy - _net_proxy_base
        log(
            f"📶 Tráfego UC {numero_cliente}: {_fmt_mb(total)} pelo proxy "
            f"(Chrome inteiro: página, hCaptcha, postbacks e PDF; "
            f"{snap['api_requests']} postbacks/PDF)",
            "info",
        )
        emit({"type": "qa_bandwidth", "numeroCliente": numero_cliente, "totalBytes": total, **snap})
        return
    total = snap["page_bytes"] + snap["api_bytes"]
    log(
        f"📶 Tráfego UC {numero_cliente}: {_fmt_mb(total)} "
        f"(página {_fmt_mb(snap['page_bytes'])} em {snap['page_requests']} req; "
        f"postbacks/PDF {_fmt_mb(snap['api_bytes'])} em {snap['api_requests']} req)",
        "info",
    )
    emit(
        {
            "type": "qa_bandwidth",
            "numeroCliente": numero_cliente,
            "totalBytes": total,
            **snap,
        }
    )


def emit(event: dict[str, Any]) -> None:
    """Emite um evento NDJSON em stdout (flush imediato)."""
    sys.stdout.write(json.dumps(event, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def log(message: str, log_type: str = "info") -> None:
    emit(
        {
            "type": "log",
            "message": message,
            "logType": log_type,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "flow": "quick_access",
        }
    )


def set_progress(step: str) -> None:
    emit({"type": "progress", "step": step, "flow": "quick_access"})


def _camoufox_browser_installed() -> bool:
    """True se o canal ativo (oficial/stable) já tem binário no cache."""
    try:
        from camoufox.multiversion import get_active_path

        return get_active_path() is not None
    except Exception:
        pass
    try:
        from camoufox.pkgman import camoufox_path

        camoufox_path(download_if_missing=False)
        return True
    except Exception:
        return False


def ensure_camoufox_browser() -> None:
    """
    O pip só instala a lib Python. O Firefox do Camoufox (official/stable)
    vem com `python -m camoufox fetch`. Sem isso o Camoufox() aborta.
    """
    if _camoufox_browser_installed():
        return

    log(
        "📦 Camoufox official/stable não está instalado. "
        "Baixando o navegador (primeira vez, pode levar alguns minutos)...",
        "info",
    )
    result = subprocess.run(
        [sys.executable, "-m", "camoufox", "fetch"],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    output = (result.stdout or "").strip()
    useful = [ln.strip() for ln in output.splitlines() if ln.strip()]
    if useful:
        log(f"camoufox fetch: {useful[-1]}", "info")

    if result.returncode != 0 or not _camoufox_browser_installed():
        detail = output[-800:] if output else f"exit {result.returncode}"
        raise RuntimeError(
            "official/stable is not installed. Falha ao baixar o Camoufox. "
            "Rode: python -m camoufox fetch. "
            f"Detalhe: {detail}"
        )
    log("✔ Camoufox official/stable instalado.", "success")


def emit_screenshot(page) -> None:
    """Envia frame JPEG base64 para a 'Tela do Navegador' do frontend."""
    if page is None:
        return
    try:
        data = page.screenshot(type="jpeg", quality=40, full_page=False)
        if isinstance(data, (bytes, bytearray)):
            b64 = base64.b64encode(data).decode("ascii")
        else:
            # Alguns builds devolvem str já em base64
            b64 = str(data)
        emit({"type": "screenshot", "data": b64, "flow": "quick_access"})
        try:
            emit({"type": "url", "value": page.url})
        except Exception:
            pass
    except Exception:
        pass


def sleep_with_ui(page, seconds: float, shot_every: float = 1.0) -> None:
    """Sleep interruptível que atualiza a preview periodicamente."""
    end = time.time() + max(0.0, seconds)
    next_shot = 0.0
    while time.time() < end:
        if is_stopped():
            return
        wait_if_paused()
        now = time.time()
        if now >= next_shot:
            emit_screenshot(page)
            next_shot = now + shot_every
        time.sleep(min(0.25, end - now))


def is_stopped() -> bool:
    with _control_lock:
        return _stopped


def wait_if_paused(page=None) -> None:
    while True:
        with _control_lock:
            if _stopped or not _paused:
                return
        if page is not None:
            emit_screenshot(page)
        time.sleep(0.25)


def request_stop() -> None:
    with _control_lock:
        global _stopped
        _stopped = True
    _channel_event.set()
    _code_event.set()


def _handle_termination_signal(signum, frame) -> None:
    # Sem isto, SIGTERM mata o processo na hora (comportamento padrão do
    # Python), pulando o `finally: session.stop()` do run_batch — o Firefox
    # do Camoufox fica órfão, é reparented pro PID 1 do container e nunca
    # mais é fechado. Só marca o flag; o loop principal encerra sozinho e
    # deixa o `finally` fechar o navegador.
    request_stop()


try:
    import signal as _signal

    _signal.signal(_signal.SIGTERM, _handle_termination_signal)
    _signal.signal(_signal.SIGINT, _handle_termination_signal)
except (ImportError, ValueError):
    pass


def set_channel_choice(radio: str) -> None:
    with _control_lock:
        global _channel_choice
        _channel_choice = radio
    _channel_event.set()


def set_manual_code(code: str) -> None:
    with _control_lock:
        global _manual_code
        _manual_code = code
    _code_event.set()


def stdin_control_loop() -> None:
    """Lê comandos JSON do Node (channel / stop / pause / resume)."""
    global _paused
    for raw in sys.stdin:
        line = raw.strip()
        if not line:
            continue
        try:
            cmd = json.loads(line)
        except json.JSONDecodeError:
            continue
        kind = cmd.get("type")
        if kind == "stop":
            request_stop()
            log("🛑 Parada solicitada.", "warn")
        elif kind == "pause":
            with _control_lock:
                _paused = True
            log("⏸ Pausado.", "warn")
        elif kind == "resume":
            with _control_lock:
                _paused = False
            log("▶ Retomado.", "info")
        elif kind == "channel":
            radio = str(cmd.get("radio") or "").strip()
            if radio:
                set_channel_choice(radio)
        elif kind == "code":
            # Código vazio = "não chegou, reenviar" (ver wait_manual_security_code).
            set_manual_code(str(cmd.get("code") or "").strip())
        elif kind == "login_gate_ok":
            _login_gate_event.set()


def aguardar_vez_do_login() -> None:
    """App desktop com vários extratores (payload `loginGate`): antes de voltar
    à tela do hCaptcha, pede a vez e espera o `login_gate_ok` — nunca dois
    navegadores na tela de login ao mesmo tempo."""
    _login_gate_event.clear()
    emit({"type": "login_gate_request", "flow": "quick_access"})
    while not is_stopped() and not _login_gate_event.wait(0.5):
        pass


def start_stdin_listener() -> None:
    t = threading.Thread(target=stdin_control_loop, name="stdin-control", daemon=True)
    t.start()


def post_backend(pathname: str, body: dict[str, Any], timeout: float = 15) -> dict | None:
    rota = _rota_backend(pathname)
    if rota is None:
        if not backend_integrado():
            log(
                "⚠ ENEL_INTERNAL_TOKEN não configurado; integração com backend ignorada.",
                "warn",
            )
        return None
    url = f"{BACKEND_API_URL}{rota[0]}"
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        method="POST",
        headers={"Content-Type": "application/json", **rota[1]},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")[:300]
        raise RuntimeError(f"Backend {pathname} HTTP {e.code}: {detail}") from e
    except Exception as e:
        raise RuntimeError(f"Backend {pathname}: {e}") from e


CREDENTIALS_ERROR_MSG = "UC ou CPF/CNPJ Inválidos"
HCAPTCHA_RECUSADO_MSG = "Não foi possível resolver o hCaptcha: a ENEL recusou o captcha"
# Erro inline no formulário (#CONTENT_Formulario_DocVal, "O documento
# informado é inválido") — aparece assim que clica em "Solicitar", sem toast
# nenhum. O texto já contém "cpf" + "invalido", então cai naturalmente em
# `is_invalid_credentials_text`/`should_skip_full_retry` (não vale retry).
DOC_INVALIDO_MSG = "CPF ou CNPJ Inválidos"
CORPORATIVO_WRONG_FLOW_MSG = "Tipo de Extração Incorreto: mudar para Corporativo"
# Diálogo da ENEL logo após "Próximo" ("Não será possível fazer esta
# solicitação, seu contrato foi encerrado..."): a 2 Via nunca vai funcionar
# para essa UC — ela vai para Manual em /ucs (ver `_marcar_uc_manual`).
CONTRATO_ENCERRADO_MSG = "Contrato Encerrado entre em contato com a distribuidora"
EMAIL_FORWARD_ERROR_MSG = (
    "Email_nome ou fluxo de encaminhamento do e-mail errado"
)


# Quanto esperar o e-mail com o código de segurança da ENEL (por envio).
OTP_ESPERA_MS = 10 * 60 * 1000
# UC sem Nome_email: espera o próximo e-mail com "Olá, ..." por até 5 min (os
# outros extratores ficam parados no envio do código enquanto isso); se não
# chegar, a UC vai para Manual com EMAIL_NAO_CADASTRADO_MSG.
OTP_CAPTURA_ESPERA_MS = 5 * 60 * 1000
EMAIL_NAO_CADASTRADO_MSG = "E-mail não cadastrado para envio do código OTP"


def otp_timeout_message(nome_email: str | None) -> str:
    nome = (nome_email or "").strip()
    if not nome:
        return (
            "Código OTP da ENEL não chegou no Outlook. Nome_email da UC está vazio "
            "— o e-mail do código não pôde ser identificado. Cadastre o Nome_email "
            "(texto que aparece no corpo do e-mail da ENEL) e tente de novo."
        )
    return (
        f'Código OTP da ENEL não chegou no Outlook (filtro Nome_email: "{nome}"). '
        "O Nome_email pode estar cadastrado errado, o e-mail pode ter atrasado "
        "ou não ter sido entregue. Confira o cadastro da UC e a caixa do Outlook."
    )


def is_otp_wait_error(message: str) -> bool:
    msg = (message or "").lower()
    return (
        "otp" in msg
        or "nome_email" in msg
        or "não chegou no outlook" in msg
        or "nao chegou no outlook" in msg
        or "código de segurança da enel" in msg
        or "codigo de seguranca da enel" in msg
    )


def is_missing_reference_error(message: str) -> bool:
    """Mês pedido não está na tabela — não vale refazer hCaptcha."""
    msg = (message or "").lower()
    return (
        "não há fatura da referência" in msg
        or "nao ha fatura da referencia" in msg
        or "ainda não foi gerada" in msg
        or "ainda nao foi gerada" in msg
        or "após 3 tentativas com atualização" in msg
        or "apos 3 tentativas com atualizacao" in msg
        or "não recarregou após atualizar" in msg
        or "nao recarregou apos atualizar" in msg
        or ("mês referência" in msg and "não encontrado" in msg)
        or ("mes referencia" in msg and "nao encontrado" in msg)
    )


def is_hcaptcha_error(message: str) -> bool:
    msg = (message or "").lower()
    return "hcaptcha" in msg


def is_browser_closed_error(message: str) -> bool:
    """Playwright: a página/contexto/Firefox já tinha morrido quando o goto rodou."""
    msg = (message or "").lower()
    return (
        "has been closed" in msg
        or "target closed" in msg
        or "browser has been closed" in msg
        or "context or browser has been closed" in msg
    )


FATURA_INDISPONIVEL_MSG = (
    "Fatura indisponível, por favor entre em contato com um de nossos "
    "canais de atendimento."
)

FATURA_ZERADA_MSG = "fatura zerada, inexistente no site"


class EnelSiteDialogError(RuntimeError):
    """Aviso da ENEL na tela (ex.: Fatura indisponível) — não é falha do extrator."""


class FaturaZeradaError(RuntimeError):
    """Valor R$ 0,00: a ENEL mostra a linha, mas não gera o PDF."""


class MissingReferenceError(RuntimeError):
    """Mês referência confirmado como inexistente (buraco detectado ao
    paginar a GridView, ver `locate_reference_with_pagination`) — não é
    falha do extrator, e reload+retry não resolveria (bateria no mesmo
    buraco de novo)."""


def is_fatura_indisponivel_error(message: str) -> bool:
    msg = (message or "").lower()
    return "fatura indispon" in msg


def is_fatura_zerada_error(message: str) -> bool:
    msg = (message or "").lower()
    return "fatura zerada" in msg or "inexistente no site" in msg


def is_attention_result(message: str) -> bool:
    """Aviso da ENEL (fatura inexistente/zerada/indisponível) — não é falha do extrator."""
    return (
        is_fatura_zerada_error(message)
        or is_fatura_indisponivel_error(message)
        or is_missing_reference_error(message)
    )


def result_status_for_message(message: str) -> str:
    return "atencao" if is_attention_result(message) else "error"


def _fold_pt(value: str) -> str:
    return (
        str(value or "")
        .lower()
        .replace("á", "a")
        .replace("à", "a")
        .replace("ã", "a")
        .replace("â", "a")
        .replace("é", "e")
        .replace("ê", "e")
        .replace("í", "i")
        .replace("ó", "o")
        .replace("ô", "o")
        .replace("õ", "o")
        .replace("ú", "u")
        .replace("ç", "c")
    )


def is_invalid_credentials_text(text: str | None) -> bool:
    t = _fold_pt(text)
    if not t:
        return False
    if "n cliente ou cpf" in t or "cpf/cnpj errados" in t:
        return True
    return "invalido" in t and (
        "cliente" in t or "cpf" in t or "cnpj" in t
    )


def is_credentials_error(message: str) -> bool:
    return is_invalid_credentials_text(message)


def is_corporativo_wrong_flow_text(text: str | None) -> bool:
    t = _fold_pt(text)
    if not t:
        return False
    return (
        "corporativo e governo" in t
        or "area de corporativo" in t
        or "tipo de extracao incorreto" in t
        or "mudar para corporativo" in t
    )


def is_corporativo_wrong_flow_error(message: str) -> bool:
    return is_corporativo_wrong_flow_text(message)


def is_contrato_encerrado_text(text: str | None) -> bool:
    t = _fold_pt(text)
    return "contrato foi encerrado" in t or "contrato encerrado" in t


def is_email_forward_error(message: str) -> bool:
    msg = _fold_pt(message)
    return (
        "email_nome" in msg
        or "encaminhamento do e-mail" in msg
        or "encaminhamento do email" in msg
    )


def is_email_channel_mismatch_error(message: str) -> bool:
    return "nenhum canal bateu com o email_segunda_via" in _fold_pt(message)


def is_invalid_otp_code_text(text: str | None) -> bool:
    """Toast pós-'Enviar' na tela de código: 'Código de verificação
    inválido.' — acontece quando Nome_email bateu num e-mail de OUTRA
    fatura (não é um erro de credenciais nem de captcha, é só o código
    errado; ver `collect_and_submit_enel_otp`)."""
    t = _fold_pt(text)
    if not t or "codigo" not in t:
        return False
    if not ("verificacao" in t or "seguranca" in t):
        return False
    return "invalido" in t or "incorreto" in t


def should_skip_full_retry(message: str) -> bool:
    return (
        is_otp_wait_error(message)
        or is_missing_reference_error(message)
        or is_fatura_indisponivel_error(message)
        or is_fatura_zerada_error(message)
        or is_credentials_error(message)
        or is_corporativo_wrong_flow_error(message)
        or is_contrato_encerrado_text(message)
        or is_email_forward_error(message)
        or is_email_channel_mismatch_error(message)
        or is_browser_closed_error(message)
        or is_hcaptcha_error(message)
    )


def _dialog_text_from_dom() -> str:
    return """() => {
      const visivel = (el) => {
        if (!el || !(el instanceof HTMLElement)) return false;
        const st = window.getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return (
          st.display !== 'none' &&
          st.visibility !== 'hidden' &&
          Number(st.opacity) !== 0 &&
          r.width > 2 &&
          r.height > 2
        );
      };
      const roots = [
        ...document.querySelectorAll(
          '.bootstrap-dialog, .modal.in, .modal.show, [role="dialog"], .ui-dialog, .fancybox-content, .fancybox-container'
        ),
      ];
      for (const root of roots) {
        if (!visivel(root)) continue;
        const txt = (root.innerText || '').replace(/\\s+/g, ' ').trim();
        if (/fatura\\s+indispon/i.test(txt)) return txt;
      }
      const body = (document.body && document.body.innerText) || '';
      const m = body.match(/Fatura indispon[íi]vel[^.\\n]{0,160}\\.?/i);
      return m ? m[0].replace(/\\s+/g, ' ').trim() : null;
    }"""


def normalize_fatura_indisponivel(text: str | None) -> str | None:
    if not text:
        return None
    compact = " ".join(str(text).split())
    if "fatura indispon" not in compact.lower():
        return None
    match = re.search(
        r"Fatura indispon[íi]vel,?\s*por favor entre em contato com um de nossos canais de atendimento\.?",
        compact,
        re.I,
    )
    if match:
        msg = match.group(0).strip()
        if not msg.endswith("."):
            msg += "."
        return msg[0].upper() + msg[1:]
    return FATURA_INDISPONIVEL_MSG


_DIALOGOS_VISIVEIS_JS = """() => {
  const visivel = (el) => {
    if (!el || !(el instanceof HTMLElement)) return false;
    const st = window.getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return st.display !== 'none' && st.visibility !== 'hidden' &&
      Number(st.opacity) !== 0 && r.width > 2 && r.height > 2;
  };
  return [
    ...document.querySelectorAll(
      '.bootstrap-dialog-message, .bootstrap-dialog, .modal.in, .modal.show, [role="dialog"], .ui-dialog'
    ),
  ]
    .filter(visivel)
    .map((el) => (el.innerText || '').replace(/\\s+/g, ' ').trim())
    .filter(Boolean)
    .join(' | ');
}"""


def read_contrato_encerrado(page) -> bool:
    """Diálogo "seu contrato foi encerrado" (bootstrap-dialog), na página ou
    em iframe — aparece depois de clicar em "Próximo" no 1º passo da 2 Via."""
    frames = [page]
    try:
        frames += [f for f in page.frames if f != page.main_frame]
    except Exception:
        pass
    for alvo in frames:
        try:
            if is_contrato_encerrado_text(alvo.evaluate(_DIALOGOS_VISIVEIS_JS)):
                return True
        except Exception:
            continue
    return False


def read_enel_dialog_text(page) -> str | None:
    """Lê o aviso da ENEL na página ou em iframe (Fatura indisponível)."""
    try:
        found = normalize_fatura_indisponivel(page.evaluate(_dialog_text_from_dom()))
        if found:
            return found
    except Exception:
        pass
    try:
        for frame in page.frames:
            if frame == page.main_frame:
                continue
            try:
                found = normalize_fatura_indisponivel(
                    frame.evaluate(_dialog_text_from_dom())
                )
                if found:
                    return found
            except Exception:
                continue
    except Exception:
        pass
    return None


def wait_outlook_security_code(
    user_id: str | None,
    since_iso: str,
    timeout_ms: int = OTP_ESPERA_MS,
    page=None,
    content_contains: str | None = None,
    exclude_message_ids: list[str] | None = None,
    capturar_saudacao: bool = False,
) -> tuple[str, str | None, str | None]:
    """
    Polla o backend em fatias curtas para liberar a thread principal e
    continuar enviando screenshots da página enquanto espera o e-mail.
    Retorna (code, messageId, nomeEmail) — o messageId permite excluir esse
    e-mail numa chamada seguinte se a ENEL rejeitar o código (ver
    `collect_and_submit_enel_otp`); nomeEmail é a saudação "Olá, ..." quando
    `capturar_saudacao` (UC sem Nome_email).
    """
    if OTP_MANUAL:
        return wait_manual_security_code(timeout_ms, page=page), None, None
    if not ENEL_INTERNAL_TOKEN:
        raise RuntimeError(
            "ENEL_INTERNAL_TOKEN não configurado — não é possível ler o código no Outlook"
        )
    if not user_id:
        raise RuntimeError(
            "userId ausente — conecte o Outlook e inicie logado no sistema"
        )

    deadline = time.time() + (timeout_ms / 1000)
    poll_ms = 8_000
    content = (content_contains or "").strip() or None

    while time.time() < deadline:
        if is_stopped():
            raise RuntimeError("Interrompido")
        wait_if_paused(page)
        emit_screenshot(page)

        remaining_ms = max(1, int((deadline - time.time()) * 1000))
        slice_ms = min(poll_ms, remaining_ms)
        try:
            payload: dict[str, Any] = {
                "userId": user_id,
                "sinceIso": since_iso,
                "timeoutMs": slice_ms,
            }
            if content:
                payload["contentContains"] = content
            if exclude_message_ids:
                payload["excludeMessageIds"] = exclude_message_ids
            if capturar_saudacao and not content:
                payload["capturarSaudacao"] = True
            result = post_backend(
                "/outlook-email/internal/wait-code",
                payload,
                timeout=(slice_ms / 1000) + 20,
            )
            code = (result or {}).get("code")
            if code:
                message_id = (result or {}).get("messageId")
                nome = str((result or {}).get("nomeEmail") or "").strip() or None
                return str(code), (str(message_id) if message_id else None), nome
        except Exception as e:
            msg = str(e).lower()
            if "401" in msg or "403" in msg or "token" in msg:
                raise

        sleep_with_ui(page, 1.0)

    if capturar_saudacao and not content:
        raise RuntimeError(EMAIL_NAO_CADASTRADO_MSG)
    raise RuntimeError(otp_timeout_message(content))


def _portao_otp_ativo(user_id: str | None) -> bool:
    return bool(user_id) and bool(ENEL_INTERNAL_TOKEN) and not OTP_MANUAL


def aguardar_portao_otp(
    page, user_id: str | None, holder: str, exclusivo: bool
) -> None:
    """Pede a vez de enviar o código no portão do backend (ver
    `adquirirPortaoOtp`). UC sem Nome_email (`exclusivo`) trava os envios dos
    outros extratores e espera os já enviados chegarem; as demais só esperam
    se houver uma UC sem Nome_email capturando a saudação. Backend fora do ar
    ou sem a rota: segue sem esperar (comportamento antigo)."""
    if not _portao_otp_ativo(user_id):
        return
    em_espera: str | None = None
    while True:
        if is_stopped():
            raise RuntimeError("Interrompido")
        wait_if_paused(page)
        try:
            r = post_backend(
                "/outlook-email/internal/otp-gate/adquirir",
                {"userId": user_id, "holder": holder, "exclusivo": exclusivo},
            )
        except Exception as e:
            log(f"⚠ Portão do OTP indisponível ({e}) — enviando sem esperar.", "warn")
            return
        if not r or r.get("ok"):
            if em_espera:
                log("▶ Liberado para enviar o código.", "info")
            return
        motivo = str(r.get("motivo") or "outro extrator enviando código")
        if motivo != em_espera:
            log(f"⏸ Envio do código em espera: {motivo}.", "warn")
            em_espera = motivo
        emit_screenshot(page)
        sleep_with_ui(page, 3.0)


def liberar_portao_otp(user_id: str | None, holder: str) -> None:
    if not _portao_otp_ativo(user_id):
        return
    try:
        post_backend(
            "/outlook-email/internal/otp-gate/liberar",
            {"userId": user_id, "holder": holder},
        )
    except Exception as e:
        log(f"⚠ Falha ao liberar o portão do OTP: {e}", "warn")


def gravar_nome_email_capturado(numero_cliente: str, nome_email: str) -> None:
    numero = re.sub(r"\D", "", numero_cliente or "")
    if not numero:
        return
    try:
        resposta = post_backend(
            "/ucs/internal/nome-email-2via",
            {"numero_cliente": numero, "nome_email": nome_email},
        )
    except Exception as e:
        log(f"⚠ Falha ao gravar o Nome_email da UC {numero}: {e}", "warn")
        return
    if resposta and resposta.get("atualizadas"):
        log(f'✔ Nome_email da UC {numero} salvo: "{nome_email}".', "success")


def wait_manual_security_code(timeout_ms: int, page=None) -> str:
    """OTP_MANUAL: espera o código digitado na interface (stdin `code`).
    Código vazio ou timeout sobem o mesmo erro de "não chegou" do Outlook,
    então `collect_and_submit_enel_otp` segue para o reenvio normalmente."""
    _code_event.clear()
    with _control_lock:
        global _manual_code
        _manual_code = None
    log("⌨ Digite na interface o código de segurança recebido da ENEL.", "warn")
    deadline = time.time() + (timeout_ms / 1000)
    while time.time() < deadline:
        if is_stopped():
            raise RuntimeError("Interrompido")
        wait_if_paused(page)
        if _code_event.wait(1.0):
            with _control_lock:
                code = _manual_code or ""
            if is_stopped():
                raise RuntimeError("Interrompido")
            if code:
                return code
            raise RuntimeError("Código OTP não informado — reenvio solicitado")
        emit_screenshot(page)
    raise RuntimeError("Código OTP não informado a tempo")


def register_extracted_file(file_name: str) -> None:
    try:
        if post_backend("/enel/internal/faturasextraidas", {"nome": file_name}) is not None:
            log(f"✔ Arquivo registrado no backend: {file_name}", "success")
    except Exception as e:
        log(f"⚠ Falha ao registrar arquivo no backend: {e}", "warn")


def _cell_by_header_patterns(row: list[dict], patterns: list[str]) -> str:
    compiled = [re.compile(p, re.I) for p in patterns]
    for cell in row:
        label = str(cell.get("label") or "").strip()
        if any(p.search(label) for p in compiled):
            return str(cell.get("value") or "").strip()
    return ""


def build_logextracao_item(uc: str, row: list[dict], reference_key: str) -> dict[str, str]:
    """
    Monta o payload de /resumo-extracoes a partir da linha da GridView.
    Colunas típicas 2VIA: Leitura | Referência | … | Vencimento | Tipo | Valor | Situação.
    """
    referencia = (
        _cell_by_header_patterns(row, [r"refer[êe]ncia"])
        or next(
            (
                str(c.get("value") or "").strip()
                for c in row
                if re.fullmatch(r"\d{1,2}/\d{4}", str(c.get("value") or "").strip())
            ),
            "",
        )
        or reference_key
    )
    # Exibe no resumo no formato da ENEL (MM/AAAA) quando possível
    if re.fullmatch(r"\d{4}-\d{2}", referencia):
        y, m = referencia.split("-")
        referencia = f"{m}/{y}"

    leitura = _cell_by_header_patterns(row, [r"leitura"]) or "-"
    consumo = _cell_by_header_patterns(row, [r"consumo"]) or "-"
    vencimento = _cell_by_header_patterns(row, [r"vencimento"]) or ""
    tipo = _cell_by_header_patterns(row, [r"^tipo$"]) or "Fatura"
    valor = _cell_by_header_patterns(row, [r"valor|pagar|r\$"]) or ""
    situacao = _cell_by_header_patterns(row, [r"situa[cç][ãa]o|pagamento"]) or ""

    # Fallbacks por conteúdo quando headers ASP.NET vêm vazios
    if not vencimento:
        for cell in row:
            val = str(cell.get("value") or "").strip()
            if re.fullmatch(r"\d{1,2}/\d{1,2}/\d{4}", val):
                # Prefere a data que NÃO é a primeira (leitura costuma vir antes)
                vencimento = val
    if not valor:
        for cell in row:
            val = str(cell.get("value") or "").strip()
            if re.search(r"r\$\s*[\d.,]+", val, re.I) or re.fullmatch(
                r"[\d.,]+", val
            ):
                if "R$" in val or re.search(r",\d{2}$", val):
                    valor = val
                    break
    if not situacao:
        for cell in row:
            val = str(cell.get("value") or "").strip().upper()
            if val in {
                "EM ABERTO",
                "PAGA",
                "PAGO",
                "VENCIDA",
                "BAIXADA",
                "CANCELADA",
            } or "ABERTO" in val:
                situacao = str(cell.get("value") or "").strip()
                break
    if tipo == "Fatura":
        for cell in row:
            val = str(cell.get("value") or "").strip().lower()
            if val in {"fatura", "2ª via", "2a via", "conta"}:
                tipo = str(cell.get("value") or "").strip()
                break

    return {
        "uc": str(uc or ""),
        "leitura": leitura or "-",
        "referencia": referencia,
        "consumoKwh": consumo or "-",
        "vencimento": vencimento,
        "tipo": tipo or "-",
        "valor": valor,
        "situacao": situacao,
    }


def persist_logextracao_row(uc: str, row: list[dict], reference_key: str) -> None:
    """Grava a linha em logextracao — alimenta /resumo-extracoes."""
    item = build_logextracao_item(uc, row, reference_key)
    try:
        post_backend("/enel/internal/logextracao", {"items": [item]})
        log(
            f"✔ Linha enviada para logextracao (resumo-extracoes): "
            f"UC {item['uc']} / {item['referencia']}",
            "success",
        )
    except Exception as e:
        log(f"⚠ Falha ao enviar logextracao: {e}", "warn")


def normalize_email(value: str | None) -> str:
    return str(value or "").strip().lower()


def email_matches_mask(full_email: str | None, masked_value: str | None) -> bool:
    full = normalize_email(full_email)
    masked = normalize_email(masked_value)
    if not full or not masked:
        return False
    if full == masked:
        return True
    escaped = re.escape(masked).replace(r"\*", ".*")
    try:
        return re.fullmatch(escaped, full, flags=re.IGNORECASE) is not None
    except re.error:
        return False


def email_domain(value: str | None) -> str:
    email = normalize_email(value)
    if "@" not in email:
        return ""
    return email.rsplit("@", 1)[-1]


def email_matches_domain(full_email: str | None, masked_value: str | None) -> bool:
    """True se o canal mascarado tem o mesmo @dominio do e-mail cadastrado."""
    domain = email_domain(full_email)
    masked = normalize_email(masked_value)
    if not domain or "@" not in masked:
        return False
    masked_domain = masked.rsplit("@", 1)[-1].replace("*", "")
    return masked_domain == domain or masked.endswith("@" + domain)


def matching_email_channels(
    canais: list[dict[str, Any]],
    email_segunda_via: str | None,
) -> list[dict[str, Any]]:
    """E-mails da tela cujo @dominio (ou máscara) bate com email_segunda_via."""
    emails = [c for c in canais if c.get("kind") == "email"]
    if not emails:
        return []
    if not email_segunda_via:
        return emails[:1]
    matched: list[dict[str, Any]] = []
    for canal in emails:
        valor = canal.get("value")
        if email_matches_mask(email_segunda_via, valor) or email_matches_domain(
            email_segunda_via, valor
        ):
            matched.append(canal)
    return matched


def email_labels_on_screen(canais: list[dict[str, Any]]) -> str:
    presentes = []
    for canal in canais:
        if canal.get("kind") != "email":
            continue
        valor = str(canal.get("value") or "").strip()
        presentes.append(valor or str(canal.get("label") or "—").strip())
    return ", ".join(presentes) if presentes else "(nenhum e-mail na tela)"


def email_segunda_via_mismatch_message(
    email_segunda_via: str, canais: list[dict[str, Any]]
) -> str:
    return (
        f"Nenhum canal bateu com o email_segunda_via={email_segunda_via}; "
        f"os e-mails presentes eram: {email_labels_on_screen(canais)}."
    )


def get_reference_key(value: Any) -> str | None:
    """
    Normaliza referência para YYYY-MM.
    Aceita "08/2026", "082026", "2026-08". Datas completas (DD/MM/AAAA) são
    ignoradas (8+ dígitos) para não confundir com a coluna de referência.
    """
    text = str(value or "").strip()
    if not text:
        return None
    if re.fullmatch(r"\d{4}-\d{2}", text):
        return text
    # MM/AAAA explícito
    m = re.fullmatch(r"(\d{1,2})[/.-](\d{4})", text)
    if m:
        month = int(m.group(1))
        year = m.group(2)
        if 1 <= month <= 12:
            return f"{year}-{month:02d}"
    digits = re.sub(r"\D", "", text)
    if not re.fullmatch(r"\d{6}", digits):
        return None
    month, year = digits[:2], digits[2:]
    if not (1 <= int(month) <= 12):
        return None
    return f"{year}-{month}"


def get_current_reference_key(now: datetime | None = None) -> str:
    if ZoneInfo is not None:
        try:
            now = now or datetime.now(ZoneInfo(EXTRACTION_TZ))
        except Exception:
            now = now or datetime.now()
    else:
        now = now or datetime.now()
    return f"{now.year:04d}-{now.month:02d}"


def normalize_reference_keys(value: Any) -> list[str]:
    lista = value if isinstance(value, list) else ([value] if value else [])
    chaves: list[str] = []
    for item in lista:
        bruto = str(item or "").strip()
        chave = get_reference_key(bruto)
        if chave and chave not in chaves:
            chaves.append(chave)
    return chaves


def get_reference_slug(value: Any) -> str:
    key = get_reference_key(value) or (
        value if re.fullmatch(r"\d{4}-\d{2}", str(value or "")) else None
    )
    if not key:
        return re.sub(r"[\\/]", "", str(value or "fatura"))
    if re.fullmatch(r"\d{4}-\d{2}", str(key)):
        year, month = str(key).split("-")
        return f"{year}.{month}"
    parsed = get_reference_key(key)
    if not parsed:
        return re.sub(r"[\\/]", "", str(value or "fatura"))
    year, month = parsed.split("-")
    return f"{year}.{month}"


def row_cell_value(row: list[dict], labels: list[str]) -> str | None:
    wanted = {l.lower() for l in labels}
    for cell in row:
        label = str(cell.get("label") or "").strip().lower()
        if label in wanted or any(w in label for w in wanted):
            return cell.get("value")
    return None


def row_reference_key(row: list[dict]) -> str | None:
    """Extrai YYYY-MM da linha (rótulo Referência ou célula MM/AAAA)."""
    labeled = row_cell_value(row, ["Referência", "Referencia"])
    key = get_reference_key(labeled)
    if key:
        return key
    for cell in row:
        val = str(cell.get("value") or "").strip()
        # Só MM/AAAA (6 dígitos) — evita confusão com DD/MM/AAAA
        if re.fullmatch(r"\d{1,2}/\d{4}", val):
            key = get_reference_key(val)
            if key:
                return key
    for cell in row:
        key = get_reference_key(cell.get("value"))
        if key:
            digits = re.sub(r"\D", "", str(cell.get("value") or ""))
            if len(digits) == 6:
                return key
    return None


def last_n_month_keys(n: int = 12, now: datetime | None = None) -> list[str]:
    now = now or datetime.now()
    keys: list[str] = []
    for i in range(n):
        year = now.year
        month = now.month - i
        while month <= 0:
            month += 12
            year -= 1
        keys.append(f"{year:04d}-{month:02d}")
    return keys


def oldest_allowed_month_key() -> str:
    return last_n_month_keys(12)[-1]


def valor_eh_zero(valor: str | None) -> bool:
    raw = re.sub(r"[R$\s]", "", str(valor or ""), flags=re.I).strip()
    if not raw:
        return False
    if "," in raw and "." in raw:
        raw = raw.replace(".", "").replace(",", ".")
    elif "," in raw:
        raw = raw.replace(",", ".")
    try:
        return float(raw) == 0.0
    except ValueError:
        return False


def row_valor(row: list[dict]) -> str:
    valor = row_cell_value(row, ["Valor", "Pagar", "R$"]) or ""
    if str(valor).strip():
        return str(valor).strip()
    for cell in row:
        val = str(cell.get("value") or "").strip()
        if re.search(r"r\$\s*[\d.,]+", val, re.I) or re.fullmatch(r"[\d.,]+", val):
            if "R$" in val or re.search(r",\d{2}$", val):
                return val
    return ""


def filter_references_last_12_months(keys: list[str]) -> list[str]:
    allowed = set(last_n_month_keys(12))
    kept = [key for key in keys if key in allowed]
    skipped = [key for key in keys if key not in allowed]
    if skipped:
        log(
            "⚠ Ignorando "
            f"{len(skipped)} fatura(s) com mais de 12 meses: {', '.join(skipped)}.",
            "warn",
        )
    return kept


def all_reference_keys_from_table(tabela: dict) -> list[str]:
    chaves: list[str] = []
    for row in tabela.get("rows") or []:
        key = row_reference_key(row)
        if key and key not in chaves:
            chaves.append(key)
    return chaves


def resolve_target_references(item: dict, tabela: dict) -> list[str]:
    """
    Com referências da agenda/resumo → só essas (ainda dentro de 12 meses).
    Sem referências (primeiro download da UC) → até 12 meses da tabela.
    """
    refs = item.get("referencias")
    if isinstance(refs, list) and refs:
        keys = normalize_reference_keys(refs)
        if keys:
            return filter_references_last_12_months(keys)
    return filter_references_last_12_months(all_reference_keys_from_table(tabela))

def scroll_widget_into_view(page) -> None:
    """Rola a página para Y entre 600 e 700px (uma vez por carga)."""
    trigger_lazy_widgets(page)


def find_input_id_by_label(page, label_text: str) -> str | None:
    return page.evaluate(
        """(texto) => {
          const normalizar = (s) => (s || "").trim().toLowerCase();
          const alvo = normalizar(texto);
          const elementos = Array.from(
            document.querySelectorAll("span, label, div, p")
          );
          for (const el of elementos) {
            if (!normalizar(el.textContent).startsWith(alvo)) continue;
            const temFilho = Array.from(el.children).some((filho) =>
              normalizar(filho.textContent).startsWith(alvo)
            );
            if (temFilho) continue;
            const container =
              el.closest(".form-group") ||
              el.closest(".grupo-field") ||
              el.parentElement;
            const input = container && container.querySelector("input, textarea");
            if (input && input.id) return input.id;
          }
          return null;
        }""",
        label_text,
    )


def wait_for_input_by_label(page, label_text: str, timeout_ms: int = 20_000) -> str:
    deadline = time.time() + timeout_ms / 1000
    last_err: Exception | None = None
    while time.time() < deadline:
        if is_stopped():
            raise RuntimeError("Interrompido")
        try:
            input_id = find_input_id_by_label(page, label_text)
            if input_id:
                return f"#{input_id}"
        except Exception as e:
            last_err = e
        time.sleep(0.3)
    msg = f'Campo "{label_text}" não apareceu na página a tempo'
    if last_err:
        msg += f" ({last_err})"
    raise RuntimeError(msg)


def wait_step_visible(page, selector: str, timeout_ms: int = 20_000) -> bool:
    deadline = time.time() + timeout_ms / 1000
    while time.time() < deadline:
        if is_stopped():
            return False
        wait_if_paused(page)
        try:
            visible = page.evaluate(
                """(sel) => {
                  const el = document.querySelector(sel);
                  return !!(el && !el.classList.contains("hidden"));
                }""",
                selector,
            )
            if visible:
                return True
        except Exception:
            pass
        emit_screenshot(page)
        time.sleep(0.35)
    return False


def read_login_toast(page) -> str | None:
    """Texto visível do toast pós-Solicitar (#pnaviso, #pmaviso ou .alert-oh)."""
    try:
        return page.evaluate(
            """(sels) => {
              const visivel = (el) => {
                if (!el) return false;
                const wrap =
                  el.closest(".toast-alert, .alert, [role='alert']") || el;
                const st = window.getComputedStyle(wrap);
                const r = wrap.getBoundingClientRect();
                if (st.display === "none" || st.visibility === "hidden")
                  return false;
                if (Number(st.opacity) === 0) return false;
                if (r.width < 2 || r.height < 2) return false;
                return true;
              };
              const nodes = [];
              for (const sel of sels) {
                const el = document.querySelector(sel);
                if (el) nodes.push(el);
              }
              for (const el of document.querySelectorAll(
                ".toast-alert #pnaviso, .toast-alert #pmaviso, .alert.alert-oh"
              )) {
                nodes.push(el);
              }
              for (const el of nodes) {
                if (!visivel(el)) continue;
                const txt = (el.innerText || el.textContent || "")
                  .replace(/\\s+/g, " ")
                  .trim();
                if (txt) return txt;
              }
              return null;
            }""",
            [QA_SEL["pnaviso"], QA_SEL["pmaviso"]],
        )
    except Exception:
        return None


def classify_login_toast(aviso: str | None) -> str | None:
    if not aviso:
        return None
    # Token (NoneCap/2captcha) recusado no postback: cita o hCaptcha para o
    # plano seguir para a próxima etapa em vez de virar erro de dados.
    if re.search(r"captcha|rob[oô]", aviso, re.I):
        return HCAPTCHA_RECUSADO_MSG
    if is_corporativo_wrong_flow_text(aviso):
        return CORPORATIVO_WRONG_FLOW_MSG
    if is_invalid_credentials_text(aviso):
        return CREDENTIALS_ERROR_MSG
    return None


def read_doc_form_error(page) -> str | None:
    try:
        return page.evaluate(
            """({ docInvalido, docObrigatorio }) => {
              const docVal = document.querySelector(docInvalido);
              const docObr = document.querySelector(docObrigatorio);
              if (docVal && docVal.style.display !== "none")
                return (docVal.innerText || "").trim();
              if (docObr && docObr.style.display !== "none")
                return (docObr.innerText || "").trim();
              return null;
            }""",
            {
                "docInvalido": QA_SEL["doc_invalido"],
                "docObrigatorio": QA_SEL["doc_obrigatorio"],
            },
        )
    except Exception:
        return None


def read_doc_invalido_error(page) -> str | None:
    """Só o erro inline `#CONTENT_Formulario_DocVal` ("documento inválido") —
    separado de `read_doc_form_error` (que também olha `doc_obrigatorio`,
    campo em branco, um erro diferente) pra poder checar isto a cada volta do
    loop sem esperar o timeout inteiro."""
    try:
        return page.evaluate(
            """(sel) => {
              const el = document.querySelector(sel);
              if (el && el.style.display !== "none") {
                const txt = (el.innerText || "").trim();
                return txt || null;
              }
              return null;
            }""",
            QA_SEL["doc_invalido"],
        )
    except Exception:
        return None


def wait_step2_or_credentials_error(page, timeout_ms: int = 165_000) -> None:
    """
    Após "Solicitar": avança p/ canal de envio, ou a ENEL devolve toast
    (#pnaviso / #pmaviso) — CPF inválido ou cliente Corporativo — ou mostra o
    erro inline `#CONTENT_Formulario_DocVal` ("documento inválido"), sem
    toast nenhum. Nessas três, não vale retry — e detecta na hora (não
    espera o timeout inteiro, que existe só pra quando a ENEL trava sem
    mostrar nenhum erro).

    O step-2 da ENEL às vezes demora (45s não bastava); espera 2 min a mais.
    """
    deadline = time.time() + timeout_ms / 1000
    last_aviso: str | None = None
    while time.time() < deadline:
        if is_stopped():
            raise RuntimeError("Interrompido")
        aviso = read_login_toast(page)
        if aviso:
            last_aviso = aviso
            mapped = classify_login_toast(aviso)
            if mapped:
                log(f"✘ {mapped}", "error")
                raise RuntimeError(mapped)
        if read_doc_invalido_error(page):
            log(f"✘ {DOC_INVALIDO_MSG}", "error")
            raise RuntimeError(DOC_INVALIDO_MSG)
        if read_contrato_encerrado(page):
            log(f"✘ {CONTRATO_ENCERRADO_MSG}", "error")
            raise RuntimeError(CONTRATO_ENCERRADO_MSG)
        try:
            visible = page.evaluate(
                """(sel) => {
                  const el = document.querySelector(sel);
                  return !!(el && !el.classList.contains("hidden"));
                }""",
                QA_SEL["step2"],
            )
            if visible:
                return
        except Exception:
            pass
        emit_screenshot(page)
        time.sleep(0.35)

    if read_contrato_encerrado(page):
        log(f"✘ {CONTRATO_ENCERRADO_MSG}", "error")
        raise RuntimeError(CONTRATO_ENCERRADO_MSG)
    aviso = last_aviso or read_login_toast(page)
    mapped = classify_login_toast(aviso)
    if mapped:
        log(f"✘ {mapped}", "error")
        raise RuntimeError(mapped)
    doc_err = read_doc_form_error(page)
    mapped_doc = classify_login_toast(doc_err)
    if mapped_doc:
        log(f"✘ {mapped_doc}", "error")
        raise RuntimeError(mapped_doc)
    raise RuntimeError(
        doc_err
        or "Não avançou para a etapa de canal de envio (dados podem estar incorretos)"
    )


def send_channel_and_open_code_screen(page, radio: str) -> str:
    """Clica no canal, envia o código e abre a tela de código. Devolve since_iso."""
    page.click(f"#{radio}")
    sleep_with_ui(page, 0.3)
    emit_screenshot(page)
    page.wait_for_selector(QA_SEL["submit_step2"], state="visible", timeout=10_000)
    since_iso = datetime.now(timezone.utc).isoformat()
    page.click(QA_SEL["submit_step2"])
    emit_screenshot(page)
    if not wait_step_visible(page, QA_SEL["step3"], 20_000):
        raise RuntimeError("Não foi possível confirmar o envio do código")
    set_progress("qa_sent")
    emit_screenshot(page)
    page.wait_for_selector(QA_SEL["continue_step3"], state="visible", timeout=10_000)
    page.click(QA_SEL["continue_step3"])
    emit_screenshot(page)
    if not wait_step_visible(page, QA_SEL["step4"], 20_000):
        raise RuntimeError("Tela de código de segurança não apareceu")
    set_progress("qa_await_code")
    emit_screenshot(page)
    return since_iso


def click_resend_codigo(page) -> None:
    """Na tela do código, 'Reenviar Código' volta à escolha de canal (step-2)."""
    log("↩ Reenviando código — voltando à escolha de e-mail...", "info")
    page.wait_for_selector(QA_SEL["resend_codigo"], state="visible", timeout=10_000)
    page.click(QA_SEL["resend_codigo"])
    emit_screenshot(page)
    if not wait_step_visible(page, QA_SEL["step2"], 20_000):
        raise RuntimeError(
            "Reenviar código não voltou à tela de canal de envio"
        )


def await_outlook_code(
    page,
    user_id: str | None,
    since_iso: str,
    numero_cliente: str,
    nome_email: str | None,
    exclude_message_ids: list[str] | None = None,
    capturar_saudacao: bool = False,
) -> tuple[str, str | None, str | None]:
    """Retorna (code, messageId, nomeEmail capturado). `exclude_message_ids`
    pula e-mails já tentados nesta rodada (código inválido / reenvio)."""
    if nome_email:
        log(
            f"📬 Aguardando código no Outlook (Nome_email: {nome_email})...",
            "info",
        )
    elif capturar_saudacao:
        log(
            "📬 Nome_email desta UC está vazio — aguardando o próximo e-mail "
            'da ENEL com "Olá, ..." (até 5 min) para cadastrar o Nome_email.',
            "info",
        )
    else:
        log(
            "⚠ Nome_email desta UC está vazio — a busca do OTP no Outlook "
            "não filtra pelo nome. Se o e-mail atrasar ou o nome não estiver "
            "no cadastro, a extração vai falhar.",
            "warn",
        )
        log("📬 Aguardando código de segurança no Outlook...", "info")
    emit(
        {
            "type": "qa_awaiting_code",
            "numeroCliente": numero_cliente,
            "sinceIso": since_iso,
            "nomeEmail": nome_email,
        }
    )
    return wait_outlook_security_code(
        user_id,
        since_iso,
        OTP_CAPTURA_ESPERA_MS if capturar_saudacao else OTP_ESPERA_MS,
        page=page,
        content_contains=nome_email,
        exclude_message_ids=exclude_message_ids,
        capturar_saudacao=capturar_saudacao,
    )


def read_invalid_code_text_anywhere(page) -> str | None:
    """Fallback do `read_login_toast` (que só olha #pnaviso/#pmaviso/
    .alert-oh) — varre qualquer texto visível na página procurando a frase
    'código de verificação inválido', caso a ENEL use um componente de aviso
    diferente nesta tela específica."""
    try:
        return page.evaluate(
            """() => {
              const body = (document.body && document.body.innerText) || "";
              const m = body.match(/c[óo]digo\\s+de\\s+verifica[cç][ãa]o\\s+inv[áa]lido[^.\\n]{0,80}\\.?/i);
              return m ? m[0].replace(/\\s+/g, " ").trim() : null;
            }"""
        )
    except Exception:
        return None


def wait_code_submit_result(page, timeout_ms: int = 20_000) -> str | None:
    """Depois de clicar 'Enviar' na tela de código: checa cedo se a ENEL
    mostrou o aviso 'Código de verificação inválido' — em vez de só
    descobrir isso depois dos 2 min de espera pela tela de fatura. Se nada
    aparecer neste tempo, retorna None (segue o fluxo normal: ou já está
    processando, ou vai aparecer a tela de fatura)."""
    deadline = time.time() + timeout_ms / 1000
    while time.time() < deadline:
        if is_stopped():
            raise RuntimeError("Interrompido")
        aviso = read_login_toast(page)
        if aviso and is_invalid_otp_code_text(aviso):
            return aviso
        aviso = read_invalid_code_text_anywhere(page)
        if aviso:
            return aviso
        emit_screenshot(page)
        time.sleep(0.35)
    return None


def submit_security_code(page, code: str) -> str | None:
    """Preenche e envia o código. Devolve o aviso de inválido, ou None se a
    ENEL aceitou (ou não mostrou erro neste prazo)."""
    page.wait_for_selector(QA_SEL["codigo_seguranca"], state="visible", timeout=10_000)
    page.fill(QA_SEL["codigo_seguranca"], "")
    page.type(QA_SEL["codigo_seguranca"], code, delay=40)
    sleep_with_ui(page, 0.3)
    emit_screenshot(page)
    page.wait_for_selector(QA_SEL["submit_codigo"], state="visible", timeout=10_000)
    page.click(QA_SEL["submit_codigo"])
    emit_screenshot(page)
    return wait_code_submit_result(page)


def resolve_channel_by_radio(
    canais: list[dict[str, Any]], radio: str
) -> dict[str, Any] | None:
    return next((c for c in canais if c.get("radio") == radio), None)


def resolve_second_email_channel(
    canais: list[dict[str, Any]],
    email_segunda_via: str | None,
    primeiro_radio: str,
) -> dict[str, Any] | None:
    restantes = [
        c
        for c in matching_email_channels(canais, email_segunda_via)
        if c.get("radio") != primeiro_radio
    ]
    return restantes[0] if restantes else None


def _resend_and_pick_channel(
    page,
    email_segunda_via: str | None,
    *,
    same_radio: str | None = None,
    exclude_radio: str | None = None,
) -> dict[str, Any] | None:
    """Clica em Reenviar Código, volta ao step-2 e escolhe o canal pedido."""
    click_resend_codigo(page)
    canais = discover_channels(page)
    if exclude_radio:
        return resolve_second_email_channel(canais, email_segunda_via, exclude_radio)
    if same_radio:
        mesmo = resolve_channel_by_radio(canais, same_radio)
        if mesmo:
            return mesmo
        matched = matching_email_channels(canais, email_segunda_via)
        return matched[0] if matched else (canais[0] if canais else None)
    return None


def _send_wait_and_submit_otp(
    page,
    canal: dict[str, Any],
    user_id: str | None,
    numero_cliente: str,
    nome_email: str | None,
    excluded_ids: list[str],
) -> tuple[str | None, str | None, str | None]:
    """Envia pelo canal, espera o Outlook e submete.

    Retorna (code, message_id, None) se a ENEL aceitou o código.
    Retorna (None, message_id, "otp_wait"|"invalid") se deve partir pro
    reenvio — não fica esperando outro e-mail que pode nunca chegar.
    Outros erros sobem.
    """
    escolhido = canal["radio"]
    canal_label = canal.get("label") or escolhido
    capturar = captura_nome_email(nome_email, canal)
    holder = f"{numero_cliente}:{os.getpid()}"
    aguardar_portao_otp(page, user_id, holder, capturar)
    try:
        since_iso = send_channel_and_open_code_screen(page, escolhido)
        log(
            f"✅ Código de segurança enviado para o cliente {numero_cliente} ({canal_label}).",
            "success",
        )
        try:
            code, message_id, nome_capturado = await_outlook_code(
                page,
                user_id,
                since_iso,
                numero_cliente,
                nome_email,
                excluded_ids,
                capturar,
            )
        except Exception as otp_e:
            if is_stopped():
                raise
            msg_otp = str(otp_e)
            if not is_otp_wait_error(msg_otp):
                raise
            log(f"⚠ Código não chegou em {canal_label}.", "warn")
            return None, None, "otp_wait"
    finally:
        # O e-mail desta UC já chegou (ou desistiu): os outros extratores
        # podem enviar os códigos deles.
        liberar_portao_otp(user_id, holder)

    if message_id:
        excluded_ids.append(message_id)

    origem = "informado manualmente" if OTP_MANUAL else "recebido no Outlook"
    log(f"✔ Código {origem}: {code}", "success")
    set_progress("qa_code")
    aviso = submit_security_code(page, code)
    if aviso:
        log(
            f"⚠ {aviso} — não espera outro e-mail no Outlook (pode nunca "
            f"chegar). Vai reenviar o código pela ENEL.",
            "warn",
        )
        return None, message_id, "invalid"
    if nome_capturado:
        # A ENEL aceitou: o e-mail era mesmo desta UC.
        gravar_nome_email_capturado(numero_cliente, nome_capturado)
    return code, message_id, None


def captura_nome_email(nome_email: str | None, canal: dict[str, Any]) -> bool:
    """UC sem Nome_email com código indo por e-mail para o Outlook: o próximo
    e-mail com "Olá, ..." vira o Nome_email dela."""
    return not nome_email and not OTP_MANUAL and canal.get("kind") == "email"


def collect_and_submit_enel_otp(
    page,
    candidatos: list[dict[str, Any]],
    email_segunda_via: str | None,
    user_id: str | None,
    numero_cliente: str,
    nome_email: str | None,
) -> tuple[str, str | None, str, str]:
    """Pede o OTP na ENEL e submete, com no máximo 3 envios:

    1) canal inicial
    2) Reenviar Código → o mesmo e-mail de antes
    3) se ainda falhar e houver outro e-mail do mesmo padrão: Reenviar → 2º

    Se nada chegar, levanta o erro de OTP no Outlook — sem ficar à espera
    de um e-mail extra e sem repetir o login.
    """
    if not candidatos:
        raise RuntimeError("Nenhum canal de envio disponível para este cliente")

    excluded_ids: list[str] = []
    primeiro = candidatos[0]
    primeiro_radio = primeiro["radio"]
    tem_segundo = resolve_second_email_channel(
        candidatos, email_segunda_via, primeiro_radio
    ) is not None

    tentativas: list[str] = ["first", "same"]
    if tem_segundo:
        tentativas.append("second")

    canal = primeiro

    for passo in tentativas:
        if passo == "same":
            log(
                "↩ Reenviando código para o mesmo e-mail da tentativa anterior...",
                "info",
            )
            try:
                canal = _resend_and_pick_channel(
                    page, email_segunda_via, same_radio=primeiro_radio
                )
            except Exception as e:
                log(f"⚠ Falha ao reenviar código: {e}", "warn")
                break
            if not canal:
                continue
        elif passo == "second":
            log(
                "↩ Código ainda não chegou — tentando o segundo e-mail do mesmo padrão...",
                "info",
            )
            try:
                canal = _resend_and_pick_channel(
                    page, email_segunda_via, exclude_radio=primeiro_radio
                )
            except Exception as e:
                log(f"⚠ Falha ao reenviar código: {e}", "warn")
                break
            if not canal:
                log(
                    "⚠ Segundo e-mail do mesmo domínio não apareceu após reenviar.",
                    "warn",
                )
                break

        canal_label = canal.get("label") or canal["radio"]
        log(f"✉ Enviando código para {canal_label}...", "info")
        code, message_id, fail = _send_wait_and_submit_otp(
            page,
            canal,
            user_id,
            numero_cliente,
            nome_email,
            excluded_ids,
        )
        if fail is None:
            return code or "", message_id, canal["radio"], canal_label
        if fail == "otp_wait" and captura_nome_email(nome_email, canal):
            # 5 min com os outros extratores parados e nenhum "Olá, ..." —
            # não reenvia: a UC vai para Manual (ver `_emit_item_result`).
            log(f"✘ {EMAIL_NAO_CADASTRADO_MSG}", "error")
            raise RuntimeError(EMAIL_NAO_CADASTRADO_MSG)

    msg = (
        EMAIL_NAO_CADASTRADO_MSG
        if captura_nome_email(nome_email, canal)
        else otp_timeout_message(nome_email)
    )
    log(f"✘ {msg}", "error")
    raise RuntimeError(msg)


def fill_client_data(page, numero_cliente: str, cpf_cnpj: str) -> bool:
    numero_sel = wait_for_input_by_label(page, "Número de Cliente")
    page.fill(numero_sel, "")
    page.type(numero_sel, str(numero_cliente), delay=random.randint(20, 60))

    cpf_sel = wait_for_input_by_label(page, "Número do CPF")
    page.fill(cpf_sel, "")
    page.type(cpf_sel, str(cpf_cnpj), delay=random.randint(20, 60))

    cliente_val = page.input_value(numero_sel)
    if cliente_val != str(numero_cliente):
        log(
            "⚠ Campo Número do Cliente foi limpo após preenchimento (página recarregou).",
            "warn",
        )
        return False
    log("✔ Número do cliente e CPF/CNPJ preenchidos.", "success")
    set_progress("qa_form_fill")
    return True


def discover_channels(page) -> list[dict[str, Any]]:
    return page.evaluate(
        """(channels) => {
          return channels
            .filter((c) => {
              const rowEl = document.querySelector(c.row);
              return rowEl && !rowEl.classList.contains("hidden");
            })
            .map((c) => {
              const valueEl = document.querySelector(c.value_sel);
              const value = (valueEl && valueEl.value) || "";
              return {
                radio: c.radio,
                kind: c.kind,
                value,
                label:
                  (c.kind === "email" ? "E-mail" : "Telefone") +
                  ": " +
                  (value || "—"),
              };
            });
        }""",
        QA_CHANNELS,
    )


def pick_channel(
    canais: list[dict[str, Any]],
    channel_mode: str,
    email_segunda_via: str | None,
) -> dict[str, Any]:
    if email_segunda_via:
        match = next(
            (
                c
                for c in canais
                if c.get("kind") == "email"
                and email_matches_mask(email_segunda_via, c.get("value"))
            ),
            None,
        )
        if match:
            return match
    if channel_mode in ("email", "telefone"):
        preferido = next((c for c in canais if c.get("kind") == channel_mode), None)
        if preferido:
            return preferido
    return canais[0]


def wait_manual_channel(page=None, timeout_s: float = 120) -> str | None:
    _channel_event.clear()
    with _control_lock:
        global _channel_choice
        _channel_choice = None
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        if is_stopped():
            return None
        if _channel_event.wait(1.0):
            with _control_lock:
                return _channel_choice
        emit_screenshot(page)
    return None


def read_invoice_table(page) -> dict | None:
    """
    Lê só linhas de fatura (com checkbox), ignora paginação/cabeçalho.
    Cada célula traz label (do th/header) + value.
    """
    return page.evaluate(
        f"""() => {{
          const table =
            document.querySelector("{QA_TABLE_SEL}") ||
            document.querySelector("{QA_GRID_SEL} table") ||
            Array.from(document.querySelectorAll("table")).find((t) => {{
              const headers = Array.from(t.querySelectorAll("th, thead td"))
                .map((c) => (c.innerText || "").trim().toLowerCase())
                .join(" | ");
              return /refer[êe]ncia/.test(headers) ||
                (t.id || "").toLowerCase().includes("gridviewsegvia");
            }});
          if (!table) return null;

          let headers = Array.from(table.querySelectorAll("thead th")).map((th) =>
            (th.innerText || "").trim()
          );
          if (!headers.length) {{
            const headerRow = table.querySelector("tr");
            if (headerRow && headerRow.querySelectorAll("th").length) {{
              headers = Array.from(headerRow.querySelectorAll("th")).map((th) =>
                (th.innerText || "").trim()
              );
            }}
          }}

          const rows = [];
          for (const tr of table.querySelectorAll("tbody tr, tr")) {{
            if (tr.classList.contains("enel-pagination")) continue;
            if (tr.querySelectorAll("th").length && !tr.querySelector("td")) continue;
            const checkbox = tr.querySelector('input[type="checkbox"]');
            if (!checkbox) continue;
            const cells = Array.from(tr.querySelectorAll("td")).map((td, i) => ({{
              label: td.getAttribute("data-label") || headers[i] || "",
              value: (td.innerText || "").trim(),
            }}));
            if (!cells.length) continue;
            rows.push(cells);
          }}
          return {{ headers, rows }};
        }}"""
    )


def read_pagination_state(page) -> dict | None:
    """
    Lê a paginação da GridView de faturas (`tr.enel-pagination`, ASP.NET
    WebForms): a página ativa aparece como texto puro (sem link); as demais
    são `<a href="javascript:__doPostBack('...','Page$N')">N</a>`.
    None se não achou a linha de paginação (uma página só, sem paginador).
    """
    try:
        return page.evaluate(
            """() => {
              const pagRow = document.querySelector('tr.enel-pagination');
              if (!pagRow) return null;
              const cells = Array.from(pagRow.querySelectorAll('table td'));
              const pages = [];
              let current = null;
              for (const td of cells) {
                const text = (td.innerText || '').trim();
                if (!/^\\d+$/.test(text)) continue;
                const a = td.querySelector('a');
                if (a) {
                  pages.push({ number: parseInt(text, 10), href: a.getAttribute('href') || '' });
                } else if (current === null) {
                  current = parseInt(text, 10);
                }
              }
              return { current, pages };
            }"""
        )
    except Exception:
        return None


def _parse_postback_args(href: str) -> tuple[str, str] | None:
    m = re.search(r"__doPostBack\('([^']*)'\s*,\s*'([^']*)'\)", href or "")
    if not m:
        return None
    return m.group(1), m.group(2)


def wait_after_pagination_postback(page) -> None:
    """Espera o __doPostBack de paginação da GridView estabilizar (sem
    esperar o botão 'Salvar em PDF' — que só aparece com um checkbox
    marcado, o que não é o caso aqui)."""
    sleep_with_ui(page, 1.0)
    try:
        page.wait_for_load_state("networkidle", timeout=8_000)
    except Exception:
        pass
    try:
        page.wait_for_selector(QA_TABLE_SEL, state="visible", timeout=10_000)
    except Exception:
        pass
    emit_screenshot(page)


def go_to_page(page, numero: int, uc: str) -> bool:
    """Navega pra página `numero` da GridView de faturas (via __doPostBack
    do link do paginador). True se já estava lá ou se navegou com sucesso."""
    estado = read_pagination_state(page)
    if not estado:
        # Sem paginador na tela = página única. Só "1" é alcançável.
        return numero == 1
    if estado.get("current") == numero:
        return True
    alvo = next((p for p in estado.get("pages") or [] if p.get("number") == numero), None)
    if not alvo:
        return False
    args = _parse_postback_args(alvo.get("href") or "")
    if not args:
        return False
    log(f"➡ UC {uc}: navegando para a página {numero} da tabela de faturas...", "info")
    try:
        page.evaluate(
            "([a, b]) => { if (typeof __doPostBack === 'function') __doPostBack(a, b); }",
            list(args),
        )
    except Exception as e:
        log(f"⚠ Falha ao navegar para a página {numero}: {e}", "warn")
        return False
    wait_after_pagination_postback(page)
    return True


MAX_PAGINATION_PAGES = 12


def collect_invoice_table_rows(page, uc: str) -> list:
    """
    Lê a GridView até cobrir os últimos 12 meses. Não segue o histórico
    antigo (2017…) — essas linhas, se aparecerem na última página lida,
    só entram no resumo; PDF fica só para a janela de 12 meses.
    """
    if not go_to_page(page, 1, uc):
        log(
            f"⚠ UC {uc}: não consegui garantir a página 1 antes de ler o histórico.",
            "warn",
        )
    todas: list = []
    tabela = read_invoice_table(page)
    oldest = oldest_allowed_month_key()
    for _ in range(MAX_PAGINATION_PAGES):
        if is_stopped():
            raise RuntimeError("Interrompido")
        wait_if_paused(page)
        if not tabela or not tabela.get("rows"):
            break
        todas.extend(tabela["rows"])
        last_key = row_reference_key(tabela["rows"][-1])
        if last_key and last_key < oldest:
            log(
                f"⚠ UC {uc}: histórico anterior a {oldest} — só grava no resumo, sem baixar PDF.",
                "info",
            )
            break
        estado = read_pagination_state(page)
        atual = (estado or {}).get("current")
        proxima_num = (atual + 1) if atual else None
        if not proxima_num or not go_to_page(page, proxima_num, uc):
            break
        tabela = read_invoice_table(page)
    go_to_page(page, 1, uc)
    return todas


def locate_reference_with_pagination(
    page, alvo: str, uc: str
) -> tuple[dict | None, int, str | None]:
    """
    Procura `alvo` (YYYY-MM) na GridView, paginando pra frente quando
    preciso. A tabela vem ordenada da referência mais nova pra mais antiga,
    então: se `alvo` não está na página atual e é MENOR (mais antigo) que a
    última referência listada nela, ele pode estar numa página seguinte —
    avança. Sempre recomeça da página 1 antes de procurar: o site da ENEL
    volta pra lá sozinho depois de cada download (ver `download_invoice_for_reference`),
    então cada busca aqui garante o ponto de partida certo mesmo que uma
    busca anterior tenha ficado parada numa página do meio.

    Detecta o "buraco" (mês pulado — não existe fatura pra ele): se, ao
    avançar de página, o primeiro item da página seguinte já é mais antigo
    que `alvo`, o mês nunca vai aparecer (ex.: última da página 1 é 10/2025,
    primeira da página 2 é 08/2025, alvo era 09/2025). Não vale reload+espera
    nesse caso — o postback de download sempre volta pra página 1 e bateria
    no mesmo buraco de novo.

    Devolve (tabela_onde_parou, row_index ou -1, motivo_do_buraco ou None).
    """
    if not go_to_page(page, 1, uc):
        log(
            f"⚠ UC {uc}: não consegui garantir a página 1 antes de procurar {alvo}.",
            "warn",
        )

    oldest = oldest_allowed_month_key()
    if alvo < oldest:
        return read_invoice_table(page), -1, None

    tabela = read_invoice_table(page)
    for _ in range(MAX_PAGINATION_PAGES):
        if is_stopped():
            raise RuntimeError("Interrompido")
        wait_if_paused(page)
        if not tabela or not tabela.get("rows"):
            return tabela, -1, None

        idx = find_row_index_by_reference(tabela, alvo)
        if idx >= 0:
            return tabela, idx, None

        last_key = row_reference_key(tabela["rows"][-1])
        if not last_key or alvo >= last_key or last_key < oldest:
            # Alvo não é mais antigo que o fim desta página — se não estava
            # nela, não tem mais onde procurar (avançar só acharia meses
            # ainda mais antigos, inclusive fora da janela de 12 meses).
            return tabela, -1, None

        estado = read_pagination_state(page)
        atual = (estado or {}).get("current")
        proxima_num = (atual + 1) if atual else None
        if not proxima_num or not go_to_page(page, proxima_num, uc):
            return tabela, -1, None

        nova_tabela = read_invoice_table(page)
        if not nova_tabela or not nova_tabela.get("rows"):
            return nova_tabela, -1, None

        primeiro_key = row_reference_key(nova_tabela["rows"][0])
        if primeiro_key and primeiro_key < alvo:
            motivo = (
                f"referência {alvo} não existe na listagem "
                f"(página pulou de {last_key} direto pra {primeiro_key})"
            )
            log(f"✘ UC {uc}: {motivo}.", "error")
            return nova_tabela, -1, motivo

        tabela = nova_tabela

    log(
        f"⚠ UC {uc}: parou de paginar após {MAX_PAGINATION_PAGES} páginas procurando {alvo}.",
        "warn",
    )
    return tabela, -1, None


def find_missing_references_paginated(
    page, alvos: list[str], uc: str
) -> tuple[list[str], list[str]]:
    """
    Confere cada alvo em `alvos` paginando a GridView quando preciso.
    Devolve (ainda_pode_esperar, confirmado_como_buraco) — a segunda lista
    nunca deve entrar no retry de "atualiza e espera 2 min" (ver
    `wait_for_missing_references`): recarregar sempre volta pra página 1 e
    bateria no mesmo buraco de novo.
    """
    esperar: list[str] = []
    confirmado: list[str] = []
    for alvo in alvos:
        _, idx, motivo = locate_reference_with_pagination(page, alvo, uc)
        if idx >= 0:
            continue
        if motivo:
            confirmado.append(alvo)
        else:
            esperar.append(alvo)
    return esperar, confirmado


MISSING_REF_MAX_ATTEMPTS = 3
MISSING_REF_WAIT_SECONDS = 120


def wait_for_missing_references(
    page, alvos: list[str], uc: str
) -> tuple[list[str], list[str]]:
    """
    Confere quais `alvos` existem na listagem — paginando a GridView quando
    preciso (ver `find_missing_references_paginated`). Os que ainda "podem
    esperar" (não geradas ainda, mais novas que tudo que já apareceu na
    listagem) tentam de novo com atualização de página + 2 min de espera,
    até 3x. Os confirmados como "buraco" (mês pulado, não existe fatura pra
    ele) NÃO entram nesse retry — recarregar sempre volta pra página 1 e
    bateria no mesmo buraco de novo, então não adianta tentar de novo.

    Devolve (ainda_faltando_apos_tentativas, confirmados_como_inexistentes).
    """
    esperar, confirmado = find_missing_references_paginated(page, alvos, uc)
    for attempt in range(1, MISSING_REF_MAX_ATTEMPTS + 1):
        if not esperar:
            break
        if is_stopped():
            raise RuntimeError("Interrompido")
        wait_if_paused(page)
        if attempt >= MISSING_REF_MAX_ATTEMPTS:
            log(
                f"✘ UC {uc}: referência(s) {', '.join(esperar)} não apareceu(ram) "
                f"após {MISSING_REF_MAX_ATTEMPTS} tentativas com atualização da página.",
                "error",
            )
            break

        log(
            f"⚠ UC {uc}: não há fatura da referência {', '.join(esperar)} na tabela. "
            f"Atualizando a página e aguardando 2 min "
            f"(tentativa {attempt}/{MISSING_REF_MAX_ATTEMPTS})...",
            "warn",
        )
        try:
            page.reload(wait_until="domcontentloaded", timeout=60_000)
        except Exception as e:
            log(f"⚠ Falha ao atualizar a página: {e}", "warn")
        sleep_with_ui(page, 3.0)
        if is_stopped():
            raise RuntimeError("Interrompido")
        log("⏳ Aguardando 2 minutos para a fatura aparecer no histórico...", "info")
        sleep_with_ui(page, MISSING_REF_WAIT_SECONDS, shot_every=15.0)
        if is_stopped():
            raise RuntimeError("Interrompido")
        wait_if_paused(page)
        emit_screenshot(page)

        deadline = time.time() + 30
        pronto = False
        while time.time() < deadline:
            if is_stopped():
                raise RuntimeError("Interrompido")
            wait_if_paused(page)
            try:
                tabela = read_invoice_table(page)
                if tabela and tabela.get("rows"):
                    pronto = True
                    break
            except Exception:
                pass
            emit_screenshot(page)
            time.sleep(1.0)
        emit_screenshot(page)
        if not pronto:
            continue

        esperar, novos_confirmados = find_missing_references_paginated(page, esperar, uc)
        confirmado.extend(novos_confirmados)

    return esperar, confirmado


def _aspnet_parse_delta(text: str) -> dict[str, Any]:
    s = text or ""
    if s.startswith("1|#|"):
        s = s[4:]
        if s.startswith("|"):
            s = s[1:]
    out: dict[str, Any] = {"fields": {}, "panels": {}, "redirect": None}
    type_alt = "|".join(_ASPNET_DELTA_TYPES)
    pos = 0
    while True:
        m = re.search(rf"(?:^|\|)(\d+)\|({type_alt})\|", s[pos:])
        if not m:
            break
        length = int(m.group(1))
        typ = m.group(2)
        start = pos + m.end()
        id_end = s.find("|", start)
        if id_end < 0:
            break
        ident = s[start:id_end]
        content = s[id_end + 1 : id_end + 1 + length]
        pos = id_end + 1 + length
        if typ == "hiddenField":
            out["fields"][ident] = content
        elif typ == "updatePanel":
            out["panels"][ident] = content
        elif typ == "pageRedirect":
            out["redirect"] = content
        elif typ == "error":
            out["error"] = content
    return out


def _aspnet_encode(data: dict[str, str]) -> str:
    parts = []
    for key, value in data.items():
        parts.append(f"{quote(str(key), safe='')}={quote(str(value), safe='')}")
    return "&".join(parts)


def _qa_segvia_url(page) -> str:
    current = page.url or ""
    if "SegundaViaAcessoRapido" in current:
        return current.split("#")[0]
    return QA_SEGVIA_URL


def _qa_action_url(page, snap: dict[str, Any]) -> str:
    """URL do postback a partir do `action` do formulário — sempre na ENEL."""
    action = str(snap.get("action") or "")
    url = urljoin(_qa_segvia_url(page), action or "SegundaViaAcessoRapido.aspx")
    if "eneldistribuicao.com.br" not in (urlparse(url).hostname or ""):
        return _qa_segvia_url(page)
    return url


def _qa_http(page, method: str, url: str, data: dict[str, str] | None = None, *, ajax: bool = False) -> dict[str, Any]:
    body = _aspnet_encode(data) if data else None
    headers: dict[str, str] = {
        "Referer": page.url or url,
        "Origin": "https://www.eneldistribuicao.com.br",
    }
    if body:
        headers["Content-Type"] = "application/x-www-form-urlencoded; charset=UTF-8"
    if ajax:
        headers["X-Requested-With"] = "XMLHttpRequest"
        headers["X-MicrosoftAjax"] = "Delta=true"
        headers["Cache-Control"] = "no-cache"
        headers["Accept"] = "*/*"
    else:
        headers["Accept"] = (
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
        )
    log(f"[http] {method} {url}" + (" ajax" if ajax else "") + (f" fields={len(data)}" if data else ""))
    res = request_fetch(page, url, method=method, data=body, headers=headers)
    n = len(res.get("raw") or b"")
    log(f"[http] {res.get('status')} {res.get('ct')} {n} bytes")
    return res


# O formulário ASP.NET (o do __VIEWSTATE), não o primeiro da página: a 2ª via
# também traz um formulário de pagamento do Itaú (ww27.itau.com.br) antes dele.
_QA_FORM_JS = """(Array.from(document.forms).find(
    (f) => f.querySelector('input[name="__VIEWSTATE"]')) || document.querySelector('form'))"""

_QA_READ_FORM_JS = """() => {
  const fields = {};
  const form = """ + _QA_FORM_JS + """;
  for (const el of (form || document).querySelectorAll('input, select, textarea')) {
    if (!el.name) continue;
    const type = (el.type || '').toLowerCase();
    if (type === 'file') continue;
    if ((type === 'checkbox' || type === 'radio') && !el.checked) continue;
    if (type === 'submit' || type === 'button' || type === 'image') continue;
    fields[el.name] = el.value == null ? '' : String(el.value);
  }
  const sm = document.querySelector('[name*="ScriptManager"], [id*="ScriptManager"]');
  const table = document.querySelector('#CONTENT_segviarapida_GridViewSegVia');
  const checks = Array.from((table || document).querySelectorAll('input[type="checkbox"]')).map((cb) => ({
    name: cb.name || '',
    id: cb.id || '',
    checked: !!cb.checked,
  })).filter((c) => /CheckFatura/i.test(c.name || c.id));
  const btn = document.querySelector('#CONTENT_segviarapida_btnSalvarPDF');
  return {
    fields,
    scriptManager: sm ? (sm.getAttribute('name') || sm.id || '') : '',
    checks,
    saveBtn: btn ? { name: btn.name || '', value: btn.value || 'Salvar em PDF' } : null,
    action: (form && (form.getAttribute('action') || '')) || '',
  };
}"""


def _qa_read_form(page) -> dict[str, Any]:
    return safe_evaluate(page, _QA_READ_FORM_JS) or {}


def _qa_sync_hidden(page, fields: dict[str, str]) -> None:
    if not fields:
        return
    try:
        safe_evaluate(
            page,
            """(fields) => {
              const form = """ + _QA_FORM_JS + """;
              if (!form) return;
              const nodes = Array.from(form.querySelectorAll('input, select, textarea'));
              for (const [name, value] of Object.entries(fields || {})) {
                let el = nodes.find((n) => n.name === name);
                if (!el) {
                  el = document.createElement('input');
                  el.type = 'hidden';
                  el.name = name;
                  form.appendChild(el);
                  nodes.push(el);
                }
                el.value = value == null ? '' : String(value);
              }
            }""",
            fields,
        )
    except Exception:
        pass


def _qa_apply_grid_delta(page, delta: dict[str, Any]) -> None:
    _qa_sync_hidden(page, delta.get("fields") or {})
    panels = delta.get("panels") or {}
    html = (
        panels.get("CONTENT_segviarapida_PnGridFaturas")
        or panels.get(QA_CHECK_PANEL)
        or next(iter(panels.values()), None)
    )
    if not html:
        return
    try:
        safe_evaluate(
            page,
            """(html) => {
              const el = document.getElementById('CONTENT_segviarapida_PnGridFaturas');
              if (el) el.innerHTML = html;
            }""",
            html,
        )
    except Exception:
        pass
    emit_screenshot(page)


def _qa_post_checkbox(page, checkbox_name: str, *, checked: bool) -> dict[str, Any]:
    """POST ASP.NET AJAX equivalente ao __doPostBack do checkbox (um por vez)."""
    snap = _qa_read_form(page)
    fields = {
        k: v
        for k, v in dict(snap.get("fields") or {}).items()
        if "CheckFatura" not in str(k)
    }
    sm = str(snap.get("scriptManager") or "")
    if sm:
        fields[sm] = f"{QA_CHECK_PANEL}|{checkbox_name}"
    fields["__EVENTTARGET"] = checkbox_name
    fields["__EVENTARGUMENT"] = ""
    if checked:
        fields[checkbox_name] = "on"
    url = _qa_action_url(page, snap)
    log(
        f"↻ POST checkbox {'marcar' if checked else 'desmarcar'} {checkbox_name}",
        "info",
    )
    res = _qa_http(page, "POST", url, fields, ajax=True)
    status = int(res.get("status") or 0)
    text = res.get("text") or ""
    if status < 200 or status >= 400:
        raise RuntimeError(f"POST checkbox HTTP {status}")
    delta = _aspnet_parse_delta(text)
    if delta.get("error"):
        raise RuntimeError(f"ASP.NET: {str(delta['error'])[:240]}")
    _qa_apply_grid_delta(page, delta)
    return delta


def _qa_post_salvar_pdf(page) -> bytes | None:
    """POST completo em btnSalvarPDF (não é XHR — devolve o PDF)."""
    snap = _qa_read_form(page)
    fields = dict(snap.get("fields") or {})
    btn = snap.get("saveBtn") or {}
    name = str(btn.get("name") or "ctl00$CONTENT$segviarapida$btnSalvarPDF")
    fields[name] = str(btn.get("value") or "Salvar em PDF")
    fields["__EVENTTARGET"] = ""
    fields["__EVENTARGUMENT"] = ""
    url = _qa_action_url(page, snap)
    log("⬇ POST btnSalvarPDF (download)", "info")
    res = _qa_http(page, "POST", url, fields, ajax=False)
    raw = res.get("raw") or b""
    if raw.startswith(b"%PDF"):
        return raw
    return None


def _checkbox_name_at(page, row_index: int) -> str:
    val = safe_evaluate(
        page,
        f"""(idx) => {{
          const table =
            document.querySelector("{QA_TABLE_SEL}") ||
            document.querySelector("{QA_GRID_SEL} table");
          if (!table) return '';
          const dataRows = Array.from(table.querySelectorAll("tbody tr, tr")).filter((tr) => {{
            if (tr.classList.contains("enel-pagination")) return false;
            return !!tr.querySelector('input[type="checkbox"]');
          }});
          const cb = dataRows[idx] && dataRows[idx].querySelector('input[type="checkbox"]');
          return (cb && cb.name) || '';
        }}""",
        row_index,
    )
    return str(val or "")


def find_row_index_by_reference(tabela: dict, alvo: str) -> int:
    for i, row in enumerate(tabela.get("rows") or []):
        if row_reference_key(row) == alvo:
            return i
    return -1


def click_invoice_row(page, row_index: int) -> bool:
    """Marca o checkbox da linha. O site dispara __doPostBack — esperar depois."""
    return bool(
        page.evaluate(
            f"""(idx) => {{
              const table =
                document.querySelector("{QA_TABLE_SEL}") ||
                document.querySelector("{QA_GRID_SEL} table");
              if (!table) return false;
              const dataRows = Array.from(
                table.querySelectorAll("tbody tr, tr")
              ).filter((tr) => {{
                if (tr.classList.contains("enel-pagination")) return false;
                return !!tr.querySelector('input[type="checkbox"]');
              }});
              const row = dataRows[idx];
              const checkbox = row && row.querySelector('input[type="checkbox"]');
              if (!checkbox) return false;
              if (!checkbox.checked) checkbox.click();
              return true;
            }}""",
            row_index,
        )
    )


def ensure_download_dir() -> None:
    DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)


def list_pdfs() -> set[str]:
    ensure_download_dir()
    return {f.name for f in DOWNLOAD_DIR.iterdir() if f.suffix.lower() == ".pdf"}


def destino_sem_sobrescrever(desired_name: str) -> str:
    """Se o PDF do mês já está em disco, grava `.... temp.pdf`.

    2 Via não mostra fatura cancelada. O backend compara a temp com a
    linha já convertida e decide se ela vira a normal, a Old, ou se some.
    """
    path = DOWNLOAD_DIR / desired_name
    if not path.exists() or desired_name.lower().endswith(" temp.pdf"):
        return desired_name
    if desired_name.lower().endswith(".pdf"):
        return desired_name[:-4] + " temp.pdf"
    return desired_name + " temp.pdf"


def rename_new_pdf(existing: set[str], desired_name: str) -> str | None:
    current = list_pdfs()
    downloaded = next((f for f in current if f not in existing), None)
    if not downloaded:
        return None
    desired_name = destino_sem_sobrescrever(desired_name)
    old_path = DOWNLOAD_DIR / downloaded
    new_path = DOWNLOAD_DIR / desired_name
    if new_path.exists() and new_path != old_path:
        new_path.unlink()
    old_path.rename(new_path)
    return desired_name


def wait_after_checkbox_postback(page) -> None:
    """Checkbox da GridView dispara __doPostBack — espera a tabela estabilizar."""
    sleep_with_ui(page, 1.2)
    try:
        page.wait_for_selector(QA_SALVAR_PDF_SEL, state="visible", timeout=15_000)
    except Exception:
        pass
    try:
        page.wait_for_load_state("networkidle", timeout=8_000)
    except Exception:
        pass
    emit_screenshot(page)


def firefox_download_prefs() -> dict[str, Any]:
    """Força o Firefox/Camoufox a baixar PDF em disco em vez de abrir o viewer."""
    ensure_download_dir()
    return {
        "pdfjs.disabled": True,
        "browser.download.folderList": 2,
        "browser.download.dir": str(DOWNLOAD_DIR),
        "browser.download.useDownloadDir": True,
        "browser.download.manager.showWhenStarting": False,
        "browser.download.alwaysOpenPanel": False,
        "browser.helperApps.neverAsk.saveToDisk": (
            "application/pdf,application/octet-stream,application/x-pdf,"
            "application/acrobat,applications/vnd.pdf,text/pdf,text/x-pdf"
        ),
        "browser.helperApps.alwaysAsk.force": False,
    }


def save_pdf_bytes(data: bytes, desired_name: str) -> str:
    if not data or not data.startswith(b"%PDF"):
        raise RuntimeError("Conteúdo capturado não é um PDF válido")
    ensure_download_dir()
    desired_name = destino_sem_sobrescrever(desired_name)
    target = DOWNLOAD_DIR / desired_name
    if target.exists():
        target.unlink()
    target.write_bytes(data)
    return desired_name


def try_save_pdf_from_page(popup, desired_name: str) -> str | None:
    """Tenta extrair PDF de uma aba/popup (URL blob, data: ou navegação PDF)."""
    try:
        popup.wait_for_load_state("domcontentloaded", timeout=10_000)
    except Exception:
        pass
    time.sleep(0.8)

    def _as_pdf(raw: bytes) -> str | None:
        if raw and raw.startswith(b"%PDF"):
            return save_pdf_bytes(raw, desired_name)
        return None

    # 1) URL atual — page.request, sem Uint8Array/Xrays no evaluate
    try:
        url = popup.url or ""
        if url.startswith("http"):
            saved = _as_pdf(request_fetch(popup, url, timeout_ms=15_000).get("raw") or b"")
            if saved:
                return saved
    except Exception:
        pass

    # 2) embed/iframe/object do viewer (só URL http; blob fica no listener de download)
    try:
        src = safe_evaluate(
            popup,
            """() => {
              const el = document.querySelector(
                'embed[type*="pdf"], object[type*="pdf"], iframe[src*=".pdf"]'
              );
              return (el && (el.src || el.getAttribute('data') || el.getAttribute('src'))) || '';
            }""",
        )
        if src and str(src).startswith("http"):
            saved = _as_pdf(request_fetch(popup, str(src), timeout_ms=15_000).get("raw") or b"")
            if saved:
                return saved
    except Exception:
        pass
    return None


def download_pdf_via_button(page, desired_name: str) -> str:
    """POST em SegundaViaAcessoRapido.aspx (btnSalvarPDF); fallback no clique."""
    ensure_download_dir()
    try:
        raw = _qa_post_salvar_pdf(page)
        if raw:
            saved = save_pdf_bytes(raw, desired_name)
            log(f"✔ PDF via POST ({len(raw)} bytes).", "success")
            return saved
        log("⚠ POST btnSalvarPDF não devolveu PDF; tentando o botão na tela.", "warn")
    except Exception as e:
        log(f"⚠ POST PDF falhou ({e}); tentando o botão na tela.", "warn")

    existing = list_pdfs()
    context = page.context
    btn = page.locator(QA_SALVAR_PDF_SEL)
    if btn.count() == 0:
        raise RuntimeError(f'Botão "Salvar em PDF" ({QA_SALVAR_PDF_SEL}) não encontrado')

    captured: dict[str, Any] = {"bytes": None, "download": None}
    main_pages = set(context.pages)

    def on_response(response) -> None:
        if captured["bytes"] is not None:
            return
        try:
            headers = {str(k).lower(): str(v) for k, v in (response.headers or {}).items()}
            ct = headers.get("content-type", "").lower()
            cd = headers.get("content-disposition", "").lower()
            url = (response.url or "").lower()
            looks_pdf = (
                "application/pdf" in ct
                or "pdf" in cd
                or url.endswith(".pdf")
                or ("pdf" in url and ("gerar" in url or "segunda" in url or "fatura" in url))
            )
            if not looks_pdf:
                return
            body = response.body()
            if body and body.startswith(b"%PDF"):
                captured["bytes"] = body
                log(f"✔ PDF capturado via response ({len(body)} bytes).", "success")
        except Exception:
            pass

    def on_download(download) -> None:
        captured["download"] = download

    page.on("response", on_response)
    try:
        context.on("response", on_response)
    except Exception:
        pass
    page.on("download", on_download)

    try:
        log('👉 Clicando em "Salvar em PDF"...', "info")
        dismiss_download_confirmation(page)
        btn.first.click(timeout=15_000)
        sleep_with_ui(page, 0.8)
        aviso = read_enel_dialog_text(page)
        if aviso:
            raise EnelSiteDialogError(aviso)

        deadline = time.time() + 45
        last_err: Exception | None = None
        while time.time() < deadline:
            if is_stopped():
                raise RuntimeError("Interrompido")
            wait_if_paused(page)

            dl = captured.get("download")
            if dl is not None:
                try:
                    nome = destino_sem_sobrescrever(desired_name)
                    target = DOWNLOAD_DIR / nome
                    if target.exists():
                        target.unlink()
                    dl.save_as(str(target))
                    log(f"✔ PDF salvo via evento download: {nome}", "success")
                    return nome
                except Exception as e:
                    last_err = e

            if captured.get("bytes"):
                try:
                    return save_pdf_bytes(captured["bytes"], desired_name)
                except Exception as e:
                    last_err = e

            for popup in list(context.pages):
                if popup in main_pages:
                    continue
                try:
                    saved = try_save_pdf_from_page(popup, desired_name)
                    if saved:
                        try:
                            popup.close()
                        except Exception:
                            pass
                        log(f"✔ PDF salvo via popup/aba: {saved}", "success")
                        return saved
                except Exception as e:
                    last_err = e

            saved = rename_new_pdf(existing, desired_name)
            if saved:
                log(f"✔ PDF encontrado em DOWNLOAD_DIR: {saved}", "success")
                return saved

            aviso = read_enel_dialog_text(page)
            if aviso:
                raise EnelSiteDialogError(aviso)

            emit_screenshot(page)
            time.sleep(0.35)

        aviso = read_enel_dialog_text(page)
        if aviso:
            raise EnelSiteDialogError(aviso)
        detail = f" ({last_err})" if last_err else ""
        raise RuntimeError(
            "Não foi possível capturar o PDF após clicar em Salvar em PDF"
            " (sem evento download, sem response PDF, sem popup e sem arquivo na pasta)"
            + detail
        )
    finally:
        try:
            page.remove_listener("response", on_response)
        except Exception:
            pass
        try:
            context.remove_listener("response", on_response)
        except Exception:
            pass
        try:
            page.remove_listener("download", on_download)
        except Exception:
            pass
        close_extra_pages(page)


def dismiss_download_confirmation(page) -> None:
    """Fecha diálogo OK/Entendi / BootstrapDialog / iframe de aviso da ENEL."""
    try:
        fechou = page.evaluate(
            """() => {
              const roots = [
                ...document.querySelectorAll(
                  '.bootstrap-dialog, .modal.in, .modal.show, [role="dialog"], .ui-dialog'
                ),
                document.body,
              ];
              const isVisible = (el) => {
                if (!el || !(el instanceof HTMLElement)) return false;
                const st = window.getComputedStyle(el);
                return st.display !== 'none' && st.visibility !== 'hidden' && el.offsetParent !== null;
              };
              const clickables = [];
              for (const root of roots) {
                if (!root) continue;
                for (const el of root.querySelectorAll(
                  "button, a, input[type='button'], input[type='submit']"
                )) {
                  if (!isVisible(el)) continue;
                  const texto = (el.innerText || el.value || "").trim().toLowerCase();
                  if (
                    /^(ok|entendi|confirmar|fechar|continuar|sim|aceitar)$/.test(texto) ||
                    texto === "ok" ||
                    /entendi|continuar|confirmar/.test(texto)
                  ) {
                    clickables.push(el);
                  }
                }
              }
              // Prefere botões dentro de modal
              const modalBtn = clickables.find((el) =>
                el.closest('.bootstrap-dialog, .modal, [role="dialog"]')
              );
              const alvo = modalBtn || clickables[clickables.length - 1];
              if (!alvo) return false;
              alvo.click();
              return true;
            }"""
        )
        if fechou:
            log("✔ Aviso/confirmação fechado.", "info")
            sleep_with_ui(page, 0.8)
            emit_screenshot(page)
    except Exception:
        pass

    # iframe de aviso (quando a ENEL embute o diálogo)
    try:
        for frame in page.frames:
            if frame == page.main_frame:
                continue
            try:
                btn = frame.locator(
                    "button:has-text('OK'), button:has-text('Entendi'), "
                    "button:has-text('Confirmar'), button:has-text('Continuar'), "
                    "input[type='button'][value='OK'], input[value='OK']"
                )
                if btn.count() > 0:
                    btn.first.click(timeout=2000)
                    log("✔ Aviso em iframe confirmado.", "info")
                    sleep_with_ui(page, 0.8)
                    break
            except Exception:
                continue
    except Exception:
        pass


def uncheck_invoice_row(page, row_index: int) -> bool:
    """Desmarca o checkbox da linha (melhor-esforço)."""
    try:
        return bool(
            page.evaluate(
                f"""(idx) => {{
                  const table =
                    document.querySelector("{QA_TABLE_SEL}") ||
                    document.querySelector("{QA_GRID_SEL} table");
                  if (!table) return false;
                  const dataRows = Array.from(
                    table.querySelectorAll("tbody tr, tr")
                  ).filter((tr) => {{
                    if (tr.classList.contains("enel-pagination")) return false;
                    return !!tr.querySelector('input[type="checkbox"]');
                  }});
                  const row = dataRows[idx];
                  const checkbox = row && row.querySelector('input[type="checkbox"]');
                  if (!checkbox) return false;
                  if (checkbox.checked) checkbox.click();
                  return true;
                }}""",
                row_index,
            )
        )
    except Exception:
        return False


def uncheck_all_invoice_rows(page) -> None:
    """Garante que nenhum checkbox fique marcado (evita aviso de múltipla seleção)."""
    try:
        page.evaluate(
            f"""() => {{
              const table =
                document.querySelector("{QA_TABLE_SEL}") ||
                document.querySelector("{QA_GRID_SEL} table");
              if (!table) return;
              for (const cb of table.querySelectorAll('input[type="checkbox"]')) {{
                if (cb.checked) cb.click();
              }}
            }}"""
        )
        sleep_with_ui(page, 0.4)
        dismiss_download_confirmation(page)
    except Exception:
        pass


def prepare_invoice_selection(page, row_index: int) -> bool:
    """Desmarca a anterior (POST) e marca só a linha alvo (POST). Um check por vez."""
    name = _checkbox_name_at(page, row_index)
    if not name:
        return False
    dismiss_download_confirmation(page)
    snap = _qa_read_form(page)
    marked = [c for c in (snap.get("checks") or []) if c.get("checked") and c.get("name")]
    for c in marked:
        if c["name"] == name:
            continue
        try:
            _qa_post_checkbox(page, str(c["name"]), checked=False)
            log(f"✔ Desmarquei {c['name']} via POST.", "info")
        except Exception as e:
            log(f"⚠ POST desmarcar {c.get('name')}: {e}", "warn")
            uncheck_all_invoice_rows(page)
    already = any(c.get("name") == name for c in marked)
    if not already:
        try:
            _qa_post_checkbox(page, name, checked=True)
        except Exception as e:
            log(f"⚠ POST marcar checkbox falhou ({e}); caindo no clique.", "warn")
            if not click_invoice_row(page, row_index):
                return False
            wait_after_checkbox_postback(page)
    dismiss_download_confirmation(page)
    emit_screenshot(page)
    return True


def close_extra_pages(page) -> None:
    try:
        for other in list(page.context.pages):
            if other != page:
                try:
                    other.close()
                except Exception:
                    pass
    except Exception:
        pass


def settle_after_download(page) -> dict | None:
    """Após o PDF: fecha abas/modais e desmarca via POST (um checkbox só)."""
    dismiss_download_confirmation(page)
    close_extra_pages(page)
    snap = _qa_read_form(page)
    for c in snap.get("checks") or []:
        if c.get("checked") and c.get("name"):
            try:
                _qa_post_checkbox(page, str(c["name"]), checked=False)
            except Exception:
                uncheck_all_invoice_rows(page)
                break
    else:
        if not any(c.get("checked") for c in (snap.get("checks") or [])):
            uncheck_all_invoice_rows(page)
    dismiss_download_confirmation(page)
    sleep_with_ui(page, 0.6)
    emit_screenshot(page)
    return read_invoice_table(page)


def download_invoice_for_reference(page, reference_key: str, uc: str) -> bool:
    """
    Marca só o checkbox da referência, baixa o PDF, registra no backend
    (arquivo + logextracao/resumo) e desmarca — pronto para o próximo mês.

    Procura a referência paginando a GridView quando preciso (a ENEL só
    mostra a página atual no DOM) — ver `locate_reference_with_pagination`.
    """
    tabela, row_index, gap_motivo = locate_reference_with_pagination(page, reference_key, uc)
    if gap_motivo:
        raise MissingReferenceError(
            f"Mês referência {reference_key} não encontrado ({gap_motivo})"
        )
    if not tabela or not tabela.get("rows"):
        log(f"⚠ UC {uc}: tabela de 2ª via não encontrada para {reference_key}.", "warn")
        return False

    if row_index < 0:
        log(
            f"⚠ UC {uc}: não há fatura da referência {reference_key} na tabela "
            f"(mesmo após paginar).",
            "warn",
        )
        return False

    row = tabela["rows"][row_index]
    if valor_eh_zero(row_valor(row)):
        persist_logextracao_row(uc, row, reference_key)
        raise FaturaZeradaError(FATURA_ZERADA_MSG)

    if not prepare_invoice_selection(page, row_index):
        log(
            f"⚠ UC {uc}: checkbox da referência {reference_key} não encontrado.",
            "warn",
        )
        return False

    log(f"✔ Checkbox selecionado para UC {uc} ({reference_key}).", "success")

    cliente_digits = re.sub(r"\D", "", str(uc or ""))
    desired_name = f"{get_reference_slug(reference_key)} - {cliente_digits}.pdf"
    try:
        # O site da 2ª via nunca mostra "Cancelada". Se o mês já tem PDF,
        # este download sai como `.... temp.pdf`; o backend compara com a
        # fatura já convertida e decide normal, Old ou descarte.
        persist_logextracao_row(uc, row, reference_key)
        # Modal às vezes cobre o botão Salvar em PDF
        dismiss_download_confirmation(page)
        saved_name = download_pdf_via_button(page, desired_name)
        log(f"✔ PDF salvo como: {saved_name}", "success")
        register_extracted_file(saved_name)
        emit_screenshot(page)
        settle_after_download(page)
        return True
    except EnelSiteDialogError:
        emit_screenshot(page)
        try:
            settle_after_download(page)
        except Exception:
            pass
        raise
    except Exception as e:
        log(f"⚠ Falha ao baixar PDF de {reference_key}: {e}", "warn")
        emit_screenshot(page)
        try:
            settle_after_download(page)
        except Exception:
            pass
        return False


def configure_downloads(context) -> None:
    ensure_download_dir()
    try:
        context.set_default_timeout(60_000)
    except Exception:
        pass


class CamoufoxSession:
    """
    Abre/fecha o Firefox do Camoufox. Depois de 3 falhas de hCaptcha o
    widget costuma ficar irrecuperável na mesma sessão — só um processo
    novo (fingerprint novo) destrava o TRAWL.
    """

    def __init__(self, headless: bool):
        self.headless = headless
        self._cm = None
        self.browser = None
        self.page = None

    def start(self):
        self.stop()
        self._cm = open_camoufox(
            headless=self.headless,
            extra_prefs=firefox_download_prefs(),
            proxy=segunda_via_proxy(),
        )
        self.browser = self._cm.__enter__()
        self.page = self._new_page()
        return self.page

    def browser_is_alive(self) -> bool:
        try:
            if self.browser is None:
                return False
            _ = self.browser.contexts
            return True
        except Exception:
            return False

    def _prepare_page(self, page) -> None:
        attach_trawl_init_script(page)
        net_track_context(page.context)
        configure_downloads(self.browser)
        try:
            cdp = page.context.new_cdp_session(page)
            cdp.send(
                "Browser.setDownloadBehavior",
                {
                    "behavior": "allow",
                    "downloadPath": str(DOWNLOAD_DIR),
                    "eventsEnabled": True,
                },
            )
        except Exception:
            pass
        try:
            page.context.set_default_timeout(60_000)
        except Exception:
            pass

    def _new_page(self):
        try:
            page = self.browser.new_page()
        except Exception:
            page = self.browser.new_page()
        self._prepare_page(page)
        return page

    def new_page(self):
        """Nova aba SEM fechar a última antes — o Firefox do Camoufox
        morre se a última page.close() rodar com o browser ainda vazio,
        e o próximo page.goto vira 'Target page has been closed'."""
        if not self.browser_is_alive():
            return self.start()
        old = self.page
        try:
            novo = self._new_page()
        except Exception:
            return self.start()
        if old is not None:
            try:
                if old != novo:
                    old.close()
            except Exception:
                pass
        try:
            close_extra_pages(novo)
        except Exception:
            pass
        self.page = novo
        return self.page

    def stop(self) -> None:
        page = self.page
        cm = self._cm
        self.page = None
        self.browser = None
        self._cm = None
        if page is not None:
            try:
                close_extra_pages(page)
            except Exception:
                pass
            try:
                page.close()
            except Exception:
                pass
        if cm is not None:
            try:
                cm.__exit__(None, None, None)
            except Exception:
                pass


class ChromeSession:
    """
    Fallback da 2ª via: Chrome do SeleniumBase (CDP Mode) do começo ao fim.
    `page` é um SbPage (API de página do Playwright em cima do SeleniumBase).
    """

    def __init__(self, headless: bool, usar_proxy: bool = True):
        self.headless = headless
        # Etapa do plano do hCaptcha com/sem o proxy da 2ª via (SEGUNDA_VIA_PROXY).
        self.usar_proxy = usar_proxy
        self.chrome = None
        self.page = None

    def start(self):
        from chrome_cdp_browser import ChromeCdp, SbPage

        self.stop()
        ensure_download_dir()
        self.chrome = ChromeCdp(self.headless)
        self.chrome.start(download_dir=DOWNLOAD_DIR, usar_proxy=self.usar_proxy)
        self.page = SbPage(self.chrome)
        return self.page

    def browser_is_alive(self) -> bool:
        return self.chrome is not None and self.chrome.is_alive()

    def emit_screenshot(self) -> None:
        emit_screenshot(self.page)

    def _open_page(self) -> None:
        self.chrome.goto(URL)
        if not self.chrome.wait_loaded():
            # Com "hCaptcha" na mensagem a falha vai para a próxima tentativa,
            # que abre outro Chrome (e outra sessão/IP do proxy).
            raise RuntimeError(
                "Não foi possível resolver o hCaptcha: a página da 2ª via não "
                f"carregou ({self.chrome.motivo_falha_carregamento(URL)})"
            )
        time.sleep(random.uniform(1.0, 2.0))

    def open_and_solve_hcaptcha(self, preview: bool = True, tentativas: int | None = None) -> bool:
        """Abre a 2ª via e resolve o hCaptcha por CDP (press/release)."""
        from hcaptcha_chrome import solve_hcaptcha_sb

        shot = self.emit_screenshot if preview else None
        self._open_page()
        if shot:
            shot()
        return solve_hcaptcha_sb(self.chrome.sb, on_step=shot, tentativas=tentativas)

    def open_until_hcaptcha(self) -> bool:
        """Abre a 2ª via e rola até o widget, sem clicar (etapas NoneCap/2captcha)."""
        from hcaptcha_chrome import nudge_scroll, wait_widget

        self._open_page()
        self.emit_screenshot()
        if not wait_widget(self.chrome.sb):
            return False
        nudge_scroll(self.chrome.sb)
        return True

    def reload_until_hcaptcha(self) -> bool:
        """Recarrega a 2ª via (mesma rolagem) até o widget aparecer de novo."""
        from hcaptcha_chrome import wait_widget

        sb = self.chrome.sb
        y = sb.evaluate("window.scrollY || 0")
        sb.reload(ignore_cache=False)
        if not wait_widget(sb, timeout_s=15):
            return False
        sb.evaluate(f"window.scrollTo(0, {int(y or 0)})")
        self.emit_screenshot()
        return True

    def new_page(self):
        return self.page

    def stop(self) -> None:
        chrome = self.chrome
        self.chrome = None
        self.page = None
        if chrome is not None:
            chrome.stop()


# "nonecap" e "2captcha" rodam no Chrome, mas o hCaptcha é resolvido pelo
# serviço em vez do clique: o NoneCap devolve o token pronto
# (hcaptcha_nonecap.py) e o 2captcha resolve o desafio por coordenadas
# (hcaptcha_2captcha.py). O Camoufox saiu do plano da 2ª via; fica só no modo
# interativo (--browser camoufox).
BROWSER_LABELS = {
    "camoufox": "Camoufox",
    "chrome": "Chrome",
    "nonecap": "NoneCap",
    "2captcha": "2captcha",
}


def browser_kind(config: dict[str, Any]) -> str:
    kind = str(config.get("browser") or "").lower()
    # Sem `browser` no payload (ou com "camoufox", que cai no desafio visual),
    # só clique no Chrome.
    return kind if kind in METODOS_HCAPTCHA else "chrome"


def tentativas_da_etapa(config: dict[str, Any]) -> int:
    return _inteiro_entre(config.get("hcaptchaRepeticoes"), 1, 5, TENTATIVAS_POR_SOLVER)


def open_session(etapa: dict[str, Any]):
    return ChromeSession(HEADLESS, usar_proxy=etapa.get("proxy", True))


def _resolver_desafio_2captcha(session: ChromeSession, config: dict[str, Any]) -> bool:
    """Desafio visual do hCaptcha resolvido pelo 2captcha (CoordinatesTask)
    na página já aberta — ver hcaptcha_2captcha.py."""
    # Import tardio: um pacote sem o módulo (ex.: app desktop antigo) só perde
    # o 2captcha, não a 2ª via inteira.
    from hcaptcha_2captcha import resolver_hcaptcha_2captcha

    page = session.page
    ok = resolver_hcaptcha_2captcha(
        session.chrome.sb,
        config,
        esperar=lambda s: sleep_with_ui(page, s),
        deve_parar=is_stopped,
        log=log,
        on_step=session.emit_screenshot,
    )
    session.emit_screenshot()
    return ok


def _open_and_solve_hcaptcha_nonecap(session: ChromeSession, config: dict[str, Any]):
    """Chrome com o token do hCaptcha pedido ao NoneCap e injetado no formulário."""
    from hcaptcha_nonecap import ErroNoneCap, resolver_hcaptcha_nonecap

    if not session.browser_is_alive():
        raise RuntimeError("Target page, context or browser has been closed")
    set_progress("captcha")
    log("↕ Abrindo a página no Chrome e rolando (600–700px) até o hCaptcha...", "info")
    if not session.open_until_hcaptcha():
        raise RuntimeError("hCaptcha não encontrado na página")
    tentativas = tentativas_da_etapa(config)
    for n in range(1, tentativas + 1):
        if n > 1:
            log("↻ Recarregando a página para pedir outro token ao NoneCap...", "info")
            if not session.reload_until_hcaptcha():
                raise RuntimeError("hCaptcha não encontrado na página")
        try:
            ok = resolver_hcaptcha_nonecap(
                session.chrome.sb,
                config,
                URL,
                proxy=session.chrome.proxy,
                deve_parar=is_stopped,
                log=log,
            )
        except ErroNoneCap as exc:
            if n == tentativas or "não configurada" in str(exc):
                raise
            log(f"⚠ {exc}. Tentando de novo...", "warn")
            continue
        session.emit_screenshot()
        if ok or is_stopped():
            return session.page
    raise RuntimeError("Não foi possível resolver o hCaptcha pelo NoneCap")


def _open_and_solve_hcaptcha_chrome(session: ChromeSession, config: dict[str, Any]):
    """Chrome: abre a 2ª via e resolve o hCaptcha só clicando (SeleniumBase)."""
    if not session.browser_is_alive():
        raise RuntimeError("Target page, context or browser has been closed")
    set_progress("captcha")
    log("↕ Abrindo a página no Chrome e rolando (600–700px) até o hCaptcha...", "info")
    tentativas = tentativas_da_etapa(config)
    log(f"🧩 Clicando no hCaptcha (Chrome, CDP press/release, até {tentativas}x)...", "info")
    ok = session.open_and_solve_hcaptcha(tentativas=tentativas)
    session.emit_screenshot()
    if not ok:
        raise RuntimeError("Não foi possível resolver o hCaptcha")
    return session.page


def _open_and_solve_hcaptcha_2captcha(session: ChromeSession, config: dict[str, Any]):
    """Chrome com o desafio do hCaptcha resolvido direto pelo 2captcha."""
    if not session.browser_is_alive():
        raise RuntimeError("Target page, context or browser has been closed")
    set_progress("captcha")
    log("↕ Abrindo a página no Chrome e rolando (600–700px) até o hCaptcha...", "info")
    if not session.open_until_hcaptcha():
        raise RuntimeError("hCaptcha não encontrado na página")
    tentativas = tentativas_da_etapa(config)
    for n in range(1, tentativas + 1):
        if n > 1:
            log("↻ Recarregando a página para tentar o 2captcha de novo...", "info")
            if not session.reload_until_hcaptcha():
                raise RuntimeError("hCaptcha não encontrado na página")
        log(f"🧩 Resolvendo o hCaptcha pelo 2captcha (coordenadas, tentativa {n}/{tentativas})...", "info")
        if _resolver_desafio_2captcha(session, config) or is_stopped():
            return session.page
    raise RuntimeError("Não foi possível resolver o hCaptcha")


def run_single(
    page,
    item: dict[str, Any],
    config: dict[str, Any],
    session: CamoufoxSession | ChromeSession | None = None,
) -> dict[str, Any]:
    chrome = session if isinstance(session, ChromeSession) else None
    numero_cliente = str(item.get("numeroCliente") or "").strip()
    cpf_cnpj = str(item.get("cpfCnpj") or "").strip()
    email_segunda_via = (item.get("emailSegundaVia") or "").strip() or None
    nome_email = (item.get("nomeEmail") or item.get("nome_email") or "").strip() or None
    channel_mode = config.get("channelMode") or "email"
    max_retries = int(config.get("maxRetries") or 3)
    user_id = config.get("userId")

    for attempt in range(max_retries):
        if attempt and config.get("loginGate"):
            aguardar_vez_do_login()
        wait_if_paused(page)
        if is_stopped():
            return {"status": "cancelled"}

        try:
            set_progress("qa_page_load")
            log(f"🌐 Abrindo página de 2ª via (cliente {numero_cliente})...", "info")
            if chrome is not None and browser_kind(config) == "nonecap":
                page = _open_and_solve_hcaptcha_nonecap(chrome, config)
                if is_stopped():
                    return {"status": "cancelled"}
            elif chrome is not None and browser_kind(config) == "2captcha":
                page = _open_and_solve_hcaptcha_2captcha(chrome, config)
                if is_stopped():
                    return {"status": "cancelled"}
            elif chrome is not None:
                page = _open_and_solve_hcaptcha_chrome(chrome, config)
            else:
                try:
                    fechada = page is None or page.is_closed()
                except Exception:
                    fechada = True
                if fechada:
                    log(
                        f"⚠ Navegador/aba já estava fechado ao abrir a UC {numero_cliente}. "
                        "Vou reabrir o Camoufox e tentar de novo.",
                        "warn",
                    )
                    return {
                        "status": "error",
                        "message": "Target page, context or browser has been closed",
                    }
                page.goto(URL, wait_until="domcontentloaded", timeout=60_000)
                sleep_with_ui(page, random.uniform(1.0, 2.0))
                emit_screenshot(page)

                wait_if_paused(page)
                if is_stopped():
                    return {"status": "cancelled"}

                set_progress("captcha")
                log("↕ Rolando a página (600–700px) até o hCaptcha...", "info")
                scroll_widget_into_view(page)
                sleep_with_ui(page, 0.5)
                emit_screenshot(page)

                if not has_hcaptcha_widget(page, timeout_ms=15_000):
                    raise RuntimeError("hCaptcha não encontrado na página")

                log("🧩 Clicando no hCaptcha (mouse humanize)...", "info")
                emit_screenshot(page)
                captcha_ok = solve_hcaptcha(page, timeout_ms=45_000)
                emit_screenshot(page)
                if is_stopped():
                    return {"status": "cancelled"}
                if not captcha_ok:
                    raise RuntimeError("Não foi possível resolver o hCaptcha")
            log("✔ hCaptcha resolvido. Preenchendo UC e CPF...", "success")

            wait_if_paused(page)
            if is_stopped():
                return {"status": "cancelled"}

            if not fill_client_data(page, numero_cliente, cpf_cnpj):
                raise RuntimeError("Falha ao preencher número do cliente / CPF-CNPJ")
            emit_screenshot(page)

            wait_if_paused(page)
            if is_stopped():
                return {"status": "cancelled"}

            page.wait_for_selector(QA_SEL["submit_step1"], state="visible", timeout=10_000)
            try:
                page.locator(QA_SEL["submit_step1"]).scroll_into_view_if_needed()
            except Exception:
                pass
            sleep_with_ui(page, 0.3)
            log('👉 Clicando em "Solicitar"...', "info")
            page.click(QA_SEL["submit_step1"])
            emit_screenshot(page)

            wait_step2_or_credentials_error(page)

            set_progress("qa_step2")
            emit_screenshot(page)
            log(
                f"✔ Cliente {numero_cliente} validado. Escolhendo canal de envio...",
                "success",
            )

            canais = discover_channels(page)
            if not canais:
                raise RuntimeError("Nenhum canal de envio disponível para este cliente")

            if channel_mode == "manual":
                emit(
                    {
                        "type": "qa_channel_options",
                        "options": canais,
                        "numeroCliente": numero_cliente,
                        "cpfCnpj": cpf_cnpj,
                    }
                )
                log("⏳ Aguardando escolha manual do canal de envio...", "warn")
                escolhido = wait_manual_channel(page, 120)
                if not escolhido:
                    raise RuntimeError("Nenhum canal escolhido a tempo")
                primeiro = resolve_channel_by_radio(canais, escolhido) or {
                    "radio": escolhido,
                    "label": escolhido,
                    "kind": "email",
                    "value": "",
                }
                candidatos = [primeiro]
                for extra in matching_email_channels(canais, email_segunda_via):
                    if extra.get("radio") != primeiro.get("radio"):
                        candidatos.append(extra)
                        break
            else:
                candidatos = matching_email_channels(canais, email_segunda_via)
                if email_segunda_via and not candidatos:
                    msg = email_segunda_via_mismatch_message(
                        email_segunda_via, canais
                    )
                    log(f"✘ {msg}", "error")
                    raise RuntimeError(msg)
                if channel_mode == "telefone" or not candidatos:
                    preferido = pick_channel(
                        canais, channel_mode, email_segunda_via
                    )
                    candidatos = [preferido]
                    if (
                        email_segunda_via
                        and preferido.get("kind") == "email"
                        and (
                            email_matches_mask(
                                email_segunda_via, preferido.get("value")
                            )
                            or email_matches_domain(
                                email_segunda_via, preferido.get("value")
                            )
                        )
                    ):
                        log(
                            f"✔ Canal de e-mail correspondente a email_segunda_via ({preferido.get('value')}).",
                            "success",
                        )
                else:
                    dominio = email_domain(email_segunda_via) or "?"
                    log(
                        f"✔ {len(candidatos)} e-mail(s) com @{dominio} na tela de envio.",
                        "success",
                    )
                    if len(candidatos) >= 2:
                        log(
                            "Se o código não chegar, reenvia no mesmo e-mail; "
                            f"se ainda não chegar, tenta o 2º @{dominio} — "
                            "sem repetir o login.",
                            "info",
                        )

            _, _, escolhido, _ = collect_and_submit_enel_otp(
                page,
                candidatos,
                email_segunda_via,
                user_id,
                numero_cliente,
                nome_email,
            )

            set_progress("qa_download")
            log("⬇ Aguardando tela de fatura/PDF (até 2 min)...", "info")
            sleep_with_ui(page, 3.0)

            # A ENEL às vezes demora bastante após o código do Outlook.
            invoice_ready = False
            deadline = time.time() + 120
            while time.time() < deadline:
                if is_stopped():
                    raise RuntimeError("Interrompido")
                wait_if_paused(page)
                try:
                    ready = page.evaluate(
                        f"""() => {{
                          if (document.querySelector("{QA_TABLE_SEL}")) return true;
                          if (document.querySelector("{QA_GRID_SEL} table")) return true;
                          if (document.querySelector("{QA_SALVAR_PDF_SEL}")) return true;
                          if (
                            document.querySelector(
                              '#pdf, a[href*=".pdf" i], a[href*="download" i], iframe[src*="pdf" i]'
                            )
                          ) return true;
                          return [...document.querySelectorAll("a, button, input")].some((el) =>
                            /pdf|baixar|imprimir|download|2\\.?\\s*via|conta|salvar em pdf/i.test(
                              `${{el.textContent || ""}} ${{el.value || ""}} ${{el.id || ""}}`
                            )
                          );
                        }}"""
                    )
                    if ready:
                        invoice_ready = True
                        break
                except Exception:
                    pass
                emit_screenshot(page)
                time.sleep(0.5)

            if not invoice_ready:
                emit_screenshot(page)
                raise RuntimeError(
                    "Código enviado, mas a tela de download da fatura não apareceu em até 2 minutos"
                )

            emit_screenshot(page)
            collected_rows = collect_invoice_table_rows(page, numero_cliente)
            tabela = (
                {"rows": collected_rows}
                if collected_rows
                else read_invoice_table(page)
            )
            if collected_rows:
                for row in collected_rows:
                    persist_logextracao_row(
                        numero_cliente,
                        row,
                        row_reference_key(row) or "",
                    )

            if item.get("somenteSituacao"):
                if not tabela or not tabela.get("rows"):
                    raise RuntimeError(
                        "Tabela de faturas não encontrada para conferir a situação."
                    )
                log(
                    f"✔ UC {numero_cliente}: situação conferida no resumo (sem baixar PDF).",
                    "success",
                )
                set_progress("done")
                return {
                    "status": "downloaded",
                    "channel": escolhido,
                    "fileName": "situacao-conferida",
                    "message": "situação conferida",
                }

            arquivos: list[str] = []
            refs_pedidas = isinstance(item.get("referencias"), list) and bool(
                normalize_reference_keys(item.get("referencias"))
            )
            presentes = filter_references_last_12_months(
                all_reference_keys_from_table(tabela or {"rows": []})
            )
            presentes_set = set(presentes)
            newest = max(presentes) if presentes else None

            if refs_pedidas:
                pedidas = filter_references_last_12_months(
                    normalize_reference_keys(item.get("referencias"))
                )
                alvos = [a for a in pedidas if a in presentes_set]
                aguardar = [
                    a
                    for a in pedidas
                    if a not in presentes_set and (newest is None or a >= newest)
                ]
            else:
                alvos = resolve_target_references(item, tabela or {"rows": []})
                alvos = filter_references_last_12_months(alvos)
                aguardar = []

            if aguardar:
                esperar, gap_confirmado = wait_for_missing_references(
                    page, aguardar, numero_cliente
                )
                collected_rows = collect_invoice_table_rows(page, numero_cliente)
                tabela = (
                    {"rows": collected_rows}
                    if collected_rows
                    else read_invoice_table(page)
                )
                presentes = filter_references_last_12_months(
                    all_reference_keys_from_table(tabela or {"rows": []})
                )
                presentes_set = set(presentes)
                alvos = [a for a in (pedidas if refs_pedidas else alvos) if a in presentes_set]
                faltando = esperar + gap_confirmado
                if faltando:
                    log(
                        f"⚠ UC {numero_cliente}: ainda sem fatura de {', '.join(faltando)} "
                        f"após atualizar a página.",
                        "warn",
                    )
                    if not alvos:
                        if gap_confirmado and not esperar:
                            msg = (
                                f"Mês referência {', '.join(gap_confirmado)} não "
                                f"encontrado (não existe fatura para esse mês)"
                            )
                        else:
                            # Refresh + espera já tentados: a ENEL ainda não gerou.
                            msg = (
                                f"A fatura para o mês referência {', '.join(faltando)} "
                                f"ainda não foi gerada"
                            )
                        return {"status": "error", "message": msg}

            if not tabela or not tabela.get("rows"):
                raise RuntimeError(
                    "Tela de faturas apareceu, mas a tabela GridViewSegVia não foi encontrada"
                )
            if not alvos:
                log(
                    f"⚠ UC {numero_cliente}: nenhuma fatura dos últimos 12 meses para baixar.",
                    "warn",
                )
                set_progress("done")
                return {
                    "status": "downloaded",
                    "channel": escolhido,
                    "fileName": "",
                    "message": "fora da janela de 12 meses",
                }

            modo = (
                "agenda/resumo"
                if refs_pedidas
                else "últimos 12 meses (sem resumo prévio)"
            )
            log(
                f"🔍 UC {numero_cliente}: {len((tabela or {}).get('rows') or [])} fatura(s) na tabela; "
                f"baixando {len(alvos)} PDF(s) dos últimos 12 meses [{modo}]...",
                "info",
            )

            erros_ref: list[tuple[str, str]] = []
            for alvo in alvos:
                wait_if_paused(page)
                if is_stopped():
                    break
                try:
                    if download_invoice_for_reference(page, alvo, numero_cliente):
                        arquivos.append(alvo)
                except (EnelSiteDialogError, MissingReferenceError, FaturaZeradaError) as e:
                    msg = str(e) or FATURA_INDISPONIVEL_MSG
                    erros_ref.append((alvo, msg))
                    kind = result_status_for_message(msg)
                    log(
                        f"{'⚠' if kind == 'atencao' else '✘'} UC {numero_cliente} ({alvo}): {msg}",
                        "warn" if kind == "atencao" else "error",
                    )
                    emit(
                        {
                            "type": "qa_item_result",
                            "numeroCliente": re.sub(r"\D", "", numero_cliente)
                            or numero_cliente,
                            "cpfCnpj": cpf_cnpj,
                            "referencia": alvo,
                            "status": kind,
                            "message": msg,
                        }
                    )
                emit_screenshot(page)

            if not arquivos:
                if erros_ref:
                    msg = erros_ref[0][1]
                    return {
                        "status": result_status_for_message(msg),
                        "message": msg,
                        "referencia": erros_ref[0][0],
                    }
                msg = (
                    f"Nenhum PDF baixado para UC {numero_cliente} "
                    f"(referências tentadas: {', '.join(alvos)})"
                )
                if refs_pedidas:
                    return {"status": "error", "message": msg}
                raise RuntimeError(msg)

            file_name = ", ".join(arquivos)
            set_progress("done")
            return {
                "status": "downloaded",
                "channel": escolhido,
                "fileName": file_name,
                "message": file_name,
            }
        except Exception as e:
            emit_screenshot(page)
            msg = str(e)
            if is_browser_closed_error(msg):
                log(
                    f"⚠ Navegador fechou no page.goto da UC {numero_cliente}. "
                    f"Vou reabrir o {BROWSER_LABELS[browser_kind(config)]} e tentar de novo.",
                    "warn",
                )
                return {"status": "error", "message": msg}
            log_type = "error" if should_skip_full_retry(msg) else "warn"
            log(
                f"{'✘' if log_type == 'error' else '⚠'} Tentativa {attempt + 1}/{max_retries} "
                f"falhou para cliente {numero_cliente}: {msg}",
                log_type,
            )
            # Quem coordena os extratores (app desktop) segura o próximo login
            # de todos por 1 min — inclusive a nova tentativa deste.
            emit({"type": "qa_attempt_failed", "message": msg, "flow": "quick_access"})
            # OTP / mês ausente: repetir o fluxo 3x só gasta hCaptcha.
            # Mês que falta na tabela: refresh + 2 min já foi tentado acima.
            if attempt == max_retries - 1 or should_skip_full_retry(msg):
                return {"status": "error", "message": msg}
            sleep_with_ui(page, 2.0)

    return {"status": "error", "message": "Máximo de tentativas atingido"}


# hCaptcha: plano de Configurações › Extrações (`enel_2via_plano`, payload
# `hcaptchaPlano`). Cada etapa é um Chrome novo: método (só clique, token
# pronto do NoneCap ou desafio pelo 2captcha), tentativas no mesmo navegador
# (clica/pede, recarrega...), com ou sem o proxy da 2ª via e minutos de
# espera se falhar. NoneCap e 2captcha só entram com a chave. Mesmas regras
# de normalizarPlano2Via no backend e normalizarPlanoHcaptcha no Extractor-JS.
# No modo singleShot o Extractor-JS manda só a etapa da vez (`browser`,
# `hcaptchaRepeticoes`, `usarProxy`).
METODOS_HCAPTCHA = ("chrome", "nonecap", "2captcha")
TENTATIVAS_POR_SOLVER = 2
PLANO_HCAPTCHA_PADRAO = (
    {"metodo": "chrome", "tentativas": 2, "proxy": True, "espera_min": 1},
    {"metodo": "chrome", "tentativas": 2, "proxy": True, "espera_min": 1},
    {"metodo": "nonecap", "tentativas": 2, "proxy": True, "espera_min": 1},
    {"metodo": "2captcha", "tentativas": 2, "proxy": True, "espera_min": 1},
)


def _inteiro_entre(valor: Any, minimo: int, maximo: int, padrao: int) -> int:
    try:
        n = round(float(valor))
    except (TypeError, ValueError):
        return padrao
    return min(maximo, max(minimo, n))


def normalizar_etapa(bruta: Any) -> dict[str, Any] | None:
    if not isinstance(bruta, dict) or bruta.get("metodo") not in METODOS_HCAPTCHA:
        return None
    return {
        "metodo": bruta["metodo"],
        "tentativas": _inteiro_entre(bruta.get("tentativas"), 1, 5, TENTATIVAS_POR_SOLVER),
        "proxy": bruta.get("proxy") is not False,
        "espera_min": _inteiro_entre(bruta.get("espera_min"), 0, 60, 1),
    }


def normalizar_plano(bruto: Any) -> list[dict[str, Any]]:
    etapas = [e for e in map(normalizar_etapa, bruto if isinstance(bruto, list) else []) if e]
    return etapas[:10] or [dict(e) for e in PLANO_HCAPTCHA_PADRAO]


def etapa_do_payload(config: dict[str, Any]) -> dict[str, Any]:
    """Etapa avulsa (singleShot / bloco do app desktop) pelos campos do payload."""
    return {
        "metodo": browser_kind(config),
        "tentativas": tentativas_da_etapa(config),
        "proxy": config.get("usarProxy") is not False,
        "espera_min": _inteiro_entre(config.get("hcaptchaEsperaMin"), 0, 60, 1),
    }


def descrever_etapa(etapa: dict[str, Any]) -> str:
    metodo = "Chrome só clicando" if etapa["metodo"] == "chrome" else BROWSER_LABELS[etapa["metodo"]]
    return f"{metodo} {etapa['tentativas']}x {'com' if etapa['proxy'] else 'sem'} proxy"


def config_da_etapa(config: dict[str, Any], etapa: dict[str, Any]) -> dict[str, Any]:
    return {
        **config,
        "browser": etapa["metodo"],
        "hcaptchaRepeticoes": etapa["tentativas"],
        "usarProxy": etapa["proxy"],
    }


def _modulos_presentes(*nomes: str) -> bool:
    try:
        return all(importlib.util.find_spec(n) is not None for n in nomes)
    except (ImportError, ValueError):
        return False


def etapa_disponivel(kind: str, config: dict[str, Any] | None = None) -> bool:
    """Se a etapa do plano pode rodar AQUI. O app desktop (ExtratorPlumber)
    roda estes scripts e pode não ter a chave do 2captcha — aí a etapa é
    pulada em vez de derrubar o lote."""
    if kind == "2captcha":
        chave = (config or {}).get("twoCaptchaApiKey") or os.environ.get("TWOCAPTCHA_API_KEY")
        return bool(str(chave or "").strip()) and _modulos_presentes("hcaptcha_2captcha")
    if kind == "nonecap":
        chave = (config or {}).get("noneCapApiKey") or os.environ.get("NONECAP_API_KEY")
        return bool(str(chave or "").strip()) and _modulos_presentes("hcaptcha_nonecap")
    return True


def hcaptcha_plan(config: dict[str, Any]) -> list[dict[str, Any]]:
    """Etapas do hCaptcha da UC, só as disponíveis aqui. Com `hcaptchaPlano`
    no payload, o plano inteiro; senão, só a etapa dos campos do payload."""
    if isinstance(config.get("hcaptchaPlano"), list):
        bruto = normalizar_plano(config["hcaptchaPlano"])
    else:
        bruto = [etapa_do_payload(config)]
    plano = [e for e in bruto if etapa_disponivel(e["metodo"], config)]
    return plano or [{**PLANO_HCAPTCHA_PADRAO[0]}]


# page.goto closed: o reaper antigo matava helper do Firefox no meio do lote.
# Dá 2 recomeços (3 tentativas) porque o navegador precisa subir de novo.
BROWSER_CLOSED_RESTARTS = 2


def _emit_item_result(item: dict[str, Any], result: dict[str, Any]) -> None:
    # `final: True` marca o resultado definitivo da UC (os `qa_item_result` por
    # referência, emitidos dentro do run_single, não têm). O Node usa isso no
    # modo singleShot para decidir se refaz a UC do zero antes de publicar.
    emit(
        {
            "type": "qa_item_result",
            "numeroCliente": re.sub(r"\D", "", str(item.get("numeroCliente") or ""))
            or item.get("numeroCliente"),
            "cpfCnpj": item.get("cpfCnpj"),
            **result,
            "final": True,
        }
    )
    message = result.get("message") or ""
    if result.get("status") == "error" and (
        message
        in (
            CREDENTIALS_ERROR_MSG,
            DOC_INVALIDO_MSG,
            CONTRATO_ENCERRADO_MSG,
            EMAIL_NAO_CADASTRADO_MSG,
        )
        or is_email_channel_mismatch_error(message)
        or is_corporativo_wrong_flow_error(message)
    ):
        _marcar_uc_manual(item, message)


def _marcar_uc_manual(item: dict[str, Any], motivo: str | None = None) -> None:
    """Dados recusados pela ENEL ou contrato encerrado: a UC vai para Manual
    em /ucs, para a rotina não tentar de novo (cada tentativa gasta captcha e
    banda do proxy)."""
    numero = re.sub(r"\D", "", str(item.get("numeroCliente") or ""))
    if not numero:
        return
    try:
        resposta = post_backend(
            "/ucs/internal/dados-invalidos-2via", {"numero_cliente": numero}
        )
    except Exception as e:
        log(f"⚠ Falha ao mudar a UC {numero} para Manual: {e}", "warn")
        return
    if resposta and resposta.get("atualizadas"):
        razao = {
            CONTRATO_ENCERRADO_MSG: "contrato encerrado na ENEL",
            EMAIL_NAO_CADASTRADO_MSG: "e-mail do código OTP não chegou no Outlook",
        }.get(motivo or "", "dados inválidos na ENEL")
        if is_email_channel_mismatch_error(motivo or ""):
            razao = "email_segunda_via não está entre os e-mails da ENEL"
        elif is_corporativo_wrong_flow_error(motivo or ""):
            razao = "a ENEL pede o fluxo Corporativo"
        log(f"✔ UC {numero} mudou para extração Manual em /ucs ({razao}).", "warn")


def run_batch(config: dict[str, Any]) -> int:
    global _stopped, _paused
    with _control_lock:
        _stopped = False
        _paused = False

    items = config.get("items") or []
    if not items:
        emit({"type": "error", "message": "Nenhum item no lote", "flow": "quick_access"})
        return 1

    # singleShot: o Node sobe UM processo Python por UC (Camoufox novo, nada
    # herdado) e mata tudo ao fim. Nesse modo o Python NÃO refaz a UC sozinho
    # (hCaptcha / navegador fechado): devolve o resultado e sai, e é o Node
    # que decide se recomeça do zero num processo novo.
    single_shot = bool(config.get("singleShot"))
    index_offset = int(config.get("indexOffset") or 0)
    total_items = int(config.get("totalItems") or len(items))

    start_stdin_listener()
    ensure_download_dir()
    set_progress("qa_start")
    if single_shot:
        # O Extractor-JS já escolheu a etapa desta tentativa.
        plano_hcaptcha = [etapa_do_payload(config)]
    else:
        plano_hcaptcha = hcaptcha_plan(config)
        # App desktop: uma etapa por despacho (`hcaptchaTentativas`: 1) e, se
        # falhar, a UC vai para outro extrator com a próxima.
        limite = int(config.get("hcaptchaTentativas") or 0)
        if limite > 0:
            plano_hcaptcha = plano_hcaptcha[:limite]
        if isinstance(config.get("hcaptchaPlano"), list):
            pulados = list(
                dict.fromkeys(
                    BROWSER_LABELS[e["metodo"]]
                    for e in normalizar_plano(config["hcaptchaPlano"])
                    if not etapa_disponivel(e["metodo"], config)
                )
            )
            if pulados:
                log(
                    f"ℹ hCaptcha: {' → '.join(descrever_etapa(e) for e in plano_hcaptcha)} "
                    f"(indisponível aqui: {', '.join(pulados)}).",
                    "info",
                )
    etapa_inicial = plano_hcaptcha[0]
    etapa = etapa_inicial
    kind = etapa["metodo"]
    if not single_shot:
        log(
            f"🌐 Iniciando geração de 2ª via ({descrever_etapa(etapa)}) "
            f"para {len(items)} cliente(s)...",
            "info",
        )

    session = open_session(etapa)

    def abrir_navegador(nova_etapa: dict[str, Any]) -> None:
        nonlocal session, etapa, kind
        session.stop()
        etapa = nova_etapa
        kind = etapa["metodo"]
        session = open_session(etapa)
        session.start()
        emit_screenshot(session.page)
        set_progress("qa_start")

    exit_code = 0
    try:
        session.start()
        emit_screenshot(session.page)
        log(
            "✔ Chrome: SeleniumBase CDP Mode / pt-BR "
            + (
                f"(hCaptcha pelo {BROWSER_LABELS[kind]}"
                if kind in ("nonecap", "2captcha")
                else "(hCaptcha por CDP press/release"
            )
            + f", {etapa['tentativas']}x, {'com' if etapa['proxy'] else 'sem'} proxy).",
            "info",
        )
        log("📹 Preview da tela (Chrome) ativo.", "info")

        i = 0
        browser_restarts = 0
        hcaptcha_falhas = 0
        while i < len(items):
            if is_stopped():
                break
            wait_if_paused()
            if is_stopped():
                break

            item = items[i]
            numero = str(item.get("numeroCliente") or "")
            if browser_restarts == 0:
                net_reset()
                log(
                    f"\n📋 Cliente {index_offset + i + 1}/{total_items}: {numero}",
                    "info",
                )
            result = run_single(session.page, item, config_da_etapa(config, etapa), session)
            log_net_usage(numero)

            if (
                not single_shot
                and result.get("status") == "error"
                and is_browser_closed_error(str(result.get("message") or ""))
                and not is_stopped()
            ):
                pode_retry = browser_restarts < BROWSER_CLOSED_RESTARTS
                if pode_retry:
                    log(
                        "↻ Navegador fechou no page.goto. "
                        f"Reiniciando o {BROWSER_LABELS[kind]} e tentando esta UC de novo "
                        f"({browser_restarts + 1}/{BROWSER_CLOSED_RESTARTS})...",
                        "warn",
                    )
                else:
                    log(
                        f"✘ Navegador fechou de novo após reabrir o {BROWSER_LABELS[kind]}. "
                        "Encerrando PIDs e seguindo para o próximo cliente.",
                        "error",
                    )
                emit(
                    {
                        "type": "browser_closed",
                        "message": str(result.get("message") or ""),
                        "flow": "quick_access",
                    }
                )
                session.stop()
                time.sleep(2.5)
                if is_stopped():
                    _emit_item_result(item, {"status": "cancelled"})
                    break
                if pode_retry:
                    # Refazer = nova tela de login: no app desktop, pela vez
                    # (que respeita o 1 min após erro entre todos os extratores).
                    if config.get("loginGate"):
                        aguardar_vez_do_login()
                        if is_stopped():
                            _emit_item_result(item, {"status": "cancelled"})
                            break
                    browser_restarts += 1
                    abrir_navegador(etapa)
                    continue
                _emit_item_result(item, result)
                exit_code = 2
                browser_restarts = 0
                hcaptcha_falhas = 0
                i += 1
                if i < len(items):
                    log("⏳ Próximo cliente em 3s...", "info")
                    time.sleep(3)
                    abrir_navegador(etapa_inicial)
                continue

            if (
                not single_shot
                and result.get("status") == "error"
                and is_hcaptcha_error(str(result.get("message") or ""))
                and not is_stopped()
            ):
                hcaptcha_falhas += 1
                total = len(plano_hcaptcha)
                pode_retry = hcaptcha_falhas < total
                rotulo = BROWSER_LABELS[kind]
                if pode_retry:
                    proximo = plano_hcaptcha[hcaptcha_falhas]
                    log(
                        f"↻ Não foi possível resolver o hCaptcha no {rotulo}. "
                        f"Encerrando o {rotulo}, órfãos e PIDs do navegador e tentando "
                        f"com {descrever_etapa(proximo)} ({hcaptcha_falhas + 1}/{total})...",
                        "warn",
                    )
                else:
                    log(
                        f"✘ hCaptcha falhou nas {total} tentativas. "
                        f"Encerrando o {rotulo}, órfãos e PIDs do navegador "
                        "antes do próximo cliente...",
                        "error",
                    )
                emit(
                    {
                        "type": "hcaptcha_failed",
                        "message": str(result.get("message") or ""),
                        "flow": "quick_access",
                    }
                )
                session.stop()
                time.sleep(2.5)
                espera_s = etapa["espera_min"] * 60
                if pode_retry and espera_s > 0:
                    log(
                        f"⏸ hCaptcha falhou {hcaptcha_falhas}x. Aguardando "
                        f"{etapa['espera_min']} min antes da próxima etapa "
                        f"({descrever_etapa(proximo)})...",
                        "warn",
                    )
                    # Fora da janela de login: no app desktop a vez da tela de
                    # login passa para o outro extrator durante a pausa.
                    set_progress("qa_hcaptcha_wait")
                    fim = time.time() + espera_s
                    while time.time() < fim and not is_stopped():
                        time.sleep(0.5)
                if is_stopped():
                    _emit_item_result(item, {"status": "cancelled"})
                    break
                if pode_retry:
                    if config.get("loginGate"):
                        aguardar_vez_do_login()
                        if is_stopped():
                            _emit_item_result(item, {"status": "cancelled"})
                            break
                    browser_restarts += 1
                    abrir_navegador(proximo)
                    log(
                        f"✔ Chrome aberto ({descrever_etapa(etapa)}). Tentativa "
                        f"{hcaptcha_falhas + 1}/{total} da 2ª via do cliente {numero}...",
                        "info",
                    )
                    continue
                _emit_item_result(item, result)
                exit_code = 2
                browser_restarts = 0
                hcaptcha_falhas = 0
                i += 1
                if i < len(items):
                    log("⏳ Próximo cliente em 3s...", "info")
                    time.sleep(3)
                    abrir_navegador(etapa_inicial)
                continue

            _emit_item_result(item, result)
            if result.get("status") == "error":
                exit_code = 2

            browser_restarts = 0
            hcaptcha_falhas = 0
            i += 1
            if is_stopped():
                break
            if i < len(items):
                log("⏳ Próximo cliente em 3s...", "info")
                time.sleep(3)
                if etapa is not etapa_inicial:
                    abrir_navegador(etapa_inicial)
                else:
                    session.new_page()
    except Exception as e:
        log(f"✘ Erro fatal: {e}", "error")
        emit({"type": "error", "message": str(e), "flow": "quick_access"})
        exit_code = 1
    finally:
        session.stop()
        set_progress("done")
        if is_stopped():
            log("🛑 Processamento interrompido.", "warn")
            emit({"type": "stopped", "flow": "quick_access"})
        else:
            log("✅ Todos os clientes processados!", "success")
            emit({"type": "done", "flow": "quick_access"})

    return exit_code


def run_interactive(kind: str = "chrome") -> int:
    """Modo debug: só abre a página e resolve o hCaptcha."""
    if kind == "chrome":
        return _run_interactive_chrome()
    print("Abrindo Camoufox (fingerprint Firefox / TRAWL)...", flush=True)
    ensure_camoufox_browser()
    with open_camoufox(
        headless=False,
        extra_prefs=firefox_download_prefs(),
        proxy=segunda_via_proxy(),
    ) as browser:
        page = browser.new_page()
        attach_trawl_init_script(page)
        print(f"Abrindo: {URL}", flush=True)
        page.goto(URL, wait_until="domcontentloaded", timeout=60_000)
        time.sleep(random.uniform(1.0, 2.0))
        print(f"URL: {page.url} | Título: {page.title()}", flush=True)

        scroll_widget_into_view(page)
        time.sleep(0.5)

        if not has_hcaptcha_widget(page, timeout_ms=15_000):
            print("hCaptcha não encontrado na página.", flush=True)
            input("Pressione Enter para fechar...")
            return 1

        ok = solve_hcaptcha(page, timeout_ms=45_000)
        return _interactive_result(ok)


def _run_interactive_chrome() -> int:
    """Mesmo caminho da produção: hCaptcha pelo SeleniumBase (sem Playwright)."""
    print("Abrindo Chrome (SeleniumBase CDP Mode)...", flush=True)
    session = ChromeSession(headless=False)
    try:
        session.start()
        ok = session.open_and_solve_hcaptcha(preview=False)
        print(f"URL: {session.page.url} | Título: {session.page.title()}", flush=True)
        return _interactive_result(ok)
    finally:
        session.stop()


def _interactive_result(ok: bool) -> int:
    if ok:
        print("hCaptcha resolvido — formulário liberado.", flush=True)
    else:
        print(
            "hCaptcha NÃO resolvido (auto-pass falhou e áudio "
            "indisponível/esgotado).",
            flush=True,
        )
    input("Pressione Enter para fechar...")
    return 0 if ok else 2


def load_batch_payload(path: str | None) -> dict[str, Any]:
    if path:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    # Lê um único JSON do stdin até EOF (sem misturar com o listener de comandos)
    raw = sys.stdin.read()
    if not raw.strip():
        raise SystemExit("Payload JSON vazio (use --batch arquivo.json)")
    return json.loads(raw)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="2VIA ENEL via Camoufox/TRAWL")
    parser.add_argument(
        "--batch",
        nargs="?",
        const="-",
        default=None,
        help="Arquivo JSON do lote, ou '-' / omitido com valor para ler stdin",
    )
    parser.add_argument(
        "--interactive",
        action="store_true",
        help="Modo debug: só resolve hCaptcha e espera Enter",
    )
    parser.add_argument(
        "--browser",
        choices=("camoufox", "chrome"),
        default="chrome",
        help="Navegador do modo --interactive",
    )
    args = parser.parse_args(argv)

    if args.interactive or args.batch is None:
        if args.batch is None and not args.interactive:
            # Sem args: modo interativo legado
            return run_interactive(args.browser)
        if args.interactive:
            return run_interactive(args.browser)

    path = None if args.batch in (None, "-") else args.batch
    # Quando --batch arquivo.json, stdin fica livre para comandos de controle.
    # Quando --batch - , o payload vem do stdin e o listener de comandos não roda
    # até depois — o facade Node deve sempre passar um arquivo temp.
    if path is None:
        raise SystemExit("Use --batch payload.json (arquivo) para modo produção")
    config = load_batch_payload(path)
    return run_batch(config)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        request_stop()
        print("\nInterrompido.", flush=True)
        sys.exit(130)
