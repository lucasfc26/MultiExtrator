"""
hCaptcha solver — port do fluxo do TRAWL (germondai/trawl).

Fluxo:
  1. Rola 600–700px, move o mouse (humanize) até o checkbox e clica.
  2. Se auto-passar, o extrator preenche UC/CPF e dá Solicitar.
  3. Se não checar ou o clique travar: Ctrl+R (mantém a posição) e clica de novo. Até 2 reloads.
  4. Se ainda falhar, o extrator fecha o Camoufox e recomeça.

Sitekeys podem desabilitar áudio — nesse caso retorna False limpo.
"""

from __future__ import annotations

import os
import random
import re
import signal
import subprocess
import tempfile
import time
import uuid
from pathlib import Path
from collections.abc import Callable
from typing import TYPE_CHECKING
from urllib.request import Request, urlopen

if TYPE_CHECKING:
    from playwright.sync_api import FrameLocator, Page

WIDGET_FRAME = 'iframe[src*="hcaptcha.com"]'
AUDIO_BUTTON = "#audio-button"
AUDIO_RESPONSE = "textarea#audio-response"
AUDIO_SUBMIT = "#audio-submit"
RELOAD_BUTTON = 'button[aria-label="Get a new challenge"]'
MAX_AUDIO_ATTEMPTS = 3

# Mesma chave pública usada pelo Buster / TRAWL (demos de acessibilidade do Google).
GOOGLE_STT = (
    "https://www.google.com/speech-api/v2/recognize"
    "?output=json&lang=en-US"
    "&key=AIzaSyBOti4mM-6x9WDnZIjIeyEU21OpBXqWBgw"
)
FFMPEG = os.environ.get("FFMPEG_PATH", "ffmpeg")
STT_URL = os.environ.get("STT_URL", "")
STT_KEY = os.environ.get("STT_API_KEY", "")

# Esperar o checkbox pintar depois do scroll, antes do mouse.
CHECKBOX_SETTLE_S = 1.5
SCROLL_NUDGE_MIN = 600
SCROLL_NUDGE_MAX = 700
CTRL_R_RETRIES = 1
# page.mouse + humanize pode travar; corta o clique e segue para Ctrl+R.
CLICK_TIMEOUT_MS = 10_000
CTRL_R_TIMEOUT_MS = 20_000
# Tempo entre mousedown e mouseup no checkbox (press/release humano).
PRESS_HOLD_MIN_S = 0.05
PRESS_HOLD_MAX_S = 0.12


def _clean_transcript(text: str) -> str:
    text = text.lower().strip()
    text = re.sub(r"\s+", " ", text)
    # hCaptcha áudio costuma pedir dígitos; se houver números, preferir só eles.
    digits = re.sub(r"\D", "", text)
    if len(digits) >= 3:
        return digits
    return text


def _transcribe_whisper(audio_url: str, timeout: float = 30) -> str | None:
    try:
        req = Request(
            audio_url,
            headers={
                "User-Agent": (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/149"
                )
            },
        )
        with urlopen(req, timeout=timeout) as resp:
            audio_bytes = resp.read()

        import json
        from urllib.request import Request as PostRequest

        boundary = f"----trawl{uuid.uuid4().hex}"
        body = (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="file"; '
            f'filename="audio.mp3"\r\n'
            f"Content-Type: audio/mpeg\r\n\r\n"
        ).encode() + audio_bytes + (
            f"\r\n--{boundary}\r\n"
            f'Content-Disposition: form-data; name="model"\r\n\r\n'
            f"whisper-1\r\n"
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="language"\r\n\r\n'
            f"en\r\n"
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="response_format"\r\n\r\n'
            f"text\r\n"
            f"--{boundary}--\r\n"
        ).encode()

        headers = {
            "Content-Type": f"multipart/form-data; boundary={boundary}",
        }
        if STT_KEY:
            headers["Authorization"] = f"Bearer {STT_KEY}"

        post = PostRequest(STT_URL, data=body, headers=headers, method="POST")
        with urlopen(post, timeout=timeout) as stt_resp:
            return _clean_transcript(stt_resp.read().decode("utf-8", "ignore"))
    except Exception as exc:
        print(f"[stt] whisper error: {exc}")
        return None


