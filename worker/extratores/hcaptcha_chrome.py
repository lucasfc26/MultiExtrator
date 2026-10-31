"""
hCaptcha no Chrome (fallback da 2VIA) — só SeleniumBase CDP Mode.

O Playwright NÃO pode estar conectado durante o captcha: com ele anexado ao
Chrome o hCaptcha abre desafio visual e o Imperva bloqueia o reload. Aqui o
clique é Input.dispatchMouseEvent puro (trajetória de mouseMoved,
mousePressed, pausa, mouseReleased), como o sb.solve_captcha().
"""

from __future__ import annotations

import json
import random
import time
from collections.abc import Callable

import mycdp

from hcaptcha_solver import (
    CHECKBOX_SETTLE_S,
    CTRL_R_RETRIES,
    PRESS_HOLD_MAX_S,
    PRESS_HOLD_MIN_S,
    SCROLL_NUDGE_MAX,
    SCROLL_NUDGE_MIN,
)

RESULT_WAIT_S = 10.0

WIDGET_BOX_JS = """(() => {
  const frames = [...document.querySelectorAll('iframe[src*="hcaptcha.com"]')];
  let fallback = null;
  for (const f of frames) {
    const r = f.getBoundingClientRect();
    const s = getComputedStyle(f);
    if (r.width < 20 || r.height < 20) continue;
    if (s.visibility === "hidden" || s.display === "none") continue;
    const box = { x: r.x, y: r.y, width: r.width, height: r.height };
    if (r.width >= 200 && r.width <= 420 && r.height >= 50 && r.height <= 130) {
      return JSON.stringify(box);
    }
    fallback = fallback || box;
  }
  return JSON.stringify(fallback);
})()"""

STATE_JS = """(() => {
  let token = "";
  try {
    if (window.hcaptcha && typeof window.hcaptcha.getResponse === "function") {
      token = window.hcaptcha.getResponse() || "";
    }
  } catch (e) {}
  if (!token) {
    const el = document.querySelector(
      '[name="h-captcha-response"], [name="g-recaptcha-response"]'
    );
    token = (el && el.value) || "";
  }
  let challenge = false;
  for (const f of document.querySelectorAll('iframe[src*="hcaptcha.com"]')) {
    const r = f.getBoundingClientRect();
    const s = getComputedStyle(f);
    if (s.visibility === "hidden" || s.display === "none") continue;
    if (r.width >= 200 && r.height >= 150) { challenge = true; break; }
  }
  return JSON.stringify({ token_len: token.length, challenge });
})()"""


def _log(msg: str) -> None:
    print(f"[hcaptcha-chrome] {msg}", flush=True)


def _eval_json(sb, expression: str):
    raw = sb.evaluate(expression)
    if not raw or raw == "null":
        return None
    return json.loads(raw)


def _send(sb, command) -> None:
    sb.loop.run_until_complete(sb.page.send(command))


def _bezier_path(start, end, steps):
    (x0, y0), (x2, y2) = start, end
    cx = (x0 + x2) / 2 + random.uniform(-120, 120)
    cy = (y0 + y2) / 2 + random.uniform(-90, 90)
    pts = []
    for i in range(1, steps + 1):
        t = i / steps
        t = t * t * (3 - 2 * t)
        x = (1 - t) ** 2 * x0 + 2 * (1 - t) * t * cx + t**2 * x2
        y = (1 - t) ** 2 * y0 + 2 * (1 - t) * t * cy + t**2 * y2
        pts.append((x, y))
    return pts


def wait_widget(sb, timeout_s: float = 20.0) -> dict | None:
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        box = _eval_json(sb, WIDGET_BOX_JS)
        if box:
            return box
        time.sleep(0.4)
    return None


def nudge_scroll(sb) -> None:
    y = random.randint(SCROLL_NUDGE_MIN, SCROLL_NUDGE_MAX)
    _log(f"rolando para y={y}px (random {SCROLL_NUDGE_MIN}-{SCROLL_NUDGE_MAX})")
    sb.evaluate(f"window.scrollTo(0, {y})")
    time.sleep(0.35)


