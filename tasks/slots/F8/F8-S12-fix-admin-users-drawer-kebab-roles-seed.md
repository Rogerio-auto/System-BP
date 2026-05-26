---
id: F8-S12
title: Fix /admin/users — drawer transparente, kebab clipado, roles vazias, seed sem credit_analyses
phase: F8
task_ref: hotfix
status: done
priority: high
estimated_size: M
agent_id: ''
claimed_at: 2026-05-26T16:26:11Z
completed_at: 2026-05-26T16:35:50Z
pr_url: https://github.com/Rogerio-auto/System-BP/pull/157
depends_on: []
blocks: []
labels: []
source_docs:
  - tasks/PROTOCOL.md
  - docs/18-design-system.md
  - apps/web/src/styles/globals.css
---

# F8-S12 — Fix /admin/users (4 bugs visíveis + seed sem credit_analyses)

## Contexto (auditoria 2026-05-26)

Rogério reportou 4 bugs visíveis em `/admin/users` + 1 sintoma de RBAC (403 em
`/api/credit-analyses`). Investigação encontrou as causas raízes — todas em
código, todas determinísticas.

### Bug 1 — Drawer de editar usuário com fundo transparente

`apps/web/src/features/admin/users/UserDrawer.tsx:645` usa
`background: 'var(--surface-1)'`. Grep em `apps/web/src/styles/globals.css`:

```
$ grep -n "surface-1\|bg-elev-1" globals.css
82:  --bg-elev-1:    #FFFFFF;
186:  --bg-elev-1:     #131D38;
```

**`--surface-1` não existe.** O DS canônico (`docs/18-design-system.md` §6.3,
tabela de tokens) define `--bg-elev-1/2/3`, `--bg-inset`, `--surface-muted`,
`--surface-hover`. Não há `--surface-1`. Variável indefinida em CSS é
tratada como `initial`, que para `background` resolve para `transparent`.

8 arquivos cometem o mesmo erro:

```
apps/web/src/components/ui/Button.tsx
apps/web/src/features/admin/users/UserRoleSelect.tsx
apps/web/src/features/admin/users/UserDrawer.tsx
apps/web/src/features/admin/users/UserCityScopesSelect.tsx
apps/web/src/features/admin/agents/AgentDrawer.tsx
apps/web/src/features/admin/agents/UserCombobox.tsx
apps/web/src/features/admin/agents/AgentCitiesSelect.tsx
apps/web/src/features/configuracoes/ai-console/playground/PlaygroundForm.tsx
```

### Bug 2 — Cursor "blocked" ao tentar adicionar role

`apps/web/src/hooks/admin/useUsers.ts:66-71`:

```ts
const RoleResponseSchema = z.object({
  id: z.string().uuid(),
  key: z.string(),
  label: z.string(), // ← UI espera 'label'
  description: z.string().nullable().optional(),
});
```

Backend retorna `{ id, key, name, scope, description }` (confirmado em
`apps/api/src/modules/roles/__tests__/routes.test.ts:170-188` e na fixture
`FIXTURE_ROLES`). Zod rejeita o parse — falta `label`, sobra `name`.

`apiListRoles()` tem `try { … } catch { return []; }` — silencia o erro,
devolve `roles = []`. `UserRoleSelect.tsx:150` desabilita o trigger:

```ts
disabled={disabled || availableRoles.length === 0}
```

Com `roles=[]`, `availableRoles=[]` → botão fica `disabled:cursor-not-allowed`
(Tailwind), que é o ícone bloqueado que o Rogério viu.

### Bug 3 — Menu de 3-pontinhos abre dentro do row (precisa scrolar)

`apps/web/src/features/admin/users/UserList.tsx:430-437` envolve a tabela em
2 containers de overflow:

```tsx
<div className="rounded-md border border-border overflow-hidden" …>
  <div className="overflow-x-auto">
    <table …>
```

O `KebabMenu` (mesma file, linhas 240-358) usa `<div className="relative inline-flex">`
com dropdown `<div className="absolute right-0 top-full mt-1 …">`. O posicionamento
`absolute` sobe pela cadeia procurando o primeiro ancestral `position: relative` —
nesse caso é o próprio container do kebab, mas o dropdown **renderiza dentro
das fronteiras visuais clipadas** pelos dois `overflow-*` pais.

Pior: `tr` no hover seta `position: 'relative'` + `zIndex: '1'` inline
(linhas 498-513) — cria stacking context que prende o dropdown de `z-10`
junto.