def _transcribe_google(audio_url: str, timeout: float = 30) -> str | None:
    tmp = Path(tempfile.gettempdir())
    uid = uuid.uuid4().hex[:8]
    mp3 = tmp / f"trawl-{uid}.mp3"
    try:
        req = Request(
            audio_url,
            headers={
                "User-Agent": (
                    "Mozilla/5.0 (X11; Linux x86_64; rv:135.0) "
                    "Gecko/20100101 Firefox/135.0"
                ),
                "Referer": "https://newassets.hcaptcha.com/",
                "Accept": "audio/webm,audio/ogg,audio/wav,audio/*;q=0.9,*/*;q=0.5",
                "Accept-Language": "en-US,en;q=0.5",
            },
        )
        with urlopen(req, timeout=timeout) as resp:
            content_type = resp.headers.get("content-type")
            audio_bytes = resp.read()
        print(
            f"[stt] audio downloaded: {len(audio_bytes)} bytes, "
            f"type={content_type}"
        )
        if len(audio_bytes) < 1000:
            print("[stt] audio too small")
            return None
        mp3.write_bytes(audio_bytes)

        for rate in (8000, 16000):
            flac = tmp / f"trawl-{uid}-{rate}.flac"
            try:
                ff = subprocess.run(
                    [
                        FFMPEG,
                        "-i",
                        str(mp3),
                        "-ar",
                        str(rate),
                        "-ac",
                        "1",
                        "-c:a",
                        "flac",
                        str(flac),
                        "-y",
                        "-loglevel",
                        "error",
                    ],
                    capture_output=True,
                    text=True,
                    timeout=30,
                )
                if ff.returncode != 0:
                    print(f"[stt] ffmpeg {rate}Hz error: {ff.stderr[:120]}")
                    continue
                flac_data = flac.read_bytes()
                if len(flac_data) < 500:
                    continue

                stt_req = Request(
                    GOOGLE_STT,
                    data=flac_data,
                    headers={"Content-Type": f"audio/x-flac; rate={rate}"},
                    method="POST",
                )
                with urlopen(stt_req, timeout=timeout) as stt_resp:
                    raw = stt_resp.read().decode("utf-8", "ignore")
                print(f"[stt] raw response: {raw[:300]}")

                for line in reversed(raw.splitlines()):
                    if not line.startswith("{"):
                        continue
                    try:
                        import json

                        j = json.loads(line)
                        t = (
                            j.get("result", [{}])[0]
                            .get("alternative", [{}])[0]
                            .get("transcript")
                        )
                        if t:
                            cleaned = _clean_transcript(t)
                            print(
                                f"[stt] transcript={t!r} → {cleaned!r}"
                            )
                            if cleaned:
                                return cleaned
                    except Exception:
                        continue
            finally:
                flac.unlink(missing_ok=True)
        return None
    except Exception as exc:
        print(f"[stt] error: {exc}")
        return None
    finally:
        mp3.unlink(missing_ok=True)


def transcribe_audio(audio_url: str, timeout: float = 30) -> str | None:
    if STT_URL:
        return _transcribe_whisper(audio_url, timeout)
    return _transcribe_google(audio_url, timeout)


def _is_passed(widget: FrameLocator, timeout_ms: float = 1000) -> bool:
    try:
        return widget.locator('[aria-checked="true"]').is_visible(
            timeout=timeout_ms
        )
    except Exception:
        return False


