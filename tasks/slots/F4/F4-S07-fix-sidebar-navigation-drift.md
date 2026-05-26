---
id: F4-S07
title: Fix sidebar drift — remove /analise placeholder e faz Sidebar consumir navigation.ts
phase: F4
task_ref: hotfix
status: done
priority: medium
estimated_size: S
agent_id: ''
claimed_at: 2026-05-26T15:48:39Z
completed_at: 2026-05-26T15:54:09Z
pr_url: https://github.com/Rogerio-auto/System-BP/pull/156
depends_on: []
blocks: []
labels: []
source_docs:
  - tasks/PROTOCOL.md
  - docs/18-design-system.md
  - apps/web/src/app/navigation.ts
  - apps/web/src/components/layout/Sidebar.tsx
  - apps/web/src/App.tsx
---

# F4-S07 — Fix sidebar drift (`/analise` órfão + Sidebar não consome `navigation.ts`)

## Contexto (auditoria 2026-05-26)

Verificação dos placeholders "Em breve" no front identificou drift entre `Sidebar.tsx`
e `app/navigation.ts`:

### Problema 1 — `/analise` é placeholder órfão

A página de Análise foi entregue em **F4-S03** (`b650c22`) sob a rota
`/credit-analyses` (gated por `credit_analyses:read`). A rota legada `/analise`
em `apps/web/src/App.tsx:104` ficou apontando para um `PlaceholderPage` ("Em breve").
A Sidebar continua linkando para essa rota órfã, então **a Análise (real) não tem
entrada visível na sidebar** — o usuário só chega por bookmark ou URL direta.

### Problema 2 — Sidebar.tsx duplica e diverge de navigation.ts

`apps/web/src/app/navigation.ts` declara explicitamente no header:

> "Sidebar e Topbar devem usar esta lista como fonte de verdade."

E exporta `APP_NAV` + `FOOTER_NAV` com a estrutura correta — incluindo
`/credit-analyses` com `permission: 'credit_analyses:read'` e `/simulator` com
`featureFlag: 'credit_simulation.enabled'`.

Grep do projeto:

```
$ grep -rn "APP_NAV\|FOOTER_NAV" apps/web/src
apps/web/src/app/navigation.ts:28:  export const APP_NAV: NavSection[] = [
apps/web/src/app/navigation.ts:65:  export const FOOTER_NAV: NavItem[] = [
```

Nenhum consumidor. **`navigation.ts` está morto.** A `Sidebar.tsx` (linhas
155-170) define seu próprio `NAV_SECTIONS_BASE` hardcoded, com:

- `/analise` (rota errada, leva ao placeholder)
- "Análise" sem gate de permissão (todo authenticated user vê o item, embora
  a página `/credit-analyses` rejeite quem não tem `credit_analyses:read`)
- `/contratos` e `/relatorios` (entradas intencionais — fora do escopo deste slot)

### Origem

F4-S03 (`b650c22`) introduziu `navigation.ts` mas não converteu a Sidebar para
consumi-lo. A intenção arquitetural ficou documentada no comment do arquivo
mas não foi executada.

## Objetivo

1. Remover rota órfã `/analise` de `App.tsx` (entrada em `PlaceholderPage`).
2. Converter `Sidebar.tsx` para consumir `APP_NAV` de `app/navigation.ts` —
   tornando navigation.ts a fonte de verdade _real_, não apenas declarada.
3. Respeitar `permission` e `featureFlag` declarados em `APP_NAV` (filtrar
   items via `useAuth().hasPermission` e `useFeatureFlag`).
4. **Não** alterar a estrutura de seções/labels nem remover os items
   `/contratos` e `/relatorios` da sidebar — esses são decisões de produto
   tratadas em slots separados (ver §Fora de escopo).

## Escopo

### 1. `apps/web/src/App.tsx`

- Remover a linha `<Route path="/analise" element={<PlaceholderPage title="Análise" />} />` (atualmente linha 104).
- Manter `PlaceholderPage` (ainda usado por `/contratos` e `/relatorios`).
- Adicionar redirect `<Route path="/analise" element={<Navigate to="/credit-analyses" replace />} />`
  no mesmo estilo dos legacy redirects existentes (`/leads`, `/kanban`) — preserva
  bookmarks antigos sem manter rota órfã.

### 2. `apps/web/src/app/navigation.ts`

- Adicionar fields explícitos onde estiver faltando coerência (revisar se
  `/contratos` e `/relatorios` precisam de `featureFlag` ou `permission` —
  manter como `undefined` se a doc não exige).
- Não remover items existentes — `/contratos` e `/relatorios` são entradas
  intencionais.

### 3. `apps/web/src/components/layout/Sidebar.tsx`

