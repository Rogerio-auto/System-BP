---
id: F8-S11
title: 2FA / TOTP — enrolment, verificação, recovery codes e enforcement no login
phase: F8
task_ref: F8.11
status: available
priority: medium
estimated_size: L
agent_id: backend-engineer
claimed_at:
completed_at:
pr_url:
depends_on: [F8-S09]
blocks: []
labels: []
source_docs:
  - docs/10-seguranca-permissoes.md
  - docs/17-lgpd-protecao-dados.md
  - docs/18-design-system.md
---

# F8-S11 — Autenticação de dois fatores (TOTP)

## Contexto

F8-S09 entregou a aba Conta com a seção Segurança contendo só troca de senha; 2FA ficou
como card "Em breve". A tabela `users` já tem a coluna `totp_secret`, mas **não há
nenhum fluxo TOTP** — o `login` não verifica segundo fator. Este slot implementa 2FA
TOTP de ponta a ponta.

> **Vertical slice.** Cruza backend (`apps/api`) e frontend (`apps/web`) num único
> branch/PR. Backend primeiro, depois o frontend consumindo.

## Objetivo

Permitir que cada usuário ative 2FA via app autenticador (TOTP), com recovery codes, e
que o login passe a exigir o segundo fator quando ele estiver ativo.

## Escopo

### Backend

Estender o módulo `account/` (criado em F8-S09) e o módulo `auth/`.

**Enrolment / gestão (em `account/`, `authenticate()` apenas, alvo sempre
`request.user.id`):**

- `POST /api/account/2fa/enroll` — gera um segredo TOTP, persiste como _pendente_ (ainda
  não ativo), retorna o `otpauth://` URI (para o frontend renderizar QR) e o segredo em
  base32 para entrada manual. Não ativa ainda.
- `POST /api/account/2fa/activate` — recebe um código TOTP; se válido, ativa o 2FA,
  gera e retorna os **recovery codes** (uma única vez — exibidos só agora). Audit
  `account.2fa_enabled`.
- `POST /api/account/2fa/disable` — exige um código TOTP válido (ou recovery code) +
  confirmação; desativa o 2FA, limpa segredo e recovery codes. Audit `account.2fa_disabled`.
- `GET /api/account/2fa/status` — retorna `{ enabled: boolean }` (ou incluir no
  `GET /api/account/profile` existente — decisão do engenheiro, registrar no PR).

**Login enforcement (em `auth/`):**

- O fluxo de login passa a verificar se o usuário tem 2FA ativo. Se sim, o login não
  emite os tokens direto — exige um passo de segundo fator (código TOTP ou recovery
  code) antes de emitir a sessão. Desenhar o fluxo (ex: login retorna um estado
  "2fa_required" + um token curto de desafio; um segundo endpoint troca código por
  sessão). Decisão de desenho registrada no PR — manter consistente com o padrão de
  sessão/CSRF já existente no `auth/`.
- Recovery code: consumível uma única vez (marcar como usado após o uso).

**Segurança / LGPD:**

- `totp_secret` e recovery codes **cifrados em repouso** — seguir o padrão de cripto de
  coluna que o doc 17 / a infra de PII já usa (não guardar segredo em texto puro).
  Recovery codes: guardar **hash**, não o valor (como senha).
- Nunca logar segredo TOTP, códigos nem recovery codes — adicionar à lista do
  `pino.redact`.
- Janela de tolerância do TOTP: ±1 step (padrão), para tolerar drift de relógio.
- Rate limiting / proteção contra brute force no endpoint de verificação de código.

### Migration

Provavelmente necessária — `users.totp_secret` existe, mas faltam: flag de 2FA ativo
(ou `totp_confirmed_at`), e armazenamento dos recovery codes (tabela nova
`user_recovery_codes` ou coluna jsonb). Desenhar o schema mínimo e gerar a migration
(próximo número livre — conferir `_journal.json`, `when` monotônico,
`slot.py check-migrations`).

### Frontend

Seção Segurança da aba Conta (`features/configuracoes/`) — substituir o card
"2FA — Em breve" por um fluxo real:

- Estado desativado: botão "Ativar 2FA" → modal/wizard: exibe QR (de `otpauth://` —
  usar uma lib de QR ou gerar SVG), campo para o código de ativação, e ao ativar
  mostra os recovery codes uma única vez (com aviso para guardá-los).
- Estado ativado: indicador "2FA ativo" + botão "Desativar" (pede código).
- Tokens do DS (doc 18), light + dark.

O passo de segundo fator no **login** também precisa de UI (tela/etapa de inserir o
código TOTP após senha correta).

## Arquivos permitidos

- `apps/api/src/modules/account/**`
- `apps/api/src/modules/auth/**`
- `apps/api/src/app.ts` (só se registrar algo novo)
- `apps/api/src/db/schema/**` (coluna/tabela de 2FA)
- `apps/api/src/db/migrations/00NN_*.sql` + `meta/_journal.json` + `meta/00NN_snapshot.json`
- `apps/web/src/features/configuracoes/**`
- `apps/web/src/features/auth/**` (etapa de 2FA no login)
- `apps/web/src/hooks/account/**`
- `apps/web/src/lib/api.ts` (só se o contrato de login mudar)
- testes correspondentes

## Definition of Done

- [ ] Enroll → activate → 2FA ativo; QR escaneável por app autenticador real.
- [ ] Recovery codes gerados na ativação, exibidos uma única vez, guardados como hash.
- [ ] Login com 2FA ativo exige o segundo fator antes de emitir sessão.
- [ ] Recovery code funciona como segundo fator e é consumível uma única vez.
- [ ] Disable exige segundo fator; limpa segredo e recovery codes.
- [ ] `totp_secret` e recovery codes cifrados/hasheados em repouso; nada em texto puro;
      `pino.redact` cobre os campos sensíveis.
- [ ] Migration com `when` monotônico; `slot.py check-migrations` verde.
- [ ] Testes backend (enroll, activate código certo/errado, login com/sem 2FA, recovery
      code single-use, disable) e frontend (seção Segurança, etapa de login).
- [ ] `pnpm --filter @elemento/api test && lint` e `pnpm --filter @elemento/web
    typecheck && lint && test && build` verdes.
- [ ] PR com screenshots do fluxo (ativação + login com 2FA).

## Validação

```powershell
pnpm --filter @elemento/api db:migrate
python scripts/slot.py check-migrations
pnpm --filter @elemento/api test -- account auth
pnpm --filter @elemento/api lint
pnpm --filter @elemento/web typecheck
pnpm --filter @elemento/web test
pnpm --filter @elemento/web build
```
