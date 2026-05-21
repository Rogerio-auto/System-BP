"""Visualização do grafo `whatsapp_pre_attendance` como diagrama Mermaid.

Endpoint utilitário **dev-only** que renderiza o grafo no browser usando a função
canônica do LangGraph (`get_graph().draw_mermaid()`). Útil para entender
visualmente o fluxo de nós e edges condicionais durante desenvolvimento e
revisão de PRs que mexem na topologia do grafo.

Sem autenticação (X-Internal-Token) por design — é dev tool consumida apenas
pelo browser do operador local em ``http://localhost:8000/graph``. Se um dia
o serviço LangGraph for exposto além de localhost, esta rota deve ser
gated por flag ou removida do bundle de produção.

LGPD: nenhum dado pessoal aqui — só topologia do grafo (nomes de nós e edges),
sem mensagens, sem estado de conversa.
"""

from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import HTMLResponse, PlainTextResponse

from app.graphs.whatsapp_pre_attendance.graph import build_graph, graph_version

router = APIRouter(tags=["dev"])


_HTML_TEMPLATE = """<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <title>Grafo whatsapp_pre_attendance @ v{version}</title>
  <style>
    :root {{
      --bg: #fafafa;
      --ink: #0a0a0a;
      --ink-2: #525252;
      --azul: #1B3A8C;
      --amarelo: #F4C430;
      --border: #e5e5e5;
    }}
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: var(--bg);
      color: var(--ink);
      padding: 24px;
    }}
    header {{
      max-width: 1200px;
      margin: 0 auto 24px;
      padding-bottom: 16px;
      border-bottom: 1px solid var(--border);
    }}
    h1 {{
      font-family: "Bricolage Grotesque", -apple-system, sans-serif;
      font-size: 2rem;
      font-weight: 800;
      margin: 0 0 4px;
      letter-spacing: -0.03em;
    }}
    h1 span.version {{
      font-family: "JetBrains Mono", monospace;
      font-size: 0.85rem;
      font-weight: 500;
      color: var(--ink-2);
      letter-spacing: 0;
      margin-left: 12px;
    }}
    p.meta {{
      color: var(--ink-2);
      margin: 0;
      font-size: 0.9rem;
    }}
    .diagram-container {{
      max-width: 1400px;
      margin: 0 auto;
      background: #fff;
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 32px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.04);
      overflow-x: auto;
    }}
    pre.mermaid {{
      margin: 0;
      background: transparent;
      font-family: "JetBrains Mono", monospace;
    }}
    nav {{
      max-width: 1200px;
      margin: 0 auto 16px;
      display: flex;
      gap: 12px;
      font-size: 0.85rem;
    }}
    nav a {{
      color: var(--azul);
      text-decoration: none;
      padding: 4px 12px;
      border: 1px solid var(--border);
      border-radius: 4px;
      background: #fff;
    }}
    nav a:hover {{ background: var(--azul); color: #fff; }}
  </style>
  <script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"></script>
</head>
<body>
  <header>
    <h1>Grafo whatsapp_pre_attendance <span class="version">{version}</span></h1>
    <p class="meta">Topologia atual do agente de pré-atendimento WhatsApp.
      Re-renderizado a cada request — sempre reflete o código deployado.</p>
  </header>
  <nav>
    <a href="/graph/mermaid">Ver source Mermaid (texto)</a>
    <a href="/health">Health</a>
  </nav>
  <div class="diagram-container">
    <pre class="mermaid">{mermaid_src}</pre>
  </div>
  <script>
    mermaid.initialize({{
      startOnLoad: true,
      theme: 'default',
      flowchart: {{ curve: 'basis', padding: 20 }},
      securityLevel: 'strict'
    }});
  </script>
</body>
</html>
"""


@router.get(
    "/graph",
    response_class=HTMLResponse,
    summary="Visualizar topologia do grafo (diagrama Mermaid renderizado)",
    description=(
        "Dev-only. Retorna HTML standalone com o diagrama do grafo "
        "`whatsapp_pre_attendance` renderizado via Mermaid.js. Sem autenticação — "
        "consumido apenas pelo browser local em ambiente de dev."
    ),
)
async def graph_diagram_html() -> HTMLResponse:
    graph = build_graph().compile()
    mermaid_src = graph.get_graph().draw_mermaid()
    html = _HTML_TEMPLATE.format(version=graph_version, mermaid_src=mermaid_src)
    return HTMLResponse(content=html)


@router.get(
    "/graph/mermaid",
    response_class=PlainTextResponse,
    summary="Source Mermaid do grafo (texto puro)",
    description=(
        "Retorna apenas a string Mermaid — útil para colar no mermaid.live, "
        "embedar em docs, ou diff em PRs que mexem na topologia."
    ),
)
async def graph_mermaid_source() -> PlainTextResponse:
    graph = build_graph().compile()
    return PlainTextResponse(content=graph.get_graph().draw_mermaid())