- Remover `NAV_SECTIONS_BASE` hardcoded.
- Substituir `useNavSections()` por implementação que:
  1. Importa `APP_NAV` de `../../app/navigation.ts`.
  2. Resolve `iconKey` (string) para o JSX correspondente via map local
     (mantém os ícones inline — não migrar para lib externa).
  3. Filtra items via `useAuth().hasPermission(item.permission)` quando
     `item.permission` está setado.
  4. Filtra items via `useFeatureFlag(item.featureFlag).enabled` quando
     `item.featureFlag` está setado.
  5. Remove seções vazias (todos os items filtrados).
- Manter visuals do DS intactos: hover lift, indicador ativo verde, brand
  com gradient da bandeira (`docs/18-design-system.md` é lei).
- O `IconAnalise` continua importado e usado — só muda quem o resolve.

### 4. Teste mínimo

Adicionar 1 teste em `apps/web/src/components/layout/__tests__/Sidebar.test.tsx`
(criar se não existir) que verifica:

- Item "Análise" aparece quando `hasPermission('credit_analyses:read') === true`.
- Item "Análise" **não** aparece quando `hasPermission('credit_analyses:read') === false`.
- Item "Simulador" respeita feature flag `credit_simulation.enabled`.
- Link "Análise" aponta para `/credit-analyses` (não `/analise`).

## Fora de escopo (NÃO fazer neste slot)

- Decidir destino de `/contratos` (remover da sidebar vs adicionar badge "Em
  desenvolvimento" vs manter como está). Item separado de produto.
- Detalhar backlog F6 para `/relatorios`. Outro slot.
- Refatorar `Topbar.tsx` para também consumir `navigation.ts` (escopo deste
  slot é a Sidebar; Topbar pode receber tratamento em slot dedicado se o
  Topbar atualmente tiver nav duplicada).
- Migrar ícones inline para lib externa (Lucide etc.). Decisão de DS, não
  bugfix.

## Arquivos permitidos

- `apps/web/src/App.tsx`
- `apps/web/src/app/navigation.ts`
- `apps/web/src/components/layout/Sidebar.tsx`
- `apps/web/src/components/layout/__tests__/Sidebar.test.tsx` (criar se necessário)

## Arquivos proibidos

- `apps/web/src/features/**` — nenhuma feature precisa mudar.
- `apps/web/src/components/layout/Topbar.tsx` — fora de escopo.
- `apps/web/src/lib/auth-store.ts` e `features/auth/useAuth.ts` — `hasPermission`
  já existe, não tocar.
- `apps/web/src/hooks/useFeatureFlag.ts` — hook já existe, não tocar.

## Definition of Done

- [ ] `apps/web/src/App.tsx`: rota `/analise` substituída por `<Navigate to="/credit-analyses" replace />`.
- [ ] `apps/web/src/components/layout/Sidebar.tsx`: nenhum `href: '/analise'`
      no diff final; `NAV_SECTIONS_BASE` removido; `useNavSections()` deriva
      de `APP_NAV` importado de `app/navigation.ts`.
- [ ] `grep -rn 'APP_NAV' apps/web/src` retorna o Sidebar como consumidor real.
- [ ] Teste verifica gate de `permission` e `featureFlag`.
- [ ] `pnpm --filter @elemento/web typecheck` verde.
- [ ] `pnpm --filter @elemento/web lint --max-warnings 0` verde.
- [ ] `pnpm --filter @elemento/web test` verde.
- [ ] `pnpm --filter @elemento/web build` verde.
- [ ] Validação manual (descrita no PR): clicar em "Análise" na sidebar
      carrega `/credit-analyses` (não o placeholder).
- [ ] DS preservado: hover lift, indicador ativo, brand inalterados (screenshot
      antes/depois no PR é desejável mas não obrigatório — confirmar com olhos).

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

## Notas

- Slot de origem do drift: F4-S03 (`b650c22 feat(credit-analyses): frontend lista, detalhe, form e nova versao`).
- `navigation.ts` já tem `permission: 'credit_analyses:read'` no item Análise — o backend de F4-S02 entrega a permission no `/auth/me`, e `auth-store.ts:73` faz o include check. O contrato existe; só falta o consumer.
- Por que redirect em vez de simplesmente deletar `/analise`? Bookmarks
  antigos (sidebar legada estava ativa em produção paralela). Redirect é
  barato e segue o padrão existente em `App.tsx:98-99` (`/kanban` → `/crm?view=kanban`,
  `/leads` → `/crm`).
- `Sidebar.tsx` tem `useFeatureFlag` importado — não é nova dep. `useAuth`
  já está exportado em `features/auth/useAuth.ts`.
