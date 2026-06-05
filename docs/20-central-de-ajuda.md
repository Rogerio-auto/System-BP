# 20 — Central de Ajuda

> Norma da Central de Ajuda do Manager Banco do Povo. Lido por agentes IA antes de qualquer slot da fase F10 (Documentação) ou que produza conteúdo de help/API. **Em conflito com um slot individual, este documento vence.**
>
> Companion docs: [18 — Design System](18-design-system.md), [17 — LGPD](17-lgpd-protecao-dados.md), [10 — Segurança & Permissões](10-seguranca-permissoes.md).

## §1 — Visão

Centralizar dentro do próprio app (rota `/ajuda`) **toda informação que um usuário do Banco do Povo precisa para operar o sistema** e **toda referência técnica que um desenvolvedor precisa para integrar via API**. Inspirações: Stripe Docs (estrutura, tipografia, API Reference), ClickUp Help Center (linguagem amigável, getting-started por persona), Linear Help (busca, brevidade).

Padrão de qualidade: world-class. Se uma página parece um README de GitHub público, reprovou. Se a busca demora mais que 100ms, reprovou. Se um operador precisa ler um glossário técnico pra entender o que é "régua de cobrança", reprovou.

## §2 — Personas e jornadas

### Persona A — Operador (agente / agente_admin / gestor_cidade)

Conhece o domínio (crédito popular), não é técnico, opera no dia a dia. Precisa de:

- Getting started específico do papel
- Guias passo-a-passo de cada ação (criar lead, mover card, registrar pagamento)
- Glossário acessível
- Tutoriais inline (F11) e search rápido

### Persona B — Gestor (gestor_geral / admin)

Configura o sistema, decide quem acessa o quê. Precisa de:

- Tudo da persona A
- Documentação de RBAC (papéis e cidades)
- Como ligar/desligar módulos
- Como interpretar dashboards
- Política de LGPD do sistema

### Persona C — Desenvolvedor / Integrador (interno e futuro externo)

Integra via API, escreve workflows n8n, mantém o sistema. Precisa de:

- API Reference completa e atualizada
- Exemplos de código (curl, TypeScript)
- Conceitos (outbox, idempotência, escopo de cidade)
- Changelog

## §3 — Arquitetura

```
┌──────────────────────────────────────────────────────────────┐
│ Camada 1 — Conteúdo (source of truth)                        │
│   docs/help/**.mdx   ← versionado no monorepo                │
│   docs/help/_assets/ ← screenshots, GIFs, SVG                │
│   docs/help/tutorials/*.yaml ← flows (F11)                   │
│   Build-time: gera índice de busca + metadata JSON           │
└──────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────┐
│ Camada 2 — Renderização (apps/web)                           │
│   Vite plugin: @mdx-js/rollup                                │
│   Highlight: Shiki (mesma engine do VS Code)                 │
│   Componentes MDX custom (§6)                                │
│   Layout 3-pane Stripe-like (nav / conteúdo / sumário)       │
│   Busca: FlexSearch sobre índice estático                    │
│   Cmd+K palette (cmdk)                                       │
└──────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────┐
│ Camada 3 — Telemetria & Feedback (apps/api + Postgres)       │
│   doc_views        — popularidade                            │
│   doc_feedback     — 👍/👎 + comentário                      │
│   tutorial_progress — fase F11                               │
└──────────────────────────────────────────────────────────────┘
```

**Por que MDX em repo, não CMS:**

- Fonte única (PR review = doc review)
- Versionado junto da feature
- Sem dependência externa, sem custo recorrente
- Devs já editam Markdown nos slots — zero curva
- Stripe / Vercel / Linear seguem o mesmo padrão

**Quando o backend entra:** apenas para o que é por-usuário (feedback, progresso de tutorial, views). Conteúdo em si fica em arquivo.

## §4 — Stack técnica

