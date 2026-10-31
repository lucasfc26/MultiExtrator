"""
Site ENEL via Camoufox (substitui o fluxo Puppeteer de runAutomation() em
server.js — ver --batch).

Fluxo por conta:
  login.html → região (sem clicar cookies: uBlock já esconde o banner) →
  Empresas → reCAPTCHA (1 clique; se abrir desafio, fecha com reload e segue) →
  user/senha → CapSolver (se ainda não passou) → Acessar
  → /private-area/contas.html → switchAccount(UC)
  → API getHistoricalInvoices + getBoleta (sem clicar Segunda Via / checkbox)
  → reconciliação de duplicidade (Cancelada + Paga/Em Aberto) + logextracao,
    portada de `reconciliarFaturasDuplicadas`/runAutomation em server.js.

Uso manual (uma conta, um shot):
  py -3 site_enel_camoufox.py --user EMAIL --password SENHA --uc 59328619 --ref 07/2026
  py -3 site_enel_camoufox.py ... --ref 06/2026 07/2026 08/2026

Uso em lote (chamado pelo server.js — ver spawnSiteEnelProcess):
  py -3 site_enel_camoufox.py --batch payload.json
  py -3 site_enel_camoufox.py --batch -   # lê o payload do stdin

Eventos NDJSON em stdout (um por linha, só em --batch) para o server.js
retransmitir no WebSocket: {"type":"log"|"progress"|"screenshot"|"url"|
"site_enel_uc_result"|"site_enel_account_result"|"done"|"stopped", ...}.
Comandos no stdin (JSON por linha): {"type":"stop"}, {"type":"pause"},
{"type":"resume"}.
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import random
import re
import sys
import threading
import time
import unicodedata
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlencode, urlparse

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

from trawl_browser import (
    attach_trawl_init_script,
    main_evaluate,
    open_camoufox,
    request_fetch,
    safe_evaluate,
)
import trawl_browser as _trawl_browser

try:
    from extraction_trawl import firefox_download_prefs
except Exception:
    def firefox_download_prefs() -> dict:
        DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)
        return {
            "pdfjs.disabled": True,
            "browser.download.folderList": 2,
            "browser.download.dir": str(DOWNLOAD_DIR),
            "browser.helperApps.neverAsk.saveToDisk": (
                "application/pdf,application/octet-stream,application/x-pdf"
            ),
        }

LOGIN_URL = "https://www.enel.com.br/pt-ceara/login.html"
REGION_CEARA_URL = "https://www.enel.com.br/pt-ceara"
REGION_CEARA_SEL = (
    'a.selectbrazilregion[data-loc-path="https://www.enel.com.br/pt-ceara"]'
)
# Adobe Launch / sessão Enel: POST neste path (mesmo cookie jar) força a
# página de login do Ceará quando o clique na região não gruda.
REGION_FORCE_URL = (
    "https://www.enel.com.br/lint-Scenane-they-much-not-Lady-me-that-now-one-"
    "?d=www.enel.com.br"
)
CONTAS_URL = "https://www.enel.com.br/pt-ceara/private-area/contas.html"
SITE_ENEL_HIST_PATH = (
    "/pt-ceara/private-area/contas.mdwedgeohl.getHistoricalInvoices.html"
)
SITE_ENEL_BOLETA_PATH = "/pt-ceara/private-area/contas.mdwedgeohl.getBoleta.html"
CAPSOLVER_API = (
    os.environ.get("CAPSOLVER_API_URL") or "https://api.capsolver.com"
).rstrip("/")
# "Failed to solve the captcha: 1001" (ERROR_CAPTCHA_SOLVE_FAILED) é falha do
# worker do CapSolver, não da página: uma task nova costuma resolver.
CAPSOLVER_TENTATIVAS = 3
DOWNLOAD_DIR = Path(os.environ.get("DOWNLOAD_DIR", str(Path.home() / "Downloads")))
# Scripts de consentimento / reCAPTCHA — se falharem, o banner e o captcha quebram.
_CRITICAL_HOST_RE = re.compile(
    r"(truste|trustarc|consent|cookielaw|onetrust|google\.com/recaptcha|"
    r"gstatic\.com/recaptcha|www\.google\.com/recaptcha|recaptcha\.net)",
    re.I,
)

# ── Integração com o backend NestJS (mesmos endpoints que server.js chamava) ──
BACKEND_API_URL = (os.environ.get("BACKEND_API_URL") or "http://localhost:3000/api").rstrip("/")
ENEL_INTERNAL_TOKEN = os.environ.get("ENEL_INTERNAL_TOKEN", "")
# MultiExtrator do desktop (ExtratorPlumber): sem token interno, mas com o JWT
# do login — usa as rotas /desktop/* (mesmo efeito das /internal/*). Rotas sem
# espelho (ex.: faturasextraidas — o PDF vai pelo MSEWeb Sync) sao puladas.
BACKEND_BEARER_TOKEN = os.environ.get("BACKEND_BEARER_TOKEN", "")
_ROTAS_DESKTOP = {
    "/enel/internal/logextracao": "/enel/desktop/logextracao",
    "/ucs/internal/from-enel": "/ucs/desktop/from-enel",
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

BATCH_MODE = False
_stopped = False
_paused = False
_preview_fail_logged = False


def emit(event: dict[str, Any]) -> None:
    line = json.dumps(event, ensure_ascii=False) + "\n"
    try:
        sys.stdout.write(line)
    except UnicodeEncodeError:
        # server.js sempre passa PYTHONIOENCODING=utf-8 ao spawnar; isso só
        # entra em jogo rodando à mão num console com outro codepage (Windows).
        enc = getattr(sys.stdout, "encoding", None) or "ascii"
        sys.stdout.write(line.encode(enc, errors="replace").decode(enc, errors="replace"))
    sys.stdout.flush()


def is_stopped() -> bool:
    return _stopped


def wait_if_paused() -> None:
    while _paused and not _stopped:
        time.sleep(0.3)


def start_stdin_listener() -> None:
    def loop() -> None:
        global _stopped, _paused
        for line in sys.stdin:
            try:
                cmd = json.loads(line)
            except Exception:
                continue
            kind = cmd.get("type")
            if kind == "stop":
                _stopped = True
            elif kind == "pause":
                _paused = True
            elif kind == "resume":
                _paused = False

    threading.Thread(target=loop, daemon=True).start()


def set_progress(step: str) -> None:
    if BATCH_MODE:
        emit({"type": "progress", "step": step, "flow": "enel"})


def log(msg: str, log_type: str = "info") -> None:
    if BATCH_MODE:
        emit({"type": "log", "message": msg, "logType": log_type, "flow": "enel"})
        return
    try:
        print(msg, flush=True)
    except UnicodeEncodeError:
        enc = getattr(sys.stdout, "encoding", None) or "ascii"
        print(msg.encode(enc, errors="replace").decode(enc, errors="replace"), flush=True)


def digits(s: str) -> str:
    return re.sub(r"\D", "", s or "")


def ref_key(s: str) -> str:
    t = (s or "").strip()
    m = re.search(r"(\d{2})[/\-.](\d{4})", t)
    if m:
        return f"{m.group(2)}-{m.group(1)}"
    m = re.search(r"(\d{4})[/\-.](\d{2})", t)
    if m:
        return f"{m.group(1)}-{m.group(2)}"
    return t


def ref_slug(key: str) -> str:
    m = re.match(r"(\d{4})-(\d{2})", key or "")
    if m:
        return f"{m.group(2)}.{m.group(1)}"
    return (key or "fatura").replace("/", ".")


def screenshot(page, name: str) -> None:
    """Só atualiza a preview ao vivo — não grava JPEG em /app/downloads."""
    emit_live_view(page)


def emit_live_view(page) -> None:
    """JPEG + URL no WebSocket — mesmo contrato do Corporativo/2VIA, senão a
    'Tela do Navegador' fica em Aguardando tela... o login inteiro."""
    global _preview_fail_logged
    if not BATCH_MODE or page is None:
        return
    try:
        data = page.screenshot(type="jpeg", quality=40, full_page=False)
        b64 = (
            base64.b64encode(data).decode("ascii")
            if isinstance(data, (bytes, bytearray))
            else str(data)
        )
        emit({"type": "screenshot", "data": b64, "flow": "enel"})
        emit({"type": "url", "value": page.url})
    except Exception as e:
        if not _preview_fail_logged:
            _preview_fail_logged = True
            log(f"⚠ preview (screenshot): {e}", "warn")


def sleep_with_ui(page, seconds: float, shot_every: float = 0.8) -> None:
    """Espera sem deixar o preview congelado (CapSolver, goto, recaptcha)."""
    end = time.time() + max(0.0, seconds)
    next_shot = 0.0
    while time.time() < end:
        if is_stopped():
            return
        wait_if_paused()
        now = time.time()
        if now >= next_shot:
            emit_live_view(page)
            next_shot = now + shot_every
        time.sleep(min(0.2, max(0.0, end - now)))


def wait_js(page, expression: str, arg: Any = None, timeout_ms: int = 15000, poll: float = 0.4) -> Any:
    """Poll via safe_evaluate — page.wait_for_function no Camoufox/Firefox
    não enxerga funções da página (Xrays) e estoura timeout à toa."""
    deadline = time.time() + max(0.0, timeout_ms) / 1000.0
    last: Any = None
    has_arg = arg is not None
    while time.time() < deadline:
        if is_stopped():
            raise RuntimeError("parado")
        wait_if_paused()
        try:
            last = (
                safe_evaluate(page, expression, arg)
                if has_arg
                else safe_evaluate(page, expression)
            )
        except Exception:
            last = None
        if last:
            return last
        sleep_with_ui(page, poll)
    return last


def post_backend(
    pathname: str,
    body: dict[str, Any] | None = None,
    *,
    method: str = "POST",
    params: dict[str, str] | None = None,
    timeout: float = 15,
) -> Any:
    """Espelha `postToBackend`/`fetchLogExtracaoInternal` do server.js — mesmos
    endpoints internos, mesmo header `x-enel-token`."""
    rota = _rota_backend(pathname)
    if rota is None:
        if not backend_integrado():
            log("⚠ ENEL_INTERNAL_TOKEN não configurado; integração com backend ignorada.", "warn")
        return None
    url = f"{BACKEND_API_URL}{rota[0]}"
    if params:
        url = f"{url}?{urlencode(params)}"
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={"Content-Type": "application/json", **rota[1]},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")[:300]
        raise RuntimeError(f"Backend {pathname} HTTP {e.code}: {detail}") from e


def attach_critical_network_probe(page) -> list[dict[str, str]]:
    """Registra falhas/bloqueios de Truste/consent/reCAPTCHA (não é uBlock — é o Camoufox)."""
    hits: list[dict[str, str]] = []

    def on_failed(req) -> None:
        url = req.url or ""
        if not _CRITICAL_HOST_RE.search(url):
            return
        fail = ""
        try:
            fail = req.failure or ""
        except Exception:
            pass
        hits.append({"event": "failed", "url": url[:180], "error": str(fail)[:120]})
        log(f"✘ request FAIL (consent/captcha): {url[:120]} ({fail})")

    def on_response(resp) -> None:
        url = resp.url or ""
        if not _CRITICAL_HOST_RE.search(url):
            return
        status = resp.status
        if status >= 400:
            hits.append({"event": "http", "url": url[:180], "error": f"HTTP {status}"})
            log(f"✘ request HTTP {status} (consent/captcha): {url[:120]}")

    page.on("requestfailed", on_failed)
    page.on("response", on_response)
    return hits


def _pessoas_empresas_ready(page) -> bool:
    """#formLogin.form-login.active com abas Pessoas/Empresas."""
    try:
        return bool(
            safe_evaluate(
                page,
                """() => {
          const form = document.querySelector('#formLogin');
          if (!form) return false;
          const cls = form.className || '';
          if (!/\\bform-login\\b/.test(cls) || !/\\bactive\\b/.test(cls)) return false;
          const tabs = form.querySelector('.login-tabs, .help-tabs__nav');
          if (!tabs) return false;
          const pessoas = tabs.querySelector('a[href="#pessoas"], a[href*="#pessoas"]');
          const empresas = tabs.querySelector('a[href="#empresas"], a[href*="#empresas"]');
          return !!(pessoas && empresas);
        }""",
            )
        )
    except Exception:
        return False


def acessar_button_visible(page) -> bool:
    """Botão Acessar do login (sendLoginUniqueID), mesmo sem as abas Pessoas/Empresas."""
    try:
        return bool(
            safe_evaluate(
                page,
                """() => {
          const buttons = Array.from(document.querySelectorAll('button, [role="button"]'));
          return buttons.some((b) => {
            const onclick = b.getAttribute('onclick') || '';
            const text = (b.innerText || b.textContent || '').replace(/\\s+/g, ' ').trim();
            if (!/sendLoginUniqueID/i.test(onclick) && !/^acessar$/i.test(text)) return false;
            const st = getComputedStyle(b);
            if (st.display === 'none' || st.visibility === 'hidden') return false;
            const r = b.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
          });
        }""",
            )
        )
    except Exception:
        return False


