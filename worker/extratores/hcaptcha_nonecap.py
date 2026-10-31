"""
hCaptcha da 2ª via resolvido pelo NoneCap (https://nonecap.com).

O serviço devolve o token pronto (`P1_...`) para a sitekey + URL da ENEL,
gerado nos navegadores dele: o fingerprint do nosso Chrome (Linux, no
container) não entra na conta. O token vai para o `h-captcha-response` /
`g-recaptcha-response` do formulário e o postback da ENEL segue como se o
checkbox tivesse passado — a página não registra callback no
`hcaptcha.render`, só lê esses campos.

Com proxy (SEGUNDA_VIA_PROXY), o NoneCap resolve pelo MESMO proxy/sessão do
Chrome: a ENEL aceita melhor um token resolvido pela conexão que o envia.

Chave: `noneCapApiKey` do payload (Configurações › Extrações, repassada pelo
backend/app desktop) ou a variável NONECAP_API_KEY.
"""

from __future__ import annotations

import json
import os
import re
import time
import urllib.error
import urllib.request
from collections.abc import Callable
from typing import Any
from urllib.parse import quote, urlsplit

API_URL = (os.environ.get("NONECAP_API_URL") or "https://api.nonecap.com").rstrip("/")
# O NoneCap costuma devolver em 10–60s; a API segura cada long-poll até 90s.
TIMEOUT_S = float(os.environ.get("NONECAP_TIMEOUT_S") or 180)
LONG_POLL_S = 60
# Sitekey do hcaptcha.render da AcessoRapidoSegundaVia.aspx (a de teste
# 10000000-ffff-... fica comentada no mesmo script).
SITEKEY_ENEL = "fc3fc196-2985-4f0f-b955-3dfef38205f4"
_UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)

SITEKEY_JS = r"""(() => {
  const el = document.querySelector(".h-captcha[data-sitekey], [data-sitekey]");
  const attr = (el && el.getAttribute("data-sitekey") || "").trim();
  if (attr) return attr;
  for (const s of document.querySelectorAll("script")) {
    const texto = (s.textContent || "").replace(/^\s*\/\/.*$/gm, "");
    if (!/hcaptcha\.render/i.test(texto)) continue;
    const achados = [...texto.matchAll(/sitekey['"]?\s*[:=]\s*['"]([0-9a-f-]{36})['"]/gi)];
    if (achados.length) return achados[achados.length - 1][1];
  }
  return "";
})()"""

INJETAR_JS = r"""((token) => {
  const preencher = (el) => {
    el.value = token;
    el.innerHTML = token;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const form = document.querySelector("form") || document.body;
  for (const nome of ["h-captcha-response", "g-recaptcha-response"]) {
    let campos = document.querySelectorAll(`textarea[name="${nome}"]`);
    if (!campos.length) {
      const el = document.createElement("textarea");
      el.name = nome;
      el.style.display = "none";
      form.appendChild(el);
      campos = [el];
    }
    campos.forEach(preencher);
  }
  document.querySelectorAll('iframe[src*="hcaptcha.com"]').forEach(
    (f) => f.setAttribute("data-hcaptcha-response", token));
  const el = document.querySelector('textarea[name="h-captcha-response"]');
  return el ? el.value.length : 0;
})(%s)"""


class ErroNoneCap(RuntimeError):
    """Falha do NoneCap. A mensagem sempre cita o hCaptcha para o
    orquestrador tratá-la como falha de captcha (ver is_hcaptcha_error)."""


def chave_api(config: dict[str, Any] | None) -> str:
    return str((config or {}).get("noneCapApiKey") or os.environ.get("NONECAP_API_KEY") or "").strip()


def _proxy_nonecap(proxy: dict[str, str] | None) -> str | None:
    """`{"server": "http://host:porta", "username", "password"}` (trawl_browser)
    → `http://usuário:senha@host:porta`, o formato aceito pelo NoneCap."""
    if not proxy or not proxy.get("server"):
        return None
    partes = urlsplit(proxy["server"])
    login = ""
    if proxy.get("username"):
        login = quote(proxy["username"], safe="")
        if proxy.get("password"):
            login += ":" + quote(proxy["password"], safe="")
        login += "@"
    return f"{partes.scheme or 'http'}://{login}{partes.hostname}:{partes.port}"