| Item               | Escolha                                   | Justificativa                                                    |
| ------------------ | ----------------------------------------- | ---------------------------------------------------------------- |
| MDX                | `@mdx-js/rollup` + `@mdx-js/react`        | Padrão da indústria; integra ao Vite existente                   |
| Syntax highlight   | `shiki`                                   | TextMate grammars reais (mesmo engine do VS Code, padrão Stripe) |
| Plugins remark     | `remark-gfm`, `remark-frontmatter`        | Tabelas, checklists, frontmatter                                 |
| Plugins rehype     | `rehype-slug`, `rehype-autolink-headings` | Permalinks por heading                                           |
| Busca              | `flexsearch` (índice pré-built)           | Zero runtime cost, sub-100ms, suporta pt-BR                      |
| Command palette    | `cmdk` (Vercel)                           | Linear / Stripe / Vercel usam; acessível                         |
| OpenAPI no backend | `fastify-zod-openapi`                     | Aproveita Zod existente sem rewrite                              |
| API Reference UI   | Custom (NÃO Swagger UI)                   | Swagger é feio; queremos Stripe-style                            |

**Proibido:** Swagger UI, Redoc com tema default, Docusaurus, GitBook, qualquer SaaS de docs (Mintlify, Readme.io). Tudo in-app.

## §5 — Sitemap e taxonomia

```
/ajuda                              home (busca + populares + últimos vistos)
/ajuda/comecar                      onboarding por persona
  /admin
  /gestor
  /agente
/ajuda/guias                        guias práticos por módulo
  /crm/...                          criar lead, importar, kanban
  /credit-analyses/...              análise de crédito
  /follow-up/...                    réguas e jobs
  /cobranca/...                     parcelas, réguas, jobs
  /templates/...                    catálogo WhatsApp
  /simulador/...
  /configuracoes/...
/ajuda/conceitos                    conceitos transversais
  /rbac.mdx
  /escopo-cidade.mdx
  /lgpd.mdx
  /feature-flags.mdx
  /outbox-eventos.mdx
  /idempotencia.mdx
/ajuda/api                          referência técnica
  /autenticacao.mdx
  /leads.mdx
  /credit-analyses.mdx
  /...                              uma página por recurso
/ajuda/changelog                    notas de release
```

**Regras de naming de arquivo:**

- kebab-case, ASCII puro (sem acento no path)
- frontmatter define `title` e `description` em pt-BR
- IDs de heading gerados via slug do título em pt-BR (rehype-slug)

**Idiomas:** pt-BR único no MVP. Estrutura preparada para `i18n` futuro (`docs/help/pt-br/...`, `docs/help/en/...`).

## §6 — Componentes MDX

Conjunto canônico (todo MDX usa apenas estes — sem inventar):

| Componente                                                   | Uso                                                  |
| ------------------------------------------------------------ | ---------------------------------------------------- |
| `<Callout type="info\|warn\|danger\|tip">`                   | Aviso destacado. Aplica tokens DS (`--info-bg`, etc) |
| `<Step number={N}>`                                          | Passo numerado em sequência tutorial                 |
| `<CodeBlock lang="ts\|bash\|json" title="..." copy>`         | Bloco de código com highlight Shiki + copy button    |
| `<EndpointCard method="POST" path="/api/leads">`             | Card de endpoint na API Reference                    |
| `<Permission requires="leads:write">`                        | Indica permissão necessária; aparece como badge      |
| `<Screenshot src="_assets/foo.png" alt="..." caption="...">` | Screenshot com legenda e lazy load                   |
| `<VideoEmbed src="..." poster="...">`                        | Vídeo MP4 local com poster                           |
| `<RelatedArticles slugs={[...]}>`                            | "Veja também" no rodapé                              |
| `<FeedbackWidget />`                                         | "Esta página ajudou?" — botões 👍/👎 + textarea      |

Componentes ficam em `apps/web/src/features/help/mdx-components/`. Cada um respeita o DS (`docs/18-design-system.md`).

## §7 — Busca

- Índice gerado em build-time por um plugin Vite custom que percorre `docs/help/**.mdx`, extrai `title`, `description`, headings, primeiro parágrafo, e palavras-chave (frontmatter `keywords`)
- Salva como `apps/web/public/help-search-index.json` (gzipped)
- No client: `flexsearch` carrega o índice on-demand quando o usuário abre Cmd+K
- Latência alvo: TTFR < 100ms em qualquer página

**Cmd+K palette:**

- Acessível por `Cmd+K` (Mac) / `Ctrl+K` (Win/Linux) em qualquer rota do app
- Mostra: busca + atalhos para áreas (Guias / Conceitos / API)
- Resultados com snippet destacado

## §8 — API Reference

**Geração:**

- Backend instrumenta cada rota com `fastify-zod-openapi`
- `/openapi.json` exposto (somente em dev/staging; em prod, comentado ou protegido por flag interna)
- Build-time: script `apps/web/scripts/generate-api-pages.ts` lê `openapi.json` + gera 1 página `.mdx` por recurso em `docs/help/api/_generated/`