def login_form_ready(page) -> bool:
    """Login pronto: abas Pessoas/Empresas ou, se elas não existirem, o botão Acessar."""
    if _pessoas_empresas_ready(page):
        return True
    return acessar_button_visible(page)


def _region_picker_visible(page) -> bool:
    """Tela de escolha de região. Não usa link genérico de /pt-ceara do login."""
    try:
        return bool(
            safe_evaluate(
                page,
                """() => {
          const visible = (el) => {
            if (!el) return false;
            const st = getComputedStyle(el);
            if (st.display === 'none' || st.visibility === 'hidden') return false;
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
          };
          const regions = Array.from(document.querySelectorAll('a.selectbrazilregion'));
          if (regions.some(visible)) return true;
          const nodes = Array.from(document.querySelectorAll('a, button, [role="button"]'));
          return nodes.some((n) =>
            visible(n) && /enel\\s*cear[aá]/i.test((n.innerText || n.textContent || '').trim())
          );
        }""",
            )
        )
    except Exception:
        return False


def _click_region_ceara(page) -> bool:
    selectors = [
        REGION_CEARA_SEL,
        'a.selectbrazilregion[data-loc-path*="pt-ceara"]',
        'a[data-loc-path*="pt-ceara"]',
        'a[href*="pt-ceara"]',
    ]
    for sel in selectors:
        try:
            loc = page.locator(sel).first
            loc.wait_for(state="visible", timeout=2500)
            loc.click(timeout=4000)
            return True
        except Exception:
            continue
    try:
        return bool(
            safe_evaluate(
                page,
                """() => {
          const exact = document.querySelector(
            'a.selectbrazilregion[data-loc-path="https://www.enel.com.br/pt-ceara"]'
          );
          if (exact) { exact.click(); return true; }
          const nodes = Array.from(document.querySelectorAll('a, button, [role="button"]'));
          const el = nodes.find((n) =>
            /enel\\s*cear[aá]/i.test((n.innerText || n.textContent || '').trim())
          );
          if (!el) return false;
          el.click();
          return true;
        }""",
            )
        )
    except Exception:
        return False


def _set_ceara_location_cookies(page) -> None:
    cookies = [
        {
            "name": "Enel.ocationArea",
            "value": "Enel / CEARÁ",
            "domain": ".enel.com.br",
            "path": "/",
        },
        {
            "name": "Enel.ocationPath",
            "value": "enel.com.br/pt-ceara",
            "domain": ".enel.com.br",
            "path": "/",
        },
        {
            "name": "Enel.ocationSet",
            "value": "true",
            "domain": ".enel.com.br",
            "path": "/",
        },
        {
            "name": "EnelSessionFirstRedirect",
            "value": "true",
            "domain": ".enel.com.br",
            "path": "/",
        },
    ]
    try:
        page.context.add_cookies(cookies)
    except Exception as e:
        log(f"⚠ cookies região Ceará: {e}", "warn")


def _force_region_ceara_via_post(page) -> None:
    """POST lint-Scenane (mesmo do DevTools) + reload em /pt-ceara/login.html."""
    _set_ceara_location_cookies(page)
    cookie_header = ""
    try:
        cookie_header = (
            safe_evaluate(page, "() => document.cookie || ''") or ""
        )
    except Exception:
        cookie_header = ""
    posted = False
    try:
        res = safe_evaluate(
            page,
            """async (url) => {
          const res = await fetch(url, {
            method: 'POST',
            credentials: 'include',
            mode: 'cors',
            headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
            body: document.cookie || '',
            redirect: 'follow',
          });
          return { status: res.status, url: res.url, redirected: !!res.redirected };
        }""",
            REGION_FORCE_URL,
        )
        posted = True
        log(
            f"POST região {REGION_FORCE_URL} → "
            f"HTTP {(res or {}).get('status')} url={(res or {}).get('url')}"
        )
    except Exception as e:
        log(f"⚠ fetch região (página): {e}", "warn")
    if not posted:
        try:
            res = request_fetch(
                page,
                REGION_FORCE_URL,
                method="POST",
                data=cookie_header or "Enel.ocationSet=true",
                headers={
                    "Content-Type": "text/plain;charset=UTF-8",
                    "Origin": "https://www.enel.com.br",
                    "Referer": page.url or LOGIN_URL,
                },
            )
            log(
                f"POST região (request) {REGION_FORCE_URL} → HTTP {res.get('status')}"
            )
        except Exception as e:
            log(f"⚠ POST região: {e}", "warn")
    try:
        page.goto(LOGIN_URL, wait_until="domcontentloaded", timeout=60000)
    except Exception as e:
        log(f"⚠ goto login pós-POST região: {e}", "warn")
        try:
            page.goto(REGION_CEARA_URL, wait_until="domcontentloaded", timeout=60000)
        except Exception:
            pass
    emit_live_view(page)


def _confirm_login_screen(page, via: str) -> None:
    if acessar_button_visible(page) and not _pessoas_empresas_ready(page):
        log(f'✔ Botão "Acessar" já está na tela de login ({via}).')
    else:
        log(f"✔ Região ENEL CEARÁ selecionada ({via}).")
    set_progress("region")
    emit_live_view(page)


def select_region_ceara(page) -> None:
    """Passa pela região Ceará antes de aceitar Pessoas/Empresas ou o botão
    Acessar. A tela de login às vezes aparece e redireciona sozinha para a
    região, então há 3s entre cada verificação."""
    for attempt in range(1, 4):
        if is_stopped():
            return
        sleep_with_ui(page, 3)
        if is_stopped():
            return

        if _region_picker_visible(page):
            clicked = _click_region_ceara(page)
            if clicked:
                log(f"↪ Clique região Ceará (tentativa {attempt}/3)")
            else:
                log(f"⚠ Botão da região não encontrado (tentativa {attempt}/3)")
            emit_live_view(page)
            continue

        if login_form_ready(page):
            _confirm_login_screen(page, f"após região, tentativa {attempt}")
            return

        log(
            "⚠ Nem a região nem o login ficaram estáveis "
            f"(tentativa {attempt}/3)."
        )

    sleep_with_ui(page, 3)
    if not _region_picker_visible(page) and login_form_ready(page):
        _confirm_login_screen(page, "após região")
        return

    log("↪ Forçando região Ceará via POST lint-Scenane + login.html")
    _force_region_ceara_via_post(page)
    sleep_with_ui(page, 3)
    if _region_picker_visible(page):
        if _click_region_ceara(page):
            log("↪ Clique região Ceará (após POST)")
        else:
            log("⚠ Botão da região não encontrado (após POST)")
        emit_live_view(page)
        sleep_with_ui(page, 3)

    if not _region_picker_visible(page) and login_form_ready(page):
        _confirm_login_screen(page, "POST forçado")
        return

    emit_live_view(page)
    raise RuntimeError(
        "Região ENEL CEARÁ não confirmada: a tela de região não abriu o "
        "login (Pessoas/Empresas ou botão Acessar) de forma estável."
    )


def select_login_tab(page, empresas: bool) -> None:
    """Escolhe Pessoas/Empresas. Sem as abas, segue se o botão Acessar já está na tela."""
    if empresas:
        try:
            timeout = 3000 if acessar_button_visible(page) else 10000
            page.locator('a[href*="#empresas"]').first.wait_for(state="visible", timeout=timeout)
            page.evaluate("""() => document.querySelector('a[href*="#empresas"]')?.click()""")
            sleep_with_ui(page, 1.2)
            log('✔ Aba "Empresas" selecionada.')
            emit_live_view(page)
        except Exception as e:
            if acessar_button_visible(page):
                log('✔ Aba Empresas não encontrada; botão "Acessar" já está na tela.')
            else:
                log(f"⚠ Aba Empresas: {e}")
        page.locator('[name="emailUsuario"]').first.wait_for(state="attached", timeout=10000)
    else:
        try:
            page.locator('a[href*="#residencial"], a[href*="#pessoas"], a[href*="#private"]').first.click(
                timeout=5000
            )
        except Exception:
            if acessar_button_visible(page):
                log('✔ Aba Pessoas não encontrada; botão "Acessar" já está na tela.')
        page.locator('[name="username"]').first.wait_for(state="attached", timeout=10000)
        log('✔ Aba "Pessoas/Residencial" selecionada.')
        emit_live_view(page)


def fill_login(page, user: str, password: str, empresas: bool) -> None:
    """Preenche usuário/senha DEPOIS do reCAPTCHA estar marcado."""
    if empresas:
        user_sel, pass_sel = '[name="emailUsuario"]', "#pwdCompany"
    else:
        user_sel, pass_sel = '[name="username"]', "#privatepwd"
    page.locator(user_sel).first.wait_for(state="visible", timeout=15000)
    page.locator(user_sel).first.click()
    page.locator(user_sel).first.fill("")
    page.locator(user_sel).first.type(user, delay=35)
    try:
        page.locator(pass_sel).first.wait_for(state="visible", timeout=8000)
    except Exception:
        page.evaluate(
            """(sel) => {
              const el = document.querySelector(sel);
              if (el) { el.style.display = 'block'; el.removeAttribute('disabled'); }
            }""",
            pass_sel,
        )
    page.locator(pass_sel).first.click()
    page.locator(pass_sel).first.fill("")
    page.locator(pass_sel).first.type(password, delay=35)
    filled = page.input_value(user_sel)
    if filled != user:
        raise RuntimeError("Campo de e-mail não reteve o valor (página recarregou).")
    log("✔ Login e senha preenchidos (após reCAPTCHA).")
    emit_live_view(page)


def recaptcha_sitekey(page, iframe_index: int) -> str:
    return (
        safe_evaluate(
            page,
            """(idx) => {
          const widgets = Array.from(document.querySelectorAll('.g-recaptcha, [data-sitekey]'));
          const fromWidget = (widgets[idx] || widgets[0] || {}).getAttribute?.('data-sitekey') || '';
          if (fromWidget) return fromWidget;
          const iframes = Array.from(document.querySelectorAll('iframe[title="reCAPTCHA"], iframe[src*="recaptcha"]'));
          const src = (iframes[idx] || iframes[0] || {}).src || '';
          try {
            return new URL(src).searchParams.get('k') || '';
          } catch (e) {
            return '';
          }
        }""",
            iframe_index,
        )
        or ""
    )


