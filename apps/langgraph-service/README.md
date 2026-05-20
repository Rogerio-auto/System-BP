# apps/langgraph-service

Orquestração de agentes IA com LangGraph + FastAPI + Pydantic.

**Princípio inviolável:** este serviço NÃO acessa o banco. Toda leitura/escrita passa por endpoints `/internal/*` do backend Node, autenticados com `X-Internal-Token`.

Ver [docs/06-langgraph-agentes.md](../../docs/06-langgraph-agentes.md).

## Setup local (sem Docker)

### Linux/macOS

```bash
cd apps/langgraph-service
uv venv && source .venv/bin/activate   # ou: python -m venv .venv
pip install -e ".[dev]"
uvicorn app.main:app --reload --port 8000
```

### Windows (PowerShell)

Setup único:

```powershell
cd apps/langgraph-service
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.lock.txt
```

Subir o serviço (a cada vez):

```powershell
# Do root do repo:
pwsh apps/langgraph-service/dev.ps1
# Se a porta 8000 estiver presa de uma sessão anterior:
pwsh apps/langgraph-service/dev.ps1 -Force
```

O script `dev.ps1`:

1. Carrega as env vars do `.env` da raiz no processo (Pydantic Settings lê do env; o serviço não tem `.env` próprio — fonte única de segredos).
2. Valida que vars obrigatórias (`BACKEND_INTERNAL_URL`, `LANGGRAPH_INTERNAL_TOKEN`, `OPENROUTER_API_KEY`) estão setadas.
3. Checa se a porta 8000 está livre (informa o PID se ocupada; `-Force` derruba).
4. Sobe `uvicorn --reload`.

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