**UI:**

- Layout 3-pane Stripe-style:
  - **Esquerda:** sumário de recursos (Leads, Customers, etc.)
  - **Centro:** descrição do endpoint + parâmetros + responses
  - **Direita:** exemplo de request + exemplo de response (toggle curl / TS)
- Cada `<EndpointCard>` clicável abre seção
- Variáveis de path destacadas com background `--info-bg`

**Code samples:**

- curl gerado a partir de `examples` do OpenAPI
- TypeScript gerado a partir do schema Zod (usando um helper interno `apps/api/scripts/zod-to-ts-example.ts`)

## §9 — Telemetria & Feedback

### Tabelas Postgres

```sql
CREATE TABLE doc_views (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid REFERENCES users(id),
  article_slug text NOT NULL,
  viewed_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_doc_views_slug_time ON doc_views (article_slug, viewed_at DESC);

CREATE TABLE doc_feedback (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid REFERENCES users(id),
  article_slug text NOT NULL,
  helpful      boolean NOT NULL,
  comment      text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_doc_feedback_slug ON doc_feedback (article_slug, created_at DESC);
```

### Endpoints

- `POST /api/help/views { slug }` — registra view (rate-limit por user+slug = 1 / 30s)
- `POST /api/help/feedback { slug, helpful, comment? }` — registra feedback
- `GET /api/help/popular?limit=10` — top 10 artigos por views nos últimos 30 dias (cache 10min)

### LGPD aplicada

- `doc_views.user_id` é vinculado, mas o `slug` em si não é PII
- `doc_feedback.comment` pode ter PII inadvertida — pino.redact aplicado
- Retenção: 12 meses; após disso, anonimizar (`user_id → NULL`)

## §10 — Processo: docs como parte do slot (a regra cultural)

A partir do **F10-S14**, todo slot que produza feature visível ao usuário ou endpoint público **deve** produzir documentação como artefato de DoD. Sem isso, o slot não fecha.

### Mudanças no `tasks/_TEMPLATE.md`

Frontmatter ganha:

```yaml
docs_required: true | false # default true; false só para refactor/infra
docs_audience: # personas que devem aprender
  - operador
  - gestor
  - admin
  - dev
docs_artifacts: # arquivos esperados
  - docs/help/guias/<modulo>/<feature>.mdx
```

DoD ganha:

```markdown
- [ ] Documentação criada/atualizada em `docs/help/...` conforme `docs_audience`
- [ ] Screenshots/GIFs em `docs/help/_assets/`
- [ ] Link cruzado adicionado à `comecar/<role>.mdx` quando o feature é first-class
- [ ] FeedbackWidget incluído na página
```

### Mudanças nos `.claude/agents/*.md`

**frontend-engineer.md:**

> Ao implementar feature visível ao usuário, produza obrigatoriamente uma página MDX em `docs/help/guias/<modulo>/<feature>.mdx` seguindo `docs/help/_template.mdx`. Cobre: o que é, quando usar, passo a passo com screenshot, erros comuns, permissões necessárias, FAQ. Sem isso, o slot não fecha.

**backend-engineer.md:**

> Endpoints públicos requerem instrumentação `fastify-zod-openapi`. Schemas de request/response devem ter `.describe()` em todos os campos não-óbvios. O `description` do endpoint vira corpo da página gerada em `docs/help/api/_generated/`.

**qa-tester.md:**

> Validar que a rota `/ajuda/guias/<modulo>/<feature>` renderiza, que a busca encontra a página por palavras-chave esperadas, e que screenshots não estão quebradas.

**security-reviewer.md:**

> Páginas de Ajuda que descrevem fluxo com PII precisam citar o checklist LGPD §14.2 (link). Endpoints expostos na API Reference precisam declarar permissão via `<Permission>` na página gerada.

### Backfill

Slots já em `done` não são retroativos. Backfill de docs para features existentes (CRM, simulador, etc.) é trabalho da **Phase B do F10** (slots F10-S05 a F10-S08).

## §11 — Tutoriais guiados (F11 — desenho aqui, build depois)

Visão: usuário entra pela primeira vez, recebe overlay com setas/spotlights guiando os primeiros passos do seu papel.

### Schema (a ser implementado em F11)