def capsolver_token(
    site_key: str, page_url: str, api_key: str, timeout_s: int = 120, page=None
) -> str:
    payload = json.dumps(
        {
            "clientKey": api_key,
            "task": {
                "type": "ReCaptchaV2TaskProxyLess",
                "websiteURL": page_url,
                "websiteKey": site_key,
            },
        }
    ).encode("utf-8")
    req = urllib.request.Request(
        f"{CAPSOLVER_API}/createTask",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        created = json.loads(resp.read().decode("utf-8"))
    if created.get("errorId"):
        raise RuntimeError(created.get("errorDescription") or "CapSolver createTask falhou")
    task_id = created.get("taskId")
    if not task_id:
        raise RuntimeError("CapSolver sem taskId")
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        if page is not None:
            sleep_with_ui(page, 3.0)
        else:
            time.sleep(3)
        body = json.dumps({"clientKey": api_key, "taskId": task_id}).encode("utf-8")
        poll = urllib.request.Request(
            f"{CAPSOLVER_API}/getTaskResult",
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(poll, timeout=30) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        if data.get("errorId"):
            raise RuntimeError(data.get("errorDescription") or "CapSolver getTaskResult falhou")
        if data.get("status") == "ready":
            token = (data.get("solution") or {}).get("gRecaptchaResponse") or ""
            if token:
                return token
    raise RuntimeError("CapSolver não devolveu token a tempo")


def inject_recaptcha_token(page, token: str) -> None:
    page.evaluate(
        """(captchaToken) => {
          const setVal = (el) => {
            el.value = captchaToken;
            el.innerHTML = captchaToken;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          };
          const textareas = Array.from(document.querySelectorAll(
            'textarea[name="g-recaptcha-response"], textarea#g-recaptcha-response'
          ));
          if (!textareas.length) {
            const ta = document.createElement('textarea');
            ta.name = 'g-recaptcha-response';
            ta.id = 'g-recaptcha-response';
            ta.style.display = 'none';
            document.body.appendChild(ta);
            textareas.push(ta);
          }
          textareas.forEach(setVal);
          const cfg = window.___grecaptcha_cfg;
          if (!cfg || !cfg.clients) return;
          const callbacks = [];
          const visit = (value) => {
            if (!value || typeof value !== 'object') return;
            for (const key of Object.keys(value)) {
              const current = value[key];
              if (key === 'callback' && typeof current === 'function') callbacks.push(current);
              else if (current && typeof current === 'object') visit(current);
            }
          };
          Object.values(cfg.clients).forEach(visit);
          callbacks.forEach((cb) => { try { cb(captchaToken); } catch (e) {} });
        }""",
        token,
    )


SCROLL_NUDGE_MIN = 200
SCROLL_NUDGE_MAX = 300


def recaptcha_iframe_index(page, empresas: bool) -> int:
    count = page.locator('iframe[title="reCAPTCHA"]').count()
    idx = 1 if empresas else 0
    if count <= 0:
        return 0
    return min(idx, count - 1)


def scroll_to_recaptcha(page) -> int:
    y = random.randint(SCROLL_NUDGE_MIN, SCROLL_NUDGE_MAX)
    try:
        page.evaluate(
            """(y) => {
              const el = document.scrollingElement || document.documentElement;
              el.style.scrollBehavior = 'auto';
              window.scrollTo(0, y);
            }""",
            y,
        )
    except Exception:
        pass
    sleep_with_ui(page, 0.4)
    try:
        page.evaluate(
            """() => document.querySelector('#recaptcha, .g-recaptcha, iframe[title="reCAPTCHA"]')
              ?.scrollIntoView({ block: 'center' });"""
        )
    except Exception:
        pass
    log(f"↕ Rolando a página até o reCAPTCHA (y≈{y}px)...")
    sleep_with_ui(page, 1.5)
    emit_live_view(page)
    return y


def recaptcha_checked(page, idx: int) -> bool:
    try:
        loc = (
            page.frame_locator('iframe[title="reCAPTCHA"]')
            .nth(idx)
            .locator(".recaptcha-checkbox-checked")
        )
        return loc.count() > 0 and loc.first.is_visible()
    except Exception:
        return False


def recaptcha_checkbox_point(page, idx: int) -> tuple[float, float] | None:
    # Nunca clicar se o desafio já estiver aberto — o mouse cairia no bframe.
    if recaptcha_challenge_visible(page):
        return None
    iframe = page.locator('iframe[title="reCAPTCHA"]').nth(idx)
    try:
        ibox = iframe.bounding_box(timeout=4000)
    except Exception:
        ibox = None
    if not ibox or ibox.get("width", 0) <= 20:
        return None
    # Preferir o retângulo do iframe âncora (title="reCAPTCHA"), não o bframe.
    title = ""
    try:
        title = (iframe.get_attribute("title") or "").lower()
    except Exception:
        pass
    if "desafio" in title or "challenge" in title:
        return None
    try:
        cb = (
            page.frame_locator('iframe[title="reCAPTCHA"]')
            .nth(idx)
            .locator("#recaptcha-anchor")
            .bounding_box(timeout=2000)
        )
        if cb and cb.get("width", 0) > 4:
            return (
                cb["x"] + cb["width"] / 2.0,
                cb["y"] + cb["height"] / 2.0,
            )
    except Exception:
        pass
    # Centro aproximado do checkbox no widget (~esquerda do iframe âncora).
    if ibox.get("height", 0) > 120:
        return None
    return ibox["x"] + 28.0, ibox["y"] + ibox["height"] / 2.0


def click_recaptcha_humanize(page, idx: int) -> bool:
    if recaptcha_challenge_visible(page):
        log("⚠ Desafio já aberto — não clico no checkbox por cima.")
        return False
    try:
        page.frame_locator('iframe[title="reCAPTCHA"]').nth(idx).locator(
            "#recaptcha-anchor"
        ).wait_for(state="attached", timeout=10000)
    except Exception as e:
        log(f"⚠ âncora reCAPTCHA não apareceu: {e}")
        return False
    pt = recaptcha_checkbox_point(page, idx)
    if pt is None:
        log("⚠ sem coordenadas do checkbox reCAPTCHA (ou desafio no caminho)")
        return False
    x, y = pt
    log(f"🧩 Clique humanize no reCAPTCHA ({x:.0f},{y:.0f})")
    try:
        page.mouse.move(x, y)
        page.wait_for_timeout(200)
        page.mouse.click(x, y)
        return True
    except Exception as e:
        log(f"⚠ mouse.click reCAPTCHA: {e}")
        return False


def recaptcha_challenge_visible(page, *, log_hit: bool = False) -> bool:
    """Detecta o iframe do desafio de imagem (bframe) — NÃO o checkbox âncora."""
    info = page.evaluate(
        """() => {
          const iframes = Array.from(document.querySelectorAll('iframe'));
          const hits = [];
          for (const el of iframes) {
            const src = el.getAttribute('src') || '';
            const title = (el.getAttribute('title') || '').toLowerCase();
            const st = getComputedStyle(el);
            const r = el.getBoundingClientRect();
            const visible =
              st.display !== 'none' &&
              st.visibility !== 'hidden' &&
              Number(st.opacity) !== 0 &&
              r.width >= 200 &&
              r.height >= 200;
            if (!visible) continue;
            // Âncora: title="reCAPTCHA" ~302x76. Desafio: bframe / "desafio" / "expira".
            const isChallenge =
              /bframe/i.test(src) ||
              /desafio|challenge|expira/i.test(title);
            if (!isChallenge) continue;
            hits.push({ title, w: Math.round(r.width), h: Math.round(r.height) });
          }
          return hits;
        }"""
    )
    if info:
        if log_hit:
            log(f"⚠ Desafio reCAPTCHA detectado: {info[0]}")
        return True
    return False


def wait_challenge_gone(page, timeout_ms: int = 8000) -> bool:
    deadline = time.time() + timeout_ms / 1000.0
    while time.time() < deadline:
        if not recaptcha_challenge_visible(page):
            return True
        sleep_with_ui(page, 0.2)
    return not recaptcha_challenge_visible(page)


def forced_reload_keep_scroll(page) -> bool:
    """Fecha o desafio com page.reload (não Control+r — Camoufox engole tecla)."""
    try:
        y = page.evaluate("() => window.scrollY || window.pageYOffset || 0")
    except Exception:
        y = None
    log("↻ Forced reload (fecha o desafio sem clicar por cima)")
    try:
        page.reload(wait_until="domcontentloaded", timeout=60000)
    except Exception as e:
        log(f"⚠ page.reload falhou ({e}); tentando Control+r")
        try:
            page.keyboard.press("Control+r")
            page.wait_for_load_state("domcontentloaded", timeout=60000)
        except Exception:
            return False
    sleep_with_ui(page, 1.5)
    if not wait_challenge_gone(page, 8000):
        log("⚠ Desafio ainda visível após reload — segundo forced reload.")
        try:
            page.reload(wait_until="domcontentloaded", timeout=60000)
            sleep_with_ui(page, 1.5)
        except Exception:
            pass
        if not wait_challenge_gone(page, 5000):
            log("⚠ Desafio persistiu após 2 forced reloads.")
            return False
    if y is not None:
        try:
            page.evaluate("(y) => window.scrollTo(0, y)", y)
        except Exception:
            pass
    emit_live_view(page)
    return True


# Alias legado (logs / chamadas antigas)
ctrl_r_keep_scroll = forced_reload_keep_scroll


def wait_recaptcha_result(page, idx: int, settle_ms: int = 4500) -> str:
    """Poll rápido: challenge tem prioridade — se abrir, NÃO fica clicando."""
    deadline = time.time() + settle_ms / 1000.0
    while time.time() < deadline:
        if recaptcha_challenge_visible(page):
            return "challenge"
        if recaptcha_checked(page, idx):
            return "passed"
        sleep_with_ui(page, 0.25)
    if recaptcha_challenge_visible(page, log_hit=True):
        return "challenge"
    if recaptcha_checked(page, idx):
        return "passed"
    return "none"


def capsolver_falhou_resolver(err: Exception) -> bool:
    return "failed to solve the captcha" in str(err).lower()


def capsolver_token_com_retry(site_key: str, page_url: str, api_key: str, page=None) -> str:
    for tentativa in range(1, CAPSOLVER_TENTATIVAS + 1):
        try:
            return capsolver_token(site_key, page_url, api_key, page=page)
        except RuntimeError as e:
            if (
                not capsolver_falhou_resolver(e)
                or tentativa == CAPSOLVER_TENTATIVAS
                or is_stopped()
            ):
                raise
            log(
                f"⚠ CapSolver: {e} — tentando novamente "
                f"({tentativa + 1}/{CAPSOLVER_TENTATIVAS})...",
                "warn",
            )
    raise RuntimeError("CapSolver não devolveu token")


def capsolver_or_manual(page, empresas: bool, api_key: str) -> bool:
    idx = recaptcha_iframe_index(page, empresas)
    if api_key:
        site_key = recaptcha_sitekey(page, idx)
        log(f"⏳ CapSolver sitekey={site_key[:12]}..." if site_key else "⚠ sitekey vazia")
        emit_live_view(page)
        if site_key:
            token = capsolver_token_com_retry(site_key, page.url, api_key, page=page)
            inject_recaptcha_token(page, token)
            log("✔ Token reCAPTCHA do CapSolver injetado.")
            emit_live_view(page)
            return True
    log("⚠ CapSolver seria o próximo passo — no teste, resolva o desafio na janela (até 90s).")
    screenshot(page, "site_enel_camoufox_recaptcha.jpg")
    try:
        page.frame_locator('iframe[title="reCAPTCHA"]').nth(idx).locator(
            ".recaptcha-checkbox-checked"
        ).wait_for(timeout=90000)
        log("✔ reCAPTCHA confirmado manualmente.")
        return True
    except Exception:
        return False


def solve_recaptcha(page, empresas: bool) -> bool:
    """
    Tentativa única: rola, clica no checkbox. Se abrir desafio de imagem (ou o
    clique não colar), fecha com um reload — sem clicar por cima — e devolve
    False; quem chamou preenche login e manda pro CapSolver. Sem loop de
    refresh: só essa uma tentativa antes de cair no CapSolver.
    """
    scroll_to_recaptcha(page)
    idx = recaptcha_iframe_index(page, empresas)
    count = page.locator('iframe[title="reCAPTCHA"]').count()
    log(f"reCAPTCHA iframes={count} (índice {idx})")
    if count == 0:
        raise RuntimeError("iframe reCAPTCHA não encontrado")

    log("🧩 reCAPTCHA: clique humanize (tentativa única)")
    clicked = click_recaptcha_humanize(page, idx)
    result = wait_recaptcha_result(page, idx) if clicked else (
        "challenge" if recaptcha_challenge_visible(page) else "none"
    )

    if result == "passed":
        log("✔ reCAPTCHA confirmado (sem desafio).")
        return True
    if result == "challenge":
        log("⚠ Desafio de imagem — fechando com reload (sem clicar por cima).")
    elif not clicked:
        log("⚠ Clique no reCAPTCHA não disparou.")
    else:
        log("⚠ Checkbox não marcou.")

    forced_reload_keep_scroll(page)
    select_login_tab(page, empresas)
    return False


def click_acessar(page, empresas: bool) -> None:
    sleep_with_ui(page, 1.5)
    try:
        page.keyboard.press("Escape")
    except Exception:
        pass
    botoes = page.locator('button[onclick*="sendLoginUniqueID"]')
    n = botoes.count()
    if n == 0:
        botoes = page.locator("button").filter(
            has_text=re.compile(r"^\s*Acessar\s*$", re.I)
        )
        n = botoes.count()
    i = 1 if empresas and n > 1 else 0
    if n == 0:
        raise RuntimeError('Botão "Acessar" não encontrado')
    try:
        botoes.nth(i).click(timeout=8000)
    except Exception:
        page.evaluate(
            """(idx) => {
              const els = Array.from(document.querySelectorAll('button')).filter((b) => {
                const onclick = b.getAttribute('onclick') || '';
                const text = (b.innerText || b.textContent || '').replace(/\\s+/g, ' ').trim();
                return /sendLoginUniqueID/i.test(onclick) || /^acessar$/i.test(text);
              });
              if (els[idx]) els[idx].click();
            }""",
            i,
        )
    log('✔ Botão "Acessar" clicado.')
    emit_live_view(page)


def wait_private_area(page, timeout_ms: int = 35000) -> None:
    deadline = time.time() + timeout_ms / 1000.0
    while time.time() < deadline:
        emit_live_view(page)
        if "private-area" in (page.url or ""):
            log(f"✔ Área privada: {page.url}")
            return
        err = page.evaluate(
            """() => {
          const els = document.querySelectorAll('.form-return-login-error-msg');
          for (const el of els) {
            const st = getComputedStyle(el);
            if (st.display !== 'none' && el.offsetParent !== null) return (el.textContent || '').trim();
          }
          return '';
        }"""
        )
        if err:
            raise RuntimeError(f"Login inválido: {err}")
        sleep_with_ui(page, 0.8)
    raise RuntimeError(f"Não entrou na área privada (url={page.url})")


def _contas_pronta(page) -> bool:
    """Contas abriu se o seletor de UC ou o botão de Segunda Via apareceu."""
    try:
        loc = page.locator(
            ".pvtArea-account-select, #action-item-button-second-billing-way"
        )
        return loc.count() > 0
    except Exception:
        return False


def goto_contas(page, *, force: bool = False) -> None:
    on_contas = "/private-area/contas.html" in (page.url or "")
    if force or not on_contas:
        try:
            if on_contas:
                page.reload(wait_until="domcontentloaded", timeout=45000)
            else:
                page.goto(CONTAS_URL, wait_until="domcontentloaded", timeout=45000)
        except Exception:
            page.goto(CONTAS_URL, wait_until="domcontentloaded", timeout=45000)
        try:
            page.wait_for_load_state("networkidle", timeout=15000)
        except Exception:
            pass
        sleep_with_ui(page, 0.8)
    deadline = time.time() + 20
    while time.time() < deadline:
        if _contas_pronta(page):
            break
        sleep_with_ui(page, 0.4)
    if not _contas_pronta(page):
        raise RuntimeError(
            "Página de Contas sem .pvtArea-account-select / Segunda Via."
        )
    try:
        fechar_avisos(page)
    except Exception:
        pass
    emit_live_view(page)
    log(f"✔ Contas: {page.url}")


def _uc_mostrada(page) -> str:
    """UC no seletor `.pvtArea-account-select` (ex.: 'Nº 9007231')."""
    try:
        loc = page.locator(".pvtArea-account-select").first
        if loc.count() > 0:
            raw = loc.inner_text(timeout=1500) or ""
            m = re.search(r"N[ºo°]?\s*(\d{5,12})", raw, re.I)
            if m:
                return digits(m.group(1))
            m = re.search(r"(\d{5,12})", raw)
            if m:
                return digits(m.group(1))
    except Exception:
        pass
    try:
        val = safe_evaluate(
            page,
            """() => {
          const box = document.querySelector('.pvtArea-account-select');
          const txt = (box && (box.innerText || box.textContent) || '');
          const m = txt.match(/N[ºo°]?\\s*(\\d{5,12})/i) || txt.match(/(\\d{5,12})/);
          return m ? m[1] : '';
        }""",
        )
        return digits(str(val or ""))
    except Exception:
        return ""


def _uc_ficou_na_pedida(page, alvo: str, settle_s: float = 1.6) -> tuple[bool, str]:
    """Confirma a UC e espera um pouco: o Site ENEL às vezes mostra a pedida
    e no reload seguinte volta pra conta padrão."""
    shown = _uc_mostrada(page)
    if not alvo or shown != alvo:
        return False, shown
    sleep_with_ui(page, settle_s)
    shown2 = _uc_mostrada(page)
    if shown2 != alvo:
        return False, shown2
    return True, shown2


def _console_switch_account(page, uc: str) -> None:
    """Igual a colar `switchAccount('243580')` no console da página.

    Camoufox isola o `page.evaluate`: no sandbox `window.switchAccount` não
    existe. `mw:` roda no main world (o globo do console). Se o prefixo falhar,
    injeta um <script> — o browser executa isso no mundo da página.
    """
    valor = str(uc)
    # 1) console do Camoufox: mw:switchAccount(...)
    try:
        page.evaluate("mw:(v) => { switchAccount(String(v)); }", valor)
        log(f"✔ console: switchAccount({valor})")
        return
    except Exception as e:
        log(f"⚠ mw:switchAccount falhou ({e}); injetando <script> no documento.")
    inject = """(v) => {
      const s = document.createElement('script');
      s.textContent = 'switchAccount(' + JSON.stringify(String(v)) + ')';
      document.documentElement.appendChild(s);
      s.remove();
    }"""
    try:
        page.evaluate("mw:" + inject, valor)
    except Exception:
        page.evaluate(inject, valor)
    log(f"✔ console(script): switchAccount({valor})")


def switch_uc(page, uc: str) -> None:
    alvo = digits(uc)
    last_err: Exception | None = None
    for tentativa in range(1, 4):
        try:
            goto_contas(page, force=(tentativa > 1))
            atual = _uc_mostrada(page)
            if alvo and atual == alvo:
                ok, atual = _uc_ficou_na_pedida(page, alvo)
                if ok:
                    log(f"✔ UC {uc} já estava selecionada.")
                    return
            log(
                f"↻ console: switchAccount({uc!r}) tentativa {tentativa}/3 "
                f"(tela={atual or 'vazio'})"
            )
            _console_switch_account(page, uc)
            emit_live_view(page)
            try:
                page.wait_for_load_state("networkidle", timeout=10000 + (tentativa - 1) * 5000)
            except Exception:
                pass
            sleep_with_ui(page, 1.2 + (tentativa - 1) * 1.2)

            deadline = time.time() + (18 + (tentativa - 1) * 10)
            shown = _uc_mostrada(page)
            while time.time() < deadline:
                ok, shown = _uc_ficou_na_pedida(page, alvo, settle_s=1.4)
                if ok:
                    if tentativa > 1:
                        log(f"✔ UC {uc}: troca confirmada na tentativa {tentativa}.")
                    else:
                        log(f"✔ UC {uc} selecionada.")
                    emit_live_view(page)
                    return
                if shown and shown != alvo:
                    log(f"⚠ UC pedida={alvo} mas a tela está em {shown} — retentando.")
                    break
                sleep_with_ui(page, 0.6)
                shown = _uc_mostrada(page)

            last_err = RuntimeError(
                f"Troca de UC não confirmada (seletor={shown or 'vazio'}, pedido={alvo})"
            )
        except Exception as e:
            last_err = e
        if tentativa < 3:
            log(f"⚠ UC {uc}: {last_err}. Recarregando Contas ({tentativa}/3)...")
            emit_live_view(page)
    raise last_err or RuntimeError(f"Falha ao selecionar UC {uc}")


def enel_site_xhr(
    page,
    method: str,
    url: str,
    form_entries: list[tuple[str, str]] | None = None,
) -> dict[str, Any]:
    """XHR same-origin com cookies da sessão (espelha enelSiteXhr do Extractor-JS)."""
    abs_url = url if str(url).startswith("http") else "https://www.enel.com.br" + str(url)
    if method.upper() == "GET" and not form_entries:
        fetched = request_fetch(
            page,
            abs_url,
            method="GET",
            headers={
                "Accept": "application/json, text/javascript, */*; q=0.01",
                "X-Requested-With": "XMLHttpRequest",
                "Referer": CONTAS_URL,
            },
        )
        return {
            "ok": True,
            "status": fetched.get("status") or 0,
            "ct": fetched.get("ct") or "",
            "text": fetched.get("text") or "",
        }
    result = safe_evaluate(
        page,
        """async ({ method, url, formEntries }) => {
          try {
            const headers = {
              Accept: 'application/json, text/javascript, */*; q=0.01',
              'X-Requested-With': 'XMLHttpRequest',
            };
            let body = undefined;
            if (formEntries && formEntries.length) {
              const fd = new FormData();
              for (const pair of formEntries) {
                fd.append(pair[0], pair[1] == null ? '' : String(pair[1]));
              }
              body = fd;
            }
            const resp = await fetch(url, {
              method,
              credentials: 'include',
              headers,
              body,
            });
            const text = await resp.text();
            return {
              ok: true,
              status: resp.status,
              ct: resp.headers.get('content-type') || '',
              text,
            };
          } catch (e) {
            return {
              ok: false,
              status: 0,
              ct: '',
              text: '',
              error: e && e.message ? e.message : String(e),
            };
          }
        }""",
        {
            "method": method,
            "url": url,
            "formEntries": form_entries or None,
        },
    )
    if not result or not result.get("ok"):
        raise RuntimeError(
            f"XHR {method} {url}: {(result or {}).get('error') or 'falhou'}"
        )
    return result


def read_site_enel_session(page, uc: str) -> dict[str, str]:
    """sessionStorage mora no main world — o sandbox do Camoufox não vê."""
    expr = """(ucEsperada) => {
          const get = (k) => {
            try { return sessionStorage.getItem(k) || ''; } catch (e) { return ''; }
          };
          return {
            clientID: get('customerIdentification') || get('clientID') || '',
            companyCode: get('companyCode') || '2003',
            sistema: get('sistema') || 'SAPCOE',
            supplyCode: get('supplyCode') || String(ucEsperada || ''),
          };
        }"""
    ctx: Any = None
    deadline = time.time() + 8
    while time.time() < deadline:
        try:
            ctx = main_evaluate(page, expr, str(uc or ""))
        except Exception:
            ctx = None
        if isinstance(ctx, dict) and (ctx.get("clientID") or ctx.get("supplyCode")):
            break
        sleep_with_ui(page, 0.4)
    if not isinstance(ctx, dict):
        ctx = {}
    if not ctx.get("companyCode"):
        ctx["companyCode"] = "2003"
    if not ctx.get("sistema"):
        ctx["sistema"] = "SAPCOE"
    if not ctx.get("supplyCode"):
        ctx["supplyCode"] = str(uc or "")
    return {str(k): str(v or "") for k, v in ctx.items()}


def _historical_invoices_url(uc: str) -> str:
    qs = urlencode(
        {
            "reasonProtocol": "SEGVIA",
            "supplyCode": digits(uc),
            "companyCode": "2003",
            "sistema": "SAPCOE",
        }
    )
    return f"{SITE_ENEL_HIST_PATH}?{qs}"


def _invoices_from_historical_text(text: str, uc: str) -> list[dict[str, Any]]:
    data = json.loads(text or "")
    invoices = data.get("invoiceList") if isinstance(data, dict) else None
    if not isinstance(invoices, list):
        invoices = []
    log(f"✔ UC {uc}: histórico API com {len(invoices)} fatura(s).")
    return invoices


def _fetch_historical_invoices(page, uc: str) -> list[dict[str, Any]]:
    url = _historical_invoices_url(uc)
    log(f"🔍 GET {url}")
    res = enel_site_xhr(page, "GET", url)
    if res.get("status", 0) < 200 or res.get("status", 0) >= 300:
        raise RuntimeError(
            f"getHistoricalInvoices HTTP {res.get('status')} "
            f"({str(res.get('text') or '')[:80]})"
        )
    text = res.get("text") or ""
    if not text.strip():
        raise RuntimeError("getHistoricalInvoices vazio")
    try:
        return _invoices_from_historical_text(text, uc)
    except json.JSONDecodeError as e:
        raise RuntimeError(
            f"getHistoricalInvoices não-JSON: {text[:120]}"
        ) from e


def _segunda_via_expandida(page) -> bool:
    try:
        return bool(
            safe_evaluate(
                page,
                """() => {
                  const b = document.querySelector('#action-item-button-second-billing-way');
                  if (!b) return false;
                  return (b.getAttribute('aria-expanded') || '').toLowerCase() !== 'false';
                }""",
            )
        )
    except Exception:
        return True


def _click_botao_segunda_via(page) -> None:
    sel = "#action-item-button-second-billing-way"
    page.locator(sel).first.wait_for(state="visible", timeout=15000)
    try:
        page.locator(sel).first.click(timeout=8000)
    except Exception:
        page.evaluate(
            """() => document.querySelector('#action-item-button-second-billing-way')?.click()"""
        )


def _recolher_e_reexpandir_segunda_via(page) -> str | None:
    """O GET manual volta vazio quando o acordeão não passou pelo clique do
    botão. Recolhe, espera a página, e reexpande — esse segundo clique é o
    que dispara getHistoricalInvoices."""
    if _segunda_via_expandida(page):
        log("↪ Clicando Segunda Via de Conta e Histórico (recolher)...")
        _click_botao_segunda_via(page)
        try:
            page.wait_for_load_state("load", timeout=20000)
        except Exception:
            pass
        recolhida_ate = time.time() + 8
        while time.time() < recolhida_ate and _segunda_via_expandida(page):
            if is_stopped():
                return None
            sleep_with_ui(page, 0.3)
    else:
        log("↪ Segunda Via já estava recolhida.")

    log("↪ Clicando Segunda Via de Conta e Histórico (reexpandir)...")
    captured: dict[str, str] = {}

    def on_response(resp) -> None:
        if "getHistoricalInvoices" not in (resp.url or "") or "text" in captured:
            return
        try:
            captured["text"] = resp.text()
        except Exception as e:
            captured["error"] = str(e)

    page.on("response", on_response)
    try:
        _click_botao_segunda_via(page)
        deadline = time.time() + 20
        while time.time() < deadline and "text" not in captured:
            if is_stopped():
                break
            sleep_with_ui(page, 0.3)
    finally:
        try:
            page.remove_listener("response", on_response)
        except Exception:
            pass
    if captured.get("text"):
        log("✔ GET getHistoricalInvoices disparado pelo botão Segunda Via.")
        return captured["text"]
    if captured.get("error"):
        log(f"⚠ Leitura do GET Segunda Via: {captured['error']}", "warn")
    else:
        log("⚠ O botão Segunda Via não disparou getHistoricalInvoices.", "warn")
    return None


def load_historical_invoices(page, uc: str) -> list[dict[str, Any]]:
    try:
        return _fetch_historical_invoices(page, uc)
    except RuntimeError as e:
        if "vazio" not in str(e):
            raise
        log(f"⚠ UC {uc}: getHistoricalInvoices vazio — nova tentativa em 1s.", "warn")
        sleep_with_ui(page, 1)
        try:
            return _fetch_historical_invoices(page, uc)
        except RuntimeError as retry_err:
            if "vazio" not in str(retry_err):
                raise
        log(
            f"⚠ UC {uc}: getHistoricalInvoices ainda vazio — "
            "recolhendo e reexpandindo Segunda Via de Conta e Histórico.",
            "warn",
        )
        try:
            text = _recolher_e_reexpandir_segunda_via(page)
        except Exception as click_err:
            log(f"⚠ UC {uc}: falha ao clicar Segunda Via: {click_err}", "warn")
            raise retry_err from click_err
        if text and text.strip():
            try:
                return _invoices_from_historical_text(text, uc)
            except json.JSONDecodeError:
                log("⚠ Resposta do botão Segunda Via também não era JSON.", "warn")
        return _fetch_historical_invoices(page, uc)


def decode_enel_url_pdf(url_pdf: str) -> bytes:
    s = (url_pdf or "").strip()
    marker = "base64,"
    idx = s.find(marker)
    if idx != -1:
        s = s[idx + len(marker) :]
    s = re.sub(r"\s+", "", s)
    if not s:
        raise RuntimeError("getBoleta não devolveu urlPdf")
    return base64.b64decode(s)


def fetch_boleta_pdf(page, uc: str, invoice_number: str) -> bytes:
    ctx = read_site_enel_session(page, uc)
    if not ctx.get("clientID"):
        raise RuntimeError(
            "clientID ausente no sessionStorage — getBoleta não pode ser chamado"
        )
    account_id = digits(uc) or str(uc)
    log(f"⏳ getBoleta invoice={invoice_number} account={account_id}")
    res = enel_site_xhr(
        page,
        "POST",
        SITE_ENEL_BOLETA_PATH,
        [
            ("companyCode", str(ctx.get("companyCode") or "2003")),
            ("type", "03"),
            ("invoiceNumberGroupedList", str(invoice_number)),
            ("accountID", account_id),
            ("clientID", str(ctx.get("clientID"))),
        ],
    )
    if res.get("status", 0) < 200 or res.get("status", 0) >= 300:
        raise RuntimeError(
            f"getBoleta HTTP {res.get('status')} ({str(res.get('text') or '')[:80]})"
        )
    try:
        data = json.loads(res.get("text") or "")
    except json.JSONDecodeError as e:
        raise RuntimeError(
            f"getBoleta não-JSON: {str(res.get('text') or '')[:120]}"
        ) from e
    desc = str(
        data.get("portugueseDescription") or data.get("englishDescription") or ""
    )
    if re.search(r"plano ativo", desc, re.I):
        raise RuntimeError(
            "Não será possível gerar sua fatura nesse momento (plano ativo)."
        )
    code = str(data.get("beResultCode") or "")
    result_ok = str(data.get("result") or "").upper() == "OK"
    if not result_ok and code and code != "000":
        raise RuntimeError(f"getBoleta recusou ({code}{': ' + desc if desc else ''})")
    if not data.get("urlPdf"):
        raise RuntimeError(
            f"getBoleta sem urlPdf ({desc})" if desc else "getBoleta sem urlPdf"
        )
    raw = decode_enel_url_pdf(str(data["urlPdf"]))
    if len(raw) < 5 or not raw.startswith(b"%PDF"):
        raise RuntimeError("getBoleta não devolveu PDF válido")
    return raw


def invoice_ref(inv: dict[str, Any]) -> str:
    return str(inv.get("referenceDate") or inv.get("reference") or "").strip()


def find_invoice(invoices: list[dict[str, Any]], referencia: str) -> dict[str, Any]:
    alvo = ref_key(referencia)
    matches = [inv for inv in invoices if ref_key(invoice_ref(inv)) == alvo]
    if not matches:
        raise RuntimeError(
            f"Referência {referencia} ({alvo}) não está no histórico API."
        )
    return matches[0]


def download_months_api(page, uc: str, refs: list[str]) -> list[Path]:
    """Após Contas + UC: baixa só via getHistoricalInvoices + getBoleta (sem UI)."""
    goto_contas(page)
    switch_uc(page, uc)
    invoices = load_historical_invoices(page, uc)
    preview = ", ".join(invoice_ref(inv) or "?" for inv in invoices[:15])
    log(f"[api] referências: {preview}")

    saved: list[Path] = []
    for i, raw in enumerate(refs):
        log(f"[lote] mês {i + 1}/{len(refs)}: UC {uc} ref={raw} (API getBoleta)")
        hit = find_invoice(invoices, raw)
        num = str(hit.get("invoiceNumber") or "").strip()
        if not num:
            # Cache pode ter vindo sem número — força refresh.
            invoices = load_historical_invoices(page, uc)
            hit = find_invoice(invoices, raw)
            num = str(hit.get("invoiceNumber") or "").strip()
        if not num:
            raise RuntimeError(f"invoiceNumber vazio para {raw}")
        pdf = fetch_boleta_pdf(page, uc, num)
        path = save_pdf(pdf, uc, invoice_ref(hit) or raw)
        saved.append(path)
        page.wait_for_timeout(400)
    return saved


# ─── Reconciliação de duplicidade + logextracao (porta de server.js) ─────────
# `reconciliarFaturasDuplicadas`/`runAutomation` liam a tabela HTML paginada de
# "Segunda Via" (#tableSecondaViaDeFactura) e comparavam por texto de célula.
# Aqui os mesmos dados vêm de uma vez só via `getHistoricalInvoices` (JSON) —
# sem paginação, sem reabrir acordeão, sem fallback UI→API (é API desde o
# início). Os nomes de campo abaixo (INVOICE_FIELD_CANDIDATES) foram conferidos
# num payload real de getHistoricalInvoices (DevTools) — ver mapeamento 1:1
# com a tabela antiga: Leitura=reading, Referência=referenceDate,
# Vencimento=expiryDate, Valor=amount, Pagamento/Situação=invoiceState,
# Consumo=consumption. Tipo continua fixo em "Site ENEL" (não vem da API).

FATURA_ZERADA_MSG = "fatura zerada, inexistente no site"
FATURA_INDISPONIVEL_MSG = "fatura indisponível"
ERRO_GERACAO_FATURA_ENEL = (
    "Fatura com erro de geração no site da ENEL (Cliente possui plano ativo)."
)

# Campos do objeto de fatura (getHistoricalInvoices) — vários candidatos por
# campo porque não temos uma amostra real ainda; ajustar após o 1º teste local
# (o log `[api] campos da fatura` abaixo mostra as chaves de verdade).
INVOICE_FIELD_CANDIDATES: dict[str, tuple[str, ...]] = {
    "leitura": ("reading",),
    "consumoKwh": ("consumption",),
    "vencimento": ("expiryDate",),
    "valor": ("amount",),
    "situacao": ("invoiceState",),
}
_LOGGED_INVOICE_KEYS = False


def invoice_field(inv: dict[str, Any], target: str) -> str:
    for key in INVOICE_FIELD_CANDIDATES.get(target, ()):
        if key in inv and inv[key] is not None:
            return str(inv[key])
    return ""


def log_invoice_keys_once(inv: dict[str, Any]) -> None:
    """Log de diagnóstico único: mostra as chaves reais da 1ª fatura recebida,
    pra conferir/ajustar INVOICE_FIELD_CANDIDATES depois do teste local."""
    global _LOGGED_INVOICE_KEYS
    if _LOGGED_INVOICE_KEYS or not inv:
        return
    _LOGGED_INVOICE_KEYS = True
    log(f"[api] campos da fatura (getHistoricalInvoices): {sorted(inv.keys())}")


def get_current_reference_key() -> str:
    import datetime

    try:
        from zoneinfo import ZoneInfo

        tz = ZoneInfo(os.environ.get("EXTRACTION_TIMEZONE") or "America/Fortaleza")
        now = datetime.datetime.now(tz)
    except Exception:
        now = datetime.datetime.now()
    return f"{now.year:04d}-{now.month:02d}"


def last_n_month_keys(n: int = 12) -> list[str]:
    import datetime

    now = datetime.date.today()
    keys = []
    for i in range(n):
        month0 = now.month - 1 - i
        year = now.year + month0 // 12
        month = month0 % 12 + 1
        keys.append(f"{year:04d}-{month:02d}")
    return keys


def oldest_allowed_month_key() -> str:
    return last_n_month_keys(12)[-1]


def normalize_reference_keys(value: Any) -> list[str]:
    items = value if isinstance(value, list) else ([value] if value else [])
    out: list[str] = []
    for item in items:
        raw = str(item if item is not None else "").strip()
        chave = raw if re.match(r"^\d{4}-\d{2}$", raw) else ref_key(raw)
        if chave and re.match(r"^\d{4}-\d{2}$", chave) and chave not in out:
            out.append(chave)
    return out


def filter_references_last_12_months(keys: list[str]) -> list[str]:
    allowed = set(last_n_month_keys(12))
    kept = [k for k in keys if k in allowed]
    skipped = [k for k in keys if k not in allowed]
    if skipped:
        log(f"⚠ Ignorando {len(skipped)} fatura(s) com mais de 12 meses: {', '.join(skipped)}.")
    return kept


def uc_somente_situacao(config: dict[str, Any], uc: str) -> bool:
    lista = config.get("somenteSituacaoUcs")
    if not isinstance(lista, list) or not lista:
        return False
    alvo = digits(str(uc))
    return any(digits(str(n)) == alvo for n in lista)


def get_target_reference_keys(config: dict[str, Any], uc: str, fallback_key: str) -> list[str]:
    """Referências alvo de uma UC: específicas > padrão do lote > mês corrente."""
    mapa = config.get("referencias")
    if isinstance(mapa, dict) and uc:
        dig = digits(str(uc))
        do_uc = mapa.get(uc) or mapa.get(dig) or mapa.get(str(int(dig)) if dig else "")
        chaves = normalize_reference_keys(do_uc)
        if chaves:
            return filter_references_last_12_months(chaves)

    padrao_raw = config.get("referencias") if isinstance(config.get("referencias"), list) else config.get("referenciasPadrao")
    padrao = normalize_reference_keys(padrao_raw)
    return filter_references_last_12_months(padrao or [fallback_key])


def situacao_eh_cancelada(value: str) -> bool:
    n = unicodedata.normalize("NFD", value or "")
    n = "".join(ch for ch in n if unicodedata.category(ch) != "Mn").strip().lower()
    n = re.sub(r"\s+", " ", n)
    return n.startswith("cancelad")


def parse_valor_numero(valor: str) -> float | None:
    raw = re.sub(r"[R$\s]", "", str(valor or ""), flags=re.I).strip()
    if not raw:
        return None
    try:
        if "," in raw and "." in raw:
            return float(raw.replace(".", "").replace(",", "."))
        if "," in raw:
            return float(raw.replace(",", "."))
        return float(raw)
    except ValueError:
        return None


def valor_eh_zero(valor: str) -> bool:
    n = parse_valor_numero(valor)
    return n is not None and n == 0


def valor_bate(a: str, b: str) -> bool:
    return str(a or "").strip() == str(b or "").strip()


def to_log_extraction_row(uc: str, inv: dict[str, Any]) -> dict[str, str]:
    log_invoice_keys_once(inv)
    return {
        "uc": digits(str(uc)),
        "leitura": invoice_field(inv, "leitura"),
        "referencia": invoice_ref(inv),
        "consumoKwh": invoice_field(inv, "consumoKwh"),
        "vencimento": invoice_field(inv, "vencimento"),
        "tipo": "Site ENEL",
        "valor": invoice_field(inv, "valor"),
        "situacao": invoice_field(inv, "situacao"),
    }


def persist_log_rows(uc: str, invoices: list[dict[str, Any]]) -> None:
    if not invoices:
        return
    rows = [to_log_extraction_row(uc, inv) for inv in invoices]
    try:
        post_backend("/enel/internal/logextracao", {"items": rows})
        log(f"✔ {len(rows)} linha(s) enviadas para logextracao.", "success")
    except Exception as e:
        log(f"⚠ Falha ao enviar logextracao: {e}", "warn")


def fetch_log_extracao_existentes(uc: str) -> list[dict[str, Any]]:
    if not backend_integrado():
        return []
    try:
        data = post_backend(
            "/enel/internal/logextracao", method="GET", params={"uc": digits(str(uc))}
        )
        return data if isinstance(data, list) else []
    except Exception as e:
        log(f"⚠ UC {uc}: falha ao consultar logextracao existente: {e}", "warn")
        return []


def ja_baixado_no_backend(existentes: list[dict[str, Any]], ref_chave: str, valor: str) -> bool:
    return any(
        ref_key(str(l.get("referencia") or "")) == ref_chave
        and valor_bate(l.get("valor"), valor)
        and str(l.get("linkArquivo") or "").strip() != ""
        for l in existentes
    )


def nivel_legado_por_valor(existentes: list[dict[str, Any]], ref_chave: str, valor: str) -> int:
    for l in existentes:
        if ref_key(str(l.get("referencia") or "")) == ref_chave and valor_bate(l.get("valor"), valor):
            try:
                return int(l.get("nivelLegado") or 0)
            except (TypeError, ValueError):
                return 0
    return 0


def marcar_linhas_para_download(linhas: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Par Cancelada + (Em Aberto/Paga): Cancelada baixa com sufixo Old. Só
    Cancelada sozinha não usa Old (não tem par pra ser "a antiga de")."""
    tem_par = any(l["cancelada"] for l in linhas) and any(not l["cancelada"] for l in linhas)
    ordenadas = sorted(linhas, key=lambda l: not l["cancelada"])  # canceladas primeiro
    return [{**l, "legado": bool(tem_par and l["cancelada"])} for l in ordenadas]


def group_invoices_by_reference(invoices: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    grupos: dict[str, list[dict[str, Any]]] = {}
    for inv in invoices:
        chave = ref_key(invoice_ref(inv))
        if not chave:
            continue
        grupos.setdefault(chave, []).append(inv)
    return grupos


def caminho_pdf(uc: str, referencia: str, nivel: int) -> Path:
    suffix = " Old" * nivel
    name = f"{ref_slug(ref_key(referencia))} - {digits(uc)}{suffix}.pdf"
    return DOWNLOAD_DIR / name


def _nivel_legado(row: dict[str, Any]) -> int:
    try:
        return int(row.get("nivelLegado") or 0)
    except (TypeError, ValueError):
        return 0


def _linhas_da_referencia(
    existentes: list[dict[str, Any]], ref_chave: str
) -> list[dict[str, Any]]:
    return [
        row
        for row in existentes
        if ref_key(str(row.get("referencia") or "")) == ref_chave
    ]


def _tem_link(row: dict[str, Any]) -> bool:
    return bool(str(row.get("linkArquivo") or "").strip())


def atual_confere_resumo(
    existentes: list[dict[str, Any]], ref_chave: str, inv: dict[str, Any]
) -> bool:
    """Paga/Em Aberto já é o PDF do mês (nível 0) no resumo."""
    valor = invoice_field(inv, "valor")
    for row in _linhas_da_referencia(existentes, ref_chave):
        if _nivel_legado(row) != 0:
            continue
        if situacao_eh_cancelada(str(row.get("situacao") or "")):
            return False
        if not _tem_link(row):
            return False
        return valor_bate(row.get("valor"), valor)
    return False


def cancelada_confere_resumo(
    existentes: list[dict[str, Any]], ref_chave: str, inv: dict[str, Any]
) -> bool:
    """Cancelada já está num Old do mês (nível > 0) no resumo."""
    valor = invoice_field(inv, "valor")
    for row in _linhas_da_referencia(existentes, ref_chave):
        if _nivel_legado(row) <= 0:
            continue
        if not situacao_eh_cancelada(str(row.get("situacao") or "")):
            continue
        if not _tem_link(row):
            continue
        if valor_bate(row.get("valor"), valor):
            return True
    return False


def nivel_old_da_cancelada(
    existentes: list[dict[str, Any]], ref_chave: str, inv: dict[str, Any]
) -> int:
    valor = invoice_field(inv, "valor")
    for row in _linhas_da_referencia(existentes, ref_chave):
        nivel = _nivel_legado(row)
        if nivel <= 0:
            continue
        if situacao_eh_cancelada(str(row.get("situacao") or "")) and valor_bate(
            row.get("valor"), valor
        ):
            return nivel
    usados = {
        _nivel_legado(row)
        for row in _linhas_da_referencia(existentes, ref_chave)
        if _nivel_legado(row) > 0
    }
    nivel = 1
    while nivel in usados:
        nivel += 1
    return nivel


def liberar_pdf_mes_para_old(uc: str, referencia: str) -> Path | None:
    """O PDF do mês está ocupado pela Cancelada. Passa esse arquivo para o
    próximo Old livre para o Paga/Em Aberto poder ocupar o nome normal."""
    atual = caminho_pdf(uc, referencia, 0)
    if not atual.exists():
        return None
    nivel = 1
    while nivel < 8 and caminho_pdf(uc, referencia, nivel).exists():
        nivel += 1
    dest = caminho_pdf(uc, referencia, nivel)
    if dest.exists():
        log(f"⚠ Não há slot Old livre para mover {atual.name}.", "warn")
        return None
    atual.rename(dest)
    log(f"✔ {atual.name} → {dest.name} (Cancelada no Old).")
    try:
        post_backend("/enel/internal/faturasextraidas", {"nome": dest.name})
        log(f"✔ Arquivo registrado no backend: {dest.name}", "success")
    except Exception as e:
        log(f"⚠ Falha ao registrar {dest.name}: {e}", "warn")
    return dest


def _avisar_falha_download(uc: str, ref_chave: str, exc: Exception) -> None:
    msg = str(exc)
    low = msg.lower()
    if "plano ativo" in low:
        log(f"⚠ UC {uc}: {ERRO_GERACAO_FATURA_ENEL}", "warn")
        emit_uc_result(uc, "atencao", ERRO_GERACAO_FATURA_ENEL, ref_chave)
    elif "zerada" in low:
        log(f"⚠ UC {uc}: {FATURA_ZERADA_MSG}", "warn")
        emit_uc_result(uc, "atencao", FATURA_ZERADA_MSG, ref_chave)
    elif "já existe em disco" in low:
        log(f"✘ UC {uc}: {msg}", "error")
        emit_uc_result(uc, "error", msg, ref_chave)
    else:
        log(f"⚠ UC {uc}: {FATURA_INDISPONIVEL_MSG} ({ref_chave}).", "warn")
        emit_uc_result(uc, "atencao", FATURA_INDISPONIVEL_MSG, ref_chave)


def _baixar_papel(
    page,
    uc: str,
    ref_chave: str,
    inv: dict[str, Any],
    nivel: int,
    *,
    overwrite: bool = False,
) -> None:
    valor = invoice_field(inv, "valor")
    if valor_eh_zero(valor):
        log(f"⚠ UC {uc}: {FATURA_ZERADA_MSG} ({ref_chave}).", "warn")
        emit_uc_result(uc, "atencao", FATURA_ZERADA_MSG, ref_chave)
        return
    papel = "Old" if nivel > 0 else "mês"
    situacao = invoice_field(inv, "situacao")
    log(
        f"↻ UC {uc}: {ref_chave} — {situacao or papel} "
        f"(Valor {valor}) no {papel}. Baixando..."
    )
    try:
        baixar_fatura_uc(page, uc, ref_chave, inv, nivel=nivel, overwrite=overwrite)
    except Exception as e:
        _avisar_falha_download(uc, ref_chave, e)


def baixar_mes_cancelada_e_atual(
    page,
    uc: str,
    ref_chave: str,
    invs_do_mes: list[dict[str, Any]],
    existentes: list[dict[str, Any]],
) -> bool:
    """Cancelada vai para o Old do mês; Paga/Em Aberto fica no arquivo normal.
    Se o resumo não estiver assim, baixa só o papel que falta. Valores iguais
    (PIX/boleto diferentes) também baixam os dois PDFs."""
    canceladas = [
        inv
        for inv in invs_do_mes
        if situacao_eh_cancelada(invoice_field(inv, "situacao"))
    ]
    atuais = [
        inv
        for inv in invs_do_mes
        if not situacao_eh_cancelada(invoice_field(inv, "situacao"))
    ]
    if not canceladas or not atuais:
        return False

    atual = atuais[-1]
    pend_canceladas = [
        inv
        for inv in canceladas
        if not cancelada_confere_resumo(existentes, ref_chave, inv)
    ]
    pend_atual = not atual_confere_resumo(existentes, ref_chave, atual)
    if not pend_canceladas and not pend_atual:
        log(
            f"✔ UC {uc}: {ref_chave} já confere com o resumo "
            "(Cancelada no Old, Paga/Em Aberto no mês)."
        )
        return True

    valor_atual = invoice_field(atual, "valor")
    valores_iguais = all(
        valor_bate(invoice_field(inv, "valor"), valor_atual) for inv in canceladas
    )
    log(
        f"↻ UC {uc}: {ref_chave} — Cancelada no Old e Paga/Em Aberto no mês "
        f"não conferem com o resumo. Baixando o que falta."
    )

    if pend_atual and caminho_pdf(uc, ref_chave, 0).exists():
        movido = liberar_pdf_mes_para_old(uc, ref_chave)
        if (
            movido
            and not valores_iguais
            and len(pend_canceladas) == 1
            and valor_bate(invoice_field(pend_canceladas[0], "valor"), valor_atual) is False
        ):
            nivel0 = next(
                (
                    row
                    for row in _linhas_da_referencia(existentes, ref_chave)
                    if _nivel_legado(row) == 0
                ),
                None,
            )
            if nivel0 and valor_bate(
                nivel0.get("valor"), invoice_field(pend_canceladas[0], "valor")
            ):
                log(
                    f"✔ UC {uc}: {ref_chave} — a Cancelada que estava no mês "
                    "foi para o Old. Sem baixar de novo."
                )
                pend_canceladas = []

    for inv in pend_canceladas:
        nivel = nivel_old_da_cancelada(existentes, ref_chave, inv)
        overwrite = caminho_pdf(uc, ref_chave, nivel).exists() and valores_iguais
        _baixar_papel(page, uc, ref_chave, inv, nivel, overwrite=overwrite)
    if pend_atual:
        _baixar_papel(page, uc, ref_chave, atual, 0)
    return True


def baixar_fatura_uc(
    page, uc: str, ref_chave: str, inv: dict[str, Any], *, nivel: int = 0, overwrite: bool = False
) -> Path:
    """1 fatura: getBoleta (API) + salva e registra no backend
    (`/enel/internal/faturasextraidas`) — equivalente a `downloadInvoiceViaBoleta`."""
    num = str(inv.get("invoiceNumber") or "").strip()
    if not num:
        raise RuntimeError(f"invoiceNumber vazio para {ref_chave}")
    pdf = fetch_boleta_pdf(page, uc, num)
    path = save_pdf(
        pdf, uc, invoice_ref(inv) or ref_chave, nivel=nivel, overwrite=overwrite
    )
    try:
        post_backend("/enel/internal/faturasextraidas", {"nome": path.name})
        log(f"✔ Arquivo registrado no backend: {path.name}", "success")
    except Exception as e:
        log(f"⚠ Falha ao registrar arquivo no backend: {e}", "warn")
    return path


def emit_uc_result(uc: str, status: str, message: str | None = None, referencia: str | None = None) -> None:
    event: dict[str, Any] = {"type": "site_enel_uc_result", "uc": digits(str(uc)), "status": status}
    if message:
        event["message"] = message
    if referencia:
        event["referencia"] = referencia
    if BATCH_MODE:
        emit(event)
    else:
        log(f"[uc-result] {event}")


def refs_precisam_pdf_refaturamento(
    invoices: list[dict[str, Any]], existentes: list[dict[str, Any]]
) -> set[str]:
    """Meses em que o JSON diverge do nível 0 em /resumo-extracoes (Valor/
    Vencimento) ou há par Cancelada+atual — precisam do fluxo Old + PDF.
    Cancelada sozinha (sem substituta no mês) NÃO entra: só atualiza
    situação, sem inventar Old."""
    need: set[str] = set()
    meses_12 = set(last_n_month_keys(12))
    for ref_chave, invs_do_mes in group_invoices_by_reference(invoices).items():
        if ref_chave not in meses_12:
            continue
        canceladas = [
            i for i in invs_do_mes if situacao_eh_cancelada(invoice_field(i, "situacao"))
        ]
        nao_canc = [
            i
            for i in invs_do_mes
            if not situacao_eh_cancelada(invoice_field(i, "situacao"))
        ]
        atual = nao_canc[-1] if nao_canc else None
        if not atual:
            continue
        if canceladas:
            need.add(ref_chave)
            continue
        nivel0 = next(
            (
                e
                for e in existentes
                if ref_key(str(e.get("referencia") or "")) == ref_chave
                and int(e.get("nivelLegado") or 0) == 0
            ),
            None,
        )
        if not nivel0:
            continue
        if not valor_bate(nivel0.get("valor"), invoice_field(atual, "valor")) or str(
            nivel0.get("vencimento") or ""
        ).strip() != invoice_field(atual, "vencimento").strip():
            need.add(ref_chave)
    return need


def reconciliar_faturas_duplicadas(
    page, uc: str, invoices: list[dict[str, Any]], *, somente_registrar: bool = False
) -> list[dict[str, Any]]:
    """Porta de `reconciliarFaturasDuplicadas`: grava tudo em logextracao;
    baixa o que falta nos meses com 2+ Valores distintos (Cancelada +
    Paga/Em Aberto, ou refaturamento). Em modo "só situação" (validação)
    não baixa PDF — exceto se o JSON divergir do resumo (aí roda o
    fluxo de refaturamento: Old + PDF novo)."""
    if not invoices:
        return []
    existentes_antes = (
        fetch_log_extracao_existentes(uc) if somente_registrar else []
    )
    refs_refaturamento = (
        refs_precisam_pdf_refaturamento(invoices, existentes_antes)
        if somente_registrar
        else set()
    )
    persist_log_rows(uc, invoices)
    if somente_registrar and not refs_refaturamento:
        return invoices
    if somente_registrar and refs_refaturamento:
        log(
            f"↻ UC {uc}: validação detectou divergência em "
            f"{', '.join(sorted(refs_refaturamento))} — refaturamento (PDF).",
        )

    existentes = fetch_log_extracao_existentes(uc)
    grupos = group_invoices_by_reference(invoices)
    meses_12 = set(last_n_month_keys(12))

    for ref_chave, invs_do_mes in grupos.items():
        if ref_chave not in meses_12:
            continue
        if somente_registrar:
            if ref_chave not in refs_refaturamento:
                continue
        elif len(invs_do_mes) < 2:
            continue  # sem duplicidade nesse mês (extração normal)
        if baixar_mes_cancelada_e_atual(page, uc, ref_chave, invs_do_mes, existentes):
            continue
        valores_distintos = {invoice_field(inv, "valor").strip() for inv in invs_do_mes}
        for valor in valores_distintos:
            if ja_baixado_no_backend(existentes, ref_chave, valor):
                continue
            if valor_eh_zero(valor):
                log(f"⚠ UC {uc}: {FATURA_ZERADA_MSG} ({ref_chave}).", "warn")
                continue
            inv_ref = next(
                (inv for inv in invs_do_mes if invoice_field(inv, "valor").strip() == valor),
                None,
            )
            if inv_ref is None:
                continue
            nivel = nivel_legado_por_valor(existentes, ref_chave, valor)
            situacao = invoice_field(inv_ref, "situacao")
            rotulo = ("Old" + " Old" * (nivel - 1)) if nivel > 0 else "atual"
            log(
                f"↻ UC {uc}: referência {ref_chave} — fatura {rotulo}"
                f"{' (Cancelada)' if situacao_eh_cancelada(situacao) else ''} "
                f"(Valor {valor}) ainda sem PDF. Baixando...",
            )
            try:
                baixar_fatura_uc(page, uc, ref_chave, inv_ref, nivel=nivel)
            except Exception as e:
                msg = str(e)
                if "plano ativo" in msg.lower():
                    log(f"⚠ UC {uc}: {ERRO_GERACAO_FATURA_ENEL}", "warn")
                    emit_uc_result(uc, "atencao", ERRO_GERACAO_FATURA_ENEL, ref_chave)
                else:
                    log(f"✘ UC {uc}: {msg} ({ref_chave}).", "error")
                    emit_uc_result(uc, "error", msg, ref_chave)
    return invoices


def baixar_referencias_alvo(
    page,
    uc: str,
    referencias_alvo: list[str],
    invoices: list[dict[str, Any]],
    existentes: list[dict[str, Any]],
) -> None:
    """Porta do loop final de `runAutomation`: baixa os meses que o lote pediu
    de fato (não só os duplicados) — cada mês pode ter 1 fatura normal ou um
    par Cancelada+atual, que já vem marcado por `marcar_linhas_para_download`."""
    grupos = group_invoices_by_reference(invoices)
    for ref_chave in referencias_alvo:
        invs_do_mes = grupos.get(ref_chave) or []
        if not invs_do_mes:
            log(f"⚠ UC {uc}: não há fatura da referência {ref_chave}.", "warn")
            continue

        if baixar_mes_cancelada_e_atual(page, uc, ref_chave, invs_do_mes, existentes):
            continue

        linhas = [
            {"inv": inv, "cancelada": situacao_eh_cancelada(invoice_field(inv, "situacao"))}
            for inv in invs_do_mes
        ]
        marcadas = marcar_linhas_para_download(linhas)
        if len(marcadas) > 1:
            log(
                f"↻ UC {uc}: {len(marcadas)} fatura(s) da referência {ref_chave} "
                "(Cancelada + atual). Baixando as duas...",
            )

        for linha in marcadas:
            inv = linha["inv"]
            valor = invoice_field(inv, "valor")
            nivel = 1 if linha["legado"] else 0

            if ja_baixado_no_backend(existentes, ref_chave, valor):
                log(f"✔ UC {uc}: referência {ref_chave} (Valor {valor}) já tinha PDF — pulando.")
                continue
            if valor_eh_zero(valor):
                log(f"⚠ UC {uc}: {FATURA_ZERADA_MSG} ({ref_chave}).", "warn")
                emit_uc_result(uc, "atencao", FATURA_ZERADA_MSG, ref_chave)
                continue
            try:
                baixar_fatura_uc(page, uc, ref_chave, inv, nivel=nivel)
            except Exception as e:
                msg = str(e)
                low = msg.lower()
                if "plano ativo" in low:
                    log(f"⚠ UC {uc}: {ERRO_GERACAO_FATURA_ENEL}", "warn")
                    emit_uc_result(uc, "atencao", ERRO_GERACAO_FATURA_ENEL, ref_chave)
                elif "zerada" in low:
                    log(f"⚠ UC {uc}: {FATURA_ZERADA_MSG}", "warn")
                    emit_uc_result(uc, "atencao", FATURA_ZERADA_MSG, ref_chave)
                elif "já existe em disco" in low:
                    log(f"✘ UC {uc}: {msg}", "error")
                    emit_uc_result(uc, "error", msg, ref_chave)
                else:
                    log(f"⚠ UC {uc}: {FATURA_INDISPONIVEL_MSG} ({ref_chave}).", "warn")
                    emit_uc_result(uc, "atencao", FATURA_INDISPONIVEL_MSG, ref_chave)


def capture_account_data(page, uc: str) -> dict[str, Any] | None:
    """Intercepta a resposta de `selectAccountBrasilCommand` durante o
    switchAccount — mesmos dados que `runAutomation` registrava em
    `/ucs/internal/from-enel` (endereço, nº de instalação, CPF/CNPJ...)."""
    captured: dict[str, Any] = {}

    def on_response(resp) -> None:
        if "selectAccountBrasilCommand" not in (resp.url or ""):
            return
        try:
            captured["data"] = resp.json()
        except Exception:
            pass

    page.on("response", on_response)
    try:
        switch_uc(page, uc)
    finally:
        try:
            page.remove_listener("response", on_response)
        except Exception:
            pass
    return captured.get("data")


def register_uc_from_enel(config: dict[str, Any], uc: str, account_data: dict[str, Any]) -> None:
    user_id = config.get("userId")
    if not account_data or not user_id:
        return
    doc_num = account_data.get("UserDocumentNum") or account_data.get("userDocumentNum") or ""
    payload = {
        "numero_cliente": digits(str(uc)),
        "numero_instalacao": (
            account_data.get("InstallationNumber")
            or account_data.get("installationNumber")
            or account_data.get("Instalacao")
            or ""
        ),
        "user_id": user_id,
        "endereco": (
            account_data.get("AddressSelect")
            or account_data.get("addressSelect")
            or account_data.get("addressSelected")
            or ""
        ),
        "nome_beneficiario": account_data.get("SupplyName") or account_data.get("supplyName") or "",
        "login_enel": config.get("user") or "",
        "senha_enel": config.get("pass") or "",
        "cpf_cnpj": doc_num,
        "tipo_conta": "empresarial" if config.get("typeComp") else "pessoal",
    }
    try:
        post_backend("/ucs/internal/from-enel", payload)
    except Exception as e:
        log(f"⚠ Erro ao registrar UC {uc}: {e}", "warn")


def process_uc_site_enel(page, config: dict[str, Any], uc: str) -> None:
    """Uma UC completa: troca de conta, API de faturas, reconciliação de
    duplicidade e download dos meses pedidos — equivalente ao corpo do loop
    `for (const uc of ucs)` em runAutomation()."""
    if uc:
        log(f"↻ Selecionando UC {uc}...")
        goto_contas(page)
        try:
            account_data = capture_account_data(page, uc)
        except Exception as e:
            log(f"✘ UC {uc}: Erro ao entrar no Site ENEL. Pulando esta UC. ({e})", "error")
            emit_uc_result(uc, "error", "Erro ao entrar no Site ENEL")
            return False
        register_uc_from_enel(config, uc, account_data or {})
    else:
        goto_contas(page)

    try:
        invoices = load_historical_invoices(page, uc)
    except Exception as e:
        log(f"⚠ Tabela de faturas não encontrada para UC {uc}: {e}", "warn")
        emit_uc_result(uc, "error", "Tabela de faturas não encontrada")
        return False

    skip_download = uc_somente_situacao(config, uc)
    reconciliar_faturas_duplicadas(page, uc, invoices, somente_registrar=skip_download)
    if skip_download:
        log(
            f"✔ UC {uc}: situação conferida no resumo (JSON; PDF só se refaturamento).",
            "success",
        )
        return True

    existentes = fetch_log_extracao_existentes(uc)
    presentes = filter_references_last_12_months(
        list({ref_key(invoice_ref(inv)) for inv in invoices if ref_key(invoice_ref(inv))})
    )
    fallback_key = get_current_reference_key()
    if config.get("baixarTodosOsMeses"):
        referencias_alvo = presentes
    else:
        pedidas = get_target_reference_keys(config, uc, fallback_key)
        presentes_set = set(presentes)
        newest = presentes[0] if presentes else ""
        referencias_alvo = [
            k for k in pedidas if k in presentes_set or (newest and k >= newest)
        ]

    if not referencias_alvo:
        log(f"⚠ UC {uc}: nenhuma fatura dos últimos 12 meses para baixar.", "warn")
        return True

    log(f"↻ UC {uc}: baixando {len(referencias_alvo)} PDF(s) dos últimos 12 meses...")
    baixar_referencias_alvo(page, uc, referencias_alvo, invoices, existentes)
    return True


def fechar_avisos(page, tentativas: int = 4) -> None:
    for _ in range(tentativas):
        try:
            fechou = safe_evaluate(
                page,
                """() => {
                  const sels = [
                    '.fancybox-button--close',
                    '.fancybox-close-small',
                    'button[aria-label="Close"]',
                    '#secondwayBilling__not-valid-option button',
                    '.modal.show .btn-close',
                    '.modal.in .close',
                  ];
                  let n = 0;
                  for (const sel of sels) {
                    for (const el of document.querySelectorAll(sel)) {
                      const st = getComputedStyle(el);
                      if (st.display === 'none' || st.visibility === 'hidden') continue;
                      el.click();
                      n += 1;
                    }
                  }
                  for (const btn of document.querySelectorAll('button, a, input[type="button"]')) {
                    const t = ((btn.value || btn.innerText || btn.textContent) || '').trim().toLowerCase();
                    if (!t) continue;
                    if (!/^(ok|fechar|entendi|continuar|close)$/i.test(t)) continue;
                    const st = getComputedStyle(btn);
                    if (st.display === 'none' || st.visibility === 'hidden') continue;
                    const r = btn.getBoundingClientRect();
                    if (r.width < 2 || r.height < 2) continue;
                    btn.click();
                    n += 1;
                  }
                  return n;
                }""",
            )
            if fechou:
                sleep_with_ui(page, 0.4)
            else:
                sleep_with_ui(page, 0.3)
        except Exception:
            break


def open_segunda_via(page, *, recover=None) -> None:
    """Abre a grade; se vier vazia, recupera (reload/reenter) e tenta de novo."""
    last_err: Exception | None = None
    for attempt in range(1, 4):
        try:
            fechar_avisos(page)
            page.locator("#action-item-button-second-billing-way").wait_for(
                state="visible", timeout=20000
            )
            page.evaluate(
                """() => document.querySelector('#action-item-button-second-billing-way')?.click()"""
            )
            if attempt == 1:
                log("✔ Segunda Via de Conta e Histórico.")
            else:
                log(f"✔ Segunda Via reaberta (tentativa {attempt}/3).")
            page.wait_for_timeout(2000 + (attempt - 1) * 1500)
            fechar_avisos(page)
            page.locator("#tableSecondaViaDeFactura").wait_for(state="visible", timeout=25000)
            page.wait_for_function(
                """() => document.querySelectorAll('#tableSecondaViaDeFactura tbody tr').length > 0""",
                timeout=30000 + (attempt - 1) * 15000,
            )
            page.wait_for_timeout(1000)
            return
        except Exception as e:
            last_err = e
            n = page.evaluate(
                """() => ({
                  table: !!document.querySelector('#tableSecondaViaDeFactura'),
                  rows: document.querySelectorAll('#tableSecondaViaDeFactura tbody tr').length,
                  html: (document.querySelector('#tableSecondaViaDeFactura')?.innerText || '').slice(0, 200),
                })"""
            )
            log(f"⚠ Tabela Segunda Via vazia/timeout ({attempt}/3): {n}")
            screenshot(page, f"site_enel_camoufox_tabela_vazia_{attempt}.jpg")
            if attempt >= 3:
                break
            if recover:
                recover()
            else:
                page.goto(CONTAS_URL, wait_until="domcontentloaded", timeout=45000)
                page.wait_for_timeout(2500)
    raise RuntimeError(f"Tabela de Segunda Via sem linhas: {last_err}") from last_err


def list_invoices(page) -> list[dict[str, Any]]:
    return page.evaluate(
        """() => {
          const table = document.querySelector('#tableSecondaViaDeFactura');
          if (!table) return [];
          const headers = Array.from(table.querySelectorAll('thead th')).map((th) =>
            (th.innerText || th.textContent || '').trim()
          );
          const refIdx = headers.findIndex((h) => /refer/i.test(h));
          const sitIdx = headers.findIndex((h) => /situa/i.test(h));
          const valIdx = headers.findIndex((h) => /valor/i.test(h));
          return Array.from(table.querySelectorAll('tbody tr')).map((tr, index) => {
            const tds = Array.from(tr.querySelectorAll('td'));
            const byLabel = (labels) => {
              for (const label of labels) {
                const td = tr.querySelector(`td[data-label="${label}"]`);
                const v = (td && (td.innerText || td.textContent) || '').trim();
                if (v) return v;
              }
              return '';
            };
            const byIdx = (i) => {
              if (i < 0 || i >= tds.length) return '';
              return (tds[i].innerText || tds[i].textContent || '').trim();
            };
            const cells = tds.map((td) => (td.innerText || td.textContent || '').trim());
            const guessRef = cells.find((c) => /\\d{2}\\/\\d{4}/.test(c)) || '';
            const cb = tr.querySelector('td[data-label="Selecione"] input, input[type="checkbox"]');
            return {
              index,
              reference:
                byLabel(['Referência', 'Referencia', 'Referência ']) ||
                byIdx(refIdx) ||
                guessRef,
              situation: byLabel(['Situação', 'Situacao']) || byIdx(sitIdx),
              valor: byLabel(['Valor']) || byIdx(valIdx),
              checked: !!(cb && cb.checked),
              cells,
            };
          });
        }"""
    )


def mark_one_row(page, index: int) -> dict[str, Any]:
    return page.evaluate(
        """(idx) => {
          const rows = Array.from(document.querySelectorAll('#tableSecondaViaDeFactura tbody tr'));
          const checked = [];
          rows.forEach((tr, i) => {
            const cb = tr.querySelector('td[data-label="Selecione"] input, input[type="checkbox"]');
            if (!cb) return;
            const want = i === idx;
            if (cb.checked !== want) cb.click();
            if (cb.checked) checked.push(i);
          });
          return { checked, ok: checked.length === 1 && checked[0] === idx };
        }""",
        index,
    )


def download_row(page, uc: str, referencia: str, index: int) -> Path:
    marked = mark_one_row(page, index)
    log(f"[pdf] checks={marked}")
    if not marked.get("ok"):
        raise RuntimeError(f"Checkbox não ficou exclusivo: {marked}")

    captured: dict[str, Any] = {"bytes": None, "download": None}

    def on_response(response) -> None:
        try:
            headers = {str(k).lower(): str(v) for k, v in (response.headers or {}).items()}
            ct = headers.get("content-type", "").lower()
            cd = headers.get("content-disposition", "").lower()
            looks = "application/pdf" in ct or "pdf" in cd or (response.url or "").lower().endswith(".pdf")
            if looks and captured["bytes"] is None:
                body = response.body()
                if body and body.startswith(b"%PDF"):
                    captured["bytes"] = body
                    log(f"[pdf] rede {len(body)} bytes {response.url}")
        except Exception:
            pass

    def on_download(download) -> None:
        captured["download"] = download
        log(f"[pdf] evento download {download.suggested_filename}")

    context = page.context
    context.on("response", on_response)
    page.on("download", on_download)
    try:
        page.locator("#pdf").wait_for(state="visible", timeout=8000)
        page.evaluate("""() => document.querySelector('#pdf')?.click()""")
        log("✔ Botão PDF clicado.")
        deadline = time.time() + 25
        while time.time() < deadline:
            if captured.get("bytes"):
                return save_pdf(captured["bytes"], uc, referencia)
            dl = captured.get("download")
            if dl is not None:
                DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)
                name = f"{ref_slug(ref_key(referencia))} - {digits(uc)}.pdf"
                target = DOWNLOAD_DIR / name
                if target.exists():
                    target.unlink()
                dl.save_as(str(target))
                log(f"✔ PDF via download: {target}")
                return target
            page.wait_for_timeout(400)
        if captured.get("bytes"):
            return save_pdf(captured["bytes"], uc, referencia)
        raise RuntimeError("Timeout aguardando PDF do Site ENEL")
    finally:
        try:
            context.remove_listener("response", on_response)
        except Exception:
            pass
        try:
            page.remove_listener("download", on_download)
        except Exception:
            pass
        for popup in list(page.context.pages):
            if popup is page:
                continue
            try:
                popup.close()
            except Exception:
                pass


def save_pdf(
    data: bytes, uc: str, referencia: str, *, nivel: int = 0, overwrite: bool = True
) -> Path:
    """`nivel` > 0 sufixa " Old" (repetido por nível) — fatura refaturada, mesmo
    esquema de `nomeArquivoFatura` em server.js. `overwrite=False` espelha
    `downloadInvoiceViaBoleta`: recusa e levanta erro em vez de sobrescrever
    (o chamador do lote classifica isso como `isErroArquivoJaExiste`)."""
    DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)
    old_suffix = " Old" * nivel
    name = f"{ref_slug(ref_key(referencia))} - {digits(uc)}{old_suffix}.pdf"
    path = DOWNLOAD_DIR / name
    if path.exists():
        if not overwrite:
            raise RuntimeError(f'"{name}" já existe em disco — não sobrescrevi.')
        path.unlink()
    path.write_bytes(data)
    log(f"✔ PDF salvo: {path} ({len(data)} bytes)")
    return path


def download_months(page, uc: str, refs: list[str]) -> list[Path]:
    """API-first: getHistoricalInvoices + getBoleta (sem clicar Segunda Via)."""
    return download_months_api(page, uc, refs)


def login_site_enel(page, user: str, password: str, empresas: bool, api_key: str) -> None:
    """Login completo: região → aba → reCAPTCHA (1 tentativa; CapSolver se falhar)
    → user/senha → Acessar → área privada. Levanta RuntimeError se não conseguir
    (credenciais inválidas ou reCAPTCHA não resolvido)."""
    emit_live_view(page)
    page.goto(LOGIN_URL, wait_until="domcontentloaded", timeout=60000)
    emit_live_view(page)
    log(f"[1] {page.url}")
    select_region_ceara(page)
    # 1) aba  2) reCAPTCHA (1 tentativa; se falhar, reload)  3) user/senha
    # 4) CapSolver se ainda não passou  5) Acessar
    select_login_tab(page, empresas)
    emit_live_view(page)
    captcha_ok = solve_recaptcha(page, empresas)
    emit_live_view(page)
    fill_login(page, user, password, empresas)
    if not captcha_ok:
        captcha_ok = capsolver_or_manual(page, empresas, api_key)
    if not captcha_ok:
        screenshot(page, "site_enel_camoufox_antes_acessar.jpg")
        raise RuntimeError("reCAPTCHA do Site ENEL não foi resolvido.")
    click_acessar(page, empresas)
    wait_private_area(page)
    emit_live_view(page)


def run_batch(payload: dict[str, Any]) -> int:
    """Chamado pelo server.js (spawnSiteEnelProcess) no lugar do antigo
    runAutomation()/runMultipleAutomations() em Puppeteer. `payload.configs` é
    a mesma lista de configs que ia pro corpo de /api/start."""
    global BATCH_MODE
    BATCH_MODE = True
    configs = list(payload.get("configs") or [])
    if not configs:
        raise SystemExit("Payload sem configs")
    start_stdin_listener()
    headless = (os.environ.get("HEADLESS") or "false").lower() == "true"
    set_progress("start")
    log(f"🌐 Iniciando extração Site ENEL: {len(configs)} conta(s)...")
    exit_code = 0

    for ci, config in enumerate(configs):
        if is_stopped():
            break
        wait_if_paused()
        user = str(config.get("user") or "")
        password = str(config.get("pass") or "")
        empresas = bool(config.get("typeComp", True))
        use_capsolver = config.get("useCapSolver", True)
        api_key = (
            str(config.get("capSolverApiKey") or "").strip()
            or (os.environ.get("CAPSOLVER_API_KEY") or "").strip()
            if use_capsolver
            else ""
        )
        log(f"📋 Conta {ci + 1}/{len(configs)}: {user}")
        try:
            with open_camoufox(headless=headless, extra_prefs=firefox_download_prefs()) as browser:
                page = browser.new_page()
                attach_trawl_init_script(page)
                emit_live_view(page)
                set_progress("page_load")
                try:
                    login_site_enel(page, user, password, empresas, api_key)
                except Exception as e:
                    exit_code = 2
                    msg = str(e)
                    log(f"✘ {msg}", "error")
                    emit({"type": "site_enel_account_result", "user": user, "status": "error", "message": msg})
                    continue
                emit_live_view(page)
                set_progress("contas")
                ucs = [str(u) for u in (config.get("ucs") or [])] or [""]
                uc_failed = False
                for uc in ucs:
                    if is_stopped():
                        break
                    wait_if_paused()
                    set_progress("segunda_via")
                    try:
                        if process_uc_site_enel(page, config, uc) is False:
                            uc_failed = True
                            exit_code = 2
                    except Exception as e:
                        uc_failed = True
                        exit_code = 2
                        log(f"✘ UC {uc}: Erro ao processar faturas ({e}). Pulando para a próxima UC.", "error")
                        emit_uc_result(uc, "error", f"Erro ao processar faturas ({e})")
                    emit_live_view(page)
                set_progress("done")
                if uc_failed:
                    log("⚠ Extração da conta terminou com erro em uma ou mais UCs.", "warn")
                    emit({
                        "type": "site_enel_account_result",
                        "user": user,
                        "status": "error",
                        "message": "falha em uma ou mais UCs",
                    })
                else:
                    log("✅ Automação concluída com sucesso!", "success")
                    emit({"type": "site_enel_account_result", "user": user, "status": "success"})
        except Exception as e:
            exit_code = 2
            msg = str(e)
            log(f"✘ Erro fatal: {msg}", "error")
            emit({"type": "site_enel_account_result", "user": user, "status": "error", "message": msg})
        if ci < len(configs) - 1 and not is_stopped():
            log("⏳ Próxima conta em 2s...")
            time.sleep(2)

    if is_stopped():
        log("🛑 Processamento interrompido.", "warn")
        emit({"type": "stopped", "flow": "enel"})
        return 1
    emit({"type": "done", "flow": "enel"})
    return exit_code


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Site ENEL via Camoufox")
    parser.add_argument("--batch", nargs="?", const="-", help="JSON de lote (arquivo ou stdin) — ver run_batch")
    parser.add_argument("--user", default=os.environ.get("ENEL_USER", os.environ.get("AGENCIA_USER", "")))
    parser.add_argument("--password", default=os.environ.get("ENEL_PASS", os.environ.get("AGENCIA_PASS", "")))
    parser.add_argument("--uc", default=os.environ.get("ENEL_UC", "55642637"))
    parser.add_argument("--ref", nargs="+", default=None)
    parser.add_argument("--empresas", action="store_true", default=True)
    parser.add_argument("--residencial", action="store_true")
    parser.add_argument("--hold", type=float, default=8.0)
    parser.add_argument("--wait-captcha", type=float, default=0)
    parser.add_argument("--headless", action="store_true")
    args = parser.parse_args(argv)

    if args.batch is not None:
        if args.batch in ("", "-"):
            payload = json.loads(sys.stdin.read() or "{}")
        else:
            with open(args.batch, encoding="utf-8") as f:
                payload = json.load(f)
        return run_batch(payload)

    empresas = not args.residencial
    refs = list(args.ref or ["07/2026"])
    if not args.user or not args.password:
        raise SystemExit("Informe --user e --password.")

    api_key = (os.environ.get("CAPSOLVER_API_KEY") or "").strip()
    log("Abrindo Camoufox (pool + geoip + WebRTC off — launcher 2VIA)...")
    with open_camoufox(
        headless=args.headless,
        extra_prefs=firefox_download_prefs(),
    ) as browser:
        fp = _trawl_browser.LAST_FINGERPRINT or {}
        log(
            f"[camoufox] Site ENEL tz={fp.get('timezone')} locale={fp.get('locale')} "
            f"geoip=on webrtc=off humanize=on coop=off"
        )
        page = browser.new_page()
        attach_trawl_init_script(page)
        critical_hits = attach_critical_network_probe(page)
        login_site_enel(page, args.user, args.password, empresas, api_key)
        if critical_hits:
            log(f"[net] {len(critical_hits)} falha(s) em consent/recaptcha (ver logs ✘).")
        else:
            log("[net] sem falhas críticas em consent/recaptcha até agora.")
        paths = download_months(page, args.uc, refs)
        for p in paths:
            log(f"OK {p}")
        if critical_hits:
            log(f"[net] total falhas consent/captcha na sessão: {len(critical_hits)}")
        if args.hold > 0 and not args.headless:
            log(f"Janela aberta {args.hold:.0f}s...")
            page.wait_for_timeout(int(args.hold * 1000))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