def _solve_audio(widget: FrameLocator, remaining_ms: float) -> bool:
    if remaining_ms < 5000:
        print("[hcaptcha] not enough time for audio attempt")
        return False

    try:
        widget.locator(AUDIO_BUTTON).wait_for(timeout=3000, state="attached")
    except Exception:
        print("[hcaptcha] audio challenge not available for this sitekey")
        return False

    try:
        widget.locator(AUDIO_BUTTON).click(timeout=5000, force=True)
    except Exception:
        pass
    print("[hcaptcha] switching to audio challenge")

    deadline = time.time() + (remaining_ms - 1000) / 1000
    attempt = 0

    while time.time() < deadline and attempt < MAX_AUDIO_ATTEMPTS:
        attempt += 1
        try:
            widget.locator("audio").wait_for(timeout=8000)
        except Exception:
            print(f"[hcaptcha] audio element not found (attempt {attempt})")
            continue

        try:
            audio_href = widget.locator("audio").evaluate(
                "el => el.src || ''"
            )
        except Exception:
            audio_href = ""

        if not audio_href or str(audio_href).startswith("blob:"):
            print(
                f"[hcaptcha] audio URL not usable: "
                f"{str(audio_href)[:60] or 'empty'}"
            )
            try:
                widget.locator(RELOAD_BUTTON).click(timeout=3000, force=True)
            except Exception:
                pass
            time.sleep(2)
            continue

        print(f"[hcaptcha] transcribing audio (attempt {attempt})")
        budget = max(deadline - time.time() - 3, 5)
        answer = transcribe_audio(str(audio_href), timeout=budget)

        if not answer:
            print("[hcaptcha] transcription empty, reloading audio")
            try:
                widget.locator(RELOAD_BUTTON).click(timeout=3000, force=True)
            except Exception:
                pass
            time.sleep(1.5)
            continue

        print(f"[hcaptcha] answer: {answer}")
        try:
            widget.locator(AUDIO_RESPONSE).fill(answer, timeout=3000)
        except Exception:
            pass
        try:
            widget.locator(AUDIO_SUBMIT).click(timeout=3000)
        except Exception:
            pass
        time.sleep(2)

        if _is_passed(widget, timeout_ms=2000):
            print("[hcaptcha] solved via audio ✓")
            return True

        print("[hcaptcha] wrong answer, reloading challenge")
        try:
            widget.locator(RELOAD_BUTTON).click(timeout=3000, force=True)
        except Exception:
            pass
        time.sleep(1.5)

    print(f"[hcaptcha] exhausted retries ({attempt}/{MAX_AUDIO_ATTEMPTS})")
    return False


def _log_frames(page: Page) -> None:
    try:
        urls = [f.url for f in page.frames if f.url and f.url != "about:blank"]
        if urls:
            print(
                "[solvers] frames:",
                " | ".join(u[:80] for u in urls),
                flush=True,
            )
    except Exception:
        pass


def _viewport_size(page: Page) -> tuple[float, float]:
    """
    Viewport real do clique — não o innerWidth/Height que o Camoufox spoofa
    no fingerprint (pode ser 1080 enquanto a janela visível é 720).
    """
    try:
        vp = page.viewport_size
        if vp and vp.get("width") and vp.get("height"):
            return float(vp["width"]), float(vp["height"])
    except Exception:
        pass
    try:
        size = page.evaluate(
            """() => {
              const vv = window.visualViewport;
              if (vv && vv.width && vv.height) return [vv.width, vv.height];
              return [
                document.documentElement.clientWidth,
                document.documentElement.clientHeight,
              ];
            }"""
        )
        return float(size[0]), float(size[1])
    except Exception:
        return 1920.0, 720.0


def _checkbox_local_point(box: dict) -> tuple[float, float]:
    """Ponto do 'Sou humano' relativo ao iframe (~24px da esquerda, meio)."""
    px = min(24.0, max(18.0, box["width"] * 0.08))
    py = box["height"] / 2.0
    return px, py


def _box_in_viewport(box: dict, vw: float, vh: float, pad: float = 8.0) -> bool:
    return (
        box["x"] >= -pad
        and box["y"] >= -pad
        and box["x"] + box["width"] <= vw + pad
        and box["y"] + box["height"] <= vh + pad
    )


