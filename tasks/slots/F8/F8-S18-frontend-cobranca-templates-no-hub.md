---
id: F8-S18
title: Frontend — plugar Cobrança + Templates WhatsApp no Hub de Configurações
phase: F8
task_ref: F8.18
status: available
priority: high
estimated_size: S
agent_id: frontend-engineer
depends_on: []
blocks: []
labels: [frontend, configuracoes, billing, templates]
source_docs:
  - docs/18-design-system.md
  - docs/10-seguranca-permissoes.md
---

# F8-S18 — Plugar Cobrança + Templates WhatsApp no Hub de Configurações

## Contexto

F5-S08 (Cobrança) e F5-S09 (Templates WhatsApp) entregaram as páginas
(`/admin/billing/dues`, `/admin/billing/rules`, `/admin/billing/jobs`,
`/admin/templates`) e as constantes `BILLING_NAV_ITEM` / `TEMPLATES_NAV_ITEM` em
`apps/web/src/app/navigation.ts`. Porém:

- Essas constantes foram exportadas mas **não foram plugadas em `APP_NAV` nem
  no `AdminSection` do `ConfiguracoesPage`**.
- Resultado: hoje **não existe link clicável em lugar nenhum da UI** para
  Cobrança ou Templates. Só batendo a URL direto na barra do navegador.

Rogério reportou o bug em 2026-05-31 ("não estou vendo a página de Cobrança
mesmo dentro de Configurações").

## Objetivo

Plugar os 4 novos cards (Cobrança — Parcelas, Cobrança — Réguas, Cobrança —
Jobs, Templates WhatsApp) no `AdminSection` do `ConfiguracoesPage`,
respeitando o padrão de gating por `hasPermission()` e — para Cobrança —
o feature flag `billing.enabled`. **Frontend puro — não toca backend.**

## Escopo

### 1. Cards no `AdminSection` (`ConfiguracoesPage.tsx`)

Adicionar dentro do grupo **Gestão** (depois dos cards de Follow-up,
antes de "Agente de IA — Prompts"):

| Card                | Rota                   | Permissão        | Feature flag      |
| ------------------- | ---------------------- | ---------------- | ----------------- |
| Cobrança — Parcelas | `/admin/billing/dues`  | `billing:read`   | `billing.enabled` |
| Cobrança — Réguas   | `/admin/billing/rules` | `billing:write`  | `billing.enabled` |
| Cobrança — Jobs     | `/admin/billing/jobs`  | `billing:read`   | `billing.enabled` |
| Templates WhatsApp  | `/admin/templates`     | `templates:read` | —                 |

- Para Cobrança: card só aparece se **permissão E flag** estiverem ativas.
  Usar `useFeatureFlags()` (mesmo hook que a Sidebar usa) com helper
  `flagEnabled(key)` retornando `true` quando status é `enabled` ou
  `internal_only`.
- Para Templates: só permissão (sem flag).
- Ícones SVG inline 24×24 no padrão dos demais (ver `IconFollowup`,
  `IconAgenteIA`). Para Cobrança use motivo de pagamento (recibo, $, calendário);
  para Templates use motivo de chat (balão de fala com linhas).

### 2. (Opcional, no mesmo slot se trivial) Sidebar principal

Avaliar se promover `BILLING_NAV_ITEM` / `TEMPLATES_NAV_ITEM` direto para
dentro de `APP_NAV` (seção nova "Comunicação" ou dentro de "Operações")
faz sentido. Se sim, plugar; se não, deixar só no Hub e remover as
constantes soltas (`BILLING_NAV_ITEM` / `TEMPLATES_NAV_ITEM`) que viraram
dead code.

> Decisão: deixar a critério do frontend-engineer, registrando a escolha
> no PR. O importante é não deixar exports não usados.

### 3. Testes

Em `ConfiguracoesPage.test.tsx`:

- Card "Cobrança — Parcelas" aparece quando `billing:read` + flag
  `billing.enabled=enabled`. Não aparece sem permissão. Não aparece sem flag.
- Card "Cobrança — Réguas" idem com `billing:write`.
- Card "Templates WhatsApp" aparece com `templates:read`; não aparece sem.

## Fora de escopo

- Mudar as páginas de Billing / Templates em si.
- Mudar permissões no backend.
- Criar slot F6.

## Arquivos permitidos

- `apps/web/src/features/configuracoes/ConfiguracoesPage.tsx`
- `apps/web/src/features/configuracoes/__tests__/ConfiguracoesPage.test.tsx`
- `apps/web/src/app/navigation.ts` (opcional — só para limpar dead code ou
  promover para `APP_NAV`)
- `apps/web/src/components/layout/Sidebar.tsx` (apenas se decidir promover
  para sidebar principal)

## Arquivos proibidos

- Qualquer coisa em `apps/api/**`
- Qualquer migration
- Páginas em `apps/web/src/features/billing/**` ou `features/templates/**`

## Definition of Done

- [ ] 4 cards novos visíveis em `/configuracoes?tab=administracao` quando
      permissões + flag forem atendidas.
- [ ] Cobrança gated por `billing:read|write` **E** flag `billing.enabled`.
- [ ] Templates gated por `templates:read`.
- [ ] Sem export não usado em `navigation.ts` (ou promovido para `APP_NAV`,
      ou removido).
- [ ] Testes de visibilidade (com/sem permissão, com/sem flag para Cobrança).
- [ ] `pnpm --filter @elemento/web typecheck && lint && test && build` verdes.
- [ ] PR com screenshot da aba Administração mostrando os 4 cards novos.

## Validação

```powershell
pnpm --filter @elemento/web test -- configuracoes
pnpm --filter @elemento/web lint
pnpm --filter @elemento/web typecheck
pnpm --filter @elemento/web build
```
