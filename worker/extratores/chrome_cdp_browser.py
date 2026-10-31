"""
Chrome "stealth" para o fallback da 2VIA ENEL — só SeleniumBase (CDP Mode).

Nada de Playwright aqui: com o Playwright (ou o Patchright) conectado ao
Chrome, o hCaptcha abre desafio visual e o Imperva responde 403 nos postbacks
da ENEL. `SbPage` expõe o pedaço da API de página do Playwright que o fluxo da
2ª via usa (evaluate, click, type, wait_for_selector, request.fetch...) em
cima do SeleniumBase, para o `run_single` rodar igual ao do Camoufox.
"""

from __future__ import annotations

import asyncio
import base64
import json
import os
import random
import re
import shutil
import sys
import tempfile
import time
import urllib.request
from datetime import date, datetime
from pathlib import Path
from typing import Any
from urllib.parse import quote

import mycdp

CHROME_BINARY = os.environ.get("CHROME_BINARY", "").strip()
CDP_TIMEOUT_S = 45.0
PAGE_LOAD_TIMEOUT_S = 40.0

# Mesmo espírito do Camoufox TRAWL (trawl_browser.py): fuso sorteado do pool,
# WebRTC sem vazar IP local e tela 1920 de largura. Só o que dá para aplicar
# no PROCESSO do Chrome (flags/variáveis) — vale igual para a página e para o
# iframe do hCaptcha (outro domínio, outro processo). Override por CDP
# (Emulation.*) só pega a aba principal e o iframe mostraria o valor real; essa
# contradição é justamente o que o hCaptcha procura. CHROME_FINGERPRINT=false
# volta ao Chrome sem nada disso.
_WINDOW = (1920, 1080)
_WEBRTC_OFF = [
    "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
    "--webrtc-ip-handling-policy=disable_non_proxied_udp",
]

# Janela invisível: fora da área da tela. O SeleniumBase já impede o Chrome de
# pausar janela encoberta (--disable-backgrounding-occluded-windows etc.). Não
# passar --disable-features aqui: o Chrome só usa o último e ele substituiria
# a lista do SeleniumBase.
_OFFSCREEN_ARGS = ["--window-position=-32000,-32000"]

# Serviços de fundo do próprio Chrome (relógio, contas, GCM, atualizador,
# optimization guide): ~90 KB por abertura que o proxy residencial cobraria.
# Ficam fora do proxy (bypass) e sem DNS (~NOTFOUND), então nem saem da
# máquina. O bypass vai na flag e na extensão de proxy do SeleniumBase: a
# extensão só assume depois da partida e o GCM/contas conectam antes dela.
_HOSTS_FUNDO_CHROME = (
    "clients2.google.com",
    "accounts.google.com",
    "android.clients.google.com",
    "mtalk.google.com",
    "update.googleapis.com",
    "optimizationguide-pa.googleapis.com",
    "*.gvt1.com",
)
_CACHE_MAX_BYTES = 300 * 1024 * 1024

# Flags que o CDP Mode do SeleniumBase põe por padrão e o hCaptcha detecta.
# Com --test-type (desde o Chrome 156) o checkbox sempre abre desafio visual,
# até com clique de mouse real; sem ela o mesmo clique passa direto.
_FLAGS_REMOVIDAS = frozenset({"--test-type"})


def _remover_flags_do_seleniumbase() -> None:
    try:
        from seleniumbase.undetected.cdp_driver import config as cdp_config
    except ImportError as e:
        print(f"[chrome] não deu para tirar {sorted(_FLAGS_REMOVIDAS)} do SeleniumBase: {e}", flush=True)
        return
    if getattr(cdp_config.Config.__call__, "_sem_flags_2via", False):
        return
    original = cdp_config.Config.__call__

    def montar_args(self):
        return [a for a in original(self) if a not in _FLAGS_REMOVIDAS]

    montar_args._sem_flags_2via = True
    cdp_config.Config.__call__ = montar_args