```sql
CREATE TABLE tutorial_flows (
  slug          text PRIMARY KEY,
  title         text NOT NULL,
  target_roles  text[] NOT NULL,
  trigger       text NOT NULL,  -- 'first_login' | 'feature_first_view' | 'manual'
  definition    jsonb NOT NULL, -- steps + targets + copy
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tutorial_progress (
  user_id       uuid REFERENCES users(id),
  flow_slug     text REFERENCES tutorial_flows(slug),
  current_step  int NOT NULL DEFAULT 0,
  completed_at  timestamptz,
  dismissed_at  timestamptz,
  PRIMARY KEY (user_id, flow_slug)
);
```

### Definição em YAML (versionada no repo)

```yaml
slug: first_login_agente
title: 'Boas-vindas — seu primeiro lead'
target_roles: [agente]
trigger: first_login
steps:
  - target: '[data-tour="sidebar-crm"]'
    title: 'Aqui ficam seus leads'
    body: 'Clique aqui para abrir o CRM.'
    next_on: click
  - target: '[data-tour="new-lead-button"]'
    title: 'Crie seu primeiro lead'
    body: 'Use este botão sempre que receber um novo contato.'
    next_on: click
  - target: '[data-tour="kanban-column"]'
    title: 'Mova seu lead pelo funil'
    body: 'Arraste cards entre colunas conforme o status.'
    next_on: timeout:8s
```

### Stack

- Componente custom `<TutorialOverlay>` (~300 LOC) — spotlight + tooltip + pin
- Estado: TanStack Query para `tutorial_progress`
- Trigger: hook `useTutorial(flowSlug)` que verifica se deve disparar
- Carregamento dos flows: build-time (YAMLs → TS) + sync inicial para DB via migration idempotente

**Por que custom e não Userpilot/Appcues:** SaaS custa €500-1500/mês recorrente para um sistema interno de cliente. UX dá pra replicar em 1 slot M. Mantém zero dependência externa.

## §12 — LGPD aplicada à doc

- Screenshots **não** podem conter PII real (CPF, telefone, e-mail, nome completo). Usar dados fictícios ou mascaramento como `***`.
- Vídeos seguem a mesma regra; se forem capturados em ambiente real, blur obrigatório.
- O search index público (`public/help-search-index.json`) **não** pode conter PII (validado por checklist).
- `doc_feedback.comment` passa por `pino.redact` no logging.

## §13 — Critérios de aceite da fase F10

- [ ] Rota `/ajuda` renderiza em todos os papéis autenticados
- [ ] Busca encontra qualquer página em <100ms
- [ ] Cmd+K abre em qualquer rota do app
- [ ] Todas as features F1..F8 que são visíveis ao usuário têm pelo menos 1 página em `docs/help/guias/`
- [ ] API Reference cobre 100% dos endpoints de `apps/api/src/modules/*/routes.ts`
- [ ] `_TEMPLATE.md` exige `docs_required`
- [ ] Agentes (`.claude/agents/*.md`) atualizados com regras de docs
- [ ] FeedbackWidget funcional em todas as páginas
- [ ] Build de produção do `apps/web` <5% maior que antes de F10 (alvo de tamanho)

## §14 — Glossário canônico (a usar em todas as páginas)

| Termo              | Definição                                                                             |
| ------------------ | ------------------------------------------------------------------------------------- |
| Lead               | Pessoa que demonstrou interesse mas ainda não virou cliente                           |
| Cliente            | Lead que foi convertido (passou por `closed_won` no Kanban)                           |
| Análise de crédito | Parecer formal sobre concessão; com versão imutável (Art. 20 §1º LGPD)                |
| Régua              | Configuração de quando/como enviar mensagem automática (follow-up ou cobrança)        |
| Job                | Instância agendada de envio gerada a partir de uma régua                              |
| Módulo liberado    | Tradução pública de "feature flag `enabled`" para o usuário final                     |
| Escopo de cidade   | Restrição automática que limita o que cada usuário vê com base nas cidades atribuídas |
| Outbox             | Mecanismo interno de garantia de entrega de eventos (não exposto ao usuário)          |

**Proibido usar nas páginas de ajuda:** "feature flag", "RBAC", "UUID", "outbox", "idempotência" (na voz do operador). Esses ficam restritos a Conceitos e API.

---

**Anterior:** [19 — Runbook Go-live](19-runbook-go-live.md)
