---
id: F24-S18
title: Backend — flag notifications.email.enabled passa a gatear o envio de e-mail
phase: F24
task_ref: docs/planejamento-notificacoes.md
status: done
priority: high
estimated_size: S
agent_id: null
depends_on: [F24-S03]
blocks: []
labels: [backend, notifications, feature-flag, bugfix]
source_docs: [docs/09-feature-flags.md, docs/23-notificacoes.md]
docs_required: false
claimed_at: 2026-07-10T15:14:44Z
completed_at: 2026-07-10T15:28:09Z
pr_url: https://github.com/Rogerio-auto/System-BP/pull/416
---

# F24-S18 — Backend: a flag de e-mail não gateia nada

## Objetivo

Fazer a feature flag `notifications.email.enabled` realmente controlar o envio de e-mail, como o
planejamento §4 e o runbook de go-live afirmam.

## Contexto

Confirmado no código em 2026-07-10: `notifications.email.enabled` existe no seed
(`db/seeds/featureFlags.ts`) e na migration `0077`, e o runbook manda virá-la no go-live — mas
`senders/email.ts` só consulta a **env var** `NOTIFICATIONS_EMAIL_ENABLED`. A flag é **morta**:
virá-la no painel não liga nem desliga nada. Quem opera o go-live acredita ter ligado o canal e não ligou.

O planejamento exige **flag em 4 camadas**; hoje o canal de e-mail tem só a camada de env.

`sendEmail(input, db)` já recebe o `Database`, então o gate é barato.

## Escopo (faz)

- Em `senders/email.ts`, aplicar `requireFlag(db, 'notifications.email.enabled', logger)` **além** da
  checagem de `env.NOTIFICATIONS_EMAIL_ENABLED`.
  - Semântica: **as duas** precisam estar ligadas para enviar (env = infraestrutura/credenciais,
    flag = decisão operacional por org). Flag off → no-op limpo + log estruturado, como já acontece
    hoje quando a env está off. Sem exceção, sem quebrar o fan-out.
  - Ordem: checar a env primeiro (barato, sem I/O), depois a flag (consulta ao banco).
- Testes em `email/__tests__/email.test.ts`: flag off + env on → no-op; flag on + env off → no-op;
  ambas on → envia; a checagem de flag não é feita quando a env já está off (sem I/O desnecessário).
- Atualizar a seção de divergências de `docs/23-notificacoes.md`: remover o aviso de "flag morta"
  para `notifications.email.enabled` e descrever a semântica de duas camadas.

## Fora de escopo (NÃO faz)

- Worker de SLA / eixos de inatividade (F24-S16).
- `notifications.realtime.enabled` (já gateado corretamente por F24-S08).
- Templates de e-mail, provider, retry.
- Migrations.

## Arquivos permitidos

- `apps/api/src/modules/notifications/senders/email.ts`
- `apps/api/src/modules/notifications/email/__tests__/email.test.ts`
- `docs/23-notificacoes.md`

## Arquivos proibidos

- `apps/web/**`
- `apps/langgraph-service/**`
- `apps/api/src/db/migrations/**`
- `apps/api/src/workers/**`

## Definition of Done

- [ ] `sendEmail` faz no-op quando `notifications.email.enabled` está off, mesmo com a env on
- [ ] `sendEmail` segue fazendo no-op quando a env está off (comportamento atual preservado)
- [ ] Flag off não lança nem interrompe o fan-out — só loga e retorna
- [ ] Env off evita a consulta de flag (sem I/O desnecessário)
- [ ] Testes cobrem as 4 combinações de env × flag
- [ ] `docs/23-notificacoes.md` não descreve mais a flag como morta
- [ ] `pnpm --filter @elemento/api typecheck` + `lint` + `test` verdes

## Validação

```powershell
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api test
```

## Notas para o agente

- **Não** coloque `python scripts/slot.py validate F24-S18` no bloco Validação (fork bomb — ver F24-S16).
- `requireFlag` já é usado em `notification-sla-scan.ts` e em `notifications/realtime.ts` — siga o mesmo
  padrão de chamada e de log, não invente helper novo.
- O e-mail é o único canal que sai da rede: se a flag falhar a consulta (banco indisponível), **não** envie.
  Fail-closed, e logue o motivo.