def _hoje() -> str:
    try:
        from zoneinfo import ZoneInfo

        fuso = ZoneInfo(os.environ.get("EXTRACTION_TIMEZONE") or "America/Fortaleza")
        return datetime.now(fuso).date().isoformat()
    except Exception:
        return date.today().isoformat()


def _pasta_cache_do_dia() -> Path | None:
    """Cache HTTP em disco compartilhado pelos Chromes (perfil novo a cada UC):
    os estáticos da ENEL e do hCaptcha (~1,5 MB) só passam pelo proxy na 1ª
    abertura do dia. Uma pasta por dia no fuso da extração; as de outros dias
    são apagadas, então o cache zera às 0h e a 1ª UC do dia o recarrega.
    Só um Chrome por vez pode usar a pasta (um por container no VPS).
    CHROME_CACHE_DIR=off desliga."""
    base = os.environ.get("CHROME_CACHE_DIR", "").strip()
    if base.lower() in ("0", "off", "false", "no"):
        return None
    raiz = Path(base) if base else Path(tempfile.gettempdir()) / "chrome-cache-2via"
    hoje = _hoje()
    try:
        raiz.mkdir(parents=True, exist_ok=True)
        for antiga in raiz.iterdir():
            if antiga.name != hoje:
                shutil.rmtree(antiga, ignore_errors=True)
        pasta = raiz / hoje
        pasta.mkdir(exist_ok=True)
        return pasta
    except OSError as e:
        print(f"[chrome] cache em disco indisponível ({e}); seguindo sem", flush=True)
        return None


def _args_economia_proxy() -> list[str]:
    args = [
        # 1ª aba direto em branco: a Nova Guia busca ~50 KB no Google.
        "about:blank",
        "--proxy-bypass-list=" + ";".join(_HOSTS_FUNDO_CHROME),
        "--host-resolver-rules=" + ",".join(f"MAP {h} ~NOTFOUND" for h in _HOSTS_FUNDO_CHROME),
    ]
    pasta = _pasta_cache_do_dia()
    if pasta is not None:
        args += [f"--disk-cache-dir={pasta}", f"--disk-cache-size={_CACHE_MAX_BYTES}"]
    return args


class _TrafegoNetLog:
    """Bytes que o Chrome trocou com o proxy, lidos do NetLog (--log-net-log):
    soma de SOCKET_BYTES_SENT/RECEIVED — com proxy, todo socket é com ele, e a
    soma bate com o que o proxy conta. O NetLog grava um evento por linha, então
    dá para ler aos poucos com o Chrome aberto."""

    def __init__(self) -> None:
        fd, nome = tempfile.mkstemp(prefix="netlog-2via-", suffix=".json")
        os.close(fd)
        self.caminho = Path(nome)
        self.bytes = 0
        self._pos = 0
        self._resto = b""
        self._tipos: set[int] | None = None

    def atualizar(self) -> int:
        try:
            with open(self.caminho, "rb") as f:
                f.seek(self._pos)
                novo = f.read()
        except OSError:
            return self.bytes
        self._pos += len(novo)
        linhas = (self._resto + novo).split(b"\n")
        self._resto = linhas.pop()
        for linha in linhas:
            linha = linha.strip().rstrip(b",")
            if self._tipos is None:
                if linha.startswith(b'{"constants"'):
                    try:
                        tipos = json.loads(linha + b"}")["constants"]["logEventTypes"]
                    except (ValueError, KeyError):
                        tipos = {}
                    self._tipos = {
                        tipos[k] for k in ("SOCKET_BYTES_SENT", "SOCKET_BYTES_RECEIVED") if k in tipos
                    }
                continue
            if b'"byte_count"' not in linha:
                continue
            try:
                ev = json.loads(linha)
            except ValueError:
                continue
            if ev.get("type") in self._tipos:
                self.bytes += int((ev.get("params") or {}).get("byte_count") or 0)
        return self.bytes

    def fechar(self) -> None:
        self.atualizar()
        try:
            self.caminho.unlink()
        except OSError:
            pass