def _req(chave: str, metodo: str, caminho: str, corpo: dict | None = None, wait: int | None = None) -> dict:
    url = f"{API_URL}{caminho}" + (f"?wait={wait}" if wait else "")
    req = urllib.request.Request(
        url,
        data=json.dumps(corpo).encode("utf-8") if corpo is not None else None,
        headers={"Authorization": f"Bearer {chave}", "Content-Type": "application/json"},
        method=metodo,
    )
    try:
        with urllib.request.urlopen(req, timeout=(wait or 0) + 20) as resp:
            return json.loads(resp.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as exc:
        try:
            erro = (json.loads(exc.read().decode("utf-8") or "{}").get("error")) or {}
        except Exception:
            erro = {}
        detalhe = erro.get("message") or erro.get("code") or f"HTTP {exc.code}"
        raise ErroNoneCap(f"Não foi possível resolver o hCaptcha pelo NoneCap: {detalhe}") from None
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise ErroNoneCap(f"Não foi possível resolver o hCaptcha: NoneCap inacessível ({exc})") from None


def pedir_token(
    chave: str,
    sitekey: str,
    url: str,
    user_agent: str | None = None,
    proxy: dict[str, str] | None = None,
    deve_parar: Callable[[], bool] = lambda: False,
    log: Callable[[str, str], None] = lambda m, t="info": None,
) -> str | None:
    """Token do hCaptcha pelo NoneCap; None = parado ou estourou o tempo."""
    corpo: dict[str, Any] = {"type": "hcaptcha", "sitekey": sitekey, "url": url}
    if user_agent:
        corpo["user_agent"] = user_agent
    proxy_url = _proxy_nonecap(proxy)
    if proxy_url:
        corpo["proxy"] = proxy_url
    inicio = time.monotonic()
    solve = _req(chave, "POST", "/v1/solves", corpo, wait=LONG_POLL_S)
    solve_id = solve.get("id") or "?"
    log(
        f"🆔 Solve NoneCap {solve_id} ({'pelo proxy do extrator' if proxy_url else 'sem proxy'}).",
        "info",
    )
    while solve.get("status") not in ("solved", "failed", "cancelled", "expired"):
        restante = TIMEOUT_S - (time.monotonic() - inicio)
        if deve_parar():
            _cancelar(chave, solve_id)
            return None
        if restante <= 0:
            _cancelar(chave, solve_id)
            log(f"✘ NoneCap não devolveu o token em {round(TIMEOUT_S)}s (solve {solve_id}).", "error")
            return None
        log(f"⏳ NoneCap resolvendo ({round(time.monotonic() - inicio)}s)...", "info")
        solve = _req(chave, "GET", f"/v1/solves/{solve_id}", wait=max(1, min(LONG_POLL_S, int(restante))))
    for aviso in solve.get("warnings") or []:
        if isinstance(aviso, dict) and aviso.get("message"):
            log(f"⚠ NoneCap: {aviso['message']}", "warn")
    if solve.get("status") != "solved" or not solve.get("token"):
        erro = solve.get("error") or {}
        detalhe = erro.get("message") or erro.get("code") or solve.get("status")
        raise ErroNoneCap(f"Não foi possível resolver o hCaptcha pelo NoneCap: {detalhe}")
    log(
        f"🎟 Token do NoneCap recebido em {round(time.monotonic() - inicio)}s "
        f"({solve.get('credits_charged') or 0} crédito(s)).",
        "info",
    )
    return solve["token"]


def _cancelar(chave: str, solve_id: str) -> None:
    try:
        _req(chave, "DELETE", f"/v1/solves/{solve_id}")
    except ErroNoneCap:
        pass


def resolver_hcaptcha_nonecap(
    sb,
    config: dict[str, Any],
    url: str,
    proxy: dict[str, str] | None = None,
    deve_parar: Callable[[], bool] = lambda: False,
    log: Callable[[str, str], None] = lambda m, t="info": None,
) -> bool:
    """Página da 2ª via já aberta no `sb` (SeleniumBase CDP). True = token
    do NoneCap no formulário."""
    chave = chave_api(config)
    if not chave:
        raise ErroNoneCap(
            "Não foi possível resolver o hCaptcha: chave do NoneCap não configurada "
            "(Configurações › Extrações ou NONECAP_API_KEY)."
        )
    sitekey = str(sb.evaluate(SITEKEY_JS) or "").strip()
    if not _UUID.match(sitekey):
        sitekey = SITEKEY_ENEL
    user_agent = str(sb.evaluate("navigator.userAgent") or "") or None
    log(f"🧩 Pedindo o token do hCaptcha ao NoneCap (sitekey {sitekey})...", "info")
    token = pedir_token(chave, sitekey, url, user_agent, proxy, deve_parar, log)
    if not token:
        return False
    tamanho = int(sb.evaluate(INJETAR_JS % json.dumps(token)) or 0)
    if tamanho < 20:
        log("✘ Token do NoneCap não entrou no formulário da 2ª via.", "error")
        return False
    log("✔ Token do NoneCap injetado no formulário.", "success")
    return True