O `UserDrawer` (mesma feature) já portaliza para `document.body` (linha 621).
O `KebabMenu` deveria fazer o mesmo. Padrão Linear/Stripe.

### Bug 4 — EditUserForm não pré-popula as roles do usuário

`apps/web/src/features/admin/users/UserDrawer.tsx:359-366`:

```ts
const { register, control, … } = useForm<UserFormValues>({
  resolver: zodResolver(UserFormSchema),
  defaultValues: {
    fullName: user.fullName,
    email: user.email,
    roleIds: [],                  // ← deveria ser user.roles.map(r => r.id)
    cityIds: [],                  // ← idem
  },
});
```

`UserFormSchema.roleIds.min(1)` exige pelo menos 1 role. Como o form inicia
vazio, o submit reprovaria mesmo se o Bug 2 não existisse. Em conjunto com
Bug 2, fica impossível salvar.

**Pré-condição:** o `UserResponse` precisa ter `roles` + `cityScopes`. Verificar
no tipo `apps/web/src/hooks/admin/useUsers.types.ts` se já estão lá; se não
estiverem, ler do backend (rota `GET /api/admin/users/:id`).

### Bug 5 — Seed.ts não tem credit_analyses:\* em ROLE_PERMISSIONS

`apps/api/scripts/seed.ts:183-221` lista as permissões da role admin. Inclui
`analyses:read` (legado) mas **não** lista as 4 permissões criadas pela
migration `0033_seed_credit_analyses_permissions.sql`:

- `credit_analyses:read`
- `credit_analyses:write`
- `credit_analyses:decide`
- `credit_analyses:request_review`

O seed usa `INSERT … ON CONFLICT DO NOTHING` (linha 417), então **não remove**
as permissões que a migration 0033 inseriu. Ambas as fontes coexistem em ambientes
saudáveis. Mas:

- Em ambientes onde a migration 0033 não foi aplicada (DB recriado, dump
  antigo, gap na sequência), o admin fica sem essas permissões → 403 em
  `/api/credit-analyses` mesmo logando como admin do seed.
- Princípio de canonicidade: o seed deveria ser sempre suficiente. Migrations
  são fonte de schema/dados, não fonte autoritativa de RBAC seed.

Atribuir também a `gestor_geral`/`gestor_regional`/`agente` conforme a doc
de RBAC (`docs/10-seguranca-permissoes.md` §3.3 + migration 0033 §3-5):

- `admin`: read + write + decide + request_review
- `gestor_geral`: read + write + decide
- `gestor_regional`: read + write + decide (city-scoped no service)
- `agente`: read + request_review

## Objetivo

Resolver os 5 bugs num único PR. Após merge:

- Editar usuário em `/admin/users` mostra drawer com fundo opaco (DS-compliant).
- Botão "Adicionar role" funciona, mostra todas as roles do banco.
- Editar pré-popula `roleIds` e `cityIds` com os valores atuais do usuário.
- Menu 3-pontinhos abre **fora** do row, sem clip.
- `pnpm --filter @elemento/api db:seed` (ré-execução em DB existente, idempotente)
  garante que admin tem `credit_analyses:*`.

## Escopo

### 1. CSS variable canon (`--surface-1` → `--bg-elev-1`)

Em todos os 8 arquivos listados na §Bug 1, substituir `var(--surface-1)` por
`var(--bg-elev-1)`. Validar visualmente que o resultado bate com o DS (drawers
ficam brancos no light theme, navy no dark — não cinza muted).

Não definir `--surface-1` como alias. Token não-canônico não entra no DS por
acidente. Doc 18 §6.3 é lei.

### 2. Zod schema do useRoles (label ↔ name)

`apps/web/src/hooks/admin/useUsers.ts:66-71`:

- Trocar `label: z.string()` por `name: z.string()` (alinha com o backend canônico).
- Adicionar `scope: z.enum(['global', 'city']).optional()` (também vem do
  backend; ainda não consumido pela UI mas evita drift futuro).
- Em `apiListRoles()` (linha 117), mapear `r.name` → `RoleOption.label`
  (a UI continua usando `label` como nome do campo no `RoleOption`).
- Verificar `apps/web/src/hooks/admin/useUsers.types.ts` — se `RoleOption`
  expõe `label`, manter; o mapeamento acontece no client adapter.

### 3. KebabMenu via portal

