---
id: F2-S04
title: Endpoint POST /api/simulations (UI)
phase: F2
task_ref: T2.4
status: available
priority: critical
estimated_size: M
agent_id: backend-engineer
claimed_at:
completed_at:
pr_url:
depends_on: [F2-S01, F2-S02, F2-S03, F1-S15]
blocks: [F2-S05, F2-S06, F2-S08, F2-S09]
labels: [lgpd-impact]
source_docs:
  - docs/05-modulos-funcionais.md
  - docs/04-eventos.md
  - docs/10-seguranca-permissoes.md
  - docs/17-lgpd-protecao-dados.md
---

# F2-S04 — POST /api/simulations (UI)

## Objetivo

Endpoint que cria uma `credit_simulation` para um lead a partir do form da UI (F2-S06).
Valida limites contra a regra ativa, chama `calculator` (F2-S02), persiste com snapshot
da `rule_version_id` e emite `simulations.generated` via outbox para o kanban-on-simulation
worker (F2-S09) consumir.

Este é o coração funcional da Fase 2 — bloqueia F2-S05 (endpoint /internal para IA), F2-S06
(UI), F2-S08 (histórico no lead) e F2-S09 (worker kanban).

## Escopo

### Endpoint `POST /api/simulations`

`authenticate()` + `authorize({ permissions: ['simulations:create'] })`. Aplica city scope:
o lead alvo precisa estar no escopo do usuário.

Body (Zod):

```ts
{
  leadId: string; // UUID
  productId: string; // UUID
  amount: number; // R$ requested
  termMonths: number;
  // amortization é definida pela regra ativa do produto; não é input do usuário
}
```

### Pipeline

1. Validar Zod.
2. Carregar lead → city scope check (403 se fora do escopo).
3. Buscar `credit_products[:id]` ativo na org → 404 se não existir/inativo.
4. Buscar regra ativa do produto, respeitando `city_scope` da regra contra `lead.city_id`:
   - Se houver regra com `lead.city_id` em `city_scope` → usar essa.
   - Senão, regra com `city_scope IS NULL` → usar essa.
   - Senão → 409 `code='no_active_rule_for_city'`.
5. Validar `amount` em `[min_amount, max_amount]` e `termMonths` em `[min_term_months, max_term_months]` → 422 se fora.
6. Chamar `calculator.calculate({ amount, termMonths, monthlyRate, amortization })`.
7. **Em transação:**
   - INSERT `credit_simulations` com:
     - `rule_version_id` = id da regra usada (snapshot imutável)
     - `rate_monthly_snapshot` = `rule.monthly_rate`
     - `amortization_table` = jsonb do resultado
     - `origin = 'manual'`
     - `created_by_user_id = req.user.id`
   - UPDATE `leads.last_simulation_id` e `kanban_cards.last_simulation_id` para o novo id.
   - EMIT outbox `simulations.generated`:
     ```ts
     { simulationId, leadId, productId, ruleVersionId, amount, termMonths,
       monthlyPayment, origin: 'manual', occurredAt }
     ```
     (sem PII bruta — só IDs e números)
8. Retornar 201 com a simulação completa (tabela amortização inclusa).

### Audit

- `audit_logs` com `entity='credit_simulation'`, `action='create'`, `actor_user_id`.

### Idempotência

Endpoint UI **não** é idempotente nativo (UI sempre cria uma nova simulação por submit).
A coluna `idempotency_key` fica NULL para `origin='manual'`. Idempotência será de F2-S05
(internal) onde IA pode reenviar.

### LGPD

- Body só contém IDs + números (sem PII bruta).
- Logs com `pino.redact` cobrindo `body.*` por garantia.
- Outbox payload sem PII.
- Resposta inclui `lead_id` (referência) mas não nome/telefone/email do lead — frontend
  já tem esses dados se precisar exibir.
- Label `lgpd-impact` no PR — checklist doc 17 §14.2.

### Feature flag

`credit_simulation.enabled` desligada → 503 `code='feature_disabled'`.

### Permissão nova

`simulations:create`, `simulations:read` (doc 10 §3.3 — já listadas; criar via seed neste slot se ainda não existem).

## Arquivos permitidos

- `apps/api/src/modules/simulations/routes.ts`
- `apps/api/src/modules/simulations/controller.ts`
- `apps/api/src/modules/simulations/service.ts` (service compartilhado com F2-S05)
- `apps/api/src/modules/simulations/repository.ts`
- `apps/api/src/modules/simulations/schemas.ts`
- `apps/api/src/modules/simulations/__tests__/routes.test.ts`
- `apps/api/src/modules/simulations/__tests__/service.test.ts`
- `apps/api/src/app.ts` (registrar plugin)
- `apps/api/src/events/types.ts` (adicionar `simulations.generated`)
- `apps/api/src/db/migrations/0017_seed_simulations_permissions.sql`
- `docs/04-eventos.md` (registrar evento)
- `docs/17-lgpd-protecao-dados.md` (atualizar §16 se aplicável)

## Definition of Done

- [ ] Endpoint cria simulação com `rule_version_id` imutável snapshotted.
- [ ] Validação fora de limites retorna 422 com campos específicos.
- [ ] `no_active_rule_for_city` retorna 409.
- [ ] City scope respeitado (lead fora do escopo → 403).
- [ ] Outbox `simulations.generated` emitido **na mesma transação** do INSERT.
- [ ] `leads.last_simulation_id` e `kanban_cards.last_simulation_id` atualizados atomicamente.
- [ ] Audit log gerado.
- [ ] Tests cobrem: caminho feliz Price, SAC, fora de limites, city sem regra, lead fora de escopo, flag off, calculator chamado corretamente (snapshot rate match).
- [ ] PR com label `lgpd-impact` + checklist §14.2.
- [ ] `pnpm --filter @elemento/api typecheck && lint && test` verdes.

## Validação

```powershell
pnpm --filter @elemento/api db:migrate
pnpm --filter @elemento/api test -- simulations
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api typecheck
```
