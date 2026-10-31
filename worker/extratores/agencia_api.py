"""
Agência Virtual Enel — fluxo HTTP (sem clicar na tela).

Não é REST. Os "endpoints" são postbacks ASP.NET com cookie de sessão
(Imperva + ASP.NET_SessionId):

  1. POST /ce/Corporativo.aspx          → login
  2. GET  /agencia/DefaultGa.aspx       → lista de UCs (1ª já vem marcada)
  3. POST /agencia/DefaultGa.aspx       → UpdatePanel troca a UC
  4. GET  /agencia/SegundaViaGa.aspx    → tabela de faturas
  5. POST /agencia/SegundaViaGa.aspx    → abre/baixa o PDF

O Camoufox só entra para a Imperva aceitar o TLS/cookie. O HTTP (login,
troca de UC, painéis AJAX) vai pelo `page.request` do Playwright — o
`fetch()` + `Uint8Array` via `page.evaluate` o Firefox/Camoufox recusa
("Accessing TypedArray data over Xrays").

Uso:
  py -3 agencia_api.py --user EMAIL --password SENHA --uc 55642637 --ref 06/2026 07/2026 08/2026
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import re
import subprocess
import sys
import threading
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.parse import urljoin

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

from trawl_browser import (
    attach_trawl_init_script,
    open_camoufox,
    request_fetch,
    safe_evaluate,
)

try:
    from extraction_trawl import firefox_download_prefs
except Exception:
    def firefox_download_prefs() -> dict:
        DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)
        return {
            "pdfjs.disabled": True,
            "browser.download.folderList": 2,
            "browser.download.dir": str(DOWNLOAD_DIR),
            "browser.download.useDownloadDir": True,
            "browser.helperApps.neverAsk.saveToDisk": (
                "application/pdf,application/octet-stream,application/x-pdf"
            ),
        }

LOGIN_URL = "https://www.eneldistribuicao.com.br/ce/Corporativo.aspx"
HOME_URL = "https://www.eneldistribuicao.com.br/agencia/DefaultGa.aspx"
SEGUNDA_VIA_URL = "https://www.eneldistribuicao.com.br/agencia/SegundaViaGa.aspx"

DOWNLOAD_DIR = Path(os.environ.get("DOWNLOAD_DIR", str(Path.home() / "Downloads")))
BACKEND_API_URL = os.environ.get("BACKEND_API_URL", "http://localhost:3000/api").rstrip(
    "/"
)
ENEL_INTERNAL_TOKEN = os.environ.get("ENEL_INTERNAL_TOKEN", "")
# MultiExtrator do desktop (ExtratorPlumber): sem token interno, mas com o JWT
# do login — usa as rotas /desktop/* (mesmo efeito das /internal/*). Rotas sem
# espelho (ex.: faturasextraidas — o PDF vai pelo MSEWeb Sync) sao puladas.
BACKEND_BEARER_TOKEN = os.environ.get("BACKEND_BEARER_TOKEN", "")
_ROTAS_DESKTOP = {
    "/enel/internal/logextracao": "/enel/desktop/logextracao",
    "/ucs/internal/from-enel": "/ucs/desktop/from-enel",
    "/ucs/internal/fora-agrupamento-corporativo": "/ucs/desktop/fora-agrupamento-corporativo",
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
HEADLESS = os.environ.get("HEADLESS", "false").lower() in ("1", "true", "yes")

# Resposta do "Imprimir": a própria SegundaViaGa.aspx com um
# <script>window.open('https://nrg-ceara.enel.com/purl/<id>')</script> — o PDF
# abriria numa aba nova, que o Firefox bloqueia por não vir de um clique.
WINDOW_OPEN_PDF_RE = re.compile(
    r"""window\.open\(\s*['"](https?://[^'"]+/purl/[^'"]+)['"]""",
    re.IGNORECASE,
)

IMPRIMIR_BLOQUEADO_MSG = (
    "Não será possível imprimir sua fatura nesse momento. "
    "Por favor, entre em contato com o seu executivo de atendimento"
)

BATCH_MODE = False
_stopped = False
_paused = False


class ImprimirBloqueadoError(RuntimeError):
    def __init__(self, message: str = IMPRIMIR_BLOQUEADO_MSG):
        super().__init__(message)


class UcForaDoAgrupamentoError(RuntimeError):
    def __init__(self, uc: str):
        self.uc = uc
        super().__init__(f"UC {uc} não está no agrupamento.")


