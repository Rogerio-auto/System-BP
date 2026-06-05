# F10 — Central de Ajuda

> Norma: [`docs/20-central-de-ajuda.md`](../../../docs/20-central-de-ajuda.md). Em qualquer conflito entre slot e norma, a norma vence.

## Objetivo da fase

Centralizar dentro de `/ajuda` toda informação que o operador, gestor e desenvolvedor precisam — guias, conceitos, API reference, busca global e telemetria de uso. Inspiração: Stripe Docs (estrutura/API) + ClickUp Help (linguagem). A fase termina com a regra cultural ativa: _todo slot novo, a partir de F10-S14, precisa entregar documentação_.

## Slots planejados

### Grupo A — Infraestrutura (desbloqueia tudo o resto)

| ID      | Título                                      | Size | Resumo                                                                           |
| ------- | ------------------------------------------- | ---- | -------------------------------------------------------------------------------- |
| F10-S01 | Pipeline MDX + componentes base             | M    | `@mdx-js/rollup`, `shiki`, plugins remark/rehype, `<Callout> <Step> <CodeBlock>` |
| F10-S02 | Layout 3-pane + nav do filesystem           | M    | DocLayout, sidebar gerado de `docs/help/**`, sumário lateral                     |
| F10-S03 | Busca FlexSearch + Cmd+K palette            | S    | Índice pré-built, `cmdk` palette global                                          |
| F10-S04 | Entry points (topbar "?" + sidebar "Ajuda") | XS   | Ícone e item de menu acessíveis em qualquer rota                                 |

### Grupo B — Conteúdo (depende do grupo A)

| ID      | Título                                           | Size | Resumo                                         |
| ------- | ------------------------------------------------ | ---- | ---------------------------------------------- |
| F10-S05 | Home + 3 conceitos base                          | S    | Página `/ajuda`, RBAC, LGPD, Módulos liberados |
| F10-S06 | Getting started por papel                        | M    | Tracks admin / gestor / agente                 |
| F10-S07 | Guias CRM (lead, importação, kanban)             | M    | 5–8 páginas, screenshots reais sem PII         |
| F10-S08 | Guias Análise + Follow-up + Cobrança + Templates | M    | 8–12 páginas                                   |

### Grupo C — API Reference (independente do B, pode paralelizar)

| ID      | Título                                  | Size | Resumo                                                           |
| ------- | --------------------------------------- | ---- | ---------------------------------------------------------------- |
| F10-S09 | `fastify-zod-openapi` + `/openapi.json` | M    | Instrumenta todas as rotas de `apps/api/src/modules/*/routes.ts` |
| F10-S10 | UI de API Reference 3-pane Stripe-like  | L    | Custom, não-Swagger                                              |
| F10-S11 | Geração de samples curl + TS            | S    | Helper `apps/web/scripts/generate-api-pages.ts`                  |

### Grupo D — Telemetria & feedback

| ID      | Título                                          | Size | Resumo                                                           |
| ------- | ----------------------------------------------- | ---- | ---------------------------------------------------------------- |
| F10-S12 | Schema `doc_views` + `doc_feedback` + endpoints | S    | Migration + 3 endpoints (POST views, POST feedback, GET popular) |
| F10-S13 | Widget "Isso te ajudou?" + ranking de populares | S    | `<FeedbackWidget>` MDX component + home com top 10               |

### Grupo E — Processo (a regra cultural)

| ID      | Título                                                       | Size | Resumo                                                        |
| ------- | ------------------------------------------------------------ | ---- | ------------------------------------------------------------- |
| F10-S14 | Atualiza `_TEMPLATE.md` + agents + PROTOCOL.md               | S    | Trava `docs_required` no frontmatter; agentes ganham contrato |
| F10-S15 | Template MDX + meta-guia "Como escrever uma página de ajuda" | S    | `docs/help/_template.mdx` + página dentro de Conceitos        |

## Ordem de execução sugerida

1. **Onda 1 (sequencial):** F10-S01 → F10-S02 → F10-S03 → F10-S04
2. **Onda 2 (paralelizável):** F10-S05 + F10-S09
3. **Onda 3 (paralelizável):** F10-S06 + F10-S07 + F10-S10
4. **Onda 4:** F10-S08 + F10-S11 + F10-S12
5. **Onda 5:** F10-S13
6. **Onda 6 (trava o processo):** F10-S14 + F10-S15

## Critérios de aceite da fase (vem da norma §13)

- [ ] Rota `/ajuda` renderiza para qualquer usuário autenticado
- [ ] Busca encontra qualquer página em <100ms
- [ ] Cmd+K abre em qualquer rota do app
- [ ] Todas as features F1..F8 visíveis ao usuário têm pelo menos 1 guia
- [ ] API Reference cobre 100% dos endpoints de `apps/api/src/modules/*/routes.ts`
- [ ] `_TEMPLATE.md` exige `docs_required` e agentes seguem o contrato
- [ ] `<FeedbackWidget />` funcional em todas as páginas
- [ ] Tamanho do bundle do `apps/web` <5% maior que antes de F10

## Próxima fase

F11 — Tutoriais guiados. Depende de F10 inteiro (especialmente S12, que monta o schema de telemetria reutilizado por `tutorial_progress`).
