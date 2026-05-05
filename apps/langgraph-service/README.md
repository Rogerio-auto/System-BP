# apps/langgraph-service

Orquestração de agentes IA com LangGraph + FastAPI + Pydantic.

**Princípio inviolável:** este serviço NÃO acessa o banco. Toda leitura/escrita passa por endpoints `/internal/*` do backend Node, autenticados com `X-Internal-Token`.

Ver [docs/06-langgraph-agentes.md](../../docs/06-langgraph-agentes.md).

## Setup local (sem Docker)

```bash
cd apps/langgraph-service
uv venv && source .venv/bin/activate   # ou: python -m venv .venv
pip install -e ".[dev]"
uvicorn app.main:app --reload --port 8000
```

## Estrutura

```
app/
├── main.py            # FastAPI bootstrap
├── config.py          # settings via Pydantic
├── api/               # endpoints (/health, /process, /assistant)
├── graphs/            # whatsapp_pre_attendance, internal_assistant
├── tools/             # tools que falam com /internal/* do backend
└── prompts/           # prompts versionados
tests/                 # pytest + respx
```