def emit(event: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(event, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def is_stopped() -> bool:
    return _stopped


def wait_if_paused() -> None:
    while _paused and not _stopped:
        time.sleep(0.3)

DELTA_TYPES = (
    "updatePanel",
    "hiddenField",
    "asyncPostBackControlIDs",
    "postBackControlIDs",
    "updatePanelIDs",
    "childUpdatePanelIDs",
    "panelsToRefreshIDs",
    "asyncPostBackTimeout",
    "formAction",
    "pageRedirect",
    "error",
    "pageTitle",
    "scriptBlock",
    "dataItem",
    "dataItemJson",
    "arrayDeclaration",
    "expando",
    "onSubmit",
)


def log(msg: str, log_type: str = "info") -> None:
    if BATCH_MODE:
        emit(
            {
                "type": "log",
                "message": msg,
                "logType": log_type,
                "flow": "corporativo",
            }
        )
    else:
        try:
            print(msg, flush=True)
        except UnicodeEncodeError:
            enc = getattr(sys.stdout, "encoding", None) or "ascii"
            print(
                msg.encode(enc, errors="replace").decode(enc, errors="replace"),
                flush=True,
            )


def set_progress(step: str) -> None:
    if BATCH_MODE:
        emit({"type": "progress", "step": step, "flow": "corporativo"})


def post_backend(pathname: str, body: dict[str, Any], timeout: float = 15) -> dict | None:
    rota = _rota_backend(pathname)
    if rota is None:
        if not backend_integrado():
            log(
                "⚠ ENEL_INTERNAL_TOKEN não configurado; integração com backend ignorada.",
                "warn",
            )
        return None
    url = f"{BACKEND_API_URL}{rota[0]}"
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        method="POST",
        headers={"Content-Type": "application/json", **rota[1]},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")[:300]
        raise RuntimeError(f"Backend {pathname} HTTP {e.code}: {detail}") from e


def fetch_log_extracao_existentes(uc: str) -> list[dict[str, Any]]:
    """GET /enel/internal/logextracao — nível 0 vs JSON da 2ª via (validação)."""
    rota = _rota_backend("/enel/internal/logextracao")
    if rota is None:
        return []
    url = f"{BACKEND_API_URL}{rota[0]}?uc={urllib.parse.quote(digits(str(uc)))}"
    req = urllib.request.Request(url, method="GET", headers=rota[1])
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            raw = resp.read().decode("utf-8")
            data = json.loads(raw) if raw else []
            return data if isinstance(data, list) else []
    except Exception as e:
        log(f"⚠ UC {uc}: falha ao consultar logextracao existente: {e}", "warn")
        return []


def _situacao_cancelada(value: str) -> bool:
    n = unicodedata.normalize("NFD", value or "")
    n = "".join(ch for ch in n if unicodedata.category(ch) != "Mn").strip().lower()
    n = re.sub(r"\s+", " ", n)
    return n.startswith("cancelad")


def refs_precisam_pdf_refaturamento_corp(
    invoices: list[dict[str, Any]], existentes: list[dict[str, Any]]
) -> set[str]:
    """Meses com divergência Valor/Vencimento vs nível 0 ou par Cancelada+atual."""
    need: set[str] = set()
    por_ref: dict[str, list[dict[str, Any]]] = {}
    for inv in invoices:
        chave = ref_key(str(inv.get("reference") or ""))
        if not chave:
            continue
        por_ref.setdefault(chave, []).append(inv)
    for ref_chave, invs in por_ref.items():
        canceladas = []
        nao_canc = []
        for inv in invs:
            cells = inv.get("cells") or []
            sit = cells[3] if len(cells) > 3 else ""
            if _situacao_cancelada(sit):
                canceladas.append(inv)
            else:
                nao_canc.append(inv)
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
        cells = atual.get("cells") or []
        valor = cells[2] if len(cells) > 2 else ""
        venc = cells[1] if len(cells) > 1 else ""
        if str(nivel0.get("valor") or "").strip() != str(valor).strip() or str(
            nivel0.get("vencimento") or ""
        ).strip() != str(venc).strip():
            need.add(ref_chave)
    return need


def register_extracted_file(file_name: str) -> None:
    try:
        posted = post_backend("/enel/internal/faturasextraidas", {"nome": file_name})
        if posted is not None:
            log(f"✔ Arquivo registrado no backend: {file_name}", "success")
    except Exception as e:
        log(f"⚠ Falha ao registrar arquivo no backend: {e}", "warn")


def _camoufox_browser_installed() -> bool:
    try:
        from camoufox.multiversion import get_active_path

        return get_active_path() is not None
    except Exception:
        pass
    try:
        from camoufox.pkgman import camoufox_path

        camoufox_path(download_if_missing=False)
        return True
    except Exception:
        return False


def ensure_camoufox_browser() -> None:
    if _camoufox_browser_installed():
        return
    log("[camoufox] baixando official/stable...")
    result = subprocess.run(
        [sys.executable, "-m", "camoufox", "fetch"],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    if result.returncode != 0 or not _camoufox_browser_installed():
        raise RuntimeError("Falha ao baixar o Camoufox. Rode: python -m camoufox fetch")


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


def _norm_msg(s: str) -> str:
    import unicodedata

    t = unicodedata.normalize("NFD", s or "")
    t = "".join(ch for ch in t if unicodedata.category(ch) != "Mn").casefold()
    return re.sub(r"\s+", " ", t).strip()


def _eh_imprimir_bloqueado(texto: str) -> bool:
    n = _norm_msg(texto)
    alvo = _norm_msg(IMPRIMIR_BLOQUEADO_MSG)
    return "nao sera possivel imprimir sua fatura" in n or n == alvo or alvo in n


def parse_delta(text: str) -> dict[str, Any]:
    """Parser do delta ASP.NET AJAX: `<len>|<type>|<id>|<content>|`."""
    s = text or ""
    if s.startswith("1|#|"):
        s = s[4:]
        if s.startswith("|"):
            s = s[1:]
    out: dict[str, Any] = {"fields": {}, "panels": {}, "redirect": None, "raw_types": []}
    type_alt = "|".join(DELTA_TYPES)
    pos = 0
    while True:
        m = re.search(rf"(?:^|\|)(\d+)\|({type_alt})\|", s[pos:])
        if not m:
            break
        length = int(m.group(1))
        typ = m.group(2)
        start = pos + m.end()
        id_end = s.find("|", start)
        if id_end < 0:
            break
        ident = s[start:id_end]
        content = s[id_end + 1 : id_end + 1 + length]
        pos = id_end + 1 + length
        out["raw_types"].append(typ)
        if typ == "hiddenField":
            out["fields"][ident] = content
        elif typ == "updatePanel":
            out["panels"][ident] = content
        elif typ == "pageRedirect":
            out["redirect"] = content
        elif typ == "formAction":
            out["form_action"] = content
        elif typ == "error":
            out["error"] = content
    return out


PARSE_FORM_JS = """(html) => {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const fields = {};
  for (const el of doc.querySelectorAll('input, select, textarea')) {
    if (!el.name) continue;
    const type = (el.type || '').toLowerCase();
    if ((type === 'checkbox' || type === 'radio') && !el.checked) continue;
    if (type === 'submit' || type === 'button' || type === 'image') continue;
    fields[el.name] = el.value == null ? '' : String(el.value);
  }
  const login = { user: null, pass: null, submit: null };
  for (const el of doc.querySelectorAll('input')) {
    if (!el.name) continue;
    const blob = `${el.id} ${el.name} ${el.type}`.toLowerCase();
    if (el.type === 'password' && !login.pass) login.pass = el.name;
    else if ((el.type === 'text' || el.type === 'email') && /user|login|usuario|email|mail/.test(blob) && !login.user)
      login.user = el.name;
    else if ((el.type === 'submit' || el.type === 'button' || el.type === 'image') && /ok|entrar|acessar|login/.test(blob) && !login.submit)
      login.submit = { name: el.name, value: el.value || 'Ok' };
  }
  const sm = doc.querySelector('[id*="ScriptManager"], [name*="ScriptManager"]');
  const units = [];
  const table = doc.querySelector('#CONTENT_gdEscolherClienteDoAgrupamento')
    || Array.from(doc.querySelectorAll('table')).find((t) =>
         /n[ºo]\\s*do\\s*cliente/i.test(t.innerText || '')
       );
  if (table) {
    for (const tr of table.querySelectorAll('tr')) {
      const tds = Array.from(tr.querySelectorAll('td'));
      if (!tds.length) continue;
      const uc = (tds[0].innerText || '').replace(/\\D/g, '');
      const cb = tr.querySelector('input[type="checkbox"]');
      if (!uc || !cb) continue;
      units.push({
        uc,
        name: cb.name || '',
        id: cb.id || '',
        checked: !!cb.checked,
        disabled: !!cb.disabled,
        principal: /principal/i.test(tr.getAttribute('title') || ''),
      });
    }
  }
  const invoices = [];
  for (const t of doc.querySelectorAll('table')) {
    const headers = Array.from(t.querySelectorAll('th, thead td')).map((c) => (c.innerText || '').trim());
    if (!headers.some((h) => /refer[êe]ncia/i.test(h))) continue;
    const refIdx = headers.findIndex((h) => /refer[êe]ncia/i.test(h));
    const rows = t.querySelectorAll('tr');
    rows.forEach((tr, index) => {
      const tds = Array.from(tr.querySelectorAll('td'));
      if (!tds.length) return;
      const cb = tr.querySelector('input[type="checkbox"]');
      const cells = tds.map((td) => (td.innerText || '').trim());
      invoices.push({
        index,
        reference: cells[refIdx] || cells[0] || '',
        cells,
        name: cb ? cb.name : '',
        id: cb ? cb.id : '',
        checked: !!(cb && cb.checked),
      });
    });
  }
  const buttons = [];
  for (const el of doc.querySelectorAll('input[type="submit"], input[type="button"], button, a[href*="__doPostBack"]')) {
    const text = (el.value || el.innerText || el.textContent || '').trim();
    if (!text) continue;
    buttons.push({
      tag: el.tagName.toLowerCase(),
      type: el.type || '',
      name: el.name || '',
      id: el.id || '',
      text,
      href: el.getAttribute('href') || '',
    });
  }
  const title = (doc.querySelector('title') && doc.querySelector('title').textContent) || '';
  const formEl = doc.querySelector('form');
  return {
    title,
    action: (formEl && (formEl.getAttribute('action') || '')) || '',
    scriptManager: sm ? (sm.getAttribute('name') || sm.id || '') : '',
    login,
    fields,
    units,
    invoices,
    buttons,
  };
}"""


MARK_ONE_INVOICE_JS = """(alvo) => {
  const table = document.querySelector('#CONTENT_gdHistoricoDeFaturamento');
  if (!table) return { ok: false, reason: 'sem tabela' };
  const leftover = document.getElementById('agencia-api-submitter');
  if (leftover) leftover.remove();

  function refKey(s) {
    const t = String(s || '').trim();
    let m = t.match(/(\\d{2})[\\/\\-.](\\d{4})/);
    if (m) return m[2] + '-' + m[1];
    m = t.match(/(\\d{4})[\\/\\-.](\\d{2})/);
    if (m) return m[1] + '-' + m[2];
    return t;
  }

  const wantId = String(alvo.id || '');
  const wantName = String(alvo.name || '');
  const wantKey = refKey(alvo.key || alvo.ref || '');

  const boxes = [];
  for (const cb of table.querySelectorAll('input[type="checkbox"]')) {
    cb.checked = false;
    cb.removeAttribute('checked');
    boxes.push({ id: cb.id || '', name: cb.name || '' });
  }

  let marked = null;
  for (const tr of table.querySelectorAll('tr')) {
    const tds = Array.from(tr.querySelectorAll('td'));
    const cb = tr.querySelector('input[type="checkbox"]');
    if (!cb || !tds.length) continue;
    const ref = (tds[0].innerText || '').trim();
    const match =
      (wantId && cb.id === wantId) ||
      (wantName && cb.name === wantName) ||
      (wantKey && refKey(ref) === wantKey);
    if (!match) continue;
    cb.checked = true;
    cb.setAttribute('checked', 'checked');
    marked = { id: cb.id || '', name: cb.name || '', ref, key: refKey(ref) };
    break;
  }

  const checked = Array.from(table.querySelectorAll('input[type="checkbox"]:checked')).map((cb) => ({
    id: cb.id || '',
    name: cb.name || '',
  }));
  const btn = document.getElementById('CONTENT_btnEmitirSegundaVia');
  const form = (btn && btn.form) || document.querySelector('form');
  if (!form) return { ok: false, reason: 'sem form', marked, checked, boxes: boxes.length };
  if (btn) {
    const extra = document.createElement('input');
    extra.type = 'hidden';
    extra.name = btn.name;
    extra.value = btn.value || 'Imprimir';
    extra.id = 'agencia-api-submitter';
    form.appendChild(extra);
  }
  return {
    ok: !!marked && checked.length === 1,
    reason: marked ? (checked.length === 1 ? '' : 'mais de um checkbox marcado') : 'referencia nao encontrada',
    marked,
    checked,
    boxes: boxes.length,
    action: form.getAttribute('action') || '',
  };
}"""


SUBMIT_FORM_JS = """({ url, fields, target }) => {
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = url;
  form.target = target || '_self';
  form.style.display = 'none';
  for (const [key, value] of Object.entries(fields || {})) {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = key;
    input.value = value == null ? '' : String(value);
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
}"""


def encode_form(data: dict[str, str]) -> str:
    from urllib.parse import quote

    parts = []
    for key, value in data.items():
        parts.append(f"{quote(str(key), safe='')}={quote(str(value), safe='')}")
    return "&".join(parts)


class AgenciaClient:
    def __init__(self, page):
        self.page = page
        self.html = ""
        self.url = ""
        self.form: dict[str, Any] = {}

    def http(self, url: str, method: str = "GET", data: dict[str, str] | None = None, ajax: bool = False) -> dict[str, Any]:
        body = encode_form(data) if data else None
        log(f"[http] {method} {url}" + ("  ajax" if ajax else "") + (f"  fields={len(data)}" if data else ""))
        headers: dict[str, str] = {
            "Referer": self.page.url or url,
        }
        if "eneldistribuicao.com.br" in url:
            headers["Origin"] = "https://www.eneldistribuicao.com.br"
        if body:
            headers["Content-Type"] = "application/x-www-form-urlencoded; charset=UTF-8"
        if ajax:
            headers["X-Requested-With"] = "XMLHttpRequest"
            headers["X-MicrosoftAjax"] = "Delta=true"
            headers["Cache-Control"] = "no-cache"
            headers["Accept"] = "*/*"
        else:
            headers["Accept"] = (
                "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
            )
        # page.request usa o cookie jar do Camoufox sem cruzar TypedArray/Xrays
        # (o fetch() via page.evaluate + Uint8Array derrubava o login).
        res = request_fetch(
            self.page,
            url,
            method=method,
            data=body,
            headers=headers,
        )
        n_bytes = len(res.get("raw") or res.get("bytes") or [])
        log(f"[http] {res.get('status')} {res.get('url')}  {res.get('ct')}  {n_bytes} bytes")
        if res.get("raw") and (res["raw"].startswith(b"%PDF") or "pdf" in str(res.get("ct") or "").lower()):
            self.form["_pdf"] = list(res["raw"])
        return res

    def parse(self, html: str) -> dict[str, Any]:
        self.html = html
        self.form = safe_evaluate(self.page, PARSE_FORM_JS, html) or {}
        return self.form

    def hidden(self) -> dict[str, str]:
        fields = dict(self.form.get("fields") or {})
        drop = []
        for key in fields:
            low = key.lower()
            if "password" in low or "username" in low:
                drop.append(key)
        for key in drop:
            fields.pop(key, None)
        return fields

    def apply_delta(self, text: str) -> dict[str, Any]:
        delta = parse_delta(text)
        fields = self.form.setdefault("fields", {})
        fields.update(delta.get("fields") or {})
        panels = delta.get("panels") or {}
        if panels:
            fragment = next(iter(panels.values()))
            parsed = safe_evaluate(
                self.page, PARSE_FORM_JS, f"<html><body>{fragment}</body></html>"
            ) or {}
            if parsed.get("units"):
                self.form["units"] = parsed["units"]
            if parsed.get("invoices"):
                self.form["invoices"] = parsed["invoices"]
            self.html = fragment
        if delta.get("error"):
            raise RuntimeError(f"Erro ASP.NET AJAX: {delta['error'][:300]}")
        return delta

    def login(self, user: str, password: str) -> None:
        log(f"[1] GET login {LOGIN_URL}")
        self.page.goto(LOGIN_URL, wait_until="domcontentloaded", timeout=60_000)
        time.sleep(1.2)
        html = self.page.content()
        self.url = self.page.url
        self.parse(html)
        login = self.form.get("login") or {}
        user_name = login.get("user") or "WEBDOOR$headercorporativo$UserName"
        pass_name = login.get("pass") or "WEBDOOR$headercorporativo$Password"
        submit = login.get("submit") or {"name": "WEBDOOR$headercorporativo$Ok", "value": "Ok"}
        log(f"[1] campos login: user={user_name} pass={pass_name} submit={submit.get('name')}")

        payload = self.hidden()
        payload[user_name] = user
        payload[pass_name] = password
        payload[submit["name"]] = submit.get("value") or "Ok"
        payload.setdefault("__EVENTTARGET", "")
        payload.setdefault("__EVENTARGUMENT", "")

        res = self.http(LOGIN_URL, "POST", payload, ajax=False)
        body = res.get("text") or ""
        final_url = res.get("url") or ""
        if "/agencia/DefaultGa.aspx" not in final_url and "DefaultGa" not in body:
            if "senha" in body.lower() and "inválid" in body.lower():
                raise RuntimeError("Login recusado (usuário/senha).")
            # fetch já seguiu o 302; se ainda estamos no corporativo, tenta GET da home
            res = self.http(HOME_URL, "GET")
            body = res.get("text") or ""
            final_url = res.get("url") or HOME_URL
        self.url = final_url
        self.parse(body)
        log(f"[1] logado em {self.url}  unidades={len(self.form.get('units') or [])}")
        self.screenshot()

    def select_unit(self, uc: str) -> None:
        alvo = digits(uc)
        units = self.form.get("units") or []
        if not units:
            res = self.http(HOME_URL, "GET")
            self.url = res.get("url") or HOME_URL
            self.parse(res.get("text") or "")
            units = self.form.get("units") or []
        log("[2] UCs: " + ", ".join(
            f"{u['uc']}{'*' if u.get('checked') else ''}" for u in units
        ))
        hit = next((u for u in units if u.get("uc") == alvo), None)
        if not hit:
            raise UcForaDoAgrupamentoError(alvo)
        if hit.get("checked"):
            log(f"[2] UC {alvo} já era a selecionada — sem POST.")
            return

        event_target = hit.get("name") or ""
        if not event_target:
            raise RuntimeError(f"Checkbox da UC {alvo} sem name/__EVENTTARGET.")

        sm = self.form.get("scriptManager") or "ctl00$ScriptManager1"
        sm = sm.replace("_", "$") if "$" not in sm else sm
        payload = self.hidden()
        payload["__EVENTTARGET"] = event_target
        payload["__EVENTARGUMENT"] = ""
        payload["__LASTFOCUS"] = ""
        payload["__ASYNCPOST"] = "true"
        payload[event_target] = "on"
        payload[sm] = f"ctl00$CONTENT$ctl00|{event_target}"

        log(f"[3] POST DefaultGa.aspx trocando para UC {alvo}  EVENTTARGET={event_target}")
        res = self.http(HOME_URL, "POST", payload, ajax=True)
        text = res.get("text") or ""
        if "|updatePanel|" in text or text.startswith("1|#|"):
            self.apply_delta(text)
        else:
            self.parse(text)
        units = self.form.get("units") or []
        hit = next((u for u in units if u.get("uc") == alvo), None)
        log("[3] UCs após POST: " + ", ".join(
            f"{u['uc']}{'*' if u.get('checked') else ''}" for u in units
        ))
        if hit and not hit.get("checked"):
            log("[3] aviso: checkbox ainda não veio checked; seguindo (sessão ASP.NET pode já ter a UC).")
        self.screenshot()

    def open_segunda_via(self) -> None:
        # Navegação GET real: o Imprimir exige Referer /agencia/SegundaViaGa.aspx
        # (Sec-Fetch-Mode: navigate). Não é clique — só posiciona a sessão.
        log(f"[4] GET {SEGUNDA_VIA_URL}")
        self.page.goto(SEGUNDA_VIA_URL, wait_until="domcontentloaded", timeout=60_000)
        time.sleep(0.8)
        html = self.page.content()
        self.url = self.page.url
        self.parse(html)
        log(f"[4] faturas={len(self.form.get('invoices') or [])}  botoes={[b.get('text') for b in (self.form.get('buttons') or [])[:8]]}")
        self.screenshot()

    def _fechar_abas_extras(self) -> None:
        try:
            for popup in list(self.page.context.pages):
                if popup is self.page:
                    continue
                try:
                    popup.close()
                except Exception:
                    pass
        except Exception:
            pass

    def _ensure_segunda_via(self) -> None:
        """Recarrega a grade da 2ª via — todos os checks voltam desmarcados."""
        self._fechar_abas_extras()
        self.open_segunda_via()

    def download_invoice(self, referencia: str, uc: str) -> Path:
        # Sempre volta à grade e marca só ESTE mês. O POST de Imprimir navega
        # embora; o próximo mês não pode herdar checkbox da fatura anterior.
        self._ensure_segunda_via()
        if self.form.get("_pdf"):
            return self._save_pdf(bytes(self.form["_pdf"]), uc, referencia)

        alvo = ref_key(referencia)
        invoices = self.form.get("invoices") or []
        log("[4] referências: " + ", ".join(
            f"{inv.get('reference') or '?'}{'*' if inv.get('checked') else ''}[{inv.get('name') or 'sem-name'}]"
            for inv in invoices[:20]
        ))
        hit = next((inv for inv in invoices if ref_key(inv.get("reference") or "") == alvo), None)
        if not hit:
            raise RuntimeError(f"Referência {referencia} ({alvo}) não encontrada na 2ª via.")

        log(
            f"[5] um check só: ref={hit.get('reference')} key={alvo} "
            f"chk={hit.get('id') or hit.get('name')}"
        )
        saved = self._submit_live_form_pdf(hit, uc, hit.get("reference") or referencia)
        if saved:
            return saved
        raise RuntimeError("POST SegundaViaGa.aspx (form vivo) não devolveu PDF.")

    def _submit_live_form_pdf(self, hit: dict[str, Any], uc: str, referencia: str) -> Path | None:
        captured: dict[str, Any] = {"bytes": None, "download": None, "docs": []}

        def on_response(response) -> None:
            try:
                headers = {str(k).lower(): str(v) for k, v in (response.headers or {}).items()}
                ct = headers.get("content-type", "").lower()
                cd = headers.get("content-disposition", "").lower()
                rtype = ""
                try:
                    rtype = response.request.resource_type
                except Exception:
                    rtype = ""
                if rtype in ("document", "xhr", "fetch") or "pdf" in ct or "pdf" in cd:
                    captured["docs"].append(f"{response.status} {ct} {response.url}")
                looks_pdf = "application/pdf" in ct or "pdf" in cd or (response.url or "").lower().endswith(".pdf")
                if looks_pdf and captured["bytes"] is None:
                    body = response.body()
                    if body and body.startswith(b"%PDF"):
                        captured["bytes"] = body
                        log(f"[5] PDF na rede ({len(body)} bytes) {response.url}")
            except Exception:
                pass

        def on_download(download) -> None:
            captured["download"] = download
            log(f"[5] evento download: {download.suggested_filename}")

        context = self.page.context
        context.on("response", on_response)
        self.page.on("download", on_download)
        try:
            info = safe_evaluate(
                self.page,
                MARK_ONE_INVOICE_JS,
                {
                    "id": hit.get("id") or "",
                    "name": hit.get("name") or "",
                    "ref": hit.get("reference") or referencia,
                    "key": ref_key(hit.get("reference") or referencia),
                },
            )
            log(
                f"[5] form vivo: marked={info.get('marked') if info else None} "
                f"checked={info.get('checked') if info else None} "
                f"boxes={info.get('boxes') if info else None} ok={info.get('ok') if info else None} "
                f"reason={info.get('reason') if info else 'sem retorno'}"
            )
            if not info or not info.get("ok"):
                raise RuntimeError(f"Não montei o form da 2ª via (um check só): {info}")
            if len(info.get("checked") or []) != 1:
                raise RuntimeError(
                    f"Checkbox da 2ª via não ficou exclusivo: {info.get('checked')}"
                )

            try:
                with self.page.expect_navigation(timeout=25_000, wait_until="domcontentloaded"):
                    self.page.evaluate(
                        """() => {
                          const form = document.querySelector('form');
                          form.submit();
                        }"""
                    )
            except Exception as exc:
                log(f"[5] navigation: {exc}")

            log(f"[5] url agora: {self.page.url}")
            for line in captured["docs"][-12:]:
                log(f"[5] resp {line}")

            if captured.get("bytes"):
                return self._save_pdf(captured["bytes"], uc, referencia)
            saved = self._baixar_pdf_aba_nova(uc, referencia)
            if saved:
                return saved

            deadline = time.time() + 20
            while time.time() < deadline:
                if captured.get("bytes"):
                    return self._save_pdf(captured["bytes"], uc, referencia)
                dl = captured.get("download")
                if dl is not None:
                    DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)
                    name = f"{ref_slug(ref_key(referencia))} - {digits(uc)}.pdf"
                    target = DOWNLOAD_DIR / name
                    if target.exists():
                        target.unlink()
                    dl.save_as(str(target))
                    log(f"[5] PDF via download: {target}")
                    return target
                self.page.wait_for_timeout(400)

            if captured.get("bytes"):
                return self._save_pdf(captured["bytes"], uc, referencia)

            try:
                html = self.page.content()
                dump = DOWNLOAD_DIR / "agencia_segunda_via_last.html"
                dump.write_text(html, encoding="utf-8", errors="replace")
                modal = safe_evaluate(
                    self.page,
                    """() => {
                      const el = document.querySelector('#lblModalBody');
                      const text = (el && (el.innerText || el.textContent) || '').trim();
                      const dlg = document.querySelector('#dialogo');
                      const visible = !!(dlg && (dlg.style.display === 'block' || dlg.classList.contains('in')));
                      return { text, visible };
                    }""",
                )
                log(f"[5] HTML salvo em {dump} título={self.page.title()!r} modal={modal}")
                if captured.get("bytes"):
                    return self._save_pdf(captured["bytes"], uc, referencia)
                if modal and (modal.get("visible") or modal.get("text")):
                    texto = str(modal.get("text") or "")
                    if _eh_imprimir_bloqueado(texto):
                        raise ImprimirBloqueadoError()
                    raise RuntimeError(
                        f"Enel recusou a impressão: {texto or 'modal sem texto'}"
                    )
            except (RuntimeError, ImprimirBloqueadoError):
                raise
            except Exception:
                pass
        finally:
            try:
                context.remove_listener("response", on_response)
            except Exception:
                pass
            try:
                self.page.remove_listener("download", on_download)
            except Exception:
                pass
        return None

    def _baixar_pdf_aba_nova(self, uc: str, referencia: str) -> Path | None:
        """PDF que o "Imprimir" manda abrir em aba nova (window.open → /purl/)."""
        urls: list[str] = []
        try:
            urls.extend(WINDOW_OPEN_PDF_RE.findall(self.page.content()))
        except Exception as exc:
            log(f"[5] não li o HTML pós-Imprimir: {exc}")
        for popup in list(self.page.context.pages):
            if popup is self.page:
                continue
            popup_url = popup.url or ""
            if popup_url.startswith("http"):
                urls.append(popup_url)

        for url in dict.fromkeys(urls):
            log(f"[5] PDF em aba nova: {url}")
            try:
                res = request_fetch(self.page, url)
            except Exception as exc:
                log(f"[5] falha ao baixar {url}: {exc}", "warn")
                continue
            raw = res.get("raw") or b""
            if raw.startswith(b"%PDF"):
                self._fechar_abas_extras()
                return self._save_pdf(raw, uc, referencia)
            log(f"[5] {url} não devolveu PDF ({res.get('status')} {res.get('ct')})", "warn")
        return None

    def _submit_and_capture_pdf(self, url: str, fields: dict[str, str], uc: str, referencia: str) -> Path | None:
        captured: dict[str, Any] = {"bytes": None, "download": None, "docs": []}
        main_pages = set(self.page.context.pages)

        def on_response(response) -> None:
            try:
                headers = {str(k).lower(): str(v) for k, v in (response.headers or {}).items()}
                ct = headers.get("content-type", "").lower()
                cd = headers.get("content-disposition", "").lower()
                rtype = ""
                try:
                    rtype = response.request.resource_type
                except Exception:
                    rtype = ""
                if rtype in ("document", "xhr", "fetch") or "pdf" in ct or "pdf" in cd:
                    captured["docs"].append(f"{response.status} {ct} {response.url}")
                looks_pdf = "application/pdf" in ct or "pdf" in cd or (response.url or "").lower().endswith(".pdf")
                if looks_pdf and captured["bytes"] is None:
                    body = response.body()
                    if body and body.startswith(b"%PDF"):
                        captured["bytes"] = body
                        log(f"[5] PDF na rede ({len(body)} bytes) {response.url}")
            except Exception:
                pass

        def on_download(download) -> None:
            captured["download"] = download
            log(f"[5] evento download: {download.suggested_filename}")

        context = self.page.context
        context.on("response", on_response)
        self.page.on("download", on_download)
        try:
            log(f"[5] submit _self {url}")
            try:
                with self.page.expect_navigation(timeout=25_000, wait_until="domcontentloaded"):
                    self.page.evaluate(
                        SUBMIT_FORM_JS,
                        {"url": url, "fields": fields, "target": "_self"},
                    )
            except Exception as exc:
                log(f"[5] navigation: {exc}")
                self.page.evaluate(
                    SUBMIT_FORM_JS,
                    {"url": url, "fields": fields, "target": "_self"},
                )
                time.sleep(2)

            log(f"[5] url agora: {self.page.url}")
            for line in captured["docs"][-12:]:
                log(f"[5] resp {line}")

            deadline = time.time() + 12
            while time.time() < deadline:
                if captured.get("bytes"):
                    return self._save_pdf(captured["bytes"], uc, referencia)
                dl = captured.get("download")
                if dl is not None:
                    DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)
                    name = f"{ref_slug(ref_key(referencia))} - {digits(uc)}.pdf"
                    target = DOWNLOAD_DIR / name
                    if target.exists():
                        target.unlink()
                    dl.save_as(str(target))
                    log(f"[5] PDF via download: {target}")
                    return target
                for popup in list(context.pages):
                    if popup in main_pages:
                        continue
                    log(f"[5] aba extra: {popup.url}")
                    try:
                        fetched = request_fetch(popup, popup.url or "")
                        raw = fetched.get("raw") or b""
                        if raw.startswith(b"%PDF"):
                            return self._save_pdf(raw, uc, referencia)
                    except Exception as exc:
                        log(f"[5] popup fetch: {exc}")
                time.sleep(0.4)

            # Último recurso: a página atual pode ser a fatura em HTML.
            try:
                html = self.page.content()
                dump = DOWNLOAD_DIR / "agencia_segunda_via_last.html"
                dump.write_text(html, encoding="utf-8", errors="replace")
                log(f"[5] HTML atual salvo em {dump} título={self.page.title()!r}")
            except Exception:
                pass
        finally:
            try:
                context.remove_listener("response", on_response)
            except Exception:
                pass
            try:
                self.page.remove_listener("download", on_download)
            except Exception:
                pass
        return None

    def _save_pdf(self, data: bytes, uc: str, referencia: str) -> Path:
        DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)
        name = f"{ref_slug(ref_key(referencia))} - {digits(uc)}.pdf"
        path = DOWNLOAD_DIR / name
        if path.exists():
            path.unlink()
        path.write_bytes(data)
        log(f"[5] PDF salvo: {path} ({len(data)} bytes)", "success")
        register_extracted_file(path.name)
        return path

    def persist_invoices(self, uc: str) -> None:
        items = []
        for inv in self.form.get("invoices") or []:
            cells = inv.get("cells") or []
            referencia = inv.get("reference") or ""
            if not referencia:
                continue
            items.append(
                {
                    "uc": digits(uc),
                    "leitura": "-",
                    "referencia": referencia,
                    "consumoKwh": "-",
                    "vencimento": cells[1] if len(cells) > 1 else "",
                    "tipo": "Corporativo",
                    "valor": cells[2] if len(cells) > 2 else "",
                    "situacao": cells[3] if len(cells) > 3 else "",
                }
            )
        if not items:
            return
        try:
            posted = post_backend("/enel/internal/logextracao", {"items": items})
            if posted is not None:
                log(f"✔ {len(items)} linha(s) enviadas para logextracao.", "success")
        except Exception as e:
            log(f"⚠ Falha ao enviar logextracao: {e}", "warn")

    def screenshot(self) -> None:
        if not BATCH_MODE:
            return
        try:
            data = self.page.screenshot(type="jpeg", quality=40, full_page=False)
            b64 = (
                base64.b64encode(data).decode("ascii")
                if isinstance(data, (bytes, bytearray))
                else str(data)
            )
            emit({"type": "screenshot", "data": b64, "flow": "corporativo"})
            emit({"type": "url", "value": self.page.url})
        except Exception:
            pass

    def goto_home(self) -> None:
        self.page.goto(HOME_URL, wait_until="domcontentloaded", timeout=60_000)
        time.sleep(0.6)
        self.parse(self.page.content())
        self.screenshot()


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


