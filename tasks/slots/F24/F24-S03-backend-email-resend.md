---
id: F24-S03
title: Backend — provider de email Resend + senders/email.ts real (org-aware)
phase: F24
task_ref: docs/planejamento-notificacoes.md
status: available
priority: high
estimated_size: M
agent_id: null
depends_on: []
blocks: [F24-S06]
labels: [backend, notifications, email, lgpd-impact]
source_docs: [docs/planejamento-notificacoes.md, docs/17-lgpd-protecao-dados.md]
docs_required: false
---

# F24-S03 — Backend: provider Resend + email sender real

## Objetivo

Substituir o stub de `senders/email.ts` por um sender real usando **Resend**: resolve o email do
usuário destinatário, monta template HTML **org-aware** (marca por org → white-label-ready),
faz retry com backoff e respeita a flag `notifications.email.enabled`.

## Contexto

Planejamento §4.6. Hoje `senders/email.ts` só loga e o fan-out passa `recipientEmail: '[stub]'`.
Email é PII (doc 17) → `pino.redact` cobre `email`. Não há provider configurado: adicionar env vars
em `config/env.ts`. Cliente Resend via `fetch` (sem SDK pesado) com retry. Template isolado em
módulo próprio para reuso por evento/inatividade.

## Escopo (faz)

- Env: `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_REPLY_TO`, `NOTIFICATIONS_EMAIL_ENABLED` em `config/env.ts` (Zod).
- Cliente Resend (`modules/notifications/email/resendClient.ts`): `send({ to, subject, html })`, retry
  exponencial (3 tentativas), erro tipado.
- Template org-aware (`modules/notifications/email/template.ts`): resolve nome/marca da org,
  layout HTML simples (cabeçalho com marca, corpo, CTA opcional de deep-link), placeholders já renderizados.
- `senders/email.ts` real: resolve `users.email` do destinatário; se canal email desabilitado por flag
  → no-op logado; envia via Resend; em falha após retry, loga erro estruturado (sem corpo/PII).
- Testes unitários: render do template, resolução de email, no-op por flag, retry mockado.

## Fora de escopo (NÃO faz)

- Webhook de bounce/complaint + supressão (follow-up).
- Mudar o fan-out (F24-S06).
- Templates por categoria avançados (MVP: 1 template parametrizado).

## Arquivos permitidos

- `apps/api/src/config/env.ts`
- `apps/api/src/modules/notifications/senders/email.ts`
- `apps/api/src/modules/notifications/email/resendClient.ts`
- `apps/api/src/modules/notifications/email/template.ts`
- `apps/api/src/modules/notifications/email/__tests__/email.test.ts`
- `.env.example`

## Arquivos proibidos

- `apps/web/**`
- `apps/langgraph-service/**`
- `apps/api/src/handlers/**`

## Definition of Done

- [ ] Env vars Resend validadas por Zod em `config/env.ts` + `.env.example`
- [ ] `senders/email.ts` envia de verdade via Resend, org-aware, com retry
- [ ] Email do destinatário redacted em log; nenhum corpo logado
- [ ] No-op limpo quando `notifications.email.enabled` desligada
- [ ] Testes unitários verdes
- [ ] `pnpm --filter @elemento/api typecheck` + `lint` + `test` verdes

## Validação

```powershell
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api test
python scripts/slot.py validate F24-S03
```

## Notas para o agente

- Não chamar provider em teste — mockar `resendClient`.
- `import type` para tipos; sem `any`. Marca da org: usar `organizations` (nome) como base.