`apps/web/src/features/admin/users/UserList.tsx:204-358`:

- Refatorar `KebabMenu` para usar `createPortal` (já importado no UserDrawer —
  padrão consistente).
- Calcular posição via `triggerRef.current?.getBoundingClientRect()`. Posicionar
  o dropdown em `position: fixed` com `top` e `right` derivados do rect.
  Tratar viewport bounds (não sair da tela).
- z-index `z-[120]` ou similar — acima da tabela, abaixo do drawer (z-[160]).
- Manter o "fechar ao clicar fora" + "fechar com Escape" — adicionar listeners
  no `document` como o `UserRoleSelect` já faz.
- O hover de row (`onMouseEnter` que seta `transform`/`zIndex`/`position`) pode
  continuar — não interfere mais porque o dropdown saiu do DOM da tabela.

### 4. EditUserForm — pré-popular roleIds e cityIds

`apps/web/src/features/admin/users/UserDrawer.tsx:332-366`:

- `defaultValues.roleIds` deve derivar de `user.roles?.map(r => r.id) ?? []`.
- `defaultValues.cityIds` deve derivar de `user.cityScopes?.map(s => s.cityId) ?? []`.
- Se `UserResponse` não tem essas propriedades, ler do backend via
  `GET /api/admin/users/:id` em um `useQuery` no `EditUserForm` — não duplicar
  com a lista. Verificar `apps/web/src/hooks/admin/useUsers.ts` se já existe
  `useUser(id)` ou similar.

### 5. seed.ts — adicionar credit_analyses:\*

`apps/api/scripts/seed.ts:183-221` e blocks adjacentes:

- Adicionar `credit_analyses:read`, `credit_analyses:write`,
  `credit_analyses:decide`, `credit_analyses:request_review` ao bloco
  `admin`.
- `gestor_geral`: `credit_analyses:read`, `credit_analyses:write`,
  `credit_analyses:decide`.
- `gestor_regional`: idem `gestor_geral`.
- `agente`: `credit_analyses:read`, `credit_analyses:request_review`.
- Verificar lista de PERMISSIONS no início do seed (linha ~143) — adicionar
  as 4 entries com `description` se ainda não estiverem ali (idempotente
  contra migration 0033 que também as cria).

Migration 0033 continua existindo — ela é a fonte de schema. Seed.ts vira a
fonte canônica de RBAC para ambientes recriados.

### 6. Testes

Adicionar/atualizar testes mínimos:

- `apps/web/src/features/admin/users/__tests__/UserList.test.tsx`: kebab abre
  fora do row (verificar que o dropdown está em `document.body`, não em
  `tbody`).
- `apps/web/src/features/admin/users/__tests__/UserDrawer.test.tsx`: edit
  pré-popula `roleIds` com `user.roles`.
- `apps/web/src/hooks/admin/__tests__/useUsers.test.ts` (criar se não existir):
  `apiListRoles` parseia payload com `name` (não `label`).
- `apps/api/scripts/__tests__/seed.test.ts` ou similar — opcional, dado que
  o seed roda em integração; ao menos validar que o array de permissions
  inclui `credit_analyses:read`.

## Fora de escopo

- Não introduzir token `--surface-1` no globals.css. Token não-canônico não
  entra no DS por acidente.
- Não refatorar o DS inteiro (`docs/18-design-system.md`). Esse é trabalho
  de slot dedicado.
- Não tocar nas migrations existentes — `0033_seed_credit_analyses_permissions.sql`
  continua como está. O seed agrega, não substitui.
- Não alterar `AgentDrawer.tsx`, `UserCombobox.tsx`, `AgentCitiesSelect.tsx`,
  `PlaygroundForm.tsx`, `Button.tsx` para além da substituição
  `var(--surface-1)` → `var(--bg-elev-1)`. Esses arquivos têm bugs análogos
  ao Bug 4 (forms não-pré-populados) que ficam fora deste slot — abrir
  follow-up se descoberto.

## Arquivos permitidos

