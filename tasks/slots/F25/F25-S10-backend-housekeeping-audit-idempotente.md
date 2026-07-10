---
id: F25-S10
title: Backend — audit de housekeeping idempotente (2º tick não infla o painel IA-24h)
phase: F25
task_ref: docs/22-agente-interno-acoes.md
status: available
priority: medium
estimated_size: S
agent_id: null
depends_on: [F25-S05, F25-S08]
blocks: []
labels: [backend, ai-agent, bugfix, idempotency]
source_docs: [docs/22-agente-interno-acoes.md]
docs_required: false
---

# F25-S10 — Backend: audit de housekeeping idempotente

## Objetivo

Fazer o audit de `leads.stagnant` no worker de housekeeping ser idempotente por dia, para um 2º tick
no mesmo dia não duplicar a linha de `audit_logs` e inflar a contagem do painel "IA nas últimas 24h".

## Contexto

Achado pelo QA de integração `F25-S08` (2026-07-10) e confirmado no código.

`apps/api/src/workers/funnel-housekeeping.ts`, `processStagnant` (linhas ~53-83):

```ts
const idempotencyKey = buildStagnantKey(lead.leadId, dayBucket);
await emit(tx, { eventName: 'leads.stagnant', ..., idempotencyKey }, { onConflictDoNothing: true });
await auditLog(tx, { action: 'leads.stagnant', ... });   // ← sem idempotência
```

O `emit` deduplica o evento no outbox via `idempotencyKey` + `onConflictDoNothing`. Mas `auditLog` é
chamado **incondicionalmente** na mesma transação, **sem chave de idempotência**. Num 2º tick no mesmo
dia (restart do worker, trigger manual, sobreposição de agendamento) o evento não duplica, mas a linha
de `audit_logs` **sim**.

Impacto: o painel "IA nas últimas 24h" (doc 22 §11, entregue em F25-S06/S07) lê de `audit_logs` — a
contagem de "sinalizou estagnação" infla a cada tick repetido. **Não** corrompe estado nem side-effect
externo (o outbox segue como fonte de verdade, corretamente deduplicado); é bug de **exatidão do painel**,
justamente a superfície central de F25.

`leads.abandoned` **não** sofre o mesmo: o lead vira `closed_lost` (terminal) e sai da elegibilidade
após o 1º tick. Mas o fix deve deixar ambos os caminhos consistentes.

Nota: `emit` retorna só o `eventId` (string) e **não** sinaliza se inseriu ou bateu no conflito
(`emit.ts` ~113: `onConflictDoNothing()` engole o resultado). Então não dá para gatear o `auditLog` no
retorno do `emit` sem alargar a interface pública do `emit` — que o próprio `emit.ts` diz para não fazer.

## Escopo (faz)

- Tornar o tick de housekeeping **idempotente por dia** antes de gravar o audit. Duas abordagens
  aceitáveis (o engenheiro escolhe a mais limpa, justificando no PR):
  1. **Pré-checagem do outbox** (preferida): antes de `emit`+`auditLog`, `SELECT 1 FROM event_outbox
WHERE idempotency_key = <buildStagnantKey/buildAbandonKey>`. Se já existe, este é um tick repetido
     → pular emit **e** audit para esse lead. Torna o tick inteiro idempotente, não só o audit.
  2. **Pré-checagem do audit**: antes de `auditLog`, verificar se já existe linha
     `(resource_id=lead, action='leads.stagnant', dentro do dayBucket)` e pular se sim.
- Preservar o isolamento por lead (uma falha num lead não derruba o tick) e a transação atômica
  emit+audit para o caso do 1º tick.
- **Atualizar o teste do F25-S08** que hoje **documenta** a duplicação como comportamento aceito
  (`funnel-housekeeping.integration.test.ts` — procure o teste do "2º tick"/`audit`/`dup`): invertê-lo
  para asseverar que o 2º tick **não** cria segunda linha de audit para `leads.stagnant`.

## Fora de escopo (NÃO faz)

- Alargar a interface pública do `emit` (`events/emit.ts` é proibido).
- O gap de `actor_type` do `auditLog` (documentado em F25-S06, separado deste bug).
- Migrations de schema (a menos que a abordagem 2b escolha índice único parcial — se for necessário,
  **pare e reporte**: vira slot com `.sql` e gate de migration, não este).
- Frontend do painel.

## Arquivos permitidos

- `apps/api/src/workers/funnel-housekeeping.ts`
- `apps/api/src/workers/__tests__/funnel-housekeeping.integration.test.ts`
- `apps/api/src/workers/__tests__/funnel-housekeeping.test.ts`

## Arquivos proibidos

- `apps/api/src/events/emit.ts`
- `apps/api/src/lib/audit.ts`
- `apps/api/src/db/migrations/**`
- `apps/web/**`

## Definition of Done

- [ ] 2º tick no mesmo dia não cria 2ª linha de `audit_logs` para `leads.stagnant`
- [ ] 1º tick continua gravando evento + audit normalmente (sem regressão)
- [ ] `leads.abandoned` permanece consistente (sem regressão)
- [ ] Isolamento por lead preservado (falha num lead não derruba o tick)
- [ ] Teste do F25-S08 invertido para asseverar o não-dup (não mais documentar o dup)
- [ ] Sem `any`, sem `as unknown as` novo (o cast existente do `tx` é pré-existente, não alargar)
- [ ] `pnpm --filter @elemento/api typecheck` + `lint` + `test` verdes (main está verde — não regredir)

## Validação

```powershell
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api test
```

## Notas para o agente

- **Não** coloque `python scripts/slot.py validate F25-S10` no bloco Validação (fork bomb — o script
  executa o bloco via subprocess; há guarda, mas não re-arme). **Não** rode `taskkill //F //IM python.exe`.
- Se a abordagem exigir tocar schema/migration, **pare e reporte** — o slot foi dimensionado para fix
  no worker sem `.sql`.
- O harness real-DB de integração pula sem Postgres — rode o unit test do worker para sinal rápido, e
  garanta que o teste de integração invertido está correto por leitura.
