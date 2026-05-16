---
id: F8-S09
title: Conta — self-service de perfil, senha e aparência (backend + frontend)
phase: F8
task_ref: F8.9
status: review
priority: medium
estimated_size: L
agent_id: backend-engineer
claimed_at: 2026-05-16T17:10:41Z
completed_at: 2026-05-16T17:27:13Z
pr_url:
depends_on: [F8-S08]
blocks: []
labels: []
source_docs:
  - docs/10-seguranca-permissoes.md
  - docs/17-lgpd-protecao-dados.md
  - docs/18-design-system.md
---

# F8-S09 — Aba Conta (self-service do próprio usuário)

## Contexto

F8-S08 cria o hub `/configuracoes` com a camada **Conta** como esqueleto "Em breve".
Este slot torna a Conta funcional: settings que **todo usuário autenticado** tem sobre
a própria conta, independentemente de role.

> **Vertical slice.** Este slot cruza backend (`apps/api`) e frontend (`apps/web`).
> Na implementação, fazer o backend primeiro (endpoints + testes), depois o frontend
> consumindo-os. Tudo num único branch/PR.

## Objetivo

Permitir que o usuário gerencie a própria conta: ver/editar perfil, trocar a senha, e
ajustar a aparência (tema). Sem privilégio administrativo — cada usuário só age sobre
**si mesmo** (`request.user.id`); nunca sobre outro usuário.

## Escopo

### Backend — endpoints self-service (`modules/account/`)

Auditar antes: o módulo `auth` só tem `login`/`refresh`/`logout`; não há endpoint de
perfil nem de troca de senha. Criar um módulo `account/` novo.

Todos os endpoints: `authenticate()` apenas (sem `authorize` — o recurso é o próprio
usuário). Operam sempre sobre `request.user.id`. Validação Zod em todas as bordas.

1. **`GET /api/account/profile`** — retorna `{ id, email, fullName, organizationId }`
   do usuário autenticado. Sem PII de terceiros.
2. **`PATCH /api/account/profile`** — edita `full_name` do próprio usuário. (Email é
   imutável via self-service — mudança de email é fluxo administrativo.) Audit log
   `account.profile_updated`.
3. **`POST /api/account/password`** — troca de senha. Body: `{ currentPassword,
newPassword }`. Regras:
   - Verificar `currentPassword` contra o hash atual (bcrypt) — senha errada → 400/401
     genérico, sem revelar detalhe.
   - `newPassword`: política mínima (comprimento, etc. — reusar a validação que o
     cadastro de usuário de F1-S07 já aplica, se houver; senão definir e documentar).
   - Re-hash com bcrypt. Audit log `account.password_changed`.
   - **Revogar as outras sessões** do usuário após troca de senha (invalidar
     `user_sessions` exceto a atual) — prática de segurança padrão.
   - LGPD: nunca logar `currentPassword`/`newPassword` (já coberto por `pino.redact`,
     confirmar a lista canônica do doc 17).

### 2FA / TOTP — FORA DE ESCOPO deste slot

A coluna `users.totp_secret` existe, mas **não há fluxo TOTP** em lugar nenhum (o
`login` não verifica TOTP). 2FA é uma feature de segurança que merece slot próprio e
desenho dedicado (enroll, verify, recovery codes, enforcement no login). Neste slot, a
seção "Segurança" da aba Conta tem **apenas troca de senha**; 2FA fica como item
"Em breve" visível. Reportar no PR a recomendação de um slot dedicado de 2FA.

### Frontend — aba Conta no hub `/configuracoes`

Substituir o esqueleto "Em breve" da camada Conta (criado por F8-S08) por conteúdo
funcional. Três seções:

- **Perfil** — form com `fullName` (editável) e `email` (read-only). Consome
  `GET`/`PATCH /api/account/profile` via TanStack Query + React Hook Form.
- **Segurança** — form de troca de senha (`currentPassword`, `newPassword`,
  confirmação). Consome `POST /api/account/password`. Feedback claro de sucesso/erro.
  2FA aparece como card "Em breve".
- **Aparência** — controle de tema (claro/escuro). Hoje o `ThemeToggle` vive solto na
  `Topbar`; aqui expor o mesmo controle de forma explícita (reusar o store/hook de
  tema existente — não duplicar lógica). O toggle da Topbar pode permanecer.

Tokens do DS (doc 18), light + dark, responsivo.

## Permissão / escopo

- Sem `authorize` — recurso é o próprio usuário. `authenticate()` garante identidade.
- **Nunca** aceitar um `userId` no body/params: o alvo é sempre `request.user.id`.
  Aceitar id de terceiro seria escalonamento de privilégio.

## Arquivos permitidos

- `apps/api/src/modules/account/**` (criar)
- `apps/api/src/app.ts` (registrar plugin `account`)
- `apps/web/src/features/configuracoes/**` (aba Conta — estende o que F8-S08 criou)
- `apps/web/src/hooks/account/**` (criar)

> Sem migration — `users`/`user_sessions` já têm as colunas necessárias. Se concluir
> que precisa de migration, pare e reporte.

## Definition of Done

- [ ] `GET /api/account/profile` retorna o perfil do usuário autenticado.
- [ ] `PATCH /api/account/profile` edita só o `full_name` do próprio usuário; audit log.
- [ ] `POST /api/account/password` valida senha atual, aplica política, re-hash bcrypt,
      revoga outras sessões, audit log; nunca loga senha.
- [ ] Tentativa de agir sobre outro `userId` é impossível (alvo sempre `request.user.id`).
- [ ] Aba Conta funcional no hub: Perfil + Segurança (senha) + Aparência (tema).
- [ ] 2FA visível como "Em breve" (não implementado); recomendação de slot dedicado
      no PR.
- [ ] Testes backend: perfil get/patch, troca de senha (sucesso, senha atual errada,
      política violada, revogação de sessões). Testes frontend: 3 seções renderizam e
      submetem.
- [ ] `pnpm --filter @elemento/api test && lint` verdes; `pnpm --filter @elemento/web
typecheck && lint && test && build` verdes. (typecheck da API pode ter erro
      sistêmico pré-existente de Fastify — reportar, não arrumar.)
- [ ] PR com screenshots da aba Conta (light + dark).

## Validação

```powershell
pnpm --filter @elemento/api test -- account
pnpm --filter @elemento/api lint
pnpm --filter @elemento/web test -- configuracoes
pnpm --filter @elemento/web lint
pnpm --filter @elemento/web typecheck
pnpm --filter @elemento/web build
```
