---
id: F7-S03
title: Hardening F3 pré-produção (timing-safe token, multi-tenant scope, idempotency, logs)
phase: F7
task_ref: T7.3
status: review
priority: critical
estimated_size: L
agent_id: backend-engineer
claimed_at: 2026-05-25T13:42:11Z
completed_at: 2026-05-25T14:56:40Z
pr_url: null
depends_on: [F3-S33, F3-S34, F9-S10]
blocks: [F7-S09]
labels: [lgpd-impact]
source_docs:
  - docs/10-seguranca-permissoes.md
  - docs/17-lgpd-protecao-dados.md
  - docs/14-riscos-mitigacoes.md
---

# F7-S03 — Hardening F3 pré-produção

## Objetivo

Consolidar o backlog de hardening acumulado nas 7 revisões de segurança da Fase 3 (memória `project_f3_hardening_backlog`). Nada bloqueou merge em staging, mas todos são pré-requisito para dados reais em produção.

## Escopo

### 1. Token interno timing-safe (todos os `/internal/*`)

- Criar helper `apps/api/src/lib/auth/internal-token.ts`:
  ```ts
  export function verifyInternalToken(received: string, expected: string): boolean;
  ```
  - Usa `crypto.timingSafeEqual` com encoding consistente
  - Retorna `false` se comprimentos diferem (timing-safe via comparação dummy)
- Substituir TODAS as comparações diretas (`!==`/`===`) em rotas `/internal/*`:
  - `leads`, `cities`, `credit-products`, `handoffs`, `chatwoot`, `ai`, `customers`, `conversations`, `simulations`, `feature-flags`, `credit-analyses` (F4-S04)
- Testes: comparações com tokens válido/inválido/diferentes comprimentos

### 2. Multi-tenant scope em `/internal/customers/:id/context` (F3-S10)

