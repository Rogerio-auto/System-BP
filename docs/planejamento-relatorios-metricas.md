# Planejamento — Página de Relatórios & Métricas (Elemento / Banco do Povo)

> Status: **proposta** · Autor: orquestração técnica · Data: 2026-06-23
> Documentos-fonte: `docs/00-visao-geral.md`, `docs/01-prd-produto.md`, `docs/05-modulos-funcionais.md` (§9), `docs/10-seguranca-permissoes.md`, `docs/17-lgpd-protecao-dados.md` (§3.3 finalidade #8, §8.3), `docs/18-design-system.md`.
> Este doc descreve o **destino completo** da rota `/relatorios` (hoje um `PlaceholderPage`). Substitui o "Em breve."

---

## 1. Objetivo

Transformar `/relatorios` numa central de inteligência operacional **adaptativa ao papel do usuário**, que responde três perguntas conforme quem olha:

- **Agente/operador:** "como está o **meu** trabalho?" — meus atendimentos, meus leads, minhas simulações, minha cobrança.
- **Gestor regional:** "como está a **minha cidade**?" — funil, conversão, gargalos, produtividade da equipe daquela(s) cidade(s).
- **Gestor geral / admin:** "como está a **operação inteira**?" — consolidado multi-cidade, comparativo entre cidades, saúde da IA, carteira de crédito e inadimplência.
- **Cobrança:** "como está a **carteira**?" — adimplência, vencidos, SPC, eficiência de cobrança.

Tudo **exportável** (CSV / XLSX / PDF) e **filtrável** com filtros direcionados ao contexto de cada papel.

---

## 2. Princípios inegociáveis (lei do projeto)

1. **LGPD — só agregados.** Doc 17 §3.3 finalidade #8: _"Agregados; nenhum dado individual deve aparecer em dashboard sem necessidade."_ Relatórios expõem **contagens, taxas, médias, somatórios** — nunca listas de CPF/telefone/nome de cidadão. Quando um drill-down precisar listar pessoas, aplica-se o mascaramento do §8.3 (`***.***.***-12`, `(69) 9****-1234`) **e** registra-se audit do acesso.
2. **Escopo de cidade é first-class.** Toda query passa por `applyCityScope`. `gestor_regional`/`agente`/`operador`/`leitura` veem **só suas cidades** (`user_city_scopes`). `admin`/`gestor_geral`/`cobranca` = `cityScopeIds = null` (global). Fora do escopo → resultado vazio, nunca vazamento.
3. **Multi-tenant.** `organization_id` em **toda** query agregada (não-negociável, item 8 do CLAUDE.md).
4. **Auditável.** Doc 05 §critérios de aceite: _"métricas batem com query SQL direta"_. Cada número da tela tem que ser reproduzível por SQL. Toda leitura de relatório e toda exportação gera linha de `audit_logs` (sem PII).
5. **RBAC por permissão, não por role hardcoded.** A tela monta seções a partir de `hasPermission(...)`. Role novo herda comportamento via catálogo de permissões.
6. **Design System é lei.** Tokens do doc 18, light-first + dark toggle, profundidade física, Bricolage/Geist/JetBrains Mono. Reusar os componentes SVG já existentes (`StatusDonut`, `ChannelBars`, `KanbanBars`, `AvgDaysInStageChart`, `TopAgentsTable`, `StatsRow`).
7. **Sem `any`, Zod em toda borda, feature flag em 4 camadas.**

---

## 3. Modelo de visibilidade por papel (o coração do pedido)

Duas dimensões combinadas: **o que** o papel vê (seções) e **em que escopo** (eu / cidade / global).

| Papel               | Escopo de dados                           | Seções visíveis                                                                  | Quebra por agente | Cobrança                             | Auditoria                |
| ------------------- | ----------------------------------------- | -------------------------------------------------------------------------------- | ----------------- | ------------------------------------ | ------------------------ |
| **admin**           | Global (todas cidades)                    | Todas                                                                            | ✔                | ✔                                   | ✔                       |
| **gestor_geral**    | Global (todas cidades)                    | Todas exceto config técnica                                                      | ✔                | ✔                                   | ✔                       |
| **gestor_regional** | Suas cidades                              | Visão geral, Atendimentos, Funil/CRM, Crédito, Cobrança, Produtividade da equipe | ✔ (só da cidade) | ✔ (escopo de cidade — D2 resolvida) | ✔ (filtrado por cidade) |
| **agente**          | **Si mesmo** (leads/conversas atribuídos) | "Meu desempenho": meus atendimentos, meus leads, minhas simulações               | só ele            | ✖                                   | ✖                       |
| **operador**        | **Si mesmo**                              | "Meu desempenho" (básico)                                                        | só ele            | ✖                                   | ✖                       |
| **leitura**         | Suas cidades                              | Visão geral + Funil (read-only)                                                  | ✖                | ✖                                   | ✖                       |
| **cobranca**        | Global                                    | Cobrança & Carteira (SPC, adimplência, eficiência)                               | ✖                | ✔                                   | ✖                       |

**Regra do "scope toggle":** no topo da página, um seletor de escopo aparece **só quando o papel tem mais de um escopo possível**:

- Agente/operador: sem seletor — sempre "Meus dados".
- Gestor regional com 1 cidade: sem seletor de cidade; com N cidades: dropdown "Todas as minhas cidades / Cidade X".
- Gestor geral/admin: dropdown "Consolidado / Cidade X" + opção "comparar cidades".
- Quem tem `dashboard:read_by_agent`: dropdown adicional "Equipe / Agente Y".

O **self-scope do agente** (mostrar "seus contratos, seus atendimentos, seus boletos") é um filtro extra no backend: `assigned_user_id = :me` / `agent_id = :me` / `created_by = :me`, aplicado automaticamente quando o papel não tem `dashboard:read` mas tem `dashboard:read_by_agent`.

---

## 4. Inventário de métricas — organizadas por seção da página

Cada seção é um "card group" colapsável. As seções renderizam condicionalmente por permissão + disponibilidade de dados no escopo.

### Seção A — Visão Geral (KPIs de topo)

`dashboard:read` (gestores/leitura) ou self-scope (agente). **Já parcialmente implementada** em `/api/dashboard/metrics`.

- Leads no período · Novos leads · Em qualificação · **Taxa de conversão** (closed_won/total)
- Atendimentos no período · Tempo médio de 1ª resposta · Taxa de resolução
- Simulações geradas · Valor total simulado · Contratos assinados · Valor em carteira
- Cobrança: a vencer (7d) · vencidos · inadimplência % _(se tiver `billing:read`)_

### Seção B — Atendimentos & Conversas

Fonte: `conversations`, `messages`, `interactions`. Escopo: cidade ou self (agente atribuído).

- Volume de conversas por canal (WhatsApp/Instagram/WAHA) e por status (open/pending/resolved/snoozed)
- **Tempo médio de 1ª resposta** (`lastInboundAt − created_at`) e **tempo médio de resolução**
- Razão inbound/outbound · conversas não lidas · backlog por agente
- Série temporal de mensagens/dia

### Seção C — IA / Pré-atendimento (Ana Clara)

Fonte: `ai_conversation_states`, `ai_decision_logs`, `chatwoot_handoffs`. `dashboard:read` + flag IA.

- Conversas atendidas pela IA · **taxa de handoff** (handoffs/conversas) · motivos de handoff
- Distribuição por nó/intenção · top intenções classificadas
- **Custo & saúde do LLM** (admin): tokens in/out, custo estimado, latência média, taxa de erro por nó/modelo/versão de prompt
- SLA de handoff (tempo até `accepted`) e taxa de resolução

### Seção D — Funil & CRM (Kanban)

Fonte: `leads`, `kanban_cards`, `kanban_stages`, `kanban_stage_history`. **Parcialmente implementada.**

- Leads por estágio (snapshot) · **conversão etapa→etapa** (funil)
- **Tempo médio por estágio** (`kanban_stage_history`, base auditável do doc 03) — gargalos em vermelho
- Leads por origem (whatsapp/manual/import/chatwoot/api) e por cidade
- Cards "parados" (aging > N dias) · leads stale (sem interação > 7d)

### Seção E — Crédito (Simulações, Análises, Contratos)

Fonte: `credit_simulations`, `credit_analyses`, `contracts`, `credit_products`.

- Simulações por produto/cidade/origem · valor médio solicitado · prazo médio · taxa média aplicada
- Funil de crédito: **simulação → enviada → análise → aprovação → contrato** (taxas de conversão entre etapas)
- Análises: **taxa de aprovação/rejeição**, tempo médio de análise, valor médio aprovado, fila pendente, carga por analista
- Contratos: por status (draft/signed/active/settled/defaulted/cancelled), valor principal total, prazo médio, **taxa de default**

### Seção F — Cobrança & Carteira

Fonte: `payment_dues`, `collection_jobs`, `collection_rules`, SPC. `billing:read` (admin/gestor_geral/cobranca).

- 5 cards de carteira (**já existem** em `/api/dashboard/collection`): a vencer · vencidos sem cobrança · em cobrança · 15d+ · em SPC
- **Taxa de adimplência/inadimplência** · valor total por status · dias médios de atraso · dias médios até pagamento
- Eficiência de cobrança: jobs agendados→enviados, taxa de falha, tentativas médias, pago-antes-do-envio
- Cobertura PIX vs boleto · renegociações

### Seção G — Produtividade (por agente / equipe)

`dashboard:read_by_agent`. Para gestores: ranking da equipe; para agente: só ele (auto-comparação contra média da equipe, sem expor colegas nominalmente se LGPD interna exigir — decisão D3).

- Leads fechados (won) por agente · simulações criadas · conversas resolvidas · 1ª resposta média · ciclo médio
- Cobranças criadas/quitadas por agente · contratos originados

### Seção H — Auditoria & Operação (admin)

`audit:read`. Fonte: `audit_logs`, `event_outbox`/DLQ.

- Ações por tipo/ator/período · alterações críticas (senha, role, status, crédito)
- Saúde de eventos: volume, taxa de sucesso, latência, **itens em DLQ**

---

## 5. Filtros (direcionados por contexto)

Barra de filtros sticky no topo, **adaptativa ao papel**. Estado serializado na URL (deep-link + reload-safe) e persistido por usuário.

| Filtro                 | Disponível para           | Comportamento                                                                                   |
| ---------------------- | ------------------------- | ----------------------------------------------------------------------------------------------- |
| **Período**            | todos                     | Presets (hoje, 7d, 30d, MTD, YTD) + **intervalo customizado** (date range picker). Default 30d. |
| **Escopo**             | quem tem >1 escopo        | Meus dados / Equipe / Cidade X / Consolidado (ver §3)                                           |
| **Cidade**             | escopo multi-cidade       | Multi-select; respeita `user_city_scopes`. Aparece só se escopo > 1 cidade.                     |
| **Agente**             | `dashboard:read_by_agent` | Single/multi-select da equipe da(s) cidade(s).                                                  |
| **Produto de crédito** | seções D/E                | Filtra simulações/análises/contratos por `product_id`.                                          |
| **Canal**              | seções B/C                | WhatsApp/Instagram/WAHA.                                                                        |
| **Status**             | contextual                | Status de lead / conversa / análise / contrato / parcela conforme a seção.                      |
| **Origem**             | seção D                   | whatsapp/manual/import/chatwoot/api.                                                            |
| **Comparação**         | gestores                  | "vs período anterior" (delta %) e "comparar cidades" (modo grid).                               |

**Regras:** filtros inválidos para o papel **nunca** são enviados (validação Zod no backend rejeita escopo fora do permitido — defense in depth). Toda combinação de filtros é refletida na exportação (exporta exatamente o que está na tela).

---

## 6. Exportação

Gated por flag `reports.export.enabled` (já existe no catálogo) + permissão nova `reports:export`.

- **Formatos:** **CSV** (dados tabulares, abre em qualquer lugar), **XLSX** (gestor/planilha — abas por seção), **PDF** (relatório formatado com branding Banco do Povo/SEDEC, para imprimir/protocolar — alto valor no setor público).
- **Biblioteca:** **`exceljs`** para XLSX (⚠️ **NÃO usar `xlsx`/SheetJS** — CVE de prototype pollution já levantada na auditoria de segurança 2026-06-22) · CSV gerado manualmente (sem dep) · PDF via geração server-side (`pdfkit` ou render headless de template — decisão D4).
- **Geração server-side**, escopo/RBAC reaplicados na rota de export (nunca confiar no front). A query de export = a query da tela com os mesmos filtros.
- **LGPD:** export carrega **agregados**. Se um relatório de drill-down (ex: lista de inadimplentes para ação de cobrança) precisar de PII, ele exige permissão específica, aplica mascaramento conforme finalidade, e **audita o export** com `action: 'reports.export'`, formato, filtros e contagem de linhas (sem PII bruta no log).
- **UX:** botão "Exportar" → escolha de formato + escopo (seção atual / relatório completo). Geração assíncrona para relatórios grandes (job + download quando pronto) — para o MVP, síncrono com limite de linhas.

---

## 7. Arquitetura técnica

### Backend (`apps/api/src/modules/reports/` — novo módulo, ou estender `dashboard/`)

- **Views materializadas** (doc 05 §9): `mv_dashboard_overview`, `mv_funnel_conversion`, `mv_stage_dwell_time` + novas para crédito/cobrança/IA. Refresh por job (5 min). KPIs pesados saem da MV; filtros finos caem em query direta indexada.
- **Endpoints** (todos com `authenticate` + `authorize` + Zod + `applyCityScope` + self-scope quando aplicável):
  - `GET /api/reports/overview` (reusa/estende `/dashboard/metrics`)
  - `GET /api/reports/attendance` · `GET /api/reports/ai` · `GET /api/reports/funnel`
  - `GET /api/reports/credit` · `GET /api/reports/collection` (reusa `/dashboard/collection`)
  - `GET /api/reports/productivity` · `GET /api/reports/audit`
  - `POST /api/reports/export` `{ section, format, filters }` → arquivo
- **Contrato Zod compartilhado** em `packages/shared-types` (evita o drift front×API já documentado). Front lê o schema real, não reescreve casing.
- Cada endpoint **audita a leitura** (já é o padrão de `dashboard.read`).

### Frontend (`apps/web/src/features/relatorios/`)

- `RelatoriosPage.tsx` monta seções por `hasPermission`. Rota já existe em `App.tsx` (trocar `PlaceholderPage`) e no nav.
- Hooks TanStack Query por seção (`useReportsOverview`, `useReportsCredit`, ...), `staleTime` ~3min, query-key inclui filtros.
- **Reusar componentes SVG existentes**; adicionar série temporal (line/area) e funil. Se a complexidade pedir, avaliar lib (decisão D5) — mas preferir SVG próprio para manter o DS coeso e zero-dep.
- Filtros como componente único controlado por estado na URL (Zustand + searchParams).
- Estados: loading (skeleton com profundidade do DS), empty (escopo sem dados), error.

---

## 8. Permissões & flags (catálogo)

Reusar o que existe e adicionar o mínimo:

- Existentes: `dashboard:read`, `dashboard:read_by_agent`, `billing:read`, `audit:read`.
- **Novas:** `reports:export` (gating de exportação). Avaliar `reports:read` como alias/guarda-chuva de `/relatorios` ou manter o gating granular por seção (recomendado: granular, reusando os existentes; `reports:export` é o único realmente novo).
- Flags (4 camadas): `dashboard.enabled` (parcial→full), `dashboard.by_agent.enabled` (Fase 6), `dashboard.followup_metrics.enabled` (Fase 6), `reports.export.enabled` (Fase 6). Plano: **construir tudo já**, manter seções avançadas atrás das flags e ligar progressivamente.

---

## 9. Decomposição em slots — Fase **F23** (autorada em `tasks/slots/F23/`)

> Autorada via `scripts/slot.py` seguindo `tasks/PROTOCOL.md`. Grafo de dependências validado
> com `plan-batch` (colisão de `_journal.json` entre S01/S02 detectada — não rodam em paralelo).

| Slot        | Especialista  | Depende de    | Entrega                                                                                       |
| ----------- | ------------- | ------------- | --------------------------------------------------------------------------------------------- |
| **F23-S01** | db-schema     | —             | Views materializadas + índices + worker de refresh (5 min)                                    |
| **F23-S02** | backend/db    | —             | RBAC: permissão `reports:export` + `billing:read` escopado p/ gestor_regional (D2)            |
| **F23-S03** | backend       | S01, S02      | Módulo `reports` core: Zod compartilhado + overview/funnel/attendance (city+self-scope+audit) |
| **F23-S04** | backend       | S03           | Endpoints credit + collection + productivity (D3)                                             |
| **F23-S05** | backend       | S03           | Endpoints IA/LLM health + auditoria                                                           |
| **F23-S06** | frontend      | S03           | Shell `RelatoriosPage` + filtros adaptativos + scope toggle + Visão Geral                     |
| **F23-S07** | frontend      | S05, S06      | Seções Atendimentos, IA, Funil/CRM                                                            |
| **F23-S08** | frontend      | S04, S05, S06 | Seções Crédito, Cobrança, Produtividade, Auditoria                                            |
| **F23-S09** | backend       | S04, S05      | `POST /reports/export` (CSV/XLSX via `exceljs`/PDF) + RBAC + flag + audit                     |
| **F23-S10** | frontend      | S08, S09      | UI de exportação + estados                                                                    |
| **F23-S11** | qa + security | S07, S08, S10 | Testes de isolamento por papel/tenant + métrica×SQL + LGPD do export + revisão de segurança   |

**Caminho crítico:** S01/S02 → S03 → (S04, S05, S06 em paralelo) → (S07, S08, S09) → S10 → S11.
**Primeiro batch executável:** F23-S01, depois F23-S02 (sequencial — colisão no journal de migrations).

---

## 10. Decisões

**Resolvidas (Rogério, 2026-06-23):**

- **D1 — Construir já vs gating Fase 6:** ✅ **Construir tudo agora atrás das flags.** Todas as seções e a exportação entram nesses slots; as avançadas (por-agente, follow-up, export) ficam atrás das feature flags existentes e ligam progressivamente.
- **D2 — Cobrança para gestor_regional:** ✅ **Sim, com escopo de cidade.** Conceder `billing:read` ao `gestor_regional`, escopado por `user_city_scopes` (vê inadimplência/carteira só das cidades dele). Requer ajuste no catálogo de permissões + garantir que o módulo de cobrança aplique `applyCityScope` (hoje `cobranca` é global — não regredir isso).
- **D3 — Produtividade nominal:** ✅ **Gestor vê ranking nominal; agente vê só a si + média anônima da equipe.** Backend não retorna nomes/números de colegas quando o solicitante é self-scoped.

**Pendentes (não bloqueiam o início; recomendação aplicada por default):**

- **D4 — Engine de PDF:** `pdfkit` (programático) vs render de template HTML headless. Default: **`pdfkit`** no MVP (zero infra extra). Reabrir só se o layout do PDF exigir fidelidade visual alta.
- **D5 — Lib de gráfico:** manter SVG próprio (coeso com DS, zero-dep) vs adotar lib para séries temporais/funil. Default: **SVG próprio**; adotar lib só se aparecer gráfico que não compense fazer à mão.

---

## 11. Riscos

- **Performance:** agregações sobre `messages`/`ai_decision_logs` (alto volume) — mitigado por MV + índices; nunca varrer tabela quente em request síncrono.
- **Drift front×API:** mitigado por Zod compartilhado em `shared-types`.
- **Vazamento LGPD em export/drill-down:** gate explícito + mascaramento + audit; revisão de segurança obrigatória no R-S10.
- **Escopo incorreto (self vs cidade vs global):** maior risco de bug — testes de isolamento por papel são obrigatórios (um teste por papel × por endpoint).