def _checkbox_iframe(page: Page):
    """
    O widget visível (~300×75). Há dois iframes hCaptcha (checkbox + desafio);
    `.first` pega o errado e o clique cai fora da caixa.
    """
    locators = page.locator(WIDGET_FRAME)
    try:
        n = locators.count()
    except Exception:
        n = 0
    fallback = None
    for i in range(n):
        el = locators.nth(i)
        try:
            if not el.is_visible():
                continue
            box = el.bounding_box()
        except Exception:
            continue
        if not box or box.get("width", 0) <= 20:
            continue
        w, h = box["width"], box["height"]
        if 200 <= w <= 420 and 50 <= h <= 130:
            return el
        fallback = el
    return fallback if fallback is not None else locators.first


def _ensure_checkbox_in_viewport(page: Page, iframe) -> bool:
    """
    Só rola se o widget estiver fora da tela. Se já estiver visível no
    rodapé, NÃO centraliza aqui — o nudge 300–354px em seguida é quem
    tira o captcha da borda. Um segundo scrollBy no clique errava o alvo.
    """
    vw, vh = _viewport_size(page)
    try:
        box = iframe.bounding_box()
    except Exception:
        box = None
    if not box:
        return False
    if _box_in_viewport(box, vw, vh):
        print(
            f"[hcaptcha] checkbox already in viewport {round(vw)}x{round(vh)} "
            f"at ({round(box['x'])},{round(box['y'])}) "
            f"{round(box['width'])}x{round(box['height'])} — skip scroll",
            flush=True,
        )
        return False
    dy = (box["y"] + box["height"] / 2.0) - (vh * 0.45)
    print(
        f"[hcaptcha] checkbox off-screen, scrolling dy={dy:.0f}px "
        f"viewport={round(vw)}x{round(vh)} box=({round(box['x'])},{round(box['y'])}) "
        f"{round(box['width'])}x{round(box['height'])}",
        flush=True,
    )
    try:
        page.evaluate(
            """(dy) => {
              const el = document.scrollingElement || document.documentElement;
              const prev = el.style.scrollBehavior;
              el.style.scrollBehavior = "auto";
              window.scrollBy(0, dy);
              el.style.scrollBehavior = prev;
            }""",
            dy,
        )
    except Exception:
        try:
            page.evaluate("(dy) => window.scrollBy(0, dy)", dy)
        except Exception:
            pass
    return True


def _nudge_page_down(page: Page, *, reset: bool = False) -> None:
    """Rola para Y aleatório entre 600 e 700px (uma vez por carga)."""
    if reset:
        try:
            delattr(page, "_hcaptcha_nudged")
        except Exception:
            pass
    if getattr(page, "_hcaptcha_nudged", False):
        print("[hcaptcha] scroll 600-700 already applied this page", flush=True)
        return
    y = random.randint(SCROLL_NUDGE_MIN, SCROLL_NUDGE_MAX)
    try:
        before = page.evaluate("() => window.scrollY || window.pageYOffset || 0")
    except Exception:
        before = "?"
    print(
        f"[hcaptcha] scrolling to y={y}px (random {SCROLL_NUDGE_MIN}-{SCROLL_NUDGE_MAX})",
        flush=True,
    )
    try:
        page.evaluate(
            """(y) => {
              const el = document.scrollingElement || document.documentElement;
              const prev = el.style.scrollBehavior;
              el.style.scrollBehavior = "auto";
              window.scrollTo(0, y);
              el.style.scrollBehavior = prev;
            }""",
            y,
        )
    except Exception:
        try:
            page.evaluate("(y) => window.scrollTo(0, y)", y)
        except Exception as exc:
            print(f"[hcaptcha] scroll 600-700 failed: {exc}", flush=True)
            return
    time.sleep(0.35)
    try:
        after = page.evaluate("() => window.scrollY || window.pageYOffset || 0")
    except Exception:
        after = "?"
    iframe = _checkbox_iframe(page)
    try:
        box = iframe.bounding_box() if iframe is not None else None
    except Exception:
        box = None
    if box:
        print(
            f"[hcaptcha] after scroll scrollY {before}->{after} "
            f"checkbox=({round(box['x'])},{round(box['y'])}) "
            f"{round(box['width'])}x{round(box['height'])}",
            flush=True,
        )
    else:
        print(f"[hcaptcha] after scroll scrollY {before}->{after}", flush=True)
    try:
        page._hcaptcha_nudged = True  # type: ignore[attr-defined]
        page._hcaptcha_scroll_y = after  # type: ignore[attr-defined]
    except Exception:
        pass


