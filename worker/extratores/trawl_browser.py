"""
Launch Camoufox no estilo TRAWL (1920×720).

Mantém geoip, WebRTC block e pool Windows (CE/PA/MA/RJ/SP).
disable_coop=True para clicar o checkbox no iframe do hCaptcha.
"""

from __future__ import annotations

import json
import os
import random
import re
import sys
from typing import Any
from urllib.parse import unquote, urlsplit

from camoufox.sync_api import Camoufox

_EVAL_MISSING = object()

# Janela e fingerprint de tela iguais — senão o clique humanize cai fora.
_SCREEN_BOUNDS = {
    "min_width": 1920,
    "max_width": 1920,
    "min_height": 720,
    "max_height": 720,
}

# Pool só Windows. Cada restart sorteia outro fuso (fingerprint novo).
FINGERPRINT_POOL: tuple[dict[str, str], ...] = (
    {"os": "windows", "locale": "pt-BR", "timezone": "America/Fortaleza"},  # CE, MA
    {"os": "windows", "locale": "pt-BR", "timezone": "America/Belem"},  # PA
    {"os": "windows", "locale": "pt-BR", "timezone": "America/Sao_Paulo"},  # RJ, SP
)


_SESSION_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789"


def segunda_via_proxy() -> dict[str, str] | None:
    """Saída de rede do Camoufox e do Chrome da 2ª via — só desse fluxo.

    SEGUNDA_VIA_PROXY=[http://|socks5://][usuário:senha@]host:porta. O hCaptcha
    e o Imperva da ENEL barram IP de datacenter (VPS); com proxy residencial o
    navegador sai por um IP "de casa".
    """
    raw = os.environ.get("SEGUNDA_VIA_PROXY", "").strip()
    if not raw:
        return None
    if "://" not in raw:
        raw = "http://" + raw
    parts = urlsplit(raw)
    if not parts.hostname or not parts.port:
        raise ValueError(
            "SEGUNDA_VIA_PROXY inválido — use [http://|socks5://][usuário:senha@]host:porta"
        )
    proxy = {"server": f"{parts.scheme}://{parts.hostname}:{parts.port}"}
    if parts.username:
        # Proxy sticky ("...-session-<id>-lifetime-10"): id novo a cada
        # navegador aberto — mesmo IP durante a tentativa, IP novo na próxima.
        proxy["username"] = re.sub(
            r"(-session-)[A-Za-z0-9]+",
            lambda m: m.group(1) + "".join(random.choices(_SESSION_CHARS, k=8)),
            unquote(parts.username),
        )
    if parts.password:
        proxy["password"] = unquote(parts.password)
    return proxy

# TRAWL `firefox_user_prefs` (pool.ts) — telemetria e serviços que um scraper não usa.
TRAWL_FIREFOX_PREFS: dict[str, Any] = {
    "dom.ipc.processCount": 2,
    "dom.ipc.processPrelaunch": False,
    "dom.ipc.contentProcessCount": 2,
    "datareporting.healthreport.uploadEnabled": False,
    "datareporting.policy.dataSubmissionEnabled": False,
    "datareporting.policy.dataSubmissionURL": "",
    "toolkit.telemetry.enabled": False,
    "toolkit.telemetry.unified": False,
    "toolkit.telemetry.archive.enabled": False,
    "toolkit.telemetry.updatePing.enabled": False,
    "breakpad.reportURL": "",
    "browser.safebrowsing.downloads.enabled": False,
    "browser.safebrowsing.malware.enabled": False,
    "extensions.update.enabled": False,
    "browser.fixup.alternate.enabled": False,
    "app.normandy.enabled": False,
    "app.shield.optoutstudies.enabled": False,
    "network.connectivity-service.enabled": False,
    "network.captive-portal-service.enabled": False,
    "network.prefetch-next": False,
    "beacon.enabled": False,
    "security.OCSP.enabled": 0,
    "network.http.tls-handshake-timeout": 30,
    "network.http.connection-timeout": 60,
    "browser.sessionstore.max_tabs_undo": 0,
}

_TRAWL_INIT_SCRIPT = """
(() => {
  window.onerror = () => true;
  window.addEventListener(
    "unhandledrejection",
    (e) => { e.preventDefault(); },
    true,
  );
  const _attachShadow = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function (init) {
    const shadowRoot = _attachShadow.call(this, init);
    Object.defineProperty(this, "shadowRootUnl", {
      configurable: true,
      value: shadowRoot,
    });
    return shadowRoot;
  };
})();
"""


LAST_FINGERPRINT: dict[str, str] | None = None


def pick_fingerprint() -> dict[str, str]:
    tz = os.environ.get("EXTRACTION_TIMEZONE", "").strip()
    chosen = dict(random.choice(FINGERPRINT_POOL))
    chosen["os"] = "windows"
    if tz:
        chosen["timezone"] = tz
    return chosen


