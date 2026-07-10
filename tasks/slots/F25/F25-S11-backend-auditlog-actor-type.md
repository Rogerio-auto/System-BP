---
id: F25-S11
title: Backend — auditLog seta actor_type na raiz (IA e sistema deixam de ser rotulados 'user')
phase: F25
task_ref: docs/22-agente-interno-acoes.md
status: in-progress
priority: medium
estimated_size: M
agent_id: null
depends_on: [F25-S06, F25-S10]
blocks: []
labels: [backend, audit, lgpd, ai-agent, bugfix]
source_docs:
  [docs/22-agente-interno-acoes.md, docs/17-lgpd-protecao-dados.md, docs/10-seguranca-permissoes.md]
docs_required: false
claimed_at: 2026-07-10T19:21:59Z
---

# F25-S11 — Backend: auditLog seta actor_type na raiz

## Objetivo

Fazer o helper `auditLog()` gravar `actor_type` corretamente (`'ai'`/`'system'`/`'user'`), eliminando
o gap documentado desde F25-S06 em que ações da IA e de workers ficam rotuladas como `'user'`.

## Contexto

`audit_logs.actor_type` (`'user' | 'system' | 'ai'`, default `'user'`, check `chk_audit_logs_actor_type`)
foi adicionado em F25-S01 **para LGPD Art. 20** (transparência de decisão automatizada — poder identificar
ações tomadas por IA). Mas o helper `auditLog()` (`apps/api/src/lib/audit.ts`) **nunca seta `actorType`**
no insert — só `actorUserId`/`actorRole`. Resultado: **toda** linha via helper cai no default `'user'`,
independente de quem agiu. E o tipo `AuditActor` nem tem campo `type`, então o caller não consegue expressá-lo.

Confirmado no código (2026-07-10):

- **54 callers** do helper. Nenhum consegue setar `actor_type`.
- **Ações da IA via helper** ficam `actor_type='user'` erroneamente: `funnel-housekeeping.ts` (2 sites,
  `{ userId: null, role: 'ai' }`) e `simulations/service.ts` (3 sites, `role: actor.role` = `'ai'` quando
  `origin='ai'`).
- **34 callers** passam `actor: null` (workers/sistema) → também gravam `'user'`, quando deveriam ser `'system'`.
- `qualifyLead()` (`leads/service.ts:1201`) grava audit **direto** (sem helper) com `actorType: 'ai'` — correto,
  é o único que acerta hoje.
- **Único consumidor** de `actor_type`: `ai-actions/repository.ts:88` filtra `actor_type='ai' OR actor_role='ai'`
  — o `OR actor_role='ai'` é o workaround compensatório deste gap. Ninguém filtra por `'user'`/`'system'`,
  então corrigir as linhas de sistema tem **zero impacto em consumidor** — só torna o dado correto.

## Escopo (faz)

- **`lib/audit.ts` — a raiz:**
  - Adicionar `type?: 'user' | 'system' | 'ai'` ao tipo `AuditActor` (exportar um alias, ex.: `AuditActorType`).
  - No insert, derivar `actorType` nesta ordem:
    1. `actor?.type` explícito, se fornecido;
    2. senão, `actor === null` → `'system'`;
    3. senão, `actor.role === 'ai'` → `'ai'` (a convenção já usada; conserta os sites IA sem caçá-los um a um);
    4. senão → `'user'`.
  - Aditivo: nenhum caller quebra (não passam `type` hoje); só o valor gravado fica mais preciso.
- **Intenção explícita nos sites de IA** (belt-and-suspenders, não depender só da heurística de role):
  - `funnel-housekeeping.ts`: passar `type: 'ai'` nos 2 `actor`.
  - `simulations/service.ts`: garantir que os audits de `origin='ai'` resultem em `actor_type='ai'`
    (via `type: 'ai'` explícito ou pela derivação de `role==='ai'` — o que ficar mais limpo; documente).
- **`ai-actions/repository.ts`:** manter o filtro `actor_type='ai' OR actor_role='ai'` (defensivo p/ linhas
  gravadas antes deste fix — não há migração de backfill aqui), mas **atualizar o comentário** do topo e da
  linha 88: a raiz está corrigida; novas linhas gravam `actor_type='ai'` direto; o `OR` vira rede de segurança
  para histórico, removível num cleanup futuro com backfill.
- **Testes:**
  - `lib/audit.test.ts`: ator `null` → `'system'`; ator `{role:'ai'}` → `'ai'`; ator `{role:'gestor'}` → `'user'`;
    `type` explícito vence a derivação; check constraint aceita os 3 valores.
  - Ajustar/estender os testes de `funnel-housekeeping` e `simulations` para asseverar `actor_type='ai'`
    nas ações de IA.

## Fora de escopo (NÃO faz)

- Migração de backfill de `actor_type` em linhas históricas (nada em prod — flags OFF; o `OR` cobre o resto).
  Se for desejável, vira slot próprio com `.sql` e gate de migration.
- Mudar `qualifyLead()` (já grava `actor_type='ai'` correto, direto).
- Alargar `events/emit.ts`. Frontend.

## Arquivos permitidos

- `apps/api/src/lib/audit.ts`
- `apps/api/src/lib/audit.test.ts`
- `apps/api/src/workers/funnel-housekeeping.ts`
- `apps/api/src/workers/__tests__/funnel-housekeeping.test.ts`
- `apps/api/src/modules/simulations/service.ts`
- `apps/api/src/modules/simulations/__tests__/*`
- `apps/api/src/modules/ai-actions/repository.ts`

## Arquivos proibidos

- `apps/api/src/events/emit.ts`
- `apps/api/src/db/migrations/**`
- `apps/api/src/modules/leads/service.ts` (qualify já correto)
- `apps/web/**`
- `apps/langgraph-service/**`

## Definition of Done

- [ ] `auditLog()` grava `actor_type` derivado (explícito > null→system > role==='ai'→ai > user)
- [ ] `AuditActor` aceita `type?` opcional
- [ ] Ações de IA de `funnel-housekeeping` e `simulations` gravam `actor_type='ai'` (testado)
- [ ] Ações de worker (`actor: null`) gravam `actor_type='system'` (testado)
- [ ] Ações humanas seguem `actor_type='user'` (sem regressão)
- [ ] Comentário do `ai-actions/repository.ts` atualizado (raiz corrigida; `OR` vira rede de segurança)
- [ ] Sem `any`/`as unknown as` novo; sem `console.log`; `typecheck`+`lint`+`test` verdes (main está verde)

## Validação

```powershell
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api test
```

## Notas para o agente

- **Não** coloque `python scripts/slot.py validate F25-S11` no bloco Validação (fork bomb — o script executa
  o bloco via subprocess; há guarda, mas não re-arme). **Não** rode `taskkill //F //IM python.exe`.
- LGPD: `actor_type` correto é requisito de transparência de decisão automatizada (Art. 20, doc 17). Este é
  o valor real do slot — não é cosmético.
- O helper já tem um `AuditTx` estrutural e comentários justificando `as` isolados — **não** replique `as`
  novos; a derivação de `actor_type` é lógica pura sobre `params.actor`, não precisa de cast.
- Cuidado: `funnel-housekeeping.ts` foi tocado por F25-S10 (idempotência) — leia o estado ATUAL antes de editar.
