---
id: F24-S19
title: Backend — propagar rule.severity até o payload de tempo real
phase: F24
task_ref: docs/planejamento-notificacoes.md
status: review
priority: medium
estimated_size: S
agent_id: null
depends_on: [F24-S08, F24-S16]
blocks: [F24-S13]
labels: [backend, notifications, bugfix]
source_docs: [docs/23-notificacoes.md]
docs_required: false
claimed_at: 2026-07-10T15:53:26Z
completed_at: 2026-07-10T16:04:43Z
---

# F24-S19 — Backend: severity nunca chega ao frontend

## Objetivo

Fazer a `severity` configurada na regra (`info` | `warning` | `critical`) chegar ao payload
`notification.new` publicado no socket, em vez de todo evento sair como `'info'`.

## Contexto

Achado do gate de segurança do `F24-S08` (2026-07-10):

`F24-S08` adicionou `severity?: NotificationSocketSeverity` em `InAppSenderInput`
(`senders/inApp.ts`, default `'info'`) e transporta o valor até o payload do socket
(`notifications/realtime.ts`). Mas **nenhum dos dois call-sites reais passa o campo**:

- `handlers/fanout-notification.ts:224` — tem `rule.severity` disponível ao montar o contexto da regra
  (`notification-rules/service.ts:189`, tipado `'info'|'warning'|'critical'`) e não repassa.
- `workers/notification-sla-scan.ts:98` — mesma situação.

Resultado: o campo existe, é tipado, viaja pelo socket — e é sempre `'info'`. O `F24-S13` (sino em
tempo real) vai estilizar badge/toast por severidade e receberá neutro para toda regra `critical`.

Nota: `notifications` **não tem** coluna `severity` (é um campo de transporte, não persistido). Isso é
intencional e não deve mudar neste slot.

### Segundo defeito: o worker engole exceções sem log

`workers/notification-sla-scan.ts` (herdado de `F24-S07`, linhas ~124, ~254, ~258) tem três blocos:

```ts
} catch {
  /* isolado */
}
```

O isolamento por regra/entidade está **certo** (uma regra ruim não pode derrubar o scan das outras orgs),
mas o erro é descartado **sem nenhum log**. Consequência prática: `F24-S16` fez `findSlaSources` lançar
`AppError(422)` em `trigger_key` desconhecido — "erro explícito em vez de silêncio" — e esse erro é
engolido aqui. O fix do S16 fica invisível em produção. Foi exatamente esse padrão de falha muda que
manteve o bug dos 6 eixos escondido.

## Escopo (faz)

- `workers/notification-sla-scan.ts`: trocar os três `catch {}` mudos por `catch (err: unknown)` com log
  estruturado (`logger.error`/`warn`), incluindo `rule_id`, `trigger_key`, `organization_id` e, quando
  houver, `entity_id`. **Manter o isolamento** — continuar sem relançar. Sem PII no log.
- `handlers/fanout-notification.ts`: repassar `rule.severity` na chamada a `sendInApp`
  (via `dispatchToChannel`/params, sem alterar a assinatura pública de `dispatchToChannel` se possível).
- `workers/notification-sla-scan.ts`: idem, repassar `rule.severity` ao `sendInApp`.
- Testes: regra `critical` → payload do socket sai `critical`; regra sem `severity` → `'info'` (default
  preservado); canal e-mail não é afetado.

## Fora de escopo (NÃO faz)

- Coluna `severity` em `notifications` (campo é de transporte, por decisão de F24-S08).
- Frontend / badge / toast (F24-S13).
- Eixos de inatividade (F24-S16) e flag de e-mail (F24-S18).
- Migrations.

## Arquivos permitidos

- `apps/api/src/handlers/fanout-notification.ts`
- `apps/api/src/handlers/__tests__/fanout-notification.test.ts`
- `apps/api/src/workers/notification-sla-scan.ts`
- `apps/api/src/workers/__tests__/notification-sla-scan.test.ts`

## Arquivos proibidos

- `apps/web/**`
- `apps/langgraph-service/**`
- `apps/api/src/db/migrations/**`
- `apps/api/src/modules/notifications/realtime.ts`

## Definition of Done

- [ ] `rule.severity` chega ao payload `notification.new` a partir do fan-out de evento
- [ ] `rule.severity` chega ao payload a partir do worker de SLA
- [ ] Regra sem `severity` continua produzindo `'info'` (sem regressão)
- [ ] `notifications` segue sem coluna `severity` (nenhuma migration)
- [ ] Nenhum `catch {}` mudo em `notification-sla-scan.ts`: todos logam com contexto e sem PII
- [ ] O isolamento por regra/entidade é preservado (erro não derruba o tick das outras orgs)
- [ ] Teste: `trigger_key` inválido gera log de erro e não interrompe o processamento das demais regras
- [ ] `pnpm --filter @elemento/api typecheck` + `lint` + `test` verdes

## Validação

```powershell
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api test
```

## Notas para o agente

- **Não** coloque `python scripts/slot.py validate F24-S19` no bloco Validação (fork bomb — ver F24-S16).
- `depends_on` inclui `F24-S16` porque aquele slot também edita `notification-sla-scan.ts` e seu teste —
  espere ele mergear para evitar conflito, não porque haja dependência lógica.
- O default `'info'` está em `senders/inApp.ts` e deve continuar sendo a única fonte do default.
