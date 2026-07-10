---
id: F24-S20
title: Test — notifications.test.ts: 3 testes quebrados + 3 erros de typecheck
phase: F24
task_ref: docs/planejamento-notificacoes.md
status: review
priority: high
estimated_size: S
agent_id: null
depends_on: [F24-S06]
blocks: []
labels: [test, notifications, bugfix, ci]
source_docs: [docs/23-notificacoes.md]
docs_required: false
claimed_at: 2026-07-10T15:35:30Z
completed_at: 2026-07-10T15:47:41Z

---

# F24-S20 — Test: suíte de notificações verde

## Objetivo

Fazer `apps/api/src/modules/notifications/__tests__/notifications.test.ts` passar e typechecar.
Hoje ele contribui com **3 falhas de teste + 3 erros de `tsc`** na `main`.

## Contexto

Detectado em 2026-07-10 ao validar a `main` após os merges de F24.

`F24-S06` fez `handleFanoutNotification` passar a chamar
`requireFlag(db, ...)` (`handlers/fanout-notification.ts:479`). O teste `notifications.test.ts` monta um
`db` mockado que **não tem `.select`**, então a chamada estoura:

```
TypeError: db.select is not a function
  ❯ Module.listAllFlags src/modules/featureFlags/repository.ts:20:13
  ❯ Module.isFlagEnabled src/modules/featureFlags/service.ts:132:23
  ❯ Module.requireFlag  src/lib/featureFlags.ts:57:37
  ❯ handleFanoutNotification src/handlers/fanout-notification.ts:479:29
  ❯ src/modules/notifications/__tests__/notifications.test.ts:579:7
```

O mesmo teste também **passa o objeto errado** para o handler: monta um payload de _emissão_ de evento
(`{ eventName, aggregateType, actor, data, idempotencyKey }`) onde a assinatura espera uma **row de
`event_outbox`** (`{ id, createdAt, eventVersion, payload, correlationId, attempts, lastError,
processedAt, failedAt, ... }`). Daí os 3 `TS2345` nas linhas 530, 555 e 579.

`handlers/__tests__/fanout-notification.test.ts` **passa** — não é o arquivo quebrado, não mexer nele.

`F24-S06` foi mergeado com este teste vermelho. O CI não pegou porque os required checks não rodam
`typecheck` e a suíte já tinha falhas pré-existentes mascarando o sinal.

## Escopo (faz)

- Corrigir o mock de `db` no teste para suportar a chamada de `requireFlag` — ou stubar `requireFlag`/
  `isFlagEnabled` no nível do módulo, o que for mais fiel ao que o teste pretende verificar.
  Decida com base no que cada um dos 3 testes está tentando provar (fan-out por canal, não feature flag).
- Corrigir o objeto passado a `handleFanoutNotification` para ser uma row de `event_outbox` bem tipada
  (as 3 ocorrências: linhas ~530, ~555, ~579).
- Os 3 testes devem passar **verificando o mesmo comportamento de antes** (fan-out de `task.created`,
  `contract.signed`, `leads.created`). Não enfraqueça a asserção para o teste passar.
- Se a flag `notifications.rules.enabled` precisar estar ligada para o fan-out ocorrer, o teste deve
  ligá-la explicitamente — e deve existir um teste cobrindo o caminho flag-off (no-op).

## Fora de escopo (NÃO faz)

- Código de produção. Este slot **não** deve alterar `handlers/fanout-notification.ts` nem
  `modules/notifications/**` fora de `__tests__`. Se o teste revelar um bug de produção, **pare e
  reporte** — vira slot próprio.
- `workers/__tests__/notification-sla-scan.test.ts` (6 erros de tsc) → tratado por `F24-S16`.
- `handlers/__tests__/fanout-notification.test.ts` → passa; e é editado por `F24-S19`.

## Arquivos permitidos

- `apps/api/src/modules/notifications/__tests__/notifications.test.ts`

## Arquivos proibidos

- `apps/api/src/handlers/**`
- `apps/api/src/modules/notifications/senders/**`
- `apps/api/src/workers/**`
- `apps/web/**`
- `apps/api/src/db/migrations/**`

## Definition of Done

- [ ] Os 3 testes de `notifications.test.ts` passam, verificando o mesmo comportamento de antes
- [ ] `npx tsc --noEmit` não acusa mais erro em `notifications.test.ts`
- [ ] Nenhum arquivo de produção alterado
- [ ] Sem `any`, sem `as unknown as` para calar o compilador
- [ ] `pnpm --filter @elemento/api lint` verde

## Validação

```powershell
pnpm --filter @elemento/api lint
npx vitest run src/modules/notifications/__tests__/notifications.test.ts
```

## Notas para o agente

- **Não** coloque `python scripts/slot.py validate F24-S20` no bloco Validação (fork bomb — ver F24-S16).
- **Não** rode `taskkill //F //IM python.exe` — mata os agentes que rodam em paralelo.
- Rode `npx tsc --noEmit` a partir de `apps/api/` para conferir os erros do seu arquivo. Espere que
  `notification-sla-scan.test.ts` ainda acuse 6 erros (não são seus, F24-S16 cuida). Não afirme
  "typecheck verde" enquanto esses existirem — reporte o número exato.
- A tentação aqui é trocar o tipo por `any` e declarar vitória. Isso reprova o slot: o teste existe para
  provar que o fan-out entrega nos canais certos.