- `apps/web/src/features/admin/users/UserDrawer.tsx`
- `apps/web/src/features/admin/users/UserList.tsx`
- `apps/web/src/features/admin/users/UserRoleSelect.tsx`
- `apps/web/src/features/admin/users/UserCityScopesSelect.tsx`
- `apps/web/src/features/admin/agents/AgentDrawer.tsx` (apenas swap CSS var)
- `apps/web/src/features/admin/agents/UserCombobox.tsx` (apenas swap CSS var)
- `apps/web/src/features/admin/agents/AgentCitiesSelect.tsx` (apenas swap CSS var)
- `apps/web/src/components/ui/Button.tsx` (apenas swap CSS var)
- `apps/web/src/features/configuracoes/ai-console/playground/PlaygroundForm.tsx` (apenas swap CSS var)
- `apps/web/src/hooks/admin/useUsers.ts`
- `apps/web/src/hooks/admin/useUsers.types.ts` (apenas se necessário)
- `apps/web/src/features/admin/users/__tests__/UserList.test.tsx` (criar/atualizar)
- `apps/web/src/features/admin/users/__tests__/UserDrawer.test.tsx` (criar/atualizar)
- `apps/web/src/hooks/admin/__tests__/useUsers.test.ts` (criar)
- `apps/api/scripts/seed.ts`

## Arquivos proibidos

- `apps/api/src/db/migrations/**` — migration 0033 está correta, não tocar.
- `apps/api/src/modules/roles/**` — endpoint backend está correto (returns `name`).
  Fix é client-side adaptar para o contrato canônico.
- `apps/web/src/styles/globals.css` — não introduzir `--surface-1`.
- `docs/18-design-system.md` — DS é lei, não muda neste slot.

## Definition of Done

- [ ] `grep -rn "var(--surface-1)" apps/web/src` retorna 0 ocorrências.
- [ ] `RoleResponseSchema` em `useUsers.ts` espera `name` (não `label`).
- [ ] `apiListRoles()` retorna lista não-vazia com fixture-backend canônico.
- [ ] `KebabMenu` renderiza dropdown via `createPortal(document.body)`.
- [ ] `EditUserForm` `defaultValues.roleIds` deriva de `user.roles`.
- [ ] `apps/api/scripts/seed.ts` `ROLE_PERMISSIONS.admin` inclui as 4
      `credit_analyses:*`; idem para `gestor_geral`/`gestor_regional`/`agente`
      conforme escopo.
- [ ] `pnpm --filter @elemento/web typecheck` verde.
- [ ] `pnpm --filter @elemento/web lint --max-warnings 0` verde.
- [ ] `pnpm --filter @elemento/web test` verde.
- [ ] `pnpm --filter @elemento/web build` verde.
- [ ] `pnpm --filter @elemento/api typecheck` verde.
- [ ] `pnpm --filter @elemento/api lint --max-warnings 0` verde.
- [ ] `pnpm --filter @elemento/api test` verde.
- [ ] PR descreve passos de validação manual para Rogério: (a) abrir
      `/admin/users` em light theme — drawer opaco; (b) clicar 3-pontinhos no
      último row da lista — menu aparece acima sem scroll; (c) editar usuário
      — roles pré-populadas; (d) adicionar role — dropdown abre; (e)
      `pnpm --filter @elemento/api db:seed` + recarregar — admin acessa
      `/credit-analyses` sem 403.

## Validação

```powershell
pnpm --filter @elemento/web typecheck
```

```powershell
pnpm --filter @elemento/web lint
```

```powershell
pnpm --filter @elemento/web test
```

```powershell
pnpm --filter @elemento/web build
```

```powershell
pnpm --filter @elemento/api typecheck
```

```powershell
pnpm --filter @elemento/api lint
```

```powershell
pnpm --filter @elemento/api test
```

## Notas

- O 403 em `/api/credit-analyses` para o usuário `admin@bdp.ro.gov.br`
  confirmou que a migration 0033 ou não rodou no DB local do Rogério ou
  o user_roles do admin perdeu sincronia. O fix do seed.ts garante
  idempotência. Após o merge, recomendar `pnpm --filter @elemento/api db:seed`.
- Bug origem do `--surface-1`: introduzido em F8-S02 / F8-S08 / F9-S07
  (commits que criaram drawers/forms novos). Não cobre o DS canônico — falha
  de revisão de PR à época. Este slot fecha a regressão.
- Bug origem do `label` vs `name`: contrato backend foi alterado em F8-S06
  (introduziu `name` + `scope`) mas o consumer frontend em F8-S02 já
  esperava `label`. Drift de slot paralelo. Este slot alinha.
- O kebab-portal é o padrão correto para qualquer dropdown dentro de tabela —
  Topbar, configurações futuras devem seguir o mesmo. Se houver
  pattern reutilizável, considerar extrair `usePortalDropdown()` num slot
  futuro de DS.
