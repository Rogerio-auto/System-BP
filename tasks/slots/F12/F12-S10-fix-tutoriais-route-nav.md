---
id: F12-S10
title: Fix — wirar rota /admin/tutoriais e card na ConfiguracoesPage (regressão F12-S05)
phase: F12
task_ref: docs/21-tutoriais-em-video.md#8
status: review
priority: high
estimated_size: S
agent_id: null
claimed_at: 2026-06-09T22:40:12Z
completed_at: 2026-06-09T22:48:15Z
pr_url: null
depends_on: [F12-S05]
blocks: []
source_docs:
  - docs/21-tutoriais-em-video.md#8
  - docs/21-tutoriais-em-video.md#12
docs_required: false
docs_audience: []
docs_artifacts: []
---

# F12-S10 — Fix: rota e nav do admin de tutoriais não aparecem

## Objetivo

Corrigir o bug que torna `/admin/tutoriais` **inacessível** e **invisível** no menu: o F12-S05 registrou a rota e o item de menu em arquivos **mortos/órfãos**.

## Diagnóstico (causa raiz confirmada)

1. **Roteamento:** `apps/web/src/main.tsx` monta `<App />` de `apps/web/src/App.tsx`. O arquivo `apps/web/src/app/router.tsx` é **órfão — ninguém o importa**. O F12-S05 adicionou `TutoriaisRoutes` + `<Route path="/admin/tutoriais">` nesse `router.tsx` morto → a rota **não existe** no app real (página inacessível).
2. **Navegação:** a nav real do admin são os **cards da `ConfiguracoesPage.tsx`** (função `AdminSection`, grupos `gestaoCards` / `tecnicaCards`). O F12-S05 só criou `TUTORIAIS_NAV_ITEM` em `apps/web/src/app/navigation.ts`, que **ninguém consome** → nenhum card aparece.

## Escopo (faz)

### `apps/web/src/App.tsx`

- Importar `TutoriaisPage` de `./pages/admin/Tutoriais`.
- Adicionar `<Route path="/admin/tutoriais" element={<TutoriaisPage />} />` junto aos demais `/admin/*` (perto da linha do `/admin/feature-flags`).

### `apps/web/src/features/configuracoes/ConfiguracoesPage.tsx`

- Adicionar um card no grupo **`tecnicaCards`** (Administração técnica), seguindo o padrão do card "Feature Flags":
  - Título: `Tutoriais em vídeo`; descrição curta; `href: '/admin/tutoriais'`.
  - Gating: `hasPermission('tutorials:manage') && flagEnabled('tutorials.enabled')` (consistente com a norma §12 e com o featureGate da API do S02).
  - Ícone: criar/usar um ícone coerente com o DS (ex.: play/vídeo). Seguir o padrão dos ícones locais (`IconFeatureFlags`, etc.).

### Limpeza de dead code (do F12-S05)

- Remover `TUTORIAIS_NAV_ITEM` de `apps/web/src/app/navigation.ts` (não é consumido).
- Remover `TutoriaisRoutes` + o import de `TutoriaisPage` de `apps/web/src/app/router.tsx` (arquivo órfão; não introduzir dependência nova nele).

### Teste de regressão (obrigatório — pega esta classe de bug)

- Teste que renderiza `<App />` (ou o roteador real) num `MemoryRouter` em `/admin/tutoriais` e assevera que a `TutoriaisPage` monta (rota existe no app real).
- Teste em `ConfiguracoesPage` (aba Administração) asseverando que o card "Tutoriais em vídeo" aparece quando o usuário tem `tutorials:manage` e a flag `tutorials.enabled` está ativa, e **não** aparece sem um deles.

## Fora de escopo (NÃO faz)

- Deletar o arquivo `app/router.tsx` inteiro (é órfão e pré-existente ao F12 — tratar em slot próprio se desejado; aqui só remover o que o S05 adicionou).
- Mudar a página `Tutoriais.tsx`, a API, ou o schema.
- Migrations (a flag/permite já existem em 0047/0049 — rodar `db:migrate` é passo operacional).

## Arquivos permitidos (`files_allowed`)

- `apps/web/src/App.tsx`
- `apps/web/src/features/configuracoes/ConfiguracoesPage.tsx`
- `apps/web/src/app/navigation.ts`
- `apps/web/src/app/router.tsx`
- `apps/web/src/features/configuracoes/__tests__/ConfiguracoesPage.test.tsx` (criar/atualizar)
- `apps/web/src/__tests__/App.routing.test.tsx` (criar, se não houver lugar melhor)
- `tasks/slots/F12/F12-S10-fix-tutoriais-route-nav.md`

## Arquivos proibidos (`files_forbidden`)

- `apps/web/src/pages/admin/Tutoriais.tsx`, `apps/web/src/features/admin/tutoriais/**` (já corretos)
- `apps/api/**`, `packages/**`, `apps/api/src/db/**`
- `tasks/STATUS.md`

## Contratos de entrada

- F12-S05 mergeado (`TutoriaisPage` existe em `apps/web/src/pages/admin/Tutoriais.tsx`).
- Flag `tutorials.enabled` (0049) e permissão `tutorials:manage` (0047) semeadas.

## Contratos de saída

- `/admin/tutoriais` acessível no app real.
- Card "Tutoriais em vídeo" aparece em Configurações › Administração › Administração técnica para quem tem permissão + flag.
- Teste de regressão cobrindo rota + card.

## Definition of Done

- [ ] Rota em `App.tsx`; card em `ConfiguracoesPage` (tecnicaCards) com gating correto
- [ ] Dead code do F12-S05 removido (navigation.ts + router.tsx)
- [ ] Teste de regressão (rota resolve + card condicional)
- [ ] `pnpm --filter @elemento/web typecheck` / `lint` / `test` / **`build`** verdes

## Comandos de validação

```powershell
pnpm --filter @elemento/web typecheck
pnpm --filter @elemento/web lint
pnpm --filter @elemento/web test
pnpm --filter @elemento/web build
```

## Notas para o agente

- ⚠️ **Lição:** o roteador vivo é `App.tsx` (montado por `main.tsx`), NÃO `app/router.tsx`. A nav de admin são os cards de `ConfiguracoesPage.tsx`, NÃO `navigation.ts`. Não escreva em arquivos órfãos.
- Rode o passo **`build`** (não só typecheck) antes do finish — o CI o roda e ele pega erros que o typecheck às vezes não mostra.
