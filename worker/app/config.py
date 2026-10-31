"""Configuração do worker, toda por variável de ambiente (ver .env.example)."""

from __future__ import annotations

import os
import sys
from pathlib import Path


def _int(nome: str, padrao: int) -> int:
    try:
        return int(os.environ.get(nome, "").strip() or padrao)
    except ValueError:
        return padrao


def _navegador(nome: str) -> str:
    valor = os.environ.get(nome, "").strip().lower()
    return valor if valor in ("camoufox", "chrome") else "camoufox"


EXTRATORES_DIR = Path(
    os.environ.get("EXTRATORES_DIR")
    or Path(__file__).resolve().parent.parent / "extratores"
)
JOBS_DIR = Path(os.environ.get("JOBS_DIR") or Path.cwd() / "jobs")
PYTHON_BIN = os.environ.get("PYTHON_BIN") or sys.executable

CAPSOLVER_API_KEY = os.environ.get("CAPSOLVER_API_KEY", "").strip()
NONECAP_API_KEY = os.environ.get("NONECAP_API_KEY", "").strip()

# Navegador do Site ENEL e do Corporativo. A 2 VIA usa sempre o Chrome do
# SeleniumBase (é o caminho do NoneCap no multiextrator).
NAVEGADOR_SITE_ENEL = _navegador("NAVEGADOR_SITE_ENEL")
NAVEGADOR_CORPORATIVO = _navegador("NAVEGADOR_CORPORATIVO")

# Quantas extrações rodam ao mesmo tempo; as demais esperam na fila. Cada uma
# é um navegador inteiro — numa VPS de 2 vCPU, mais de 1 já estrangula a CPU.
MAX_JOBS_SIMULTANEOS = max(1, _int("MAX_JOBS_SIMULTANEOS", 1))
# Limite de cada extração, sem contar o tempo esperando o código OTP.
JOB_TIMEOUT_S = max(60, _int("JOB_TIMEOUT_S", 20 * 60))
# Espera máxima pelo código OTP da 2 VIA (cada pedido de código).
OTP_TIMEOUT_S = max(60, _int("OTP_TIMEOUT_S", 10 * 60))
# Por quanto tempo o resultado (e os PDFs) ficam disponíveis em GET /extracoes/{id}.
JOB_TTL_S = max(60, _int("JOB_TTL_S", 60 * 60))

# Etapas do hCaptcha da 2 VIA, no formato `hcaptchaPlano` do multiextrator.
HCAPTCHA_ETAPAS_NONECAP = max(1, _int("HCAPTCHA_ETAPAS_NONECAP", 2))
HCAPTCHA_TENTATIVAS_POR_ETAPA = min(5, max(1, _int("HCAPTCHA_TENTATIVAS_POR_ETAPA", 2)))
