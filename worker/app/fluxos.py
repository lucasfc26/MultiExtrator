"""Os três fluxos de extração: entrada da API → payload `--batch` dos scripts
copiados do multiextrator, e eventos NDJSON dos scripts → status da API.

Status da API: "sucesso" (PDF baixado, nada a observar), "atencao" (a ENEL
respondeu, mas sem fatura ou com ressalva — ex.: fatura zerada, impressão
bloqueada) e "erro" (login, captcha, dados inválidos, falha técnica).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Literal
from zoneinfo import ZoneInfo

from pydantic import BaseModel, Field, field_validator

from . import config

FUSO = ZoneInfo("America/Fortaleza")


# ─── Referências ──────────────────────────────────────────────────────────────


def chave_referencia(valor: str) -> str:
    """"07/2026", "7/2026", "072026", "2026-07" → "2026-07"."""
    texto = str(valor or "").strip()
    m = re.fullmatch(r"(\d{4})-(\d{1,2})", texto)
    if m:
        ano, mes = m.group(1), int(m.group(2))
    else:
        m = re.fullmatch(r"(\d{1,2})[/.\-](\d{4})", texto) or re.fullmatch(
            r"(\d{2})(\d{4})", texto
        )
        if not m:
            raise ValueError(f'referência "{valor}" inválida (use MM/AAAA)')
        mes, ano = int(m.group(1)), m.group(2)
    if not 1 <= mes <= 12:
        raise ValueError(f'referência "{valor}" com mês inválido')
    return f"{ano}-{mes:02d}"


def ultimos_12_meses() -> list[str]:
    hoje = datetime.now(FUSO)
    chaves = []
    for i in range(12):
        m0 = hoje.month - 1 - i
        chaves.append(f"{hoje.year + m0 // 12:04d}-{m0 % 12 + 1:02d}")
    return chaves


def mm_aaaa(chave: str) -> str:
    ano, mes = chave.split("-")
    return f"{mes}/{ano}"


def referencia_do_arquivo(nome: str) -> str | None:
    """"07.2026 - 123.pdf" → "07/2026" (nome que os três scripts dão ao PDF)."""
    m = re.match(r"(\d{2})\.(\d{4})", nome)
    return f"{m.group(1)}/{m.group(2)}" if m else None


# ─── Entradas da API ─────────────────────────────────────────────────────────


class EntradaBase(BaseModel):
    referencia: str | None = Field(
        None, description="MM/AAAA. Sem referência: mês atual (fuso de Fortaleza)."
    )
    referencias: list[str] | None = Field(None, description="Vários meses (MM/AAAA).")

    def chaves_referencia(self) -> list[str]:
        brutas = list(self.referencias or [])
        if self.referencia:
            brutas.insert(0, self.referencia)
        chaves: list[str] = []
        for bruta in brutas:
            chave = chave_referencia(bruta)
            if chave not in chaves:
                chaves.append(chave)
        if not chaves:
            chaves = [ultimos_12_meses()[0]]
        janela = set(ultimos_12_meses())
        fora = [mm_aaaa(c) for c in chaves if c not in janela]
        if fora:
            raise ValueError(
                f"a ENEL só disponibiliza os últimos 12 meses (fora da janela: {', '.join(fora)})"
            )
        return chaves


def _so_digitos(valor: str, campo: str) -> str:
    digitos = re.sub(r"\D", "", str(valor or ""))
    if not digitos:
        raise ValueError(f"{campo} deve ter números")
    return digitos


class EntradaSiteEnel(EntradaBase):
    usuario: str = Field(..., min_length=1, description="E-mail/login do Site ENEL")
    senha: str = Field(..., min_length=1)
    uc: str | None = Field(None, description="Nº do cliente. Sem UC: a conta padrão do login.")
    tipo_conta: Literal["empresa", "residencial"] = "empresa"

    @field_validator("uc")
    @classmethod
    def _uc(cls, v: str | None) -> str | None:
        return _so_digitos(v, "uc") if v else None


class EntradaCorporativo(EntradaBase):
    usuario: str = Field(..., min_length=1, description="Login da Agência Virtual (Corporativo)")
    senha: str = Field(..., min_length=1)
    uc: str = Field(..., description="Nº do cliente dentro do agrupamento")

    @field_validator("uc")
    @classmethod
    def _uc(cls, v: str) -> str:
        return _so_digitos(v, "uc")


class EntradaSegundaVia(EntradaBase):
    uc: str = Field(..., description="Nº do cliente")
    cpf_cnpj: str = Field(..., description="CPF/CNPJ do titular")
    email_segunda_via: str | None = Field(
        None, description="E-mail que deve receber o código (escolhe o canal certo na tela da ENEL)"
    )
    canal: Literal["email", "telefone"] = "email"

    @field_validator("uc")
    @classmethod
    def _uc(cls, v: str) -> str:
        return _so_digitos(v, "uc")

    @field_validator("cpf_cnpj")
    @classmethod
    def _doc(cls, v: str) -> str:
        digitos = _so_digitos(v, "cpf_cnpj")
        if len(digitos) not in (11, 14):
            raise ValueError("cpf_cnpj deve ter 11 (CPF) ou 14 (CNPJ) dígitos")
        return digitos


# ─── Fluxos ──────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class Fluxo:
    nome: str
    script: str
    entrada: type[EntradaBase]
    # Variáveis de ambiente extras do subprocesso.
    env: dict[str, str] = field(default_factory=dict)


def payload_site_enel(e: EntradaSiteEnel) -> dict[str, Any]:
    if not config.CAPSOLVER_API_KEY:
        raise ValueError("CAPSOLVER_API_KEY não configurada no worker")
    return {
        "configs": [
            {
                "user": e.usuario,
                "pass": e.senha,
                "typeComp": e.tipo_conta == "empresa",
                "useCapSolver": True,
                "capSolverApiKey": config.CAPSOLVER_API_KEY,
                "ucs": [e.uc] if e.uc else [],
                "referencias": e.chaves_referencia(),
            }
        ]
    }


def payload_corporativo(e: EntradaCorporativo) -> dict[str, Any]:
    return {
        "items": [
            {
                "user": e.usuario,
                "pass": e.senha,
                "numeroCliente": e.uc,
                "referencia": mm_aaaa(chave),
            }
            for chave in e.chaves_referencia()
        ],
        "maxRetries": 3,
    }


def payload_segunda_via(e: EntradaSegundaVia) -> dict[str, Any]:
    if not config.NONECAP_API_KEY:
        raise ValueError("NONECAP_API_KEY não configurada no worker")
    etapa = {
        "metodo": "nonecap",
        "tentativas": config.HCAPTCHA_TENTATIVAS_POR_ETAPA,
        "proxy": True,
        "espera_min": 0,
    }
    return {
        "items": [
            {
                "numeroCliente": e.uc,
                "cpfCnpj": e.cpf_cnpj,
                "emailSegundaVia": e.email_segunda_via,
                "referencias": [mm_aaaa(c) for c in e.chaves_referencia()],
            }
        ],
        "channelMode": e.canal,
        "maxRetries": 2,
        "hcaptchaPlano": [dict(etapa) for _ in range(config.HCAPTCHA_ETAPAS_NONECAP)],
        "noneCapApiKey": config.NONECAP_API_KEY,
    }


FLUXOS: dict[str, tuple[Fluxo, Any]] = {
    "site_enel": (
        Fluxo(
            "site_enel",
            "site_enel_camoufox.py",
            EntradaSiteEnel,
            {"NAVEGADOR": config.NAVEGADOR_SITE_ENEL},
        ),
        payload_site_enel,
    ),
    "corporativo": (
        Fluxo(
            "corporativo",
            "agencia_api.py",
            EntradaCorporativo,
            {"NAVEGADOR": config.NAVEGADOR_CORPORATIVO},
        ),
        payload_corporativo,
    ),
    "segunda_via": (
        Fluxo(
            "segunda_via",
            "extraction_trawl.py",
            EntradaSegundaVia,
            # O código OTP chega pela API (stdin {"type": "code"}), não pelo Outlook.
            {"OTP_MANUAL": "true"},
        ),
        payload_segunda_via,
    ),
}


# ─── Eventos → resultado ─────────────────────────────────────────────────────

STATUS_EVENTO = {
    "downloaded": "ok",
    "success": "ok",
    "atencao": "atencao",
    "error": "erro",
    "cancelled": "erro",
}


@dataclass
class Apuracao:
    """O que os eventos de uma extração disseram até agora."""

    problemas: list[dict[str, str]] = field(default_factory=list)
    ultimo_erro_log: str | None = None
    teve_resultado: bool = False

    def problema(self, status: str, mensagem: str | None, referencia: str | None = None) -> None:
        mensagem = (mensagem or "").strip() or (
            "Extração cancelada" if status == "erro" else "Sem detalhes"
        )
        if any(p["mensagem"] == mensagem for p in self.problemas):
            return
        item = {"status": status, "mensagem": mensagem}
        if referencia:
            item["referencia"] = referencia
        self.problemas.append(item)


def apurar_evento(evento: dict[str, Any], ap: Apuracao) -> None:
    tipo = evento.get("type")
    if tipo == "log" and evento.get("logType") == "error":
        ap.ultimo_erro_log = str(evento.get("message") or "").strip(" ✘") or ap.ultimo_erro_log
    elif tipo == "error":
        ap.problema("erro", str(evento.get("message") or ""))
    elif tipo in ("site_enel_uc_result", "corp_item_result", "qa_item_result"):
        ap.teve_resultado = True
        status = STATUS_EVENTO.get(str(evento.get("status") or ""), "erro")
        if status != "ok":
            ap.problema(status, evento.get("message"), evento.get("referencia"))
    elif tipo == "site_enel_account_result":
        ap.teve_resultado = True
        if evento.get("status") == "error" and evento.get("message") != "falha em uma ou mais UCs":
            ap.problema("erro", evento.get("message"))


def _descrever_problema(p: dict[str, str]) -> str:
    ref = p.get("referencia")
    if not ref:
        return p["mensagem"]
    if re.fullmatch(r"\d{4}-\d{2}", ref):
        ref = mm_aaaa(ref)
    return f"{ref}: {p['mensagem']}"


def apurar_final(
    ap: Apuracao,
    arquivos: list[str],
    referencias: list[str],
    codigo_saida: int | None,
    motivo_fim: str | None,
) -> tuple[str, str]:
    """(status, observacao) da extração terminada."""
    if motivo_fim:
        # O script parado só diz "Interrompido"/"cancelled"; o motivo é o nosso.
        ap.problemas = [
            p for p in ap.problemas if p["mensagem"] not in ("Extração cancelada", "Interrompido")
        ]
        ap.problemas.insert(0, {"status": "erro", "mensagem": motivo_fim})
    erros = [p for p in ap.problemas if p["status"] == "erro"]
    texto = "; ".join(_descrever_problema(p) for p in ap.problemas)
    if arquivos:
        baixadas = f"{len(arquivos)} fatura(s) baixada(s)"
        return ("atencao", f"{baixadas}. {texto}") if ap.problemas else ("sucesso", f"{baixadas}.")
    if erros:
        return "erro", texto
    if ap.problemas:
        return "atencao", texto
    if not ap.teve_resultado or codigo_saida not in (0, None):
        detalhe = ap.ultimo_erro_log or f"código de saída {codigo_saida}"
        return "erro", f"A extração terminou sem resultado ({detalhe})."
    refs = ", ".join(mm_aaaa(r) for r in referencias)
    return "atencao", f"Nenhuma fatura encontrada para a referência {refs}."