def trigger_lazy_widgets(page: Page) -> None:
    """Espera o iframe e rola 600–700px."""
    _log_frames(page)
    try:
        page.wait_for_selector(WIDGET_FRAME, timeout=15_000, state="attached")
    except Exception:
        pass
    try:
        _nudge_page_down(page)
    except Exception:
        pass
    _log_frames(page)


def _iframe_content_frame(iframe):
    try:
        handle = iframe.element_handle(timeout=3000)
        if handle:
            return handle.content_frame()
    except Exception:
        return None
    return None


def _checkbox_widget(page: Page) -> FrameLocator:
    """FrameLocator do widget 300×75 — `.first` pega o iframe de desafio."""
    iframe = _checkbox_iframe(page)
    try:
        src = iframe.get_attribute("src") or ""
        if "hcaptcha" in src:
            return page.frame_locator(f'iframe[src="{src}"]')
    except Exception:
        pass
    return page.frame_locator(
        'iframe[src*="hcaptcha"][src*="frame=checkbox"]'
    )


def _wait_checkbox_ready(page: Page, timeout_ms: float = 8000) -> bool:
    """Espera o #checkbox existir dentro do iframe (não só o iframe vazio)."""
    deadline = time.time() + timeout_ms / 1000.0
    while time.time() < deadline:
        iframe = _checkbox_iframe(page)
        frame = _iframe_content_frame(iframe)
        if frame is not None:
            try:
                if frame.locator("#checkbox").is_visible(timeout=400):
                    return True
            except Exception:
                pass
        time.sleep(0.25)
    return False


def _checkbox_local_click_point(page: Page, iframe) -> tuple[float, float] | None:
    """
    Ponto DENTRO do iframe (não coords de página). Prefere o centro do
    #checkbox real convertido para local; senão ~24px da esquerda.
    """
    try:
        ibox = iframe.bounding_box(timeout=3000)
    except Exception:
        ibox = None
    if not ibox or ibox.get("width", 0) <= 20:
        return None
    frame = _iframe_content_frame(iframe)
    if frame is not None:
        try:
            cb = frame.locator("#checkbox").bounding_box(timeout=2000)
            if cb and cb.get("width", 0) > 4 and cb.get("height", 0) > 4:
                lx = (cb["x"] + cb["width"] / 2.0) - ibox["x"]
                ly = (cb["y"] + cb["height"] / 2.0) - ibox["y"]
                lx = min(max(lx, 8.0), ibox["width"] - 8.0)
                ly = min(max(ly, 8.0), ibox["height"] - 8.0)
                return lx, ly
        except Exception:
            pass
    return _checkbox_local_point(ibox)


class _ClickWatchdog(Exception):
    """Humanize do Camoufox travou e o SIGALRM cortou o clique."""