def current_ref() -> str:
    now = datetime.now()
    return f"{now.month:02d}/{now.year}"


def group_items(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    groups: list[dict[str, Any]] = []
    index: dict[str, int] = {}
    for item in items:
        user = str(item.get("user") or "").strip()
        password = str(item.get("pass") or "")
        key = f"{user}\0{password}"
        if key not in index:
            index[key] = len(groups)
            groups.append({"user": user, "pass": password, "entries": []})
        groups[index[key]]["entries"].append(item)
    return groups


def emit_corp_result(
    user: str,
    numero: str,
    status: str,
    message: str | None = None,
    file_name: str | None = None,
    referencia: str | None = None,
) -> None:
    event: dict[str, Any] = {
        "type": "corp_item_result",
        "user": user,
        "numeroCliente": numero,
        "status": status,
        "flow": "corporativo",
    }
    if message:
        event["message"] = message
    if file_name:
        event["fileName"] = file_name
    if referencia:
        event["referencia"] = referencia
    emit(event)


def marcar_uc_manual_fora_agrupamento(uc: str) -> None:
    """A conta não enxerga a UC: ela vai para Manual em /ucs, para a rotina
    não tentar de novo pelo Corporativo."""
    numero = digits(uc)
    if not numero:
        return
    try:
        resposta = post_backend(
            "/ucs/internal/fora-agrupamento-corporativo", {"numero_cliente": numero}
        )
    except Exception as e:
        log(f"⚠ Falha ao mudar a UC {numero} para Manual: {e}", "warn")
        return
    if resposta and resposta.get("atualizadas"):
        log(
            f"✔ UC {numero} mudou para extração Manual em /ucs (fora do agrupamento Corporativo).",
            "warn",
        )


def run_batch(payload: dict[str, Any]) -> int:
    global BATCH_MODE
    BATCH_MODE = True
    items = list(payload.get("items") or [])
    if not items:
        raise SystemExit("Payload sem items")
    start_stdin_listener()
    ensure_camoufox_browser()
    groups = group_items(items)
    set_progress("corp_start")
    log(
        f"🌐 Iniciando extração Corporativo (Agência): {len(items)} unidade(s) em {len(groups)} conta(s)...",
        "info",
    )
    headless = HEADLESS
    exit_code = 0
    with open_camoufox(headless=headless, extra_prefs=firefox_download_prefs()) as browser:
        page = browser.new_page()
        attach_trawl_init_script(page)
        client = AgenciaClient(page)
        for g, group in enumerate(groups):
            if is_stopped():
                break
            wait_if_paused()
            user = group["user"]
            password = group["pass"]
            entries = group["entries"]
            set_progress("corp_login")
            log(f"📋 Conta {g + 1}/{len(groups)}: {user} ({len(entries)} item(ns))", "info")
            try:
                client.login(user, password)
            except Exception as e:
                exit_code = 2
                msg = str(e)
                log(f"✘ Login falhou ({user}): {msg}", "error")
                for item in entries:
                    emit_corp_result(
                        user,
                        str(item.get("numeroCliente") or ""),
                        "error",
                        msg,
                        referencia=str(item.get("referencia") or "") or None,
                    )
                continue

            set_progress("corp_private_area")
            by_uc: dict[str, list[dict[str, Any]]] = {}
            for item in entries:
                uc = digits(str(item.get("numeroCliente") or ""))
                by_uc.setdefault(uc, []).append(item)

            for uc, uc_items in by_uc.items():
                if is_stopped():
                    break
                wait_if_paused()
                set_progress("corp_unidade")
                try:
                    client.goto_home()
                    client.select_unit(uc)
                    set_progress("corp_segunda_via")
                    client.open_segunda_via()
                    existentes_antes = fetch_log_extracao_existentes(uc)
                    client.persist_invoices(uc)
                    refs_refaturamento = refs_precisam_pdf_refaturamento_corp(
                        list(client.form.get("invoices") or []),
                        existentes_antes,
                    )
                except Exception as e:
                    exit_code = 2
                    msg = str(e)
                    log(f"✘ UC {uc}: {msg}", "error")
                    if isinstance(e, UcForaDoAgrupamentoError):
                        marcar_uc_manual_fora_agrupamento(uc)
                    for item in uc_items:
                        emit_corp_result(
                            user,
                            uc,
                            "error",
                            msg,
                            referencia=str(item.get("referencia") or "") or None,
                        )
                    continue

                so_validacao = all(item.get("somenteSituacao") for item in uc_items)
                if so_validacao and refs_refaturamento:
                    log(
                        f"↻ UC {uc}: validação detectou divergência em "
                        f"{', '.join(sorted(refs_refaturamento))} — refaturamento (PDF).",
                    )
                    for ref_chave in sorted(refs_refaturamento):
                        if is_stopped():
                            break
                        wait_if_paused()
                        set_progress("corp_download")
                        try:
                            path = client.download_invoice(ref_chave, uc)
                            emit_corp_result(
                                user,
                                uc,
                                "downloaded",
                                file_name=path.name,
                                referencia=ref_chave,
                            )
                        except ImprimirBloqueadoError:
                            log(IMPRIMIR_BLOQUEADO_MSG, "warn")
                            emit_corp_result(
                                user, uc, "atencao", IMPRIMIR_BLOQUEADO_MSG, referencia=ref_chave
                            )
                        except Exception as e:
                            msg = str(e)
                            if _eh_imprimir_bloqueado(msg):
                                log(IMPRIMIR_BLOQUEADO_MSG, "warn")
                                emit_corp_result(
                                    user,
                                    uc,
                                    "atencao",
                                    IMPRIMIR_BLOQUEADO_MSG,
                                    referencia=ref_chave,
                                )
                            else:
                                exit_code = 2
                                log(f"✘ UC {uc} {ref_chave}: {msg}", "error")
                                emit_corp_result(user, uc, "error", msg, referencia=ref_chave)
                    for item in uc_items:
                        if item.get("somenteSituacao"):
                            emit_corp_result(
                                user,
                                uc,
                                "downloaded",
                                "Situação conferida.",
                                referencia=str(item.get("referencia") or "") or None,
                            )
                    continue

                for item in uc_items:
                    if is_stopped():
                        break
                    wait_if_paused()
                    raw_ref = str(item.get("referencia") or "").strip() or current_ref()
                    if item.get("somenteSituacao"):
                        emit_corp_result(
                            user,
                            uc,
                            "downloaded",
                            "Situação conferida.",
                            referencia=raw_ref,
                        )
                        continue
                    set_progress("corp_download")
                    try:
                        path = client.download_invoice(raw_ref, uc)
                        emit_corp_result(
                            user,
                            uc,
                            "downloaded",
                            file_name=path.name,
                            referencia=raw_ref,
                        )
                    except ImprimirBloqueadoError:
                        log(IMPRIMIR_BLOQUEADO_MSG, "warn")
                        emit_corp_result(
                            user,
                            uc,
                            "atencao",
                            IMPRIMIR_BLOQUEADO_MSG,
                            referencia=raw_ref,
                        )
                    except Exception as e:
                        msg = str(e)
                        if _eh_imprimir_bloqueado(msg):
                            log(IMPRIMIR_BLOQUEADO_MSG, "warn")
                            emit_corp_result(
                                user,
                                uc,
                                "atencao",
                                IMPRIMIR_BLOQUEADO_MSG,
                                referencia=raw_ref,
                            )
                        else:
                            exit_code = 2
                            log(f"✘ UC {uc} {raw_ref}: {msg}", "error")
                            emit_corp_result(
                                user,
                                uc,
                                "error",
                                msg,
                                referencia=raw_ref,
                            )
            if g < len(groups) - 1 and not is_stopped():
                log("⏳ Próxima conta em 3s...", "info")
                time.sleep(3)

    set_progress("done")
    if is_stopped():
        log("🛑 Processamento interrompido.", "warn")
        emit({"type": "stopped", "flow": "corporativo"})
    else:
        log("✅ Todas as contas processadas!", "success")
        emit({"type": "done", "flow": "corporativo"})
    return 0 if not is_stopped() else 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Agência Enel via POST/GET (Camoufox só p/ Imperva)")
    parser.add_argument("--batch", nargs="?", const="-", help="JSON de lote (arquivo ou stdin)")
    parser.add_argument("--user", default=os.environ.get("AGENCIA_USER", ""))
    parser.add_argument("--password", default=os.environ.get("AGENCIA_PASS", ""))
    parser.add_argument("--uc", default=os.environ.get("AGENCIA_UC", ""))
    parser.add_argument(
        "--ref",
        nargs="+",
        default=None,
        help="Uma ou mais referências (MM/AAAA). Cada mês: um check, baixa, desmarca, próximo.",
    )
    parser.add_argument("--hold", type=float, default=20.0)
    parser.add_argument("--headless", action="store_true")
    args = parser.parse_args(argv)

    if args.batch is not None:
        if args.batch in ("", "-"):
            payload = json.loads(sys.stdin.read() or "{}")
        else:
            with open(args.batch, encoding="utf-8") as f:
                payload = json.load(f)
        return run_batch(payload)

    refs = list(args.ref or [])
    env_ref = os.environ.get("AGENCIA_REF", "")
    if not refs and env_ref:
        refs = [env_ref]
    if not args.user or not args.password or not args.uc or not refs:
        raise SystemExit("Informe --user --password --uc --ref (ou --batch).")

    ensure_camoufox_browser()
    log("Abrindo Camoufox só para sessão Imperva (fluxo 100% fetch)...")
    with open_camoufox(
        headless=args.headless or HEADLESS,
        extra_prefs=firefox_download_prefs(),
    ) as browser:
        page = browser.new_page()
        attach_trawl_init_script(page)
        client = AgenciaClient(page)
        client.login(args.user, args.password)
        client.select_unit(args.uc)
        client.open_segunda_via()
        client.persist_invoices(args.uc)
        for i, ref in enumerate(refs):
            log(f"[lote] mês {i + 1}/{len(refs)}: UC {args.uc} ref={ref} (um check por vez)")
            path = client.download_invoice(ref, args.uc)
            log(f"OK {path}")
        if args.hold > 0 and not args.headless and not HEADLESS:
            try:
                page.goto(SEGUNDA_VIA_URL, wait_until="domcontentloaded", timeout=30_000)
            except Exception:
                pass
            log(f"Janela aberta {args.hold:.0f}s para conferir...")
            time.sleep(args.hold)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