_NETLOGS: list[_TrafegoNetLog] = []


def trafego_proxy() -> int | None:
    """Bytes que os Chromes deste processo já trocaram com o proxy (None se
    nenhum usou proxy)."""
    if not _NETLOGS:
        return None
    return sum(n.atualizar() for n in _NETLOGS)


def _proxy_seleniumbase(proxy: dict[str, str] | None) -> str | None:
    """SEGUNDA_VIA_PROXY no formato do SeleniumBase ("usuário:senha@host:porta")."""
    if not proxy:
        return None
    scheme, endereco = proxy["server"].split("://", 1)
    usuario, senha = proxy.get("username"), proxy.get("password")
    if not usuario:
        return proxy["server"] if scheme != "http" else endereco
    if scheme != "http":
        raise ValueError("Chrome não aceita proxy SOCKS com usuário/senha — use http://")
    if any(c in f"{usuario}{senha or ''}" for c in ":@"):
        raise ValueError("SEGUNDA_VIA_PROXY: usuário/senha com ':' ou '@' quebram o SeleniumBase")
    return f"{usuario}:{senha or ''}@{endereco}"


def _fuso_do_ip_de_saida(proxy: dict[str, str]) -> str | None:
    """Fuso (IANA) do IP que o proxy entrega nesta sessão, via ip-api.com."""
    scheme, endereco = proxy["server"].split("://", 1)
    if scheme != "http":
        return None
    usuario = quote(proxy.get("username", ""), safe="")
    senha = quote(proxy.get("password", ""), safe="")
    url = f"http://{usuario}:{senha}@{endereco}" if usuario else proxy["server"]
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({"http": url}))
    try:
        with opener.open(
            "http://ip-api.com/json/?fields=status,query,city,regionName,timezone",
            timeout=15,
        ) as resp:
            dados = json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        print(f"[chrome] geolocalização do IP do proxy falhou: {e}", flush=True)
        return None
    if dados.get("status") != "success" or not dados.get("timezone"):
        return None
    print(
        f"[chrome] IP do proxy {dados.get('query')} — {dados.get('city')}/"
        f"{dados.get('regionName')} ({dados['timezone']})",
        flush=True,
    )
    return str(dados["timezone"])


def _fingerprint_ligado() -> bool:
    return os.environ.get("CHROME_FINGERPRINT", "true").strip().lower() not in ("0", "false", "no")

_FUNCTION_RE = re.compile(r"^\s*(async\s+)?(\(|function\b|[A-Za-z_$][\w$]*\s*=>)")

_FETCH_JS = """async (req) => {
  const init = {
    method: req.method,
    headers: req.headers,
    credentials: "include",
    redirect: "follow",
  };
  if (req.referrer) init.referrer = req.referrer;
  if (req.data != null) init.body = req.data;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), req.timeout);
  init.signal = ctrl.signal;
  try {
    const r = await fetch(req.url, init);
    const buf = new Uint8Array(await r.arrayBuffer());
    let bin = "";
    for (let i = 0; i < buf.length; i += 0x8000) {
      bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    }
    return JSON.stringify({
      status: r.status,
      url: r.url,
      headers: Object.fromEntries(r.headers.entries()),
      b64: btoa(bin),
    });
  } finally {
    clearTimeout(timer);
  }
}"""

# Headers que o fetch() do navegador não deixa definir (ele mesmo põe).
_FORBIDDEN_HEADERS = {"referer", "origin", "cookie", "host", "content-length", "user-agent"}

_PUNCT_KEYS = {
    ".": ("Period", 190),
    "/": ("Slash", 191),
    "-": ("Minus", 189),
    " ": ("Space", 32),
    "@": ("Digit2", 50),
    "_": ("Minus", 189),
}


