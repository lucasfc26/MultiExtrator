"""
hCaptcha da 2ª via resolvido pelo 2captcha — método de coordenadas
(https://2captcha.com/api-docs/coordinates).

Roda no Chrome do SeleniumBase (mesma sessão das outras etapas) quando o
clique no checkbox não passa e o hCaptcha abre o desafio visual:

  1. abre o desafio (clique no checkbox), se ainda não estiver aberto;
  2. tira um screenshot só do iframe do desafio (com a instrução no topo);
  3. manda a imagem ao 2captcha como `CoordinatesTask`;
  4. clica nos pontos devolvidos (convertidos para a tela) e no botão
     Verificar/Próximo do desafio;
  5. repete enquanto o hCaptcha mostrar outra página/desafio, até o token
     aparecer no `h-captcha-response` ou acabarem as rodadas.

Chave: `twoCaptchaApiKey` do payload (Configurações › Extrações, repassada
pelo backend/app desktop) ou a variável TWOCAPTCHA_API_KEY.
"""

from __future__ import annotations

import base64
import json
import os
import random
import time
import urllib.error
import urllib.request
from collections.abc import Callable
from typing import Any

import mycdp

from hcaptcha_chrome import (
    STATE_JS,
    _bezier_path,
    _eval_json,
    _send,
    cdp_press_release,
    wait_result,
    wait_widget,
)
from hcaptcha_solver import PRESS_HOLD_MAX_S, PRESS_HOLD_MIN_S

API_URL = (os.environ.get("TWOCAPTCHA_API_URL") or "https://api.2captcha.com").rstrip("/")
# Coordenadas costumam voltar em 10–60s; 3 min por imagem dá margem ao worker.
TIMEOUT_S = float(os.environ.get("TWOCAPTCHA_TIMEOUT_S") or 180)
POLL_S = 5.0
# Cada página do desafio é uma task; o hCaptcha pode pedir 2–3 páginas e
# trocar o desafio quando erra.
MAX_RODADAS = int(os.environ.get("TWOCAPTCHA_HCAPTCHA_RODADAS") or 6)
COMENTARIO = (
    os.environ.get("TWOCAPTCHA_HCAPTCHA_COMENTARIO")
    or "The instruction at the top of the image is in Portuguese. Click on every image "
    "or object that matches it and do not click the buttons at the bottom. If the task "
    "asks to drag or move pieces, click only the 'Pular' button at the bottom right."
)
# Limites do CoordinatesTask: 1000px no maior lado e 600 kB.
LADO_MAX_PX = 1000
TAMANHO_MAX_BYTES = 600_000
ESPERA_IMAGENS_S = 1.5
RESULTADO_S = 6.0
# O iframe do desafio é cross-origin (hcaptcha.com): sem acesso ao DOM, o
# botão Verificar/Próximo é clicado pela posição no rodapé (canto inferior
# direito) do layout do hCaptcha.
BOTAO_DX = 55
BOTAO_DY = 30

DESAFIO_JS = """(() => {
  let melhor = null;
  for (const f of document.querySelectorAll('iframe[src*="hcaptcha.com"]')) {
    const r = f.getBoundingClientRect();
    const s = getComputedStyle(f);
    if (s.visibility === "hidden" || s.display === "none") continue;
    if (r.width < 200 || r.height < 150) continue;
    if (r.bottom <= 0 || r.top >= innerHeight) continue;
    if (!melhor || r.width * r.height > melhor.width * melhor.height) {
      melhor = { x: r.x, y: r.y, width: r.width, height: r.height };
    }
  }
  if (!melhor) return "null";
  return JSON.stringify({
    ...melhor,
    scrollX: window.scrollX,
    scrollY: window.scrollY,
    dpr: window.devicePixelRatio || 1,
    vh: innerHeight,
  });
})()"""


class ErroDoisCaptcha(RuntimeError):
    """Falha do 2captcha. A mensagem sempre cita o hCaptcha para o
    orquestrador tratá-la como falha de captcha (ver is_hcaptcha_error)."""


def chave_api(config: dict[str, Any]) -> str:
    return str(config.get("twoCaptchaApiKey") or os.environ.get("TWOCAPTCHA_API_KEY") or "").strip()


