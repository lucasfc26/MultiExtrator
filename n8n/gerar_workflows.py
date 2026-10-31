"""Gera os workflows n8n do MultiExtractor.

Uso: python n8n/gerar_workflows.py n8n/workflows

Editou um workflow pela interface do n8n? Exporte por cima do JSON em vez de
rodar isto de novo, ou leve a mudança para cá.
"""

import json
import sys
import uuid
from pathlib import Path

DEST = Path(sys.argv[1])
WORKER = "http://worker:8000"
CRED = {"httpHeaderAuth": {"id": "multiextractor-api-key", "name": "MultiExtractor API Key"}}
NS = uuid.UUID("5b8f7a52-0c3e-4f0e-9a51-6d1e2f3a4b5c")


def uid(*partes: str) -> str:
    return str(uuid.uuid5(NS, "/".join(partes)))


def webhook(wf: str, path: str, pos):
    return {
        "parameters": {
            "httpMethod": "POST",
            "path": path,
            "authentication": "headerAuth",
            "responseMode": "responseNode",
            "options": {},
        },
        "id": uid(wf, "webhook"),
        "name": "Receber pedido",
        "type": "n8n-nodes-base.webhook",
        "typeVersion": 2,
        "position": pos,
        "webhookId": uid(wf, "webhook-id"),
        "credentials": CRED,
    }


def http(wf: str, nome: str, metodo: str, url: str, corpo: str | None, pos):
    params = {
        "method": metodo,
        "url": url,
        "options": {
            # fullResponse: o status HTTP do worker (422 dados inválidos, 409...)
            # volta para quem chamou. neverError: 4xx/5xx não derrubam o fluxo.
            "response": {"response": {"fullResponse": True, "neverError": True}},
            # Fila + navegador + captcha: uma extração pode levar vários minutos.
            "timeout": 1_800_000,
        },
    }
    if corpo is not None:
        params.update({"sendBody": True, "specifyBody": "json", "jsonBody": corpo})
    return {
        "parameters": params,
        "id": uid(wf, nome),
        "name": nome,
        "type": "n8n-nodes-base.httpRequest",
        "typeVersion": 4.2,
        "position": pos,
        # Worker fora do ar: segue com `error` no item e responde 502.
        "onError": "continueRegularOutput",
    }


CORPO_RESPOSTA = (
    "={{ JSON.stringify($json.body ?? { status: 'erro', observacao: "
    "'Worker indisponível: ' + ($json.error?.message ?? 'sem resposta') }) }}"
)


def responder(wf: str, nome: str, pos, corpo: str = CORPO_RESPOSTA, codigo: str | int = "={{ $json.statusCode ?? 502 }}"):
    return {
        "parameters": {
            "respondWith": "json",
            "responseBody": corpo,
            "options": {"responseCode": codigo},
        },
        "id": uid(wf, nome),
        "name": nome,
        "type": "n8n-nodes-base.respondToWebhook",
        "typeVersion": 1.1,
        "position": pos,
    }


def se(wf: str, nome: str, esquerda: str, operador: dict, direita, pos):
    cond = {"id": uid(wf, nome, "cond"), "leftValue": esquerda, "operator": operador}
    if direita is not None:
        cond["rightValue"] = direita
    return {
        "parameters": {
            "conditions": {
                "options": {"caseSensitive": True, "leftValue": "", "typeValidation": "loose"},
                "conditions": [cond],
                "combinator": "and",
            },
            "options": {},
        },
        "id": uid(wf, nome),
        "name": nome,
        "type": "n8n-nodes-base.if",
        "typeVersion": 2,
        "position": pos,
    }


def nota(wf: str, nome: str, texto: str, pos, largura=520, altura=300):
    return {
        "parameters": {"content": texto, "height": altura, "width": largura},
        "id": uid(wf, nome),
        "name": nome,
        "type": "n8n-nodes-base.stickyNote",
        "typeVersion": 1,
        "position": pos,
    }


