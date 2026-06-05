---
id: F10-S06
title: Getting started por papel — admin, gestor, agente
phase: F10
task_ref: docs/20-central-de-ajuda.md#5
status: available
priority: high
estimated_size: M
agent_id: null
claimed_at: null
completed_at: null
pr_url: null
depends_on: [F10-S05]
blocks: []
source_docs:
  - docs/20-central-de-ajuda.md#5
  - docs/20-central-de-ajuda.md#14
  - docs/10-seguranca-permissoes.md
docs_required: false
docs_audience: []
docs_artifacts: []
---

# F10-S06 — Getting started por papel

## Objetivo

Entregar trilhas de primeiro acesso para os três papéis principais — administrador, gestor e agente. Cada trilha é uma página única e linear que responde "comecei agora, o que faço nos primeiros 30 minutos?" sem fazer o usuário caçar respostas em vários lugares.

## Contexto

A norma §5 lista a seção `comecar` como a primeira da hierarquia. F10-S05 entregou conceitos + home, mas a home ainda aponta "Em breve" para Começar. Este slot fecha esse gap e estabelece o padrão de tracks por persona para os tutoriais guiados de F11.

Como subproduto, esta é a primeira seção com pretty label em pt-BR ("Começar" com cedilha vs. slug `comecar` sem). Vou adicionar dois pequenos maps em `manifest.ts` — `SECTION_LABELS` para títulos display e `SECTION_ORDER` para ordenação consistente entre seções (Começar → Guias → Conceitos → API, não alfabética).

## Escopo (faz)

- Adiciona `SECTION_LABELS` + `SECTION_ORDER` em `apps/web/src/features/help/manifest.ts`:
  - Labels: `comecar → "Começar"`, `guias → "Guias"`, `conceitos → "Conceitos"`, `api → "API"`.
  - Order: `comecar: 10`, `guias: 20`, `conceitos: 30`, `api: 40`. Slugs fora do mapa: order 99 + alfabético.
- Atualiza `sectionTitle()` para consultar o mapa antes do fallback capitalize.
- Atualiza o builder de manifest para ordenar `sections` por `(order, title)`.
- Cria 3 páginas:
  - `docs/help/comecar/admin.mdx` — onboarding do administrador (cidades, usuários, módulos liberados, observabilidade).
  - `docs/help/comecar/gestor.mdx` — onboarding do gestor (dashboard, réguas, templates, análise de crédito).
  - `docs/help/comecar/agente.mdx` — onboarding do agente (CRM, Kanban, simulação, registro de atendimento).
- Atualiza `docs/help/index.mdx`:
  - Substitui "Começar — em breve" por bullet list com link para cada track.
- Atualiza `apps/web/src/features/help/__tests__/manifest.test.ts`:
  - Asserta que a seção `comecar` aparece **antes** de `conceitos` na ordem do manifest.
  - Asserta que o título display da seção é "Começar" (com cedilha).
  - Resolve cada um dos 3 slugs novos.
- Atualiza `apps/web/src/features/help/__tests__/search.test.ts`:
  - Busca por "admin", "gestor", "agente" encontra a respectiva trilha.

## Fora de escopo (NÃO faz)

- Guias por módulo — F10-S07 (CRM) e F10-S08 (resto).
- Tutorial guiado overlay — F11.
- Section index pages — refactor futuro.
- "Populares" e ranking — F10-S12+S13.

## Arquivos permitidos (`files_allowed`)

- `apps/web/src/features/help/manifest.ts` (apenas adicionar os 2 maps + ajuste de sort)
- `apps/web/src/features/help/__tests__/manifest.test.ts`
- `apps/web/src/features/help/__tests__/search.test.ts`
- `docs/help/index.mdx`
- `docs/help/comecar/admin.mdx` (criar)
- `docs/help/comecar/gestor.mdx` (criar)
- `docs/help/comecar/agente.mdx` (criar)
- `tasks/slots/F10/F10-S06-comecar-tracks.md`

## Arquivos proibidos (`files_forbidden`)

- Qualquer outro arquivo em `apps/web/src/features/help/**`.
- Qualquer outra MDX em `docs/help/conceitos/**` ou `docs/help/api/**`.
- `apps/api/**`, `apps/langgraph-service/**`, `packages/**`.
- `tasks/STATUS.md`.

## Contratos de entrada

- F10-S05 entregue: home + 3 conceitos publicados, manifest builder funcional.

## Contratos de saída

- `/ajuda/comecar/admin`, `/comecar/gestor`, `/comecar/agente` renderizam.
- Sidebar mostra seção "Começar" (com cedilha) **acima** de "Conceitos".
- Home aponta para cada trilha.
- Busca por "agente" retorna a trilha do agente.

## Definition of Done

- [ ] Código implementado conforme escopo
- [ ] `pnpm --filter @elemento/web typecheck` verde
- [ ] `pnpm --filter @elemento/web lint` verde
- [ ] `pnpm --filter @elemento/web test` verde
- [ ] `pnpm --filter @elemento/web build` verde com main bundle ≤ baseline + 5 KB gzipped
- [ ] As 3 trilhas + home rendem em dev sem PII real

## Comandos de validação

```powershell
pnpm --filter @elemento/web typecheck
pnpm --filter @elemento/web lint
pnpm --filter @elemento/web test
pnpm --filter @elemento/web build
```

## Notas para o agente

- **Tom:** direto e útil. "Você acabou de receber acesso. Comece por aqui."
- **Steps numerados** para os primeiros passos (componente `<Step>`).
- **Callouts:** `tip` para atalhos, `info` para esclarecimentos, `warn` para condutas a evitar (sem `danger` — LGPD já cobre).
- **Cross-links** para Conceitos (papéis, LGPD, módulos liberados) onde fizer sentido.
- **Linguagem proibida** (norma §14): "feature flag", "RBAC", "UUID", "outbox". Use "módulo liberado", "papel", "identificador", etc.
- **Ordem de leitura:** todo track deve sugerir os 3 conceitos como "o que ler em seguida".
