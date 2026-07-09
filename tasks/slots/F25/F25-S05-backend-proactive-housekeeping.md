---
id: F25-S05
title: Backend — worker proativo de estagnação + abandono reversível (config por org)
phase: F25
task_ref: docs/22-agente-interno-acoes.md
status: in-progress
priority: high
estimated_size: L
agent_id: null
depends_on: [F25-S01, F25-S02]
blocks: [F25-S06]
labels: [backend, ai-agent, worker, outbox, feature-flags]
source_docs: [docs/22-agente-interno-acoes.md, docs/04-eventos.md, docs/09-feature-flags.md]
docs_required: false
claimed_at: 2026-07-09T19:03:25Z

---
# F25-S05 — Backend: agente proativo (housekeeping do funil)

## Objetivo

Implementar a Frente B do doc 22 (§5.2/§6.2/§7): o worker **agendado** que mantém o funil
atualizado sem interação — marca estagnação (sinaliza humano) e abandono automático **reversível**.
Sem outbound ao cidadão (decisão travada §7.1).

## Contexto

Determinístico primeiro; a IA nunca envia mensagem. Limiares configuráveis por org
(§7.2): sugestão inicial `STAGNANT_AFTER_DAYS=7`, `ABANDON_AFTER_DAYS=30`. Nunca age em lead que
já é responsabilidade humana (Documentação em diante).

## Escopo (faz)

- Tabela de config `ai_funnel_settings` (org_id PK/FK, `stagnant_after_days` int, `abandon_after_days`
  int, `enabled` bool) — migration + schema Drizzle + defaults. (Se o slot preferir, reusar
  `ai_funnel_config`; manter nome consistente com o schema.)
- Worker agendado `apps/api/src/workers/funnel-housekeeping.ts`:
  - Varre leads sem interação além do limiar, por org, respeitando `canonical_role`
    (só age em `pre_atendimento`/`simulacao` — nunca Documentação+).
  - Estagnação: emite `leads.stagnant` (sinalização; não muda terminal) — consumível pelo motor de
    notificações (F24) para alertar humano.
  - Abandono: `leads.status → closed_lost` (outcome `abandonado`), move card para
    `concluido_perdido` via `leads.abandoned`, audit `actor_type='ai'`. **Reversível** (F25-S06).
  - Gate por flag `internal_assistant.actions.enabled` no início do job (doc 09 §4.3); idempotente
    (não re-emitir para o mesmo lead/bucket).
- Registrar o schedule em `apps/api/src/workers/index.ts` (cron interno existente).

## Fora de escopo (NÃO faz)

- Endpoint/painel de reversão (F25-S06).
- Envio de mensagem outbound ao cidadão (fora de escopo do doc 22 §7.1).
- UI de configuração dos limiares (F25-S07).

## Arquivos permitidos

- `apps/api/src/db/schema/aiFunnelSettings.ts`
- `apps/api/src/db/schema/index.ts`
- `apps/api/src/db/migrations/0082_ai_funnel_settings.sql`
- `apps/api/src/db/migrations/meta/_journal.json`
- `apps/api/src/workers/funnel-housekeeping.ts`
- `apps/api/src/workers/index.ts`
- `apps/api/src/workers/__tests__/funnel-housekeeping.test.ts`

## Arquivos proibidos

- `apps/web/**`
- `apps/langgraph-service/**`
- `apps/api/src/modules/**`

## Definition of Done

- [ ] `ai_funnel_settings` por org (migration + schema + defaults 7/30)
- [ ] Worker varre por org, respeita `canonical_role`, não toca Documentação+
- [ ] `leads.stagnant` (sinal) e `leads.abandoned` (terminal reversível) emitidos; audit `actor_type='ai'`
- [ ] Idempotente por lead/bucket; gate por flag; sem outbound ao cidadão
- [ ] `pnpm --filter @elemento/api typecheck` + `lint` + `test` verdes

## Validação

```powershell
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api test
python scripts/slot.py validate F25-S05
```

## Notas para o agente

- **Migration:** `0082` sugestão; verificar colisão e usar próxima livre.
- Sem PII em payload de evento. Emissão idempotente (`onConflictDoNothing`).
- "sem interação" = usar última mensagem/atividade do lead; documentar o critério no PR.