def ligar(*pares):
    """pares: (origem, saida, destino) → connections do n8n."""
    con: dict = {}
    for origem, saida, destino in pares:
        main = con.setdefault(origem, {"main": []})["main"]
        while len(main) <= saida:
            main.append([])
        main[saida].append({"node": destino, "type": "main", "index": 0})
    return con


def workflow(nome: str, nodes, connections):
    return {
        "name": nome,
        "nodes": nodes,
        "connections": connections,
        "active": False,
        "settings": {"executionOrder": "v1", "timezone": "America/Fortaleza"},
        "pinData": {},
        "tags": [],
    }


def sincrono(wf: str, titulo: str, path: str, rota: str, exemplo: dict, doc: str):
    entrada = json.dumps(exemplo, ensure_ascii=False, indent=2)
    texto = (
        f"## {titulo}\n\n{doc}\n\n"
        f"**POST** `/webhook/{path}`  \nHeader: a chave da credencial *MultiExtractor API Key*\n\n"
        f"```json\n{entrada}\n```\n\n"
        "Resposta: `status` = `sucesso` | `atencao` | `erro`, `observacao` e "
        "`arquivos[]` com `pdf_base64` de cada fatura."
    )
    nodes = [
        nota(wf, "Como usar", texto, [-80, -420], largura=560, altura=520),
        webhook(wf, path, [0, 160]),
        http(wf, "Extrair no worker", "POST", f"{WORKER}/extracoes/{rota}",
             "={{ JSON.stringify($json.body) }}", [240, 160]),
        responder(wf, "Responder resultado", [480, 160]),
    ]
    con = ligar(
        ("Receber pedido", 0, "Extrair no worker"),
        ("Extrair no worker", 0, "Responder resultado"),
    )
    return workflow(f"MultiExtractor — {titulo}", nodes, con)


SITE_ENEL = sincrono(
    "site-enel",
    "Site ENEL",
    "enel/site-enel",
    "site-enel",
    {"usuario": "login@empresa.com", "senha": "senha", "uc": "12345678",
     "referencia": "07/2026", "tipo_conta": "empresa"},
    "Login no Site ENEL (reCAPTCHA pelo **CapSolver**, chave no worker) e PDF "
    "da fatura pela API da área privada. `uc` opcional (sem ela, a conta padrão "
    "do login); `referencia` opcional (padrão: mês atual); `tipo_conta`: "
    "`empresa` | `residencial`.",
)

CORPORATIVO = sincrono(
    "corporativo",
    "Corporativo",
    "enel/corporativo",
    "corporativo",
    {"usuario": "login@empresa.com", "senha": "senha", "uc": "12345678", "referencia": "07/2026"},
    "Agência Virtual (Corporativo), sem captcha: login → troca para a UC do "
    "agrupamento → Segunda Via → PDF. `referencia` opcional (padrão: mês atual).",
)