def _key_info(char: str) -> dict[str, Any]:
    if char.isdigit():
        code, vk = f"Digit{char}", ord(char)
    elif char.isascii() and char.isalpha():
        code, vk = f"Key{char.upper()}", ord(char.upper())
    else:
        code, vk = _PUNCT_KEYS.get(char, ("", 0))
    return {
        "key": char,
        "code": code,
        "windows_virtual_key_code": vk,
        "native_virtual_key_code": vk,
    }


class ChromeCdp:
    def __init__(self, headless: bool):
        self.headless = headless
        self.sb = None
        # Proxy (com a sessão sticky) com que o Chrome subiu — o NoneCap
        # resolve o hCaptcha pela mesma saída.
        self.proxy: dict[str, str] | None = None
        self._netlog: _TrafegoNetLog | None = None

    def _launch_kwargs(self, proxy: dict[str, str] | None) -> dict[str, Any]:
        # Idioma pela flag do Chrome, nunca `locale=`: o SeleniumBase aplica o
        # locale com Network.setUserAgentOverride, que põe o Accept-Language
        # fora da ordem natural dos headers e o Imperva bloqueia (403) os POSTs.
        kwargs: dict[str, Any] = {"browser_args": ["--lang=pt-BR"]}
        if _fingerprint_ligado():
            kwargs["browser_args"] += [
                *_WEBRTC_OFF,
                f"--window-size={_WINDOW[0]},{_WINDOW[1]}",
            ]
        if CHROME_BINARY:
            kwargs["browser_executable_path"] = CHROME_BINARY
        if self.headless:
            if sys.platform.startswith("linux"):
                # Chrome headless é fácil de detectar pelo hCaptcha; no
                # container ele roda com janela numa tela virtual (Xvfb).
                kwargs["headless"] = False
                kwargs["xvfb"] = True
                if _fingerprint_ligado():
                    kwargs["xvfb_metrics"] = f"{_WINDOW[0]},{_WINDOW[1]}"
            else:
                # Sem Xvfb no Windows/macOS: janela de verdade, fora da tela.
                # Headless real é detectado pelo hCaptcha e faz o SeleniumBase
                # aplicar Network.setUserAgentOverride (403 do Imperva).
                kwargs["headless"] = False
                kwargs["browser_args"] += _OFFSCREEN_ARGS
        proxy_sb = _proxy_seleniumbase(proxy)
        if proxy_sb:
            kwargs["proxy"] = proxy_sb
            kwargs["proxy_bypass_list"] = ",".join(_HOSTS_FUNDO_CHROME)
            kwargs["browser_args"] += _args_economia_proxy()
        return kwargs

    @staticmethod
    def _fuso(proxy: dict[str, str] | None) -> str | None:
        """Fuso do Chrome. Só no Linux: lá o Chrome lê a variável TZ (todos os
        processos, inclusive o do iframe). No Windows o Chrome ignora TZ e já
        usa o fuso real da máquina. Com proxy, o do IP de saída — o proxy
        residencial sai de qualquer cidade e o hCaptcha compara o fuso com a
        geolocalização do IP; sem proxy (ou se a consulta falhar), sorteado do
        pool do Camoufox."""
        if not (_fingerprint_ligado() and sys.platform.startswith("linux")):
            return None
        if proxy:
            fuso = _fuso_do_ip_de_saida(proxy)
            if fuso:
                return fuso
        try:
            from trawl_browser import pick_fingerprint

            return pick_fingerprint().get("timezone")
        except Exception:
            return None

    def start(self, download_dir: Path | None = None, usar_proxy: bool = True) -> None:
        from trawl_browser import segunda_via_proxy

        self.stop()
        # Uma sessão só (mesmo -session-<id>) para a consulta do fuso e o
        # Chrome: o proxy sticky mantém o mesmo IP para as duas.
        proxy = segunda_via_proxy() if usar_proxy else None
        self.proxy = proxy
        kwargs = self._launch_kwargs(proxy)
        fuso = self._fuso(proxy)
        print(
            "[chrome] SeleniumBase CDP Mode "
            + " ".join(
                f"{k}={str(v).rsplit('@', 1)[-1] if k == 'proxy' else v}"
                for k, v in kwargs.items()
            )
            + (f" tz={fuso}" if fuso else ""),
            flush=True,
        )
        if proxy:
            self._netlog = _TrafegoNetLog()
            _NETLOGS.append(self._netlog)
            kwargs["browser_args"] = [*kwargs["browser_args"], f"--log-net-log={self._netlog.caminho}"]
        # O SeleniumBase embrulha stdout/stderr com o colorama (cp1252 no
        # Windows), o que quebra as linhas JSON lidas pelo Extractor-JS.
        stdout, stderr = sys.stdout, sys.stderr
        # Variáveis herdadas pelo processo do Chrome. No Linux o `--lang` é
        # ignorado: o idioma (navigator.languages / Accept-Language) sai de
        # LANGUAGE — sem isso o container ia como en-US com IP brasileiro.
        env_chrome: dict[str, str] = {}
        if fuso:
            env_chrome["TZ"] = fuso
        if _fingerprint_ligado() and sys.platform.startswith("linux"):
            env_chrome["LANGUAGE"] = "pt_BR:pt"
        antigos = {k: os.environ.get(k) for k in env_chrome}
        try:
            from seleniumbase import sb_cdp

            _remover_flags_do_seleniumbase()
            os.environ.update(env_chrome)
            self.sb = sb_cdp.Chrome(**kwargs)
        finally:
            sys.stdout, sys.stderr = stdout, stderr
            for k, v in antigos.items():
                if v is None:
                    os.environ.pop(k, None)
                else:
                    os.environ[k] = v
        if download_dir is not None:
            try:
                self.send(
                    mycdp.browser.set_download_behavior(
                        behavior="allow",
                        download_path=str(download_dir),
                        events_enabled=True,
                    )
                )
            except Exception:
                pass

    def send(self, command, timeout_s: float = CDP_TIMEOUT_S):
        return self.run(self.sb.page.send(command), timeout_s)

    def run(self, coro, timeout_s: float = CDP_TIMEOUT_S):
        # Sem limite, um IP lento do proxy (página que nunca termina de
        # renderizar) deixava o CDP esperando para sempre.
        return self.sb.loop.run_until_complete(asyncio.wait_for(coro, timeout_s))

    def goto(self, url: str) -> None:
        self.sb.goto(url)

    def wait_loaded(self, timeout_s: float = PAGE_LOAD_TIMEOUT_S) -> bool:
        """Se o DOM da página (com formulário) ficou pronto a tempo."""
        expression = "document.readyState !== 'loading' && document.forms.length > 0"
        deadline = time.time() + timeout_s
        while time.time() < deadline:
            try:
                if self.run(self.sb.page.evaluate(expression, return_by_value=True), 5):
                    return True
            except Exception:
                pass
            time.sleep(0.5)
        return False

    def motivo_falha_carregamento(self, url: str) -> str:
        """Erro de rede do Chrome ao abrir `url` (net::ERR_PROXY_..., ...)."""
        try:
            _frame, _loader, erro = self.send(mycdp.page.navigate(url), 30)[:3]
        except asyncio.TimeoutError:
            return "sem resposta em 30s"
        except Exception as e:
            return f"navegador sem resposta: {type(e).__name__}"
        return erro or "página abriu, mas sem o formulário"

    def current_url(self) -> str:
        try:
            return self.sb.get_current_url()
        except Exception:
            return ""

    def screenshot_bytes(self) -> bytes | None:
        try:
            data = self.send(mycdp.page.capture_screenshot(format_="jpeg", quality=40), 10)
        except Exception:
            return None
        if isinstance(data, (bytes, bytearray)):
            return bytes(data)
        return base64.b64decode(data) if data else None

    def is_alive(self) -> bool:
        if self.sb is None:
            return False
        try:
            self.run(self.sb.page.evaluate("1"), 10)
            return True
        except Exception:
            return False

    def stop(self) -> None:
        sb = self.sb
        self.sb = None
        if sb is not None:
            try:
                sb.quit()
            except Exception:
                pass
        if self._netlog is not None:
            self._netlog.fechar()
            self._netlog = None


