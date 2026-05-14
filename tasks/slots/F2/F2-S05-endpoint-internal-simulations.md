---
id: F2-S05
title: Endpoint POST /internal/simulations (para IA, idempotente)
phase: F2
task_ref: T2.5
status: review
priority: high
estimated_size: S
agent_id: backend-engineer
claimed_at: 2026-05-14T21:54:49Z
completed_at: 2026-05-14T22:15:20Z
pr_url:
depends_on: [F2-S04]
blocks: []
labels: [lgpd-impact]
source_docs:
  - docs/06-langgraph-agentes.md
  - docs/04-eventos.md
  - docs/10-seguranca-permissoes.md
  - docs/17-lgpd-protecao-dados.md
---

# F2-S05 — POST /internal/simulations (para IA)

## Objetivo

Endpoint interno consumido pela tool `generate_credit_simulation` do LangGraph (F3).
Mesma lógica de F2-S04, mas:

- Autenticado por header `X-Internal-Token` (não JWT de usuário).
- **Idempotência por `idempotency_key`** — IA pode reenviar a mesma chamada sem criar
  duplicatas.
- Carrega `origin='ai'` na simulação.
- Sem `created_by_user_id`; com `created_by_ai_log_id` (referência futura para F3).

## Escopo

### Endpoint `POST /internal/simulations`

Sem JWT. Validação:

- Header `X-Internal-Token` = `env.INTERNAL_API_TOKEN`. Senão 401.
- Body Zod estende o de F2-S04:
  ```ts
  {
    leadId: string;
    productId: string;
    amount: number;
    termMonths: number;
    idempotencyKey: string;        // required — UUID v4 gerado pela IA
    aiDecisionLogId?: string;      // opcional — referência ao log da decisão (F3)
  }
  ```

### Pipeline

1. Validar header + Zod.
2. Lookup pela `UNIQUE (origin='ai', idempotency_key)`:
   - Se já existe → retornar 200 com a simulação existente (idempotência).
   - Se não existe → seguir pipeline de F2-S04 (mesmo `service` compartilhado).
3. INSERT com `origin='ai'`, `idempotency_key`, `created_by_ai_log_id` (NULL ou ref).
4. Resto idêntico a F2-S04: snapshot da regra, outbox, audit, atualiza `last_simulation_id`.

### Service compartilhado

Reusar `simulationsService.createSimulation()` de F2-S04. Diferenças tratadas via
parâmetro de origin/idempotency. **Não duplique lógica de cálculo/validação.**

### LGPD

- Mesmo cuidado de F2-S04.
- Outbox payload **não** carrega PII.
- DLP do LangGraph (F1-S26) garante que prompts não vazam PII; este endpoint só recebe
  IDs + números, sem texto livre.

### Audit

- `audit_logs` com `actor_user_id=NULL`, `actor_type='ai'`, `entity='credit_simulation'`,
  `metadata.idempotency_key`.

### Rate limit

- 60 req/min por IP (a IA chama por correlation; protege de loop infinito).

## Arquivos permitidos

- `apps/api/src/modules/simulations/internal-routes.ts`
- `apps/api/src/modules/simulations/__tests__/internal-routes.test.ts`
- `apps/api/src/app.ts` (registrar plugin internal — provavelmente já há um plugin
  `internal/*` de F1-S26; este slot só adiciona a rota)

## Definition of Done

- [ ] Endpoint exige `X-Internal-Token` válido → 401 sem.
- [ ] `idempotencyKey` obrigatório no body.
- [ ] Reenvio com mesma chave retorna **a mesma** simulação (200, não 201).
- [ ] `origin='ai'` na simulação criada.
- [ ] Outbox emitido **uma única vez** (na criação, não no reenvio).
- [ ] Audit log com `actor_type='ai'`.
- [ ] Rate limit funciona (teste com >60 reqs em 60s → 429).
- [ ] Service compartilhado com F2-S04 (sem duplicação).
- [ ] PR com label `lgpd-impact` + checklist §14.2.
- [ ] `pnpm --filter @elemento/api typecheck && lint && test` verdes.

## Validação

```powershell
pnpm --filter @elemento/api test -- simulations/internal
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api typecheck
```
