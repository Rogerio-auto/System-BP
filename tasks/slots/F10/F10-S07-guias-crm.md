---
id: F10-S07
title: Guias CRM — criar lead, importar, kanban, detalhe, conversão, busca
phase: F10
task_ref: docs/20-central-de-ajuda.md#5
status: done
priority: high
estimated_size: M
agent_id: null
claimed_at: 2026-06-05T22:56:53Z
completed_at: 2026-06-05T23:13:10Z
pr_url: https://github.com/Rogerio-auto/System-BP/pull/190
depends_on: [F10-S06]
blocks: []
source_docs:
  - docs/20-central-de-ajuda.md#5
  - docs/20-central-de-ajuda.md#6
  - docs/20-central-de-ajuda.md#14
  - docs/05-modulos-funcionais.md
docs_required: false
docs_audience: []
docs_artifacts: []
---

# F10-S07 — Guias CRM

## Objetivo

Entregar a primeira leva de guias práticos por módulo, cobrindo o CRM ponta-a-ponta — o módulo mais usado pelo agente no dia a dia. Cada guia responde uma ação específica em <500 palavras: "como faço X?".

## Contexto

A norma §5 define a seção `guias/` como um nível abaixo de Começar e acima de Conceitos. A norma §13 exige "pelo menos 1 guia por feature F1..F8 visível ao usuário"; este slot quita essa dívida para o módulo CRM (módulo F1). Em paralelo, fecha o gap citado em `comecar/agente.mdx` que diz "veja os guias do CRM" — atualmente sem destino.

Como a seção `guias/` ainda não existe, este slot a estrena. O manifest atual já lida com qualquer pasta nova via `SECTION_LABELS["guias"] = "Guias"` e `SECTION_ORDER["guias"] = 20` (entregue em F10-S06), portanto **nenhuma alteração no `manifest.ts` é necessária** — o filesystem-driven nav pega automaticamente.

A subseção `guias/crm/` cria um nível de aninhamento que ainda não existia (`comecar/admin.mdx` é folha única). O manifest atual agrupa apenas pelo primeiro segmento do slug, então os artigos aparecerão dentro da seção "Guias" sem distinção visual de submódulo — isso é OK para esta entrega; o refactor de section-index e submenu fica para F10-S15+.

## Escopo (faz)

Cria 6 guias dentro de `docs/help/guias/crm/`:

1. **`criar-lead.mdx`** — Criação manual de lead via "Novo lead" no `CrmListPage`. Steps numerados, cobre nome, CPF, telefone, cidade, origem. Callout `tip` para teclas de atalho. Callout `info` reforçando que o CPF é cifrado.
2. **`importar-leads.mdx`** — Wizard de importação (`ImportWizardPage`). Como preparar CSV, mapear colunas, validar antes de confirmar, lidar com duplicatas. Callout `warn` sobre limites de tamanho.
3. **`kanban.mdx`** — Funil visual (`CrmDetailPage` + colunas no `CrmListPage`). Drag-and-drop, regras de transição, o que acontece quando o lead muda de coluna (evento + automação). Glossário rápido: "novo → contato → simulação → análise → aprovado → cliente".
4. **`detalhes-do-lead.mdx`** — Página de detalhe: timeline, anotações, simulações associadas, histórico de mensagens. Como adicionar anotação, ler timeline.
5. **`converter-em-cliente.mdx`** — A transição para `closed_won` (cliente). Pré-requisitos (análise aprovada), o que muda após a conversão, link para guia de cobrança (F10-S08).
6. **`buscar-e-filtrar.mdx`** — Busca por nome/CPF, filtros por etapa/cidade/origem, salvamento de filtro. Callout `tip` para Cmd+K como atalho global.

Atualiza cross-links em `docs/help/comecar/`:

- **`agente.mdx`** — substitui o item genérico "leia mais nos guias do CRM" por links diretos para os 6 guias acima.
- **`gestor.mdx`** — adiciona link para `kanban.mdx` e `converter-em-cliente.mdx` na seção "veja como sua equipe opera".

Atualiza testes:

- **`apps/web/src/features/help/__tests__/manifest.test.ts`** — asserta que a seção `guias` aparece entre `comecar` e `conceitos` (order 20). Asserta que os 6 slugs resolvem via `getArticleBySlug`.
- **`apps/web/src/features/help/__tests__/search.test.ts`** — busca por "criar lead", "importar", "kanban", "converter" encontra os respectivos guias.

## Fora de escopo (NÃO faz)

- Guias de análise de crédito, follow-up, cobrança, templates — F10-S08.
- Section index `docs/help/guias/index.mdx` ou submenu visual `guias/crm/` — refactor de nav futuro (F10-S15+).
- Alterar `manifest.ts` (label/order já entregues em F10-S06).
- Screenshots reais — entrarão em backfill quando ambiente de staging sem PII estiver disponível; por agora as páginas usam apenas texto + `<Step>` + `<Callout>`.
- `<FeedbackWidget />` — componente entra em F10-S13. Páginas deste slot não incluem ainda.
- Guias do simulador / configurações / dashboard — slots próprios futuros (não há `F10-S0X` reservado ainda).

