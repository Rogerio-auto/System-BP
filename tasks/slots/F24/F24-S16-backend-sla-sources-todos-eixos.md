---
id: F24-S16
title: Backend — worker de SLA: 7 eixos reais + trigger_key kanban_stage parametrizável
phase: F24
task_ref: docs/planejamento-notificacoes.md
status: available
priority: high
estimated_size: L
agent_id: null
depends_on: [F24-S07]
blocks: [F24-S17]
labels: [backend, notifications, worker, bugfix, multi-tenant]
source_docs: [docs/planejamento-notificacoes.md, docs/23-notificacoes.md]
docs_required: false
---

# F24-S16 — Backend: worker de SLA cumpre o catálogo

## Objetivo

Fazer o worker `notification-sla-scan` disparar de fato para os **7 eixos** de inatividade do
`TRIGGER_CATALOG`, e permitir que uma regra `kanban_stage` aponte para um stage específico.
Hoje só 1 eixo é consultado e **nenhuma regra criada pela API real dispara**.

## Contexto

`F24-S07` entregou o worker, mas com três defeitos confirmados no código (2026-07-10):

1. **`findSlaSources` ignora o eixo.** Delega incondicionalmente para `findStagnantKanbanCards`.
   Os outros 6 eixos passam na validação Zod e nunca disparam — em silêncio.
2. **Bug de formato de chave.** O catálogo declara `key: 'kanban_stage:*'`, mas
   `findStagnantKanbanCards` compara `kanbanStages.name` contra a chave inteira (`triggerKey !== '*'`),
   sem tirar o prefixo `kanban_stage:`. Como a API valida `trigger_key` contra o catálogo
   (`notification-rules.ts` §514), o único valor aceito é `kanban_stage:*` — que nunca casa com um
   nome de stage. **Regra criada pela UI real nunca dispara.**
3. **Teste mascara o bug.** `notification-sla-scan.test.ts` usa `triggerKey: 'Qualificacao'`, um valor
   que a validação da API rejeitaria. Verde no CI, quebrado em produção.

Divergências adicionais a corrigir no mesmo slot:

- `entityType`: o código retorna sempre `'lead'`; o catálogo declara um `entityType` por eixo
  (`kanban_card`, `conversation`, `simulation`, `credit_analysis`, `contract`, `payment_due`).
- `timestampSource` do catálogo diz `kanban_cards.stage_changed_at`; a coluna real é `entered_stage_at`.
- `chatwoot_handoffs` **não tem** coluna `requested_at` — o eixo é `status='requested'` + `created_at`.

## Escopo (faz)

- **`kanban_stage` parametrizável** (decisão do Rogério, 2026-07-10): `trigger_key` passa a aceitar
  `kanban_stage:*` (qualquer stage) **e** `kanban_stage:<stageId>` (UUID de `kanban_stages.id`).
  - Validação por **prefixo** em `notification-rules.ts`: resolver a entry do catálogo para qualquer
    chave que comece com `kanban_stage:`, aceitando `*` ou um UUID válido. Demais chaves seguem
    exigindo match exato. Regras existentes com `kanban_stage:*` continuam válidas.
  - Usar **`stageId` (UUID)**, não o nome do stage: nome é editável e não é estável.
- **`findSlaSources` vira dispatcher real** — um `switch`/mapa por `triggerKey`, uma função-fonte por eixo:

  | trigger_key                     | fonte                           | filtro                                   |
  | ------------------------------- | ------------------------------- | ---------------------------------------- |
  | `kanban_stage:*` / `:<stageId>` | `kanban_cards.entered_stage_at` | `stage_id` quando não for `*`            |
  | `handoff:requested`             | `chatwoot_handoffs.created_at`  | `status='requested'`                     |
  | `simulation:sent_no_reply`      | `credit_simulations.sent_at`    | `sent_at IS NOT NULL`                    |
  | `analysis:pendente`             | `credit_analyses.updated_at`    | `status='pendente'`                      |
  | `contract:draft_unsigned`       | `contracts.created_at`          | `status='draft'` (e `signed_at IS NULL`) |
  | `payment_due:overdue`           | `payment_dues.due_date`         | `status IN ('pending','overdue')`        |
  | `conversation:no_reply`         | `conversations.last_inbound_at` | `status='open'`                          |

  - Chave desconhecida → **lançar erro explícito** (nunca cair em fallback silencioso).
  - Cada fonte retorna `SlaEligibleEntity` com o **`entityType` do catálogo** (não `'lead'` fixo).
  - Toda fonte filtra por `organizationId` e retorna `cityId` (join até `leads`/`customers` quando
    a tabela não tiver a cidade) — o filtro `city_scope` do worker depende disso.
  - Respeitar `deleted_at IS NULL` onde a tabela tem soft-delete.