- Receber `organization_id` em header `X-Organization-Id` (regra inviolável #3)
- Adicionar `WHERE organization_id = $1` em todas as queries
- Tool Python `get_customer_context` passa header
- Teste: customer existe em outra org → 404

### 3. Idempotency keys determinísticas

- F3-S12 outbox: trocar `Date.now()` por chave determinística `lead_update_<lead_id>_<field_hash>`
- F3-S05 evento `cities.identified`: trocar `randomUUID()` por `city_identify_<lead_id>_<city_id>`
- Testes: 2 emissões idênticas → 1 evento no outbox

### 4. PII_KEYS_FORBIDDEN completar (F3-S09)

- Adicionar à lista em `apps/api/src/modules/internal/ai/repository.ts`:
  - `cpf_hash`, `cpf_encrypted`, `phone_normalized`, `phone_e164`, `document_hash`
- Teste: tentativa de logar campo proibido → 400 com mensagem clara

### 5. Métodos públicos no `_base.py` da tool Python

- Adicionar em `apps/langgraph-service/app/tools/_base.py`:
  - `async def put(self, path, json=None) -> dict`
  - `async def patch(self, path, json=None) -> dict`
- Refatorar F3-S22 (`update_lead_profile`) e F3-S30 (`persist_state`) para usar métodos públicos
- Testes existentes continuam verdes

### 6. Log sanitization (vários slots)

- F3-S23 `load_state.py:164`: substituir `str(exc)` por `f"http_status_{exc.response.status_code}"`
- F3-S26 `classify_intent.py:196`: remover `raw_response` do log info; manter só em debug
- F3-S32 `process.py:415`: trocar `error=str(exc)` por `error_type=type(exc).__name__`; `str(exc)` só em debug
- F3-S33 `process-with-ai.ts`: remover/mascarar `waMessageId` em logs `warn`/`info`
- F3-S34 `ai-fallback.ts`: URLs internas → paths relativos; remover header `Idempotency-Key` para `/internal/ai/decisions`
- F9-S09 `classify_intent.py:244` e `qualify_credit_interest.py:424`: substituir `str(PromptNotFoundError)` por mensagem genérica
- F3-S22 `_base.py`: confirmar que stack traces de httpx não vazam URLs internas

### 7. Race condition em `ai_conversation_states`

- Migration `0039_unique_org_phone_active.sql`:
  - `CREATE UNIQUE INDEX uq_ai_conversation_states_org_phone_active ON ai_conversation_states (organization_id, phone) WHERE deleted_at IS NULL;`
- Atualizar `ON CONFLICT` em `apps/api/src/modules/internal/conversations/repository.ts` para usar `(organization_id, phone) WHERE deleted_at IS NULL` em vez de `conversation_id`
- Teste de race: 2 webhooks simultâneos do mesmo `phone+org` → 1 estado ativo

### 8. F3-S04 simplificação (lead sem cidade)

- Agora que `leads.city_id` é nullable: remover workaround 422 em `apps/api/src/modules/internal/leads/controller.ts`
- Lead é criado com `city_id=null`; identificação de cidade vira passo separado pelo nó `identify_city`
- Teste atualizado

### 9. F3-S28 prompt alinhamento

- `apps/langgraph-service/app/prompts/simulation.md`: remover referência ao campo `sistema_amortizacao` ausente OU adicionar campo ao `sim_context` (escolher uma)

### 10. Dry-run stubs (F9 Playground)

- `apps/langgraph-service/app/graphs/whatsapp_pre_attendance/dry_run.py:_stub_handoffs`: trocar `body.get("conversation_id")` por `str(uuid.uuid4())`
- Stub de `ChatwootNoteOutput`: adicionar campo `note_id` para evitar `Field required` Pydantic
- Mensagem de erro do `request_handoff` no playground sem `lead_id`: trocar para "Modo sintético sem lead — handoff não pode ser disparado nesta simulação"

### 11. F8-S11 hardening 2FA

- Tabela nova `used_totp_codes (user_id, code_hash, used_at)` TTL 90s — bloqueia replay
- Refatorar `apps/api/src/modules/auth/totp.ts` para rejeitar código já usado
- Recovery codes: trocar `byte % 32` por rejection sampling (já implementado em libs, escolher uma)
- Migration `0040_used_totp_codes.sql`

### 12. Setup de teste fix (F9-S00)

- Adicionar em `apps/api/src/test/setup.ts`:
  ```ts
  process.env['FX_BRL_PER_USD'] = '5.75';
  ```
- Validação: rodar a suíte completa do api e confirmar que os ~12 testes que falhavam ao bootar env passam.

## LGPD

- Todos os ajustes de log diminuem exposição de PII (item 6) → reforço Art. 6º VII (transparência) e §8.3 do doc 17
- Multi-tenant scope em `/internal/customers/:id/context` corrige violação de invariante #3
- Sem novo suboperador, sem nova finalidade, sem necessidade de DPIA novo
- PR com label `lgpd-impact` + checklist doc 17 §14.2 referenciando este slot

## Fora de escopo

- F3-S36 testes de prompt injection: CPFs válidos no fixture e assertions dead — slot pequeno separado (não bloqueia produção pq não afeta runtime)
- Fix autoload + Vitest (4 test files pré-existentes falhando) — slot dedicado de tooling, não bloqueia produção
- F9-S01 comentário cosmético sobre migration 0026 — fix-it-when-touching
- F9-S07 dead code + rgba hardcoded em UI playground — slot pequeno cosmético

## Arquivos permitidos

```
apps/api/src/lib/auth/internal-token.ts
apps/api/src/lib/auth/__tests__/internal-token.test.ts
apps/api/src/modules/internal/**/*.ts
apps/api/src/modules/auth/totp.ts
apps/api/src/modules/auth/__tests__/totp.test.ts
apps/api/src/db/migrations/0039_unique_org_phone_active.sql
apps/api/src/db/migrations/0040_used_totp_codes.sql
apps/api/src/db/migrations/meta/_journal.json
apps/api/src/db/schema/usedTotpCodes.ts
apps/api/src/db/schema/index.ts
apps/api/src/handlers/process-with-ai.ts
apps/api/src/handlers/ai-fallback.ts
apps/api/src/test/setup.ts
apps/langgraph-service/app/tools/_base.py
apps/langgraph-service/app/tools/__tests__/test_base.py
apps/langgraph-service/app/graphs/whatsapp_pre_attendance/nodes/load_state.py
apps/langgraph-service/app/graphs/whatsapp_pre_attendance/nodes/classify_intent.py
apps/langgraph-service/app/graphs/whatsapp_pre_attendance/nodes/qualify_credit_interest.py
apps/langgraph-service/app/graphs/whatsapp_pre_attendance/dry_run.py
apps/langgraph-service/app/api/process.py
apps/langgraph-service/app/prompts/simulation.md
```

## Definition of Done

- [ ] Todos os 12 itens implementados (ou marcados explicitamente como deferred com slot novo aberto)
- [ ] Helper `verifyInternalToken` aplicado em **todos** os endpoints `/internal/*` (grep confirma 0 comparações diretas)
- [ ] Migration 0039 + 0040 criadas; `check-migrations` verde
- [ ] Race test passa (2 webhooks simultâneos → 1 estado)
- [ ] Suite api existente passa (não regredir); os 12 test files que falhavam por `FX_BRL_PER_USD` agora passam
- [ ] Suite langgraph existente passa
- [ ] PR com label `lgpd-impact` + checklist doc 17 + referência ao backlog consolidado

## Validação

```powershell
python scripts/slot.py check-migrations
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api test
cd apps/langgraph-service ; uv run ruff check . ; uv run mypy app ; uv run pytest -q
```