def _post(caminho: str, corpo: dict[str, Any]) -> dict[str, Any]:
    req = urllib.request.Request(
        f"{API_URL}{caminho}",
        data=json.dumps(corpo).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as exc:
        # O 2captcha devolve 400 com { errorCode, errorDescription }.
        try:
            dados = json.loads(exc.read().decode("utf-8") or "{}")
        except Exception:
            dados = {}
        detalhe = dados.get("errorDescription") or dados.get("errorCode") or f"HTTP {exc.code}"
        raise ErroDoisCaptcha(f"Não foi possível resolver o hCaptcha pelo 2captcha: {detalhe}") from None
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise ErroDoisCaptcha(f"Não foi possível resolver o hCaptcha: 2captcha inacessível ({exc})") from None


def _erro_da_resposta(resposta: dict[str, Any]) -> None:
    if resposta.get("errorId"):
        detalhe = resposta.get("errorDescription") or resposta.get("errorCode")
        raise ErroDoisCaptcha(f"Não foi possível resolver o hCaptcha pelo 2captcha: {detalhe}")


def pedir_coordenadas(
    chave: str,
    imagem_b64: str,
    esperar: Callable[[float], None] = time.sleep,
    deve_parar: Callable[[], bool] = lambda: False,
    log: Callable[[str, str], None] = lambda m, t="info": None,
) -> list[tuple[float, float]] | None:
    """`CoordinatesTask` com a imagem do desafio. Devolve os pontos em pixels
    da imagem; None = parado ou estourou o tempo."""
    criada = _post(
        "/createTask",
        {
            "clientKey": chave,
            "task": {"type": "CoordinatesTask", "body": imagem_b64, "comment": COMENTARIO},
        },
    )
    _erro_da_resposta(criada)
    task_id = criada.get("taskId")
    if not task_id:
        raise ErroDoisCaptcha("Não foi possível resolver o hCaptcha: 2captcha não devolveu taskId")
    log(f"🆔 Task 2captcha criada ({task_id}, CoordinatesTask).", "info")

    inicio = time.monotonic()
    ultimo_aviso = inicio
    while time.monotonic() - inicio < TIMEOUT_S:
        if deve_parar():
            return None
        esperar(POLL_S)
        resultado = _post("/getTaskResult", {"clientKey": chave, "taskId": task_id})
        _erro_da_resposta(resultado)
        if resultado.get("status") == "ready":
            pontos = (resultado.get("solution") or {}).get("coordinates") or []
            return [(float(p["x"]), float(p["y"])) for p in pontos if "x" in p and "y" in p]
        if time.monotonic() - ultimo_aviso >= 15:
            ultimo_aviso = time.monotonic()
            log(f"⏳ 2captcha processando ({round(ultimo_aviso - inicio)}s)...", "info")
    log(f"✘ 2captcha não devolveu as coordenadas em {round(TIMEOUT_S)}s (task {task_id}).", "error")
    return None


def _cdp(sb, command):
    return sb.loop.run_until_complete(sb.page.send(command))


def _token_len(sb) -> int:
    estado = _eval_json(sb, STATE_JS) or {}
    return int(estado.get("token_len") or 0)


def _caixa_desafio(sb) -> dict | None:
    return _eval_json(sb, DESAFIO_JS)


def _enquadrar(sb, caixa: dict) -> dict | None:
    """Rola até o desafio caber na tela: screenshot e cliques só valem
    dentro da área visível."""
    topo, base, altura_tela = caixa["y"], caixa["y"] + caixa["height"], caixa["vh"]
    if topo >= 0 and base <= altura_tela:
        return caixa
    delta = topo if topo < 0 or caixa["height"] > altura_tela else base - altura_tela
    sb.evaluate(f"window.scrollBy(0, {int(delta)})")
    time.sleep(0.6)
    return _caixa_desafio(sb)


def _dimensoes_jpeg(dados: bytes) -> tuple[int, int] | None:
    """(largura, altura) do marcador SOF do JPEG."""
    i = 2
    while i + 9 < len(dados):
        if dados[i] != 0xFF:
            return None
        marcador = dados[i + 1]
        if marcador == 0xFF:
            i += 1
            continue
        if marcador in (0xD8, 0x01) or 0xD0 <= marcador <= 0xD7:
            i += 2
            continue
        if 0xC0 <= marcador <= 0xCF and marcador not in (0xC4, 0xC8, 0xCC):
            altura = int.from_bytes(dados[i + 5 : i + 7], "big")
            largura = int.from_bytes(dados[i + 7 : i + 9], "big")
            return largura, altura
        i += 2 + int.from_bytes(dados[i + 2 : i + 4], "big")
    return None


def _capturar(sb, caixa: dict) -> tuple[str, int, int]:
    """Screenshot JPEG só do desafio, dentro dos limites do CoordinatesTask.
    Devolve (base64, largura, altura) da imagem enviada."""
    dpr = float(caixa.get("dpr") or 1)
    escala = min(1.0, LADO_MAX_PX / (max(caixa["width"], caixa["height"]) * dpr))
    # O clip do Page.captureScreenshot é relativo ao documento, não à tela.
    clip = mycdp.page.Viewport(
        x=caixa["x"] + caixa["scrollX"],
        y=caixa["y"] + caixa["scrollY"],
        width=caixa["width"],
        height=caixa["height"],
        scale=escala,
    )
    b64 = ""
    dados = b""
    for qualidade in (85, 65, 45):
        b64 = _cdp(sb, mycdp.page.capture_screenshot(format_="jpeg", quality=qualidade, clip=clip))
        dados = base64.b64decode(b64)
        if len(dados) <= TAMANHO_MAX_BYTES:
            break
    largura, altura = _dimensoes_jpeg(dados) or (
        round(caixa["width"] * escala * dpr),
        round(caixa["height"] * escala * dpr),
    )
    return b64, largura, altura


def _no_botao(caixa: dict, x: float, y: float) -> bool:
    """(x, y) relativo ao desafio cai na área do botão Verificar/Pular."""
    return x >= caixa["width"] - 2 * BOTAO_DX and y >= caixa["height"] - 2 * BOTAO_DY


def _clicar(sb, origem: tuple[float, float], destino: tuple[float, float]) -> tuple[float, float]:
    """Move o mouse por mouseMoved até `destino` e clica (press/release)."""
    for x, y in _bezier_path(origem, destino, random.randint(12, 22)):
        _send(sb, mycdp.input_.dispatch_mouse_event("mouseMoved", x=x, y=y))
        time.sleep(random.uniform(0.006, 0.02))
    time.sleep(random.uniform(0.08, 0.2))
    x, y = destino
    left = mycdp.input_.MouseButton("left")
    _send(
        sb,
        mycdp.input_.dispatch_mouse_event(
            "mousePressed", x=x, y=y, button=left, buttons=1, click_count=1
        ),
    )
    time.sleep(random.uniform(PRESS_HOLD_MIN_S, PRESS_HOLD_MAX_S))
    _send(
        sb,
        mycdp.input_.dispatch_mouse_event(
            "mouseReleased", x=x, y=y, button=left, buttons=0, click_count=1
        ),
    )
    return destino


def resolver_hcaptcha_2captcha(
    sb,
    config: dict[str, Any],
    esperar: Callable[[float], None] = time.sleep,
    deve_parar: Callable[[], bool] = lambda: False,
    log: Callable[[str, str], None] = lambda m, t="info": None,
    on_step: Callable[[], None] = lambda: None,
) -> bool:
    """Página da 2ª via já aberta no `sb`. True = token do hCaptcha na página."""
    chave = chave_api(config)
    if not chave:
        raise ErroDoisCaptcha(
            "Não foi possível resolver o hCaptcha: chave do 2captcha não configurada "
            "(Configurações › Extrações ou TWOCAPTCHA_API_KEY)."
        )

    for rodada in range(1, MAX_RODADAS + 1):
        if deve_parar():
            return False
        if _token_len(sb):
            return True

        caixa = _caixa_desafio(sb)
        if caixa is None:
            widget = wait_widget(sb, timeout_s=8)
            if not widget:
                log("✘ hCaptcha não encontrado na página para o 2captcha.", "error")
                return False
            log("🖱 Clicando no hCaptcha para abrir o desafio...", "info")
            cdp_press_release(sb, widget)
            resultado = wait_result(sb)
            on_step()
            if resultado == "passou":
                return True
            caixa = _caixa_desafio(sb)
            if caixa is None:
                log("⚠ O clique não abriu o desafio do hCaptcha. Tentando de novo...", "warn")
                continue

        esperar(ESPERA_IMAGENS_S)
        caixa = _enquadrar(sb, _caixa_desafio(sb) or caixa)
        if caixa is None:
            continue
        imagem, largura, altura = _capturar(sb, caixa)
        on_step()
        log(
            f"🧩 Enviando o desafio do hCaptcha ao 2captcha (coordenadas, "
            f"rodada {rodada}/{MAX_RODADAS}, {largura}×{altura}px)...",
            "info",
        )
        pontos = pedir_coordenadas(chave, imagem, esperar, deve_parar, log)
        if pontos is None:
            return False
        if not pontos:
            log("⚠ 2captcha não devolveu nenhum ponto. Tentando de novo...", "warn")
            continue

        fx, fy = caixa["width"] / largura, caixa["height"] / altura
        alvos = [(px * fx, py * fy) for px, py in pontos]
        # Ponto no canto do botão = o worker pulou o desafio (ex.: de arrastar).
        pulou = any(_no_botao(caixa, x, y) for x, y in alvos)
        objetos = [(caixa["x"] + x, caixa["y"] + y) for x, y in alvos if not _no_botao(caixa, x, y)]
        descricao = [f"({x:.0f},{y:.0f})" for x, y in objetos] + (["Pular"] if pulou else [])
        log(f"🎯 2captcha devolveu {len(pontos)} ponto(s): {', '.join(descricao)}", "info")
        mouse = (
            caixa["x"] + random.uniform(20, caixa["width"] - 20),
            caixa["y"] + random.uniform(20, 60),
        )
        for alvo in objetos:
            mouse = _clicar(sb, mouse, alvo)
            time.sleep(random.uniform(0.3, 0.7))
        _clicar(
            sb,
            mouse,
            (caixa["x"] + caixa["width"] - BOTAO_DX, caixa["y"] + caixa["height"] - BOTAO_DY),
        )
        on_step()

        fim = time.monotonic() + RESULTADO_S
        while time.monotonic() < fim:
            if deve_parar():
                return False
            if _token_len(sb):
                return True
            esperar(0.5)

    log(f"✘ 2captcha não resolveu o hCaptcha em {MAX_RODADAS} rodada(s).", "error")
    return False
