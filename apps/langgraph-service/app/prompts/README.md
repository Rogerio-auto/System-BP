# Prompts do Agente LangGraph

## Fonte canônica (F9-S09)

Desde F9-S09, os prompts são lidos da tabela `prompt_versions` no banco de dados via
endpoint interno `GET /internal/prompts/active/:key` do backend Node.

**NÃO edite os arquivos `.md` desta pasta esperando que o agente use a versão nova.**
Use a UI de gerenciamento de prompts (F9-S05) para criar e ativar novas versões.

## Fluxo

```
UI (F9-S05) → INSERT prompt_versions (DB)
                 ↓
LangGraph → GET /internal/prompts/active/:key
           → load_active_prompt() [TTLCache 60s]
           → nós usam ActivePrompt.body como system message
```

## Arquivos `.md` (histórico)

Os arquivos `.md` nesta pasta são mantidos apenas para histórico e documentação.
Marcados com `# OBSOLETO desde F9-S09`.

| Arquivo                      | Key canônica              | Nó que usa                   |
| ---------------------------- | ------------------------- | ---------------------------- |
| `pre_attendance_classify.md` | `pre_attendance_classify` | `classify_intent.py`         |
| `pre_attendance_qualify.md`  | `pre_attendance_qualify`  | `qualify_credit_interest.py` |
| `simulation.md`              | `simulation`              | `generate_simulation.py`     |
| `pre_attendance_agent.md`    | `pre_attendance_agent`    | `agent_turn.py` (F16-S40)   |

## Loader

`app/prompts/loader.py` — `load_active_prompt(key: str) -> ActivePrompt`

- Cache TTL de 60s em processo (sem dependências externas).
- 404 → `PromptNotFoundError` → nó converte em `handoff_required=True`.
- Timeout → propaga `httpx.TimeoutException` → nó converte em handoff.
- Sem fallback para `.md` — quebra explícita é melhor que comportamento inconsistente.

## Migration de seed

`0031_seed_initial_prompts.sql` — insere as 3 keys iniciais como v1 ativa.
`0070_seed_pre_attendance_agent_prompt.sql` — insere `pre_attendance_agent` v1 ativa (F16-S39, Bloco B).
Idempotente: `ON CONFLICT DO NOTHING` na constraint `(key, version)`.