class _Response:
    def __init__(self, payload: dict[str, Any]):
        self.status = int(payload.get("status") or 0)
        self.url = str(payload.get("url") or "")
        self.headers = dict(payload.get("headers") or {})
        self._body = base64.b64decode(payload.get("b64") or "")

    def body(self) -> bytes:
        return self._body


class _Request:
    def __init__(self, page: "SbPage"):
        self._page = page

    def fetch(
        self,
        url: str,
        *,
        method: str = "GET",
        headers: dict[str, str] | None = None,
        data: str | None = None,
        timeout: float = 60_000,
        **_: Any,
    ) -> _Response:
        """fetch() de dentro da página: mesmos cookies e TLS do Chrome."""
        headers = dict(headers or {})
        referrer = headers.get("Referer") or headers.get("referer")
        safe = {k: v for k, v in headers.items() if k.lower() not in _FORBIDDEN_HEADERS}
        raw = self._page.evaluate(
            _FETCH_JS,
            {
                "url": url,
                "method": method,
                "headers": safe,
                "data": data,
                "referrer": referrer,
                "timeout": timeout,
            },
            timeout_s=timeout / 1000 + 15,
        )
        return _Response(json.loads(raw))


class _Locator:
    def __init__(self, page: "SbPage", selector: str):
        self._page = page
        self._selector = selector

    @property
    def first(self) -> "_Locator":
        return self

    def count(self) -> int:
        return int(
            self._page.evaluate(
                "(s) => document.querySelectorAll(s).length", self._selector
            )
            or 0
        )

    def click(self, timeout: float | None = None, **_: Any) -> None:
        self._page.click(self._selector, timeout=timeout)

    def scroll_into_view_if_needed(self, **_: Any) -> None:
        self._page.evaluate(
            "(s) => { const el = document.querySelector(s); "
            "if (el) el.scrollIntoView({block: 'center'}); }",
            self._selector,
        )