## Arquivos permitidos (`files_allowed`)

- `docs/help/guias/crm/criar-lead.mdx` (criar)
- `docs/help/guias/crm/importar-leads.mdx` (criar)
- `docs/help/guias/crm/kanban.mdx` (criar)
- `docs/help/guias/crm/detalhes-do-lead.mdx` (criar)
- `docs/help/guias/crm/converter-em-cliente.mdx` (criar)
- `docs/help/guias/crm/buscar-e-filtrar.mdx` (criar)
- `docs/help/comecar/agente.mdx` (apenas substituir bloco de cross-links)
- `docs/help/comecar/gestor.mdx` (apenas adicionar 2 links na seção existente)
- `apps/web/src/features/help/__tests__/manifest.test.ts`
- `apps/web/src/features/help/__tests__/search.test.ts`
- `tasks/slots/F10/F10-S07-guias-crm.md`

## Arquivos proibidos (`files_forbidden`)

- `apps/web/src/features/help/manifest.ts` (S06 já entregou o necessário; alterar aqui é reverter trabalho).
- Qualquer outro arquivo em `apps/web/src/features/help/**` que não seja `__tests__/`.
- `docs/help/comecar/admin.mdx` (admin não usa CRM diretamente).
- `docs/help/index.mdx` (S06 já lista a seção via `<RelatedArticles>`; alterar aqui sai do escopo).
- `apps/api/**`, `apps/langgraph-service/**`, `packages/**`.
- `tasks/STATUS.md`.

## Contratos de entrada

- F10-S06 entregue: `SECTION_LABELS["guias"] = "Guias"` e `SECTION_ORDER["guias"] = 20` em `manifest.ts`.
- `comecar/agente.mdx` e `comecar/gestor.mdx` existem com a estrutura entregue em S06.
- Componentes MDX canônicos (`<Callout>`, `<Step>`, `<CodeBlock>`) registrados via provider de F10-S01.

## Contratos de saída

- `/ajuda/guias/crm/criar-lead`, `/importar-leads`, `/kanban`, `/detalhes-do-lead`, `/converter-em-cliente`, `/buscar-e-filtrar` renderizam.
- Sidebar mostra a seção "Guias" entre "Começar" e "Conceitos".
- Busca por "criar lead", "importar", "kanban", "converter" retorna os guias corretos no top-3.
- `comecar/agente.mdx` aponta para os 6 guias.
- Nenhum guia usa "feature flag", "RBAC", "UUID", "outbox", "idempotência" no corpo (norma §14).
- Nenhum guia traz CPF, telefone, email ou nome real — apenas personas fictícias da norma §12.

## Definition of Done

- [ ] Código implementado conforme escopo
- [ ] `pnpm --filter @elemento/web typecheck` verde
- [ ] `pnpm --filter @elemento/web lint` verde
- [ ] `pnpm --filter @elemento/web test` verde
- [ ] `pnpm --filter @elemento/web build` verde com main bundle ≤ baseline + 10 KB gzipped
- [ ] Os 6 guias rendem em dev sem PII real em qualquer exemplo
- [ ] Busca por "criar lead", "kanban", "importar" devolve o guia certo em <100ms

## Validação

```powershell
pnpm --filter @elemento/web typecheck
pnpm --filter @elemento/web lint
pnpm --filter @elemento/web test
pnpm --filter @elemento/web build
```

## Notas para o agente

- **Tom:** ClickUp Help, não contrato bancário. "Você vai criar um lead. Em 3 passos." > "O usuário deverá proceder à criação do registro de lead."
- **Frontmatter obrigatório:** `title`, `description`, `order` (use 10, 20, 30, 40, 50, 60 dentro de `guias/crm/`), `keywords` (array para busca — inclua sinônimos pt-BR).
- **Estrutura padrão por guia:**
  1. Parágrafo de abertura (1-2 frases): "Use este guia quando…".
  2. Pré-requisitos em `<Callout type="info">` se houver.
  3. `<Step number={1}>` … `<Step number={N}>` com a sequência.
  4. Bloco "Erros comuns" (h2) com causa + correção.
  5. Bloco "Veja também" com 2-3 cross-links relativos.
- **Callouts:**
  - `tip` — atalho ou produtividade ("Cmd+K para abrir busca").
  - `info` — esclarecimento neutro ("o CPF é cifrado").
  - `warn` — atenção, não dano ("CSV maior que 10 MB demora 1-2 min").
  - Sem `danger` — LGPD já é coberta pelo conceito.
- **Cross-links:** sempre por URL relativa começando com `/ajuda/...` (não path do arquivo).
- **Tamanho:** 250-500 palavras por guia. Não é livro.
- **Verificar localmente:** após criar os MDX, rodar `pnpm --filter @elemento/web dev`, navegar para cada um, conferir TOC + sidebar.
- **Conferir busca:** abrir Cmd+K em qualquer rota, digitar termos-chave, validar que o guia esperado aparece no top-3.
