"""API interna do worker — quem chama é o n8n (ver n8n/workflows).

POST /extracoes/{site-enel|corporativo|segunda-via}  inicia e espera até o fim
                                                     (ou até a 2 VIA pedir o código)
POST /extracoes/{id}/codigo                          entrega o código OTP e espera de novo
GET  /extracoes/{id}                                 consulta (opcionalmente esperando)
DELETE /extracoes/{id}                               cancela

Os endpoints são `def` (não `async`): a espera bloqueia uma thread do pool,
não o loop do servidor.
"""

from __future__ import annotations

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from . import config
from .fluxos import FLUXOS, EntradaBase, EntradaCorporativo, EntradaSegundaVia, EntradaSiteEnel
from .jobs import ErroDeEstado, Job, JobManager

app = FastAPI(title="MultiExtractor Worker", version="1.0.0")
jobs = JobManager()


def _erro(http: int, observacao: str) -> JSONResponse:
    return JSONResponse(status_code=http, content={"status": "erro", "observacao": observacao})


@app.exception_handler(RequestValidationError)
def _validacao(_: Request, exc: RequestValidationError) -> JSONResponse:
    partes = []
    for e in exc.errors():
        campo = ".".join(str(p) for p in e.get("loc", ()) if p != "body")
        msg = str(e.get("msg", "")).removeprefix("Value error, ")
        partes.append(f"{campo}: {msg}" if campo else msg)
    return _erro(422, "Dados inválidos — " + "; ".join(partes))


@app.exception_handler(HTTPException)
def _http(_: Request, exc: HTTPException) -> JSONResponse:
    return _erro(exc.status_code, str(exc.detail))


def _job(job_id: str) -> Job:
    job = jobs.obter(job_id)
    if not job:
        raise HTTPException(404, "Extração não encontrada (id inválido ou expirada).")
    return job


def _iniciar(fluxo: str, entrada: EntradaBase, aguardar: bool, incluir_pdf: bool):
    montar_payload = FLUXOS[fluxo][1]
    try:
        payload = montar_payload(entrada)
        referencias = entrada.chaves_referencia()
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    job = jobs.criar(fluxo, payload, referencias, getattr(entrada, "uc", None))
    if aguardar:
        job.aguardar()
    return job.resposta(incluir_pdf=incluir_pdf)


@app.get("/health")
def health():
    return {
        "ok": True,
        "chaves": {"capsolver": bool(config.CAPSOLVER_API_KEY), "nonecap": bool(config.NONECAP_API_KEY)},
        "navegadores": {
            "site_enel": config.NAVEGADOR_SITE_ENEL,
            "corporativo": config.NAVEGADOR_CORPORATIVO,
            "segunda_via": "chrome",
        },
        "max_jobs_simultaneos": config.MAX_JOBS_SIMULTANEOS,
    }


@app.post("/extracoes/site-enel")
def site_enel(entrada: EntradaSiteEnel, aguardar: bool = True, incluir_pdf: bool = True):
    return _iniciar("site_enel", entrada, aguardar, incluir_pdf)


@app.post("/extracoes/corporativo")
def corporativo(entrada: EntradaCorporativo, aguardar: bool = True, incluir_pdf: bool = True):
    return _iniciar("corporativo", entrada, aguardar, incluir_pdf)


@app.post("/extracoes/segunda-via")
def segunda_via(entrada: EntradaSegundaVia, aguardar: bool = True, incluir_pdf: bool = True):
    return _iniciar("segunda_via", entrada, aguardar, incluir_pdf)


class EntradaCodigo(BaseModel):
    codigo: str | None = Field(None, description="Código de segurança recebido da ENEL")
    reenviar: bool = Field(False, description="true = o código não chegou; pedir outro à ENEL")


@app.post("/extracoes/{job_id}/codigo")
def enviar_codigo(job_id: str, entrada: EntradaCodigo, aguardar: bool = True, incluir_pdf: bool = True):
    job = _job(job_id)
    codigo = "".join((entrada.codigo or "").split())
    if not codigo and not entrada.reenviar:
        raise HTTPException(422, 'Informe "codigo" (ou "reenviar": true se o código não chegou).')
    try:
        jobs.enviar_codigo(job, "" if entrada.reenviar else codigo)
    except ErroDeEstado as exc:
        raise HTTPException(409, str(exc)) from exc
    if aguardar:
        job.aguardar()
    return job.resposta(incluir_pdf=incluir_pdf)


@app.get("/extracoes/{job_id}")
def consultar(
    job_id: str,
    aguardar: bool = False,
    incluir_pdf: bool = True,
    logs: bool = Query(False, description="Inclui as últimas linhas de log do extrator"),
):
    job = _job(job_id)
    if aguardar:
        job.aguardar()
    return job.resposta(incluir_pdf=incluir_pdf, incluir_logs=logs)


@app.delete("/extracoes/{job_id}")
def cancelar(job_id: str):
    job = _job(job_id)
    jobs.cancelar(job)
    job.aguardar(("concluido",), timeout=45)
    return job.resposta(incluir_pdf=False)