class _IframeFrame:
    """iframe same-origin, avaliado pelo documento principal."""

    def __init__(self, page: "SbPage", index: int):
        self._page = page
        self._index = index

    def evaluate(self, expression: str, arg: Any = None) -> Any:
        return self._page.evaluate(
            """([i, src, arg]) => {
              const f = document.querySelectorAll("iframe")[i];
              const w = f && f.contentWindow;
              if (!w) return null;
              return w.eval("(" + src + ")")(arg);
            }""",
            [self._index, expression, arg],
        )


class _Context:
    def __init__(self, page: "SbPage"):
        self.pages = [page]

    def on(self, *_: Any) -> None:
        pass

    def remove_listener(self, *_: Any) -> None:
        pass

    def set_default_timeout(self, *_: Any) -> None:
        pass

    def new_cdp_session(self, *_: Any):
        raise RuntimeError("CDP session do Playwright indisponível no SbPage")


class SbPage:
    """Subconjunto da API `playwright.sync_api.Page` usado na 2ª via."""

    def __init__(self, chrome: ChromeCdp):
        self._chrome = chrome
        self.context = _Context(self)
        self.request = _Request(self)
        self.main_frame = self

    @property
    def sb(self):
        return self._chrome.sb

    @property
    def url(self) -> str:
        return self._chrome.current_url()

    @property
    def frames(self) -> list[Any]:
        try:
            n = int(self.evaluate("() => document.querySelectorAll('iframe').length") or 0)
        except Exception:
            n = 0
        return [self] + [_IframeFrame(self, i) for i in range(n)]

    def title(self) -> str:
        return self.sb.get_title()

    def is_closed(self) -> bool:
        return not self._chrome.is_alive()

    def evaluate(
        self, expression: str, arg: Any = None, timeout_s: float = CDP_TIMEOUT_S
    ) -> Any:
        if expression.startswith("mw:"):
            raise RuntimeError("mw: só existe no Camoufox")
        if _FUNCTION_RE.match(expression):
            source = f"({expression})({json.dumps(arg)})"
        else:
            source = expression
        return self._chrome.run(
            self.sb.page.evaluate(source, await_promise=True, return_by_value=True),
            timeout_s,
        )

    def wait_for_selector(
        self, selector: str, state: str = "visible", timeout: float = 30_000
    ) -> None:
        check = (
            "(s) => !!document.querySelector(s)"
            if state == "attached"
            else """(s) => {
              const el = document.querySelector(s);
              if (!el) return false;
              const st = getComputedStyle(el);
              const r = el.getBoundingClientRect();
              return st.display !== "none" && st.visibility !== "hidden" &&
                r.width > 0 && r.height > 0;
            }"""
        )
        deadline = time.time() + timeout / 1000
        while True:
            try:
                if self.evaluate(check, selector):
                    return
            except Exception:
                pass
            if time.time() >= deadline:
                raise TimeoutError(
                    f"wait_for_selector: {selector} ({state}) não apareceu em {timeout:.0f}ms"
                )
            time.sleep(0.25)

    def wait_for_load_state(self, state: str = "load", timeout: float = 30_000) -> None:
        deadline = time.time() + timeout / 1000
        while time.time() < deadline:
            try:
                if self.evaluate("document.readyState") == "complete":
                    break
            except Exception:
                pass
            time.sleep(0.25)
        if state == "networkidle":
            time.sleep(0.5)

    def locator(self, selector: str) -> _Locator:
        return _Locator(self, selector)

    def click(self, selector: str, timeout: float | None = None, **_: Any) -> None:
        self.wait_for_selector(selector, timeout=timeout or 30_000)
        self.sb.click(selector)

    def fill(self, selector: str, value: str, **_: Any) -> None:
        self.evaluate(
            """([s, v]) => {
              const el = document.querySelector(s);
              if (!el) throw new Error("fill: " + s + " não encontrado");
              el.focus();
              el.value = v;
              el.dispatchEvent(new Event("input", { bubbles: true }));
              el.dispatchEvent(new Event("change", { bubbles: true }));
            }""",
            [selector, value],
        )

    def type(self, selector: str, text: str, delay: float | None = None, **_: Any) -> None:
        """keyDown/keyUp por caractere, como o Playwright: o press_keys do
        SeleniumBase embaralha campos com máscara (ex.: CPF/CNPJ da ENEL)."""
        self.evaluate("(s) => document.querySelector(s).focus()", selector)
        pause = (delay if delay is not None else 40) / 1000
        for char in text:
            key_info = _key_info(char)
            self._chrome.send(
                mycdp.input_.dispatch_key_event(type_="keyDown", text=char, **key_info)
            )
            self._chrome.send(mycdp.input_.dispatch_key_event(type_="keyUp", **key_info))
            time.sleep(pause + random.uniform(0, 0.02))

    def input_value(self, selector: str) -> str:
        return str(
            self.evaluate(
                "(s) => { const el = document.querySelector(s); return el ? el.value : ''; }",
                selector,
            )
            or ""
        )

    def screenshot(self, **_: Any) -> bytes:
        data = self._chrome.screenshot_bytes()
        if not data:
            raise RuntimeError("screenshot indisponível")
        return data

    def goto(self, url: str, **_: Any) -> None:
        self._chrome.goto(url)

    def reload(self, **_: Any) -> None:
        self.sb.reload(ignore_cache=False)

    def on(self, *_: Any) -> None:
        pass

    def remove_listener(self, *_: Any) -> None:
        pass

    def close(self) -> None:
        pass
