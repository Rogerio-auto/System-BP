---
id: F9-S09
title: LangGraph lê prompts de prompt_versions (DB) em vez de arquivos .md
phase: F9
task_ref: T9.9
status: review
priority: high
estimated_size: M
agent_id: python-engineer
claimed_at: 2026-05-20T18:25:42Z
completed_at: 2026-05-20T19:17:55Z
pr_url:
depends_on: [F9-S01, F9-S08]
blocks: []
labels: []
source_docs:
  - docs/05-modulos-funcionais.md
  - docs/06-langgraph-agentes.md
  - docs/12-tasks-tecnicas.md
  - docs/17-lgpd-protecao-dados.md
---

# F9-S09 — Conectar LangGraph ao DB de prompts

## Objetivo

Fazer o LangGraph **ler prompts da tabela `prompt_versions` (DB) em vez dos arquivos `.md` em `apps/langgraph-service/app/prompts/`**, fechando o gap arquitetural pré-existente: hoje a UI F9-S05 escreve no DB mas o agente em runtime lê do filesystem — os dois sistemas estão completamente desconectados, então mexer pela UI não muda o comportamento do bot.

## Contexto

Identificado durante a auditoria de F9-S08 (commit `485af6e`). A função `_load_prompt()` em cada nó (`classify_intent.py`, `qualify_credit_interest.py`, `generate_simulation.py`) parseia frontmatter YAML de arquivos `.md` em `apps/langgraph-service/app/prompts/`. F9-S08 estendeu o frontmatter com `temperature`/`max_tokens`/`top_p` mas a leitura continua via filesystem.

O resultado: o operador cria nova versão de prompt pela UI → entra em `prompt_versions` no DB → **nunca chega no agente**. A feature de gestão de prompts (F9-S05) é uma ilusão funcional.

Esse slot resolve isso conectando os nós ao backend Node via endpoint `/internal/prompts/active/:key`.

## Escopo

### Backend (API Node)

- **Novo endpoint:** `GET /api/internal/prompts/active/:key` em `apps/api/src/modules/internal/prompts/` (criar módulo).
  - Header `X-Internal-Token` obrigatório.
  - Retorna a versão ativa (`active = true`) da `key`: `{ key, version, body, content_hash, model_recommended, temperature, max_tokens, top_p, prompt_version }` onde `prompt_version = "${key}@v${version}"`.
  - 404 se não houver versão ativa para a key.
  - Cache opcional `Cache-Control: max-age=60` ou ETag para reduzir round-trip; sem cache stateful.

### LangGraph (Python)

- **Novo módulo:** `apps/langgraph-service/app/prompts/loader.py` com função `async def load_active_prompt(key: str) -> ActivePrompt` que chama `GET /internal/prompts/active/:key` via `InternalApiClient`. Define `ActivePrompt` (Pydantic v2) com os 7 campos do response.
- **Cache em processo:** `LRU` simples (ou `cachetools.TTLCache` de 60s) para evitar um round-trip por turno conversacional. Invalidação só por TTL — não precisa de invalidation cross-process no MVP.
- **Atualizar 3 nós:** `classify_intent.py`, `qualify_credit_interest.py`, `generate_simulation.py` — substituir `_load_prompt()` (que lê `.md`) por `await load_active_prompt(key)`. Os campos `temperature/max_tokens/top_p` continuam vindo do prompt (agora do DB).
- **Comportamento de fallback:** se o endpoint retornar 404 ou timeout, o nó cai em `handoff_required=True` com `handoff_reason="prompt active version não encontrada para key=X"`. Sem fallback silencioso para `.md` — quebra é melhor que comportamento inconsistente.

### Schema sync

- Confirmar que `prompt_versions` no DB tem entries para as 3 keys atualmente em uso (`pre_attendance_classify`, `pre_attendance_qualify`, `simulation` — verificar nomes reais nos `.md`). Se não tiver, criar **seed** que insere a versão atual dos `.md` como `v1 active=true` na primeira execução. Idempotente.
- Migration NOVA `0031_seed_initial_prompts.sql` que INSERTs idempotentes (`ON CONFLICT DO NOTHING`) das 3 keys com o conteúdo atual dos arquivos `.md` como v1. Isso garante que após o merge, ao mudar o LangGraph para ler do DB, há prompts ativos.