def _run_with_timeout(fn, seconds: float):
    """Corta clique/humanize que não devolve (watchdog só onde há SIGALRM)."""
    if hasattr(signal, "SIGALRM") and os.name != "nt":
        def _handle(signum, frame):
            raise _ClickWatchdog(f"click hung for {seconds:.0f}s")

        old = signal.getsignal(signal.SIGALRM)
        signal.signal(signal.SIGALRM, _handle)
        try:
            signal.setitimer(signal.ITIMER_REAL, seconds)
            return fn()
        finally:
            signal.setitimer(signal.ITIMER_REAL, 0.0)
            signal.signal(signal.SIGALRM, old)

    # Sem SIGALRM (Windows): roda na propria thread. A API sync do Playwright
    # e presa a thread (greenlet) que abriu o navegador — chamar de uma thread
    # de watchdog da "Cannot switch to a different thread" e derruba o clique
    # e o Ctrl+R. Aqui o limite fica por conta dos timeouts do proprio Playwright.
    return fn()


def _checkbox_page_point(page: Page) -> tuple[float, float] | None:
    iframe = _checkbox_iframe(page)
    try:
        ibox = iframe.bounding_box(timeout=3000)
    except Exception:
        ibox = None
    if not ibox or ibox.get("width", 0) <= 20:
        return None
    frame = _iframe_content_frame(iframe)
    if frame is not None:
        try:
            cb = frame.locator("#checkbox").bounding_box(timeout=2000)
            if cb and cb.get("width", 0) > 4 and cb.get("height", 0) > 4:
                return (
                    cb["x"] + cb["width"] / 2.0,
                    cb["y"] + cb["height"] / 2.0,
                )
        except Exception:
            pass
    px, py = _checkbox_local_point(ibox)
    return ibox["x"] + px, ibox["y"] + py


def _click_checkbox_humanize(page: Page) -> bool:
    """Move o mouse com humanize até o checkbox e faz press/release separados."""
    try:
        _widget_locator(page).locator("#checkbox").wait_for(
            state="attached", timeout=8000
        )
    except Exception:
        print("[hcaptcha] #checkbox not in iframe", flush=True)
        return False
    pt = _checkbox_page_point(page)
    if pt is None:
        print("[hcaptcha] sem coordenadas do checkbox", flush=True)
        return False
    x, y = pt
    print(f"[hcaptcha] humanize mouse -> ({x:.0f},{y:.0f})", flush=True)

    hold_s = random.uniform(PRESS_HOLD_MIN_S, PRESS_HOLD_MAX_S)

    def _do() -> None:
        page.mouse.move(x, y)
        time.sleep(random.uniform(0.12, 0.3))
        page.mouse.down(button="left")
        time.sleep(hold_s)
        page.mouse.up(button="left")

    try:
        _run_with_timeout(_do, CLICK_TIMEOUT_MS / 1000.0)
        print(
            f"[hcaptcha] clicked checkbox (press/release, hold={hold_s * 1000:.0f}ms)",
            flush=True,
        )
        return True
    except _ClickWatchdog as exc:
        print(
            f"[hcaptcha] {exc} — clique travou (captcha/mouse). "
            "Ctrl+R e tenta de novo.",
            flush=True,
        )
        return False
    except Exception as exc:
        print(f"[hcaptcha] humanize click failed: {exc}", flush=True)
        return False


def _ctrl_r_keep_scroll(page: Page) -> bool:
    """Ctrl+R e devolve o scroll de antes (a página deve reabrir no mesmo lugar)."""
    try:
        y = page.evaluate("() => window.scrollY || window.pageYOffset || 0")
    except Exception:
        y = getattr(page, "_hcaptcha_scroll_y", None)
    print("[hcaptcha] Ctrl+R", flush=True)

    def _reload() -> None:
        try:
            page.keyboard.press("Control+r")
        except Exception as exc:
            print(f"[hcaptcha] Ctrl+R falhou ({exc}); page.reload()", flush=True)
            page.reload(wait_until="domcontentloaded", timeout=60_000)
        try:
            page.wait_for_load_state("domcontentloaded", timeout=60_000)
        except Exception:
            pass

    try:
        _run_with_timeout(_reload, CTRL_R_TIMEOUT_MS / 1000.0)
    except _ClickWatchdog as exc:
        print(f"[hcaptcha] {exc} — Ctrl+R também travou", flush=True)
        return False
    try:
        page.wait_for_selector(WIDGET_FRAME, timeout=15_000, state="attached")
    except Exception:
        print("[hcaptcha] widget missing after Ctrl+R", flush=True)
        return False
    time.sleep(0.6)
    if y is not None:
        try:
            page.evaluate("(y) => window.scrollTo(0, y)", y)
        except Exception:
            pass
    return True