def cdp_press_release(sb, box: dict) -> None:
    """Move até o checkbox por mouseMoved e clica com press/release separados."""
    tx = box["x"] + 30 + random.uniform(-2.5, 2.5)
    ty = box["y"] + box["height"] / 2 + random.uniform(-2.5, 2.5)
    vw, vh = _eval_json(sb, "JSON.stringify([innerWidth, innerHeight])")
    sx = random.uniform(vw * 0.15, vw * 0.45)
    sy = random.uniform(vh * 0.15, vh * 0.5)
    steps = random.randint(22, 36)
    _log(f"mouseMoved ({sx:.0f},{sy:.0f}) -> ({tx:.0f},{ty:.0f}) em {steps} passos")

    _send(sb, mycdp.input_.dispatch_mouse_event("mouseMoved", x=sx, y=sy))
    for x, y in _bezier_path((sx, sy), (tx, ty), steps):
        _send(sb, mycdp.input_.dispatch_mouse_event("mouseMoved", x=x, y=y))
        time.sleep(random.uniform(0.008, 0.028))
    time.sleep(random.uniform(0.12, 0.35))

    hold = random.uniform(PRESS_HOLD_MIN_S, PRESS_HOLD_MAX_S)
    left = mycdp.input_.MouseButton("left")
    _send(
        sb,
        mycdp.input_.dispatch_mouse_event(
            "mousePressed", x=tx, y=ty, button=left, buttons=1, click_count=1
        ),
    )
    time.sleep(hold)
    _send(
        sb,
        mycdp.input_.dispatch_mouse_event(
            "mouseReleased", x=tx, y=ty, button=left, buttons=0, click_count=1
        ),
    )
    _log(f"mousePressed/mouseReleased enviados (hold={hold * 1000:.0f}ms)")


def wait_result(sb) -> str:
    """'passou' (token do hCaptcha preenchido), 'desafio visual' ou 'sem check'."""
    deadline = time.time() + RESULT_WAIT_S
    state = {"token_len": 0, "challenge": False}
    while time.time() < deadline:
        state = _eval_json(sb, STATE_JS) or state
        if state.get("token_len"):
            return "passou"
        time.sleep(0.5)
    return "desafio visual" if state.get("challenge") else "sem check"


def solve_hcaptcha_sb(
    sb,
    on_step: Callable[[], None] | None = None,
    tentativas: int | None = None,
) -> bool:
    """
    Página já aberta no sb: rola 600–700px, clica por CDP e, se não passar,
    recarrega (mesma posição) e clica de novo — `tentativas` cliques no total
    (padrão: CTRL_R_RETRIES reloads).
    """
    step = on_step or (lambda: None)
    if not wait_widget(sb):
        _log("widget não encontrado")
        return False
    nudge_scroll(sb)
    time.sleep(CHECKBOX_SETTLE_S)
    step()

    attempts = max(1, int(tentativas)) if tentativas else CTRL_R_RETRIES + 1
    for n in range(1, attempts + 1):
        box = wait_widget(sb, timeout_s=8)
        if box:
            _log(f"tentativa {n}: clique CDP")
            cdp_press_release(sb, box)
            result = wait_result(sb)
        else:
            result = "sem widget"
        step()
        _log(f"tentativa {n}: {result}")
        if result == "passou":
            return True
        if n == attempts:
            break
        y = sb.evaluate("window.scrollY || 0")
        _log(f"reload {n}/{attempts - 1}")
        sb.reload(ignore_cache=False)
        if not wait_widget(sb, timeout_s=15):
            _log("widget sumiu depois do reload")
            return False
        sb.evaluate(f"window.scrollTo(0, {int(y or 0)})")
        time.sleep(CHECKBOX_SETTLE_S)
    return False