- **Testes** (`sla-sources.test.ts` novo + ajuste do worker):
  - Um teste por eixo: entidade além do threshold é elegível; dentro do threshold, não.
  - `kanban_stage:<stageId>` filtra pelo stage certo; `kanban_stage:*` pega qualquer stage.
  - **Teste de regressão do bug de chave**: uma regra com `trigger_key` vindo do catálogo real
    (`kanban_stage:*`) dispara. Proibido usar `'Qualificacao'` como `triggerKey` em teste.
  - `entityType` retornado bate com o do catálogo, por eixo.
  - Chave desconhecida lança.
  - Fonte não vaza PII (só IDs + timestamps) — LGPD §8.5.

## Fora de escopo (NÃO faz)

- UI do editor de regras (seletor de stage) → `F24-S17`.
- Gate da flag `notifications.email.enabled` → `F24-S18`.
- Migrations / mudança de schema do banco (`trigger_key` já é text).
- Gatilhos de evento (`trigger_kind='event'`, F24-S06).

## Arquivos permitidos

- `packages/shared-schemas/src/notification-rules.ts`
- `packages/shared-schemas/src/__tests__/notification-rules.test.ts`
- `apps/api/src/modules/notification-rules/sla-sources.ts`
- `apps/api/src/modules/notification-rules/__tests__/sla-sources.test.ts`
- `apps/api/src/workers/notification-sla-scan.ts`
- `apps/api/src/workers/__tests__/notification-sla-scan.test.ts`

## Arquivos proibidos

- `apps/web/**`
- `apps/langgraph-service/**`
- `apps/api/src/db/migrations/**`
- `apps/api/src/handlers/**`
- `apps/api/src/modules/notifications/senders/**`

## Definition of Done

- [ ] `findSlaSources` roteia por `triggerKey`; chave desconhecida lança erro explícito
- [ ] Os 7 eixos do `TRIGGER_CATALOG` têm fonte real, com a coluna de timestamp correta
- [ ] `trigger_key` aceita `kanban_stage:*` e `kanban_stage:<stageId>` (validação por prefixo, UUID)
- [ ] `entityType` retornado vem do catálogo, por eixo (não `'lead'` fixo)
- [ ] Toda fonte filtra `organization_id` e devolve `cityId` para o filtro `city_scope`
- [ ] Teste de regressão com `trigger_key` real do catálogo (nenhum teste usa `'Qualificacao'`)
- [ ] Fontes retornam só IDs + timestamps (sem PII)
- [ ] `pnpm --filter @elemento/api typecheck` + `lint` + `test` verdes

## Validação

```powershell
pnpm --filter @elemento/shared-schemas test
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api test
```

## Notas para o agente

- **Não** coloque `python scripts/slot.py validate F24-S16` no bloco Validação (o script executa cada
  linha via subprocess — comando auto-referencial causava fork bomb; há guarda, mas não re-arme).
- `notification_rule_deliveries` guarda `entity_type`/`entity_id`: mudar `entityType` de `'lead'` para o
  do catálogo altera a chave de dedup. É intencional (a chave anterior estava errada), mas registre no PR:
  regras `stage_inactivity` existentes podem re-notificar uma vez após o deploy.
- Performance: consultar só orgs com regras ativas; reuse os índices de F24-S01
  (`idx_chatwoot_handoffs_org_status`, `idx_credit_analyses_org_status`, parcial de `payment_dues`).
- `payment_dues.due_date` é `date`, não `timestamp` — cuidado ao comparar com o cutoff de horas.
- Não altere a assinatura de `dispatchToChannel` nem o cálculo de `bucket` (F24-S06/S07 estão corretos).