### Limpeza

- **Não** delete os arquivos `.md` em `apps/langgraph-service/app/prompts/` neste slot — eles ficam como histórico/seed. Adicione comentário no topo de cada `.md`: `# OBSOLETO desde F9-S09 — fonte canônica em prompt_versions (DB). Mantido para histórico.`
- Atualize `apps/langgraph-service/app/prompts/README.md` (se existir) explicando o novo fluxo.

### Permissões

- Endpoint `/internal/prompts/active/:key` é internal (X-Internal-Token) — não exige RBAC do usuário. Documentar no PR.

## RBAC / Segurança

- Sem mudança no RBAC da UI (`ai_prompts:*` continua na API pública).
- Endpoint interno protegido por X-Internal-Token (timing-safe, como os outros).
- LGPD: `body` do prompt nunca contém PII por design (já validado em F9-S01 com regex defensiva). Sem mudança.

## Fora de escopo

- Hot-reload (cache invalidation por evento) — TTL 60s é suficiente para o MVP. Slot futuro se necessário.
- Migração dos prompts `.md` para fora do repo (Notion, Confluence, etc.) — backlog.
- Versionamento de prompts por organização (multi-tenancy de prompts) — backlog. Hoje prompts são globais.

## Arquivos permitidos

**Backend (API):**

- `apps/api/src/modules/internal/prompts/routes.ts`
- `apps/api/src/modules/internal/prompts/schemas.ts`
- `apps/api/src/modules/internal/prompts/repository.ts`
- `apps/api/src/modules/internal/prompts/__tests__/routes.test.ts`
- `apps/api/src/db/migrations/0031_seed_initial_prompts.sql`
- `apps/api/src/db/migrations/meta/_journal.json`

**LangGraph:**

- `apps/langgraph-service/app/prompts/loader.py`
- `apps/langgraph-service/app/graphs/whatsapp_pre_attendance/nodes/classify_intent.py`
- `apps/langgraph-service/app/graphs/whatsapp_pre_attendance/nodes/qualify_credit_interest.py`
- `apps/langgraph-service/app/graphs/whatsapp_pre_attendance/nodes/generate_simulation.py`
- `apps/langgraph-service/tests/prompts/test_loader.py`
- `apps/langgraph-service/tests/graphs/test_classify_intent.py` (ajustar testes existentes)
- `apps/langgraph-service/app/prompts/pre_attendance_classify.md` (apenas adicionar comentário OBSOLETO)
- `apps/langgraph-service/app/prompts/pre_attendance_qualify.md` (idem)
- `apps/langgraph-service/app/prompts/simulation.md` (idem)
- `apps/langgraph-service/app/prompts/README.md` (se existir — explicar novo fluxo)

## Definition of Done

- [ ] Endpoint `GET /api/internal/prompts/active/:key` responde 200 com payload completo e 404 quando ausente.
- [ ] Migration 0031 seeda as 3 keys atuais em `prompt_versions` com `active = true` (idempotente).
- [ ] `journal.json` sincronizado; `check-migrations` verde.
- [ ] `load_active_prompt()` busca do endpoint, parseia em `ActivePrompt`, cacheia 60s.
- [ ] Os 3 nós usam `load_active_prompt(key)` em vez de ler `.md`.
- [ ] Endpoint 404 ou timeout → nó cai em `handoff_required=True` com motivo legível.
- [ ] Após criar nova versão pela UI (F9-S05) e ativar, em até 60s o LangGraph passa a usar — testado E2E (manual ou integração).
- [ ] Cache TTL 60s validado por teste (mock de tempo).
- [ ] Sem regressão nos testes existentes; nós continuam tendo cobertura de erros.
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` (api) verdes.
- [ ] `ruff check`, `mypy app`, `pytest -q` (langgraph) verdes.

## Validação

```powershell
pnpm --filter @elemento/api db:migrate
python scripts/slot.py check-migrations
python scripts/slot.py validate F9-S09
cd apps/langgraph-service ; ruff check . ; mypy app ; pytest -q
```
