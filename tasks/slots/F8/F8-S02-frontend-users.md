---
id: F8-S02
title: Frontend gestão de usuários (admin/users)
phase: F8
task_ref: F8.2
status: done
priority: high
estimated_size: M
agent_id: frontend-engineer
claimed_at: 2026-05-15T19:30:02Z
completed_at: 2026-05-15T19:47:57Z
pr_url: https://github.com/Rogerio-auto/System-BP/pull/65
depends_on: [F1-S07, F1-S08]
blocks: []
labels: []
source_docs:
  - docs/18-design-system.md
  - docs/design-system/index.html
  - docs/10-seguranca-permissoes.md
---

# F8-S02 — Frontend gestão de usuários

## Objetivo

Tela `/admin/users` para gerenciar usuários do sistema (login + acesso), consumindo o backend
de F1-S07 que já expõe os 7 endpoints (`list/create/update/deactivate/reactivate/set-roles/
set-city-scopes`). Hoje o admin só consegue cadastrar usuário via SQL ou Postman.

Padrão visual deve seguir o DS oficial (Bricolage para títulos, Geist para body, profundidade
e hovers do `docs/18-design-system.md`).

## Escopo

### Tela `/admin/users`

- Header com título "Usuários" (Bricolage), subtítulo caption, botão primário "Novo usuário".
- Tabela densa (`Table` do DS, §9.7) com colunas: nome + avatar, email, roles (chips de
  `Badge`), cidades de escopo (resumo: "Porto Velho +3" se >1), status (Badge `active`/
  `inactive`), último login (formatRelativeDate), ações (kebab menu).
- Filtros na barra superior: busca (Input, debounce 300ms), filtro por role (Select), filtro
  por status, filtro por cidade.
- Paginação cursor (TanStack Query infinite ou paginated — escolher conforme padrão de
  `CrmListPage`).
- Stats row no topo: total ativos, total inativos, último cadastro (Stat primitivo do DS).

### Drawer "Novo usuário" / "Editar usuário"

- Drawer lateral direito (não modal) — coerente com `CrmDetailPage` para edição inline.
- Form Zod (compartilhado com backend via `packages/shared-schemas`).
- Campos: nome completo, email, senha temporária (só no create — mostrar com botão de copiar
  - flag `must_change_password` exibida).
- Sub-seção "Roles": multi-select com chips (use Badge variants do DS). Disable da role
  `admin` se for o último admin (avisar via Toast).
- Sub-seção "Escopo de cidades": multi-select com chips. Se role tem `scope=global`,
  ocultar/desabilitar a sub-seção e mostrar caption "Esta role tem acesso global".
- Ações: "Salvar" (primary), "Cancelar", "Desativar" (destructive, com confirmação) no caso
  de edição.

### Estados

- Loading inicial: skeleton de tabela.
- Empty (sem usuários): ilustração + CTA "Criar primeiro usuário".
- Erro: card com Retry.
- Toast de sucesso após create/update/deactivate.

### Acesso

- Rota protegida por `AuthGuard`. Adicionar verificação de permissão `users:admin` no
  componente (esconder item de menu se não tiver).
- Atualizar `Sidebar` com item "Usuários" sob seção "Administração".

## Arquivos permitidos

- `apps/web/src/pages/admin/Users.tsx`
- `apps/web/src/features/admin/users/UserList.tsx`
- `apps/web/src/features/admin/users/UserDrawer.tsx`
- `apps/web/src/features/admin/users/UserRoleSelect.tsx`
- `apps/web/src/features/admin/users/UserCityScopesSelect.tsx`
- `apps/web/src/features/admin/users/__tests__/UserDrawer.test.tsx`
- `apps/web/src/hooks/admin/useUsers.ts`
- `apps/web/src/hooks/admin/useUsers.types.ts`
- `apps/web/src/App.tsx` (registrar rota `/admin/users`)
- `apps/web/src/components/layout/Sidebar.tsx` (adicionar item de menu)

## Definition of Done

- [ ] Tela lista usuários com filtros funcionais (busca + role + status + cidade).
- [ ] Tabela usa `Table` canônico, Badge para status e roles, Avatar com `--grad-rondonia`.
- [ ] Criar usuário via drawer funciona; mostra senha temporária com botão copiar.
- [ ] Editar usuário atualiza roles e city scopes via 2 chamadas separadas
      (`PUT /roles` + `PUT /city-scopes`) — service trata as duas em sequência.
- [ ] Desativar/reativar funciona com confirmação.
- [ ] Bloqueio visual de desativar o último admin (Toast warning).
- [ ] Sidebar mostra "Usuários" sob "Administração" apenas com permissão `users:admin`.
- [ ] Funciona em ambos os temas (light + dark) sem regressão.
- [ ] Tests: drawer fecha após sucesso, validações Zod aparecem, mostra erro de email
      duplicado.
- [ ] PR com screenshots (lista + drawer create + drawer edit, light + dark).

## Validação

```powershell
pnpm --filter @elemento/web test -- admin/users
pnpm --filter @elemento/web lint
pnpm --filter @elemento/web typecheck
pnpm --filter @elemento/web build
```