def modo_headless(headless: bool) -> bool | str:
    """No Linux (container) o "headless" vira janela numa tela virtual (Xvfb).

    Firefox headless de verdade é fácil de detectar: no Docker o hCaptcha
    abria desafio visual em todo clique. É o mesmo motivo do Chrome da 2VIA
    já rodar com `xvfb=True` (ver chrome_cdp_browser.py). Camoufox aceita
    `headless="virtual"` e sobe o Xvfb sozinho. CAMOUFOX_HEADLESS=true força
    o headless antigo (ex.: imagem sem Xvfb).
    """
    if not headless:
        return False
    forcado = os.environ.get("CAMOUFOX_HEADLESS", "").strip().lower()
    if forcado in ("1", "true", "yes"):
        return True
    return "virtual" if sys.platform.startswith("linux") else True


def _screen_constraint():
    try:
        from browserforge.fingerprints import Screen

        return Screen(**_SCREEN_BOUNDS)
    except Exception:
        return None


def camoufox_launch_kwargs(
    headless: bool,
    extra_prefs: dict[str, Any] | None = None,
    fingerprint: dict[str, str] | None = None,
    proxy: dict[str, str] | None = None,
) -> dict[str, Any]:
    """Camoufox TRAWL: pool Windows + geoip + WebRTC off + 1920×720 + COOP off."""
    fp = fingerprint or pick_fingerprint()
    prefs = dict(TRAWL_FIREFOX_PREFS)
    if extra_prefs:
        prefs.update(extra_prefs)

    kwargs: dict[str, Any] = {
        "headless": modo_headless(headless),
        "os": ["windows"],
        "window": (1920, 720),
        "geoip": True,
        "humanize": True,
        "disable_coop": True,
        "block_webrtc": True,
        "i_know_what_im_doing": True,
        "main_world_eval": True,
        "locale": fp["locale"],
        "config": {
            "forceScopeAccess": True,
            "timezone": fp["timezone"],
        },
        "firefox_user_prefs": prefs,
    }
    screen = _screen_constraint()
    if screen is not None:
        kwargs["screen"] = screen
    if proxy:
        kwargs["proxy"] = proxy
    return kwargs


class _ChromePlaywright:
    """MultiExtractor: Chrome pelo Playwright no lugar do Camoufox (NAVEGADOR=chrome).

    O Camoufox também é Playwright, então o `with ... as browser` devolve o
    mesmo tipo de objeto e o resto do script (page.on, expect_navigation,
    page.request...) não muda. No Linux sem tela, o Chrome abre com janela
    numa tela virtual (Xvfb do SeleniumBase), pelo mesmo motivo do Camoufox
    usar headless="virtual": headless de verdade é fácil de detectar.
    """

    def __init__(self, headless: bool, proxy: dict[str, str] | None = None):
        self.headless = headless
        self.proxy = proxy
        self._pw = None
        self._browser = None
        self._display = None

    def __enter__(self):
        from playwright.sync_api import sync_playwright

        headless = self.headless
        if headless and sys.platform.startswith("linux"):
            try:
                from sbvirtualdisplay import Display

                self._display = Display(visible=0, size=(1920, 1080))
                self._display.start()
                headless = False
            except Exception as exc:
                print(f"[chrome] sem Xvfb ({exc}); usando headless", flush=True)
        kwargs: dict[str, Any] = {
            "channel": os.environ.get("CHROME_CHANNEL", "chrome"),
            "headless": headless,
            "args": ["--lang=pt-BR", "--window-size=1920,1080"],
        }
        if self.proxy:
            kwargs["proxy"] = self.proxy
        print(
            f"[chrome] Playwright channel={kwargs['channel']} headless={headless}"
            + (f" proxy={self.proxy['server']}" if self.proxy else ""),
            flush=True,
        )
        self._pw = sync_playwright().start()
        self._browser = self._pw.chromium.launch(**kwargs)
        return self._browser

    def __exit__(self, *exc_info):
        for fechar in (
            lambda: self._browser and self._browser.close(),
            lambda: self._pw and self._pw.stop(),
            lambda: self._display and self._display.stop(),
        ):
            try:
                fechar()
            except Exception:
                pass
        return False


def open_camoufox(
    headless: bool,
    extra_prefs: dict[str, Any] | None = None,
    proxy: dict[str, str] | None = None,
) -> Camoufox:
    """Abre o Camoufox com geoip, WebRTC bloqueado e pool Windows. COOP off."""
    if os.environ.get("NAVEGADOR", "").strip().lower() == "chrome":
        return _ChromePlaywright(headless, proxy=proxy)
    global LAST_FINGERPRINT
    fp = pick_fingerprint()
    LAST_FINGERPRINT = fp
    kwargs = camoufox_launch_kwargs(
        headless, extra_prefs=extra_prefs, fingerprint=fp, proxy=proxy
    )
    print(
        f"[camoufox] fingerprint os=windows locale={fp['locale']} "
        f"tz={fp['timezone']} 1920x720 geoip=on webrtc=off humanize=on coop=off "
        f"headless={kwargs['headless']}"
        + (f" proxy={kwargs['proxy']['server']}" if kwargs.get("proxy") else ""),
        flush=True,
    )
    try:
        return Camoufox(**kwargs)
    except TypeError as exc:
        dropped = _drop_unknown_kwargs(kwargs, exc)
        print(f"[camoufox] relançando sem kwargs incompatíveis: {exc}", flush=True)
        return Camoufox(**dropped)
    except Exception as exc:
        msg = str(exc).lower()
        if kwargs.get("geoip") and any(
            token in msg for token in ("geoip", "maxmind", "geolocation", "mmdb")
        ):
            kwargs = dict(kwargs)
            kwargs["geoip"] = False
            print(f"[camoufox] geoip indisponível ({exc}); relançando sem geoip", flush=True)
            return Camoufox(**kwargs)
        raise