def _widget_locator(page: Page) -> FrameLocator:
    try:
        return _checkbox_widget(page)
    except Exception:
        return page.frame_locator(WIDGET_FRAME).first


def _has_visual_challenge(page: Page) -> bool:
    """Desafio de imagem visível (iframe alto), não o widget 300×75."""
    selectors = (
        'iframe[src*="hcaptcha"][src*="frame=challenge"]',
        'iframe[title*="hCaptcha challenge" i]',
        'iframe[src*="hcaptcha"][src*="challenge"]',
    )
    for sel in selectors:
        locators = page.locator(sel)
        try:
            n = locators.count()
        except Exception:
            n = 0
        for i in range(n):
            el = locators.nth(i)
            try:
                if not el.is_visible():
                    continue
                box = el.bounding_box()
            except Exception:
                continue
            if box and box.get("width", 0) >= 200 and box.get("height", 0) >= 150:
                return True
    locators = page.locator(WIDGET_FRAME)
    try:
        n = locators.count()
    except Exception:
        n = 0
    for i in range(n):
        el = locators.nth(i)
        try:
            if not el.is_visible():
                continue
            box = el.bounding_box()
        except Exception:
            continue
        if not box:
            continue
        w, h = box["width"], box["height"]
        if h >= 150 and w >= 200 and not (200 <= w <= 420 and 50 <= h <= 130):
            return True
    return False


def _wait_auto_pass(page: Page) -> bool:
    time.sleep(2.5)
    return _is_passed(_widget_locator(page), timeout_ms=1500)


def has_hcaptcha_widget(page: Page, timeout_ms: float = 2000) -> bool:
    try:
        page.wait_for_selector(
            WIDGET_FRAME, timeout=timeout_ms, state="attached"
        )
        return True
    except Exception:
        return False


def solve_hcaptcha(
    page: Page,
    timeout_ms: float = 30_000,
    on_reload: Callable[[], bool | None] | None = None,
) -> bool:
    """
    Scroll 600–700 → mouse humanize no checkbox → se não checar,
    Ctrl+R (mesma posição) e clica de novo (até 2x). Sem preencher form.
    """
    _ = timeout_ms
    _ = on_reload
    try:
        try:
            page.wait_for_selector(WIDGET_FRAME, timeout=15_000, state="attached")
        except Exception:
            print("[hcaptcha] widget not found", flush=True)
            return False

        trigger_lazy_widgets(page)
        time.sleep(CHECKBOX_SETTLE_S)

        attempts = CTRL_R_RETRIES + 1
        for n in range(1, attempts + 1):
            print(f"[hcaptcha] tentativa {n}: clique humanize", flush=True)
            clicked = _click_checkbox_humanize(page)
            if clicked and _wait_auto_pass(page):
                if n == 1:
                    print("[hcaptcha] auto-passed ✓", flush=True)
                else:
                    print(
                        f"[hcaptcha] auto-passed after Ctrl+R {n - 1} ✓",
                        flush=True,
                    )
                return True
            if clicked and _has_visual_challenge(page):
                print("[hcaptcha] visual challenge after click", flush=True)

            if n > CTRL_R_RETRIES:
                break
            print(
                f"[hcaptcha] sem check/clique travou — "
                f"Ctrl+R tentativa {n}/{CTRL_R_RETRIES}",
                flush=True,
            )
            if not _ctrl_r_keep_scroll(page):
                return False
            time.sleep(CHECKBOX_SETTLE_S)

        print("[hcaptcha] not passed after Ctrl+R retries", flush=True)
        return False
    except Exception as exc:
        print(f"[hcaptcha] error: {exc}")
        return False
