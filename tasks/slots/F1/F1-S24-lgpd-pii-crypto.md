---
id: F1-S24
title: LGPD baseline — cifração de PII em coluna + hash HMAC + Pino redact
phase: F1
task_ref: LGPD §3.4 §8.1 §8.3
status: review
priority: critical
estimated_size: M
agent_id: backend-engineer
claimed_at: 2026-05-12T00:00:00Z
completed_at: 2026-05-12T11:40:00Z
pr_url: null
depends_on: [F1-S01, F1-S09]
blocks: [F1-S25]
labels: [lgpd-impact]
source_docs:
  - docs/17-lgpd-protecao-dados.md
  - docs/10-seguranca-permissoes.md
  - docs/03-modelo-dados.md#section-3
---

# F1-S24 — LGPD baseline: cifração de PII + hash de dedupe + redact de logs

## Objetivo

Implementar o baseline técnico de proteção de PII exigido pelo doc 17 §8.1 e §8.3 — cifração em coluna de `customers.document_number` e `users.totp_secret`, hash HMAC determinístico para dedupe/busca, configuração canônica do logger Pino com `redact` da lista do §8.3, e seed de fake data sem PII real.

## Escopo

### Cifração em coluna

- Extensão `pgcrypto` já habilitada via migration 0000 (verificar e reforçar).
- `customers.document_number` muda para `bytea` cifrado (AES-256-GCM via `pgp_sym_encrypt`/`pgp_sym_decrypt` com chave de `app.lgpd_data_key`).
- `customers.document_hash` mantém `text` com HMAC-SHA256 do document_number + pepper (chave `app.lgpd_dedupe_pepper`).
- `users.totp_secret` idem — cifrado em coluna.
- Chaves vêm exclusivamente de `process.env.LGPD_DATA_KEY` e `LGPD_DEDUPE_PEPPER`. Falha de boot se ausentes em prod.
- Helpers em `apps/api/src/lib/crypto/pii.ts`:
  - `encryptPii(plain: string): Promise<Uint8Array>`
  - `decryptPii(cipher: Uint8Array): Promise<string>`
  - `hashDocument(plain: string): string` — determinístico para dedupe.
- Drizzle: custom column type `piiText` que serializa transparente via `pgp_sym_*`. Acessos não autorizados (sem permissão `customers:read_full`) devolvem a versão mascarada.

### Logger Pino canônico

- `apps/api/src/lib/logger.ts` exporta `logger` com `redact` configurado:
  - Lista: `req.headers.authorization`, `req.headers.cookie`, `res.headers["set-cookie"]`, `req.body.password`, `req.body.cpf`, `req.body.document_number`, `req.body.email`, `req.body.primary_phone`, `req.body.phone`, `req.body.birth_date`, `req.body.totp_secret`, `req.body.refresh_token`, `*.cpf`, `*.document_number`, `*.password`, `*.password_hash`, `*.refresh_token`, `*.totp_secret`.
  - Censura: `"[redacted]"`.
- Plugin Fastify registra `logger` global. Proibido criar logger paralelo.
- Teste `pino-redact.test.ts` valida que cada chave gera `[redacted]` no output.

### Sem PII real fora de produção

- Seed de fake data (`apps/api/src/db/seed-fake.ts`) usa Faker locale `pt_BR`.
- Documentar em `apps/api/README.md` que clone de produção para staging é proibido (referenciar doc 17 §9.3).

### Documentação operacional

- `apps/api/docs/runbook-key-rotation.md` — passo a passo de rotação anual das chaves `LGPD_DATA_KEY` e `LGPD_DEDUPE_PEPPER` (re-cifragem em batch, verificação, expurgo da chave antiga).

## Arquivos permitidos

- `apps/api/src/db/schema/users.ts`
- `apps/api/src/db/schema/customers.ts`
- `apps/api/src/db/migrations/000X_lgpd_pii_crypto.sql`
- `apps/api/src/lib/crypto/pii.ts`
- `apps/api/src/lib/crypto/pii.test.ts`
- `apps/api/src/lib/logger.ts`
- `apps/api/src/lib/logger.test.ts`
- `apps/api/src/db/seed-fake.ts`
- `apps/api/docs/runbook-key-rotation.md`
- `apps/api/README.md` (apenas seção LGPD)
- `.env.example` (acrescentar `LGPD_DATA_KEY`, `LGPD_DEDUPE_PEPPER`)
- `docs/17-lgpd-protecao-dados.md` (atualizar §16 marcando o item conforme avança)

## Arquivos proibidos

- Qualquer arquivo fora do path `apps/api/**` exceto os listados acima e `docs/17-*` para marcar checklist.

## Definition of Done

- [ ] Migration aplica em DB limpo e em DB com seed; rollback documentado.
- [ ] `pii.test.ts` cobre encrypt+decrypt roundtrip, falha sem chave, e determinismo do hash.
- [ ] `logger.test.ts` cobre cada padrão da lista de redact.
- [ ] Boot da API com `LGPD_DATA_KEY` vazia → falha imediata (em `NODE_ENV=production`).
- [ ] Tentativa de log com objeto contendo `cpf` claro → output mostra `[redacted]` em todos os transports.
- [ ] Seed de fake data gera CPFs sintéticos válidos (DV correto, mas explicitamente ficcionais).
- [ ] PR com label `lgpd-impact` e checklist do doc 17 §14.2 preenchido.
- [ ] Item correspondente do doc 17 §16 marcado.

## Validação

```powershell
pnpm --filter @elemento/api test -- crypto/pii logger
pnpm --filter @elemento/api db:migrate
pnpm --filter @elemento/api db:seed-fake
pnpm lint
pnpm typecheck
```