def segunda_via():
    wf = "segunda-via"
    job_id = "{{ $('Iniciar no worker').first().json.body.job_id }}"
    pedir_codigo = (
        "={{ JSON.stringify({ ...$json.body, url_codigo: $execution.resumeUrl, "
        "como_enviar: 'POST url_codigo com {\"codigo\": \"123456\"} (ou {\"reenviar\": true} "
        "se o código não chegou), com o mesmo header de autenticação' }) }}"
    )
    texto = (
        "## 2 VIA ENEL (acesso rápido)\n\n"
        "hCaptcha pelo **NoneCap** (chave no worker) → UC + CPF/CNPJ → a ENEL "
        "envia um código de segurança ao cliente → PDF.\n\n"
        "**1.** POST `/webhook/enel/segunda-via`\n"
        "```json\n"
        + json.dumps({"uc": "12345678", "cpf_cnpj": "12345678000199",
                      "referencia": "07/2026", "email_segunda_via": "financeiro@cliente.com.br",
                      "canal": "email"}, ensure_ascii=False, indent=2)
        + "\n```\n"
        "Resposta **202** `status: aguardando_codigo` com `url_codigo`.\n\n"
        "**2.** POST na `url_codigo` (mesmo header) em até **10 min**:\n"
        "`{\"codigo\": \"123456\"}` — ou `{\"reenviar\": true}` se não chegou.\n"
        "Resposta: o resultado final (`sucesso` | `atencao` | `erro` + PDF) ou "
        "outro 202 se a ENEL recusar o código.\n\n"
        "Sem código em 10 min, a extração é cancelada."
    )
    nodes = [
        nota(wf, "Como usar", texto, [-80, -560], largura=620, altura=640),
        webhook(wf, "enel/segunda-via", [0, 200]),
        http(wf, "Iniciar no worker", "POST", f"{WORKER}/extracoes/segunda-via",
             "={{ JSON.stringify($json.body) }}", [220, 200]),
        se(wf, "Pediu código?", "={{ $json.body?.estado }}",
           {"type": "string", "operation": "equals"}, "aguardando_codigo", [440, 200]),
        responder(wf, "Pedir código", [680, 60], corpo=pedir_codigo, codigo=202),
        {
            "parameters": {
                "resume": "webhook",
                # No Wait o parâmetro é incomingAuthentication (no Webhook, authentication).
                "incomingAuthentication": "headerAuth",
                "httpMethod": "POST",
                "responseMode": "responseNode",
                "limitWaitTime": True,
                "limitType": "afterTimeInterval",
                "resumeAmount": 10,
                "resumeUnit": "minutes",
                "options": {},
            },
            "id": uid(wf, "Esperar código"),
            "name": "Esperar código",
            "type": "n8n-nodes-base.wait",
            "typeVersion": 1.1,
            "position": [900, 60],
            "webhookId": uid(wf, "wait-id"),
            "credentials": CRED,
        },
        # Retomado pela url_codigo: item do webhook (headers/query/body), sem
        # statusCode. Retomado pelo limite de 10 min: o item que entrou no
        # Wait (resposta do worker, com statusCode).
        se(wf, "Código chegou?", "={{ $json.statusCode === undefined }}",
           {"type": "boolean", "operation": "true", "singleValue": True}, None, [1120, 60]),
        http(wf, "Enviar código", "POST", f"={WORKER}/extracoes/{job_id}/codigo",
             "={{ JSON.stringify({ codigo: $json.body?.codigo != null ? String($json.body.codigo) : null, "
             "reenviar: $json.body?.reenviar === true }) }}", [1340, -40]),
        se(wf, "Pediu outro código?", "={{ $json.body?.estado }}",
           {"type": "string", "operation": "equals"}, "aguardando_codigo", [1560, -40]),
        responder(wf, "Pedir novo código", [1780, -180], corpo=pedir_codigo, codigo=202),
        http(wf, "Cancelar no worker", "DELETE", f"={WORKER}/extracoes/{job_id}", None, [1340, 200]),
        responder(wf, "Responder resultado", [1780, 340]),
    ]
    con = ligar(
        ("Receber pedido", 0, "Iniciar no worker"),
        ("Iniciar no worker", 0, "Pediu código?"),
        ("Pediu código?", 0, "Pedir código"),
        ("Pediu código?", 1, "Responder resultado"),
        ("Pedir código", 0, "Esperar código"),
        ("Esperar código", 0, "Código chegou?"),
        ("Código chegou?", 0, "Enviar código"),
        ("Código chegou?", 1, "Cancelar no worker"),
        ("Enviar código", 0, "Pediu outro código?"),
        ("Pediu outro código?", 0, "Pedir novo código"),
        ("Pediu outro código?", 1, "Responder resultado"),
        ("Pedir novo código", 0, "Esperar código"),
    )
    return workflow("MultiExtractor — 2 VIA ENEL", nodes, con)


DEST.mkdir(parents=True, exist_ok=True)
for arquivo, wf in (
    ("site-enel.json", SITE_ENEL),
    ("segunda-via-enel.json", segunda_via()),
    ("corporativo.json", CORPORATIVO),
):
    (DEST / arquivo).write_text(json.dumps(wf, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("ok", arquivo, len(wf["nodes"]), "nós")