def _drop_unknown_kwargs(kwargs: dict[str, Any], err: TypeError) -> dict[str, Any]:
    text = str(err)
    cleaned = dict(kwargs)
    for key in list(cleaned):
        if key in text:
            cleaned.pop(key, None)
    return cleaned


def safe_evaluate(page, expression: str, arg: Any = _EVAL_MISSING) -> Any:
    """page.evaluate que só devolve JSON (string) para o Python.

    O Firefox/Camoufox estoura:
      Page.evaluate: Accessing TypedArray data over Xrays is slow, and forbidden
    quando o resultado (ou um Uint8Array intermediário) cruza a fronteira
    chrome/content. JSON.stringify roda no mesmo compartimento da página;
    só um string volta.
    """
    wrapper = """async ({ expression, arg, hasArg }) => {
      const fn = eval('(' + expression + ')');
      const value = hasArg ? await Promise.resolve(fn(arg)) : await Promise.resolve(fn());
      if (value === undefined) return null;
      return JSON.stringify(value);
    }"""
    has_arg = arg is not _EVAL_MISSING
    raw = page.evaluate(
        wrapper,
        {"expression": expression, "arg": None if not has_arg else arg, "hasArg": has_arg},
    )
    if raw is None:
        return None
    if isinstance(raw, (dict, list, int, float, bool)):
        return raw
    return json.loads(raw)


def main_evaluate(page, expression: str, arg: Any = _EVAL_MISSING) -> Any:
    """Camoufox: `page.evaluate` roda num sandbox e NÃO vê globais da página
    (`window.switchAccount` etc.). Com `main_world_eval=True`, o prefixo `mw:`
    executa no mundo real. Tem que ser síncrono — async no mw: não é awaited.
    """
    wrapper = """({ expression, arg, hasArg }) => {
      try {
        const fn = eval('(' + expression + ')');
        const value = hasArg ? fn(arg) : fn();
        if (value === undefined) return null;
        return JSON.stringify(value);
      } catch (e) {
        return JSON.stringify({
          __error: (e && e.message) ? e.message : String(e),
        });
      }
    }"""
    has_arg = arg is not _EVAL_MISSING
    payload = {
        "expression": expression,
        "arg": None if not has_arg else arg,
        "hasArg": has_arg,
    }
    raw = None
    try:
        raw = page.evaluate("mw:" + wrapper, payload)
    except Exception:
        raw = None
    if raw is None:
        try:
            raw = page.evaluate(wrapper, payload)
        except Exception:
            return None
    if raw is None:
        return None
    if isinstance(raw, (dict, list, int, float, bool)):
        parsed = raw
    else:
        try:
            parsed = json.loads(raw)
        except Exception:
            return raw
    if isinstance(parsed, dict) and parsed.get("__error"):
        raise RuntimeError(str(parsed["__error"]))
    return parsed


def request_fetch(
    page,
    url: str,
    *,
    method: str = "GET",
    data: str | None = None,
    headers: dict[str, str] | None = None,
    timeout_ms: int = 60_000,
) -> dict[str, Any]:
    """HTTP com o cookie jar do browser, sem page.evaluate (sem TypedArray/Xrays)."""
    kwargs: dict[str, Any] = {
        "method": method,
        "headers": headers or {},
        "timeout": timeout_ms,
        "fail_on_status_code": False,
        "max_redirects": 10,
    }
    if data:
        kwargs["data"] = data
    response = page.request.fetch(url, **kwargs)
    raw = response.body()
    ct = response.headers.get("content-type") or ""
    is_pdf = raw.startswith(b"%PDF") or "application/pdf" in ct.lower()
    return {
        "status": response.status,
        "url": response.url,
        "ct": ct,
        "bytes": list(raw) if is_pdf else [],
        "raw": raw,
        "text": "" if is_pdf else raw.decode("utf-8", errors="replace"),
        "location": response.headers.get("location") or "",
    }


def attach_trawl_init_script(page) -> None:
    """Espelha o `context.addInitScript` do TRAWL (erros JS + shadowRootUnl)."""
    try:
        page.context.add_init_script(_TRAWL_INIT_SCRIPT)
    except Exception:
        pass
