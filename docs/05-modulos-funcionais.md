# 05 — Módulos Funcionais

> Cada módulo descreve: objetivo, usuários, fluxos, regras, dados, eventos, telas, APIs, critérios de aceite, feature flag, dependências.

---

## 1. CRM

### Objetivo

Substituir Notion como fonte da verdade de leads e clientes. Centralizar identidade, histórico, associações.

### Usuários

- Agente, gestor regional, gestor geral, admin.

### Fluxos principais

- **Cadastro automático via WhatsApp:** cria lead com `source=whatsapp`, sem `customer_id`.
- **Cadastro manual:** form completo, validação Zod, dedupe por `primary_phone` normalizado.
- **Importação CSV/XLSX:** ver [08-importacoes.md](08-importacoes.md).
- **Dedupe:** índice único parcial em `(organization_id, primary_phone) where status != 'merged'`. Conflito → tela de merge sugerido.
- **Promoção a customer:** ao obter CPF, cria `customers` e linka `leads.customer_id`.
- **Tags:** array livre, com sugestões de auto-complete.
- **Timeline:** `lead_history` + `interactions` mescladas em ordem temporal.

### Regras

- Telefone normalizado E.164. Validação de DDD (Rondônia tem 069).
- CPF criptografado em repouso, hash para busca.
- Cidade obrigatória ao mover para `simulacao`.
- Agente atribuído obrigatório ao mover para `documentacao`.

### Dados

Tabelas: `leads`, `customers`, `customer_contacts`, `customer_addresses`, `lead_history`, `interactions`.

### Eventos

`leads.created`, `leads.updated`, `leads.imported`, `leads.merged`, `interactions.recorded`.

### Telas

- CRM/lista (filtros por cidade, agente, status, origem, tags, busca).
- Detalhe do cliente (abas: Resumo, Conversas, Simulações, Análises, Documentos, Histórico).
- Form de novo lead.
- Merge sugerido.

### APIs

`GET /api/leads`, `POST /api/leads`, `GET /api/leads/:id`, `PATCH /api/leads/:id`, `POST /api/leads/:id/merge`, `GET /api/leads/:id/timeline`, `GET /api/customers/:id`.

### Feature flag

`crm.enabled` (default `enabled`). Sub: `crm.import.enabled`.

### Critérios de aceite

- Criar lead manualmente, validação ativa.
- Listar leads com filtro por cidade respeitando escopo.
- Tentar criar lead com telefone duplicado → bloqueio com mensagem clara.
- Promover lead a customer.
- Acesso negado a lead de cidade fora do escopo.

### Dependências

auth, cidades, agentes.

---

## 2. Kanban

### Objetivo

Substituir Trello. Visão operacional do funil com stages, status e outcome separados.

### Usuários

Agente, gestor regional, gestor geral.

### Fluxos

- Card é criado automaticamente em `pre_atendimento` quando lead nasce.
- Movimentação manual com drag-and-drop ou via menu contextual; valida transições permitidas.
- Movimentação automática por eventos:
  - `simulations.generated` em pre_atendimento → move para `simulacao`.
  - `chatwoot.handoff_requested` → move para `documentacao` se ainda em pre/sim.
  - `credit_analysis.status_changed` para `aprovado`/`recusado` → move para `concluido` com `outcome` correspondente.
- Mudança de stage exige `reason` quando saída é "para trás" ou para `concluido`/`abandonado`.

### Regras

- Stages catalogados em `kanban_stages` (ordem fixa, mas adição futura possível).
- `status` é livre dentro de cada stage, mas validado por enum por stage:
  - `pre_atendimento`: `aguardando_resposta`, `coletando_dados`, `pronto_para_simulacao`.
  - `simulacao`: `aguardando_decisao_cliente`, `simulacao_enviada`, `aguardando_documento`.
  - `documentacao`: `aguardando_documento`, `documento_pendente`, `pronto_para_analise`.
  - `analise_credito`: `em_analise`, `pendente_resposta_cliente`.
  - `concluido`: outcome decide.
- `outcome` só preenchido quando stage = `concluido`.
- Transições reversas exigem permissão (`kanban:revert`).

### Dados

`kanban_cards`, `kanban_stages`, `kanban_stage_history`.

### Eventos

`kanban.card_created`, `kanban.stage_updated`, `kanban.outcome_set`.

### Telas

- Kanban (colunas por stage, filtros por cidade/agente/produto/período, busca).
- Detalhe do card (modal lateral com Resumo, Simulação vinculada, Análise vinculada, Histórico, Mensagens recentes).
- Histórico de mudanças.
- Métricas embutidas (tempo médio na coluna).

### APIs

`GET /api/kanban` (filtros), `PATCH /api/kanban/cards/:id/stage`, `PATCH /api/kanban/cards/:id/status`, `PATCH /api/kanban/cards/:id/outcome`, `GET /api/kanban/cards/:id/history`.

### Feature flag

`kanban.enabled` (default `enabled`).

### Critérios de aceite

- Movimentar card respeitando transições válidas.
- Filtros por cidade respeitam escopo do usuário.
- Histórico registra ator, motivo e timestamp.
- Métricas de tempo por etapa calculam corretamente.

### Dependências

CRM, cidades, agentes, eventos.

---

## 3. Simulação de crédito dinâmica

### Objetivo

Eliminar dados fixos no código. Permitir criar/editar produtos e regras pela UI, com versionamento e preservação de histórico.

### Fluxos

- **CRUD de produtos:** admin/gestor geral cria produto, define regra inicial.
- **Atualização de regra:** ao alterar taxa/prazo, gera nova `credit_product_rules.version`. Antiga marcada `is_active=false` com `effective_to=now()`.
- **Simulação manual:** form pede produto, valor, prazo. Backend valida limites, calcula com fórmula Price (default) ou SAC, persiste com `rule_version_id`.
- **Simulação via IA:** tool `generate_credit_simulation` chama mesmo service.
- **Histórico:** lista simulações por lead, com badge de versão de regra.
- **Comparação:** futura — simulação solicitada vs aprovada vs contratada.

### Fórmula Price

$$ PMT = P \cdot \frac{i (1+i)^n}{(1+i)^n - 1} $$
Onde `P` = valor solicitado, `i` = taxa mensal decimal, `n` = prazo em meses. Tabela amortização gerada e salva em `credit_simulations.amortization_table`.

### Regras

- `amount` entre `min_amount` e `max_amount`.
- `term_months` entre `min_term_months` e `max_term_months`.
- Validar regra ativa para a cidade do lead (se `city_scope` não vazio).
- Simulação criada por IA sempre passa por endpoint backend que aplica todas as validações.
- Simulação é imutável após criação. Para "alterar", cria nova.

### Dados

`credit_products`, `credit_product_rules`, `credit_simulations`.

### Eventos

`credit.product_created`, `credit.product_updated`, `credit.rule_published`, `simulations.generated`, `simulations.sent_to_customer`.

### Telas

- Lista de produtos (gestor geral/admin).
- Editor de produto + regras (com timeline de versões).
- Simulador interno (form + resultado + tabela de amortização).
- Histórico de simulações na ficha do cliente.

### APIs

`GET/POST/PATCH /api/credit-products`, `POST /api/credit-products/:id/rules`, `POST /api/simulations`, `GET /api/customers/:id/simulations`.

### Feature flag

`credit_simulation.enabled` (default `enabled`).

### Critérios de aceite

- Criar produto sem deploy.
- Atualizar taxa cria nova versão; simulações antigas continuam apontando para versão antiga.
- Simulação via IA usa exatamente o mesmo cálculo do simulador interno.
- Validação rejeita valor fora dos limites.

### Dependências

auth, leads.

---

## 4. Análise de crédito

### Objetivo

Registrar parecer humano sobre cada operação, com versionamento, auditoria e suporte a importação massiva.

### Fluxos

- **Cadastro manual:** agente abre lead, registra análise vinculada (opcional) a uma simulação. Status inicial `em_analise` ou `pendente`.
- **Atualização:** sempre cria nova `credit_analysis_versions`. `credit_analyses.current_version_id` aponta para a mais nova.
- **Importação:** ver [08-importacoes.md](08-importacoes.md). Cada linha vira análise + versão `1`.
- **Promoção a aprovado:** preenche `approved_amount`, `approved_term_months`, `approved_rate_monthly`. Emite `credit_analysis.status_changed`.

### Regras

- Apenas `agente`, `gestor_regional` da cidade ou `gestor_geral` podem editar.
- Histórico de versões imutável.
- Status sequência válida: `em_analise → pendente|aprovado|recusado`. `pendente → aprovado|recusado`. `aprovado/recusado` é terminal.
- IA pode **ler** análise (tool `get_credit_analysis_history`) mas **não pode criar nem alterar**.

### Dados

`credit_analyses`, `credit_analysis_versions`, anexos via `attachments jsonb` ou tabela dedicada futura.

### Eventos

`credit_analysis.added`, `credit_analysis.updated`, `credit_analysis.imported`, `credit_analysis.status_changed`.

### Telas

- Lista de análises (filtros).
- Detalhe da análise (form de nova versão, timeline de versões).
- Importação dedicada.

### APIs

`POST /api/credit-analyses`, `PATCH /api/credit-analyses/:id` (cria nova versão), `GET /api/credit-analyses/:id`, `GET /api/customers/:id/analyses`, `POST /api/imports/credit-analyses`.

### Feature flag

`credit_analysis.enabled` (default `enabled`). Sub: `credit_analysis.import.enabled`. `internal_score.enabled` para o campo `internal_score`.

### Critérios de aceite

- Criar análise manual.
- Editar gera nova versão; versões antigas visíveis e imutáveis.
- Importação cria análises com vínculo correto.
- IA tentando alterar análise → 403.

### Dependências

CRM, simulações.

---

## 5. Motor de follow-up (visível-mas-desabilitado no MVP)

### Objetivo

Reativar leads inativos com mensagens automáticas seguindo régua D+1 / D+3 / D+7 / D+15.

### Fluxos

- Evento dispara agendamento (`leads.created`, `kanban.stage_updated`).
- Worker `followup-scheduler` cria `followup_jobs` com `scheduled_at`.
- Worker `followup-sender` lê jobs vencidos, valida janela WhatsApp (24h), seleciona template, envia.
- Mensagem do cliente cancela jobs futuros da régua daquele lead.

### Regras

- Idempotência por `(lead_id, rule_id, day_bucket)`.
- Pausa global por flag `followup.enabled=disabled` (no MVP).
- Pausa manual por agente.
- Respeitar templates Meta aprovados.
- Respeitar opt-out.

### Dados

`followup_rules`, `followup_jobs`, `whatsapp_templates`.

### Eventos

`followup.scheduled`, `followup.triggered`, `followup.sent`, `followup.failed`, `followup.cancelled`, `customer_replied_after_followup`.

### Telas

- Lista de réguas (admin).
- Lista de jobs (com status, filtros).
- Detalhe do lead mostra jobs ativos e histórico.

### APIs

`GET/POST /api/followup-rules`, `GET /api/followup-jobs`, `POST /api/followup-jobs/:id/cancel`, `POST /api/leads/:id/followup/pause`.

### Feature flag

`followup.enabled` (default `disabled` no MVP).

### Critérios de aceite (Fase 5)

- Régua agenda corretamente.
- Resposta do cliente cancela próximos.
- Janela WhatsApp respeitada.
- Falha de envio registrada e retry seguro.

### Dependências

WhatsApp, templates, eventos.

---

## 6. Motor de cobrança (visível-mas-desabilitado no MVP)

Espelho do follow-up, mas para `payment_dues`. Régua D-3 / D0 / D+3 / D+15.

### Fluxos especiais

- Cadastro manual ou importação de vencimentos.
- Marcação manual como pago/renegociado/inadimplente.
- Geração de cobrança evita duplicidade por `(payment_due_id, rule_id)`.

### Eventos

`payment.due_created`, `collection.scheduled`, `collection.triggered`, `collection.message_sent`, `collection.failed`, `payment.marked_as_paid`, `payment.marked_as_overdue`, `payment.renegotiated`.

### Feature flag

`collection.enabled` (default `disabled` no MVP).

---

## 7. Assistente IA interno (visível-mas-desabilitado no MVP)

### Objetivo

Permitir que gestores e agentes consultem dados operacionais em linguagem natural, respeitando escopo de permissão.

### Fluxos

- Usuário digita pergunta no Manager.
- Backend valida flag + permissão.
- Encaminha ao LangGraph (grafo `internal_assistant`).
- LangGraph carrega contexto do usuário (role, city_scopes), classifica consulta, escolhe tools (somente leitura no MVP).
- Tools chamam endpoints internos do backend (`/internal/assistant/*`) que aplicam o mesmo RBAC.
- Resposta volta com texto + dados + ações sugeridas.
- Ações que mutam exigem confirmação humana explícita.

### Regras

- IA jamais executa ação mutante sem confirmação.
- IA não vê dados fora do escopo do usuário.
- Toda consulta gera `assistant_queries`.
- Prompt versionado.

### Dados

`assistant_queries`, `prompt_versions`.

### Eventos

`internal_assistant.query_created`, `internal_assistant.tool_called`, `internal_assistant.action_requested`, `internal_assistant.action_confirmed`.

### Telas

- Painel do assistente (chat com histórico).
- Confirmação de ação (modal com diff).

### APIs

`POST /api/internal-assistant/query`, `POST /api/internal-assistant/actions/:id/confirm`.

### Feature flag

`ai.internal_assistant.enabled` (default `disabled` no MVP, habilitado em Fase 6).

### Critérios de aceite

- Gestor regional vê apenas dados da sua cidade.
- Tentativa de ação mutante sem confirmação → bloqueada.
- Logs registram tools usadas e respostas.

### Dependências

LangGraph, RBAC, dashboards.

---

## 8. Multiagentes por cidade

### Objetivo

Suportar múltiplos agentes humanos em diferentes cidades com isolamento, roteamento e visibilidade segmentada.

### Fluxos

- Cadastro de cidades + slugs + aliases.
- Cadastro de agentes vinculados a `users`.
- `agent_city_assignments` define quais cidades cada agente atende. `is_primary` define cidade-base.
- Roteamento ao identificar cidade:
  1. Filtra agentes ativos com `agent_city_assignments` na cidade.
  2. Aplica regra de balanceamento (round-robin por cidade ou menor carga ativa).
  3. Atualiza `kanban_cards.assigned_agent_id` e `chatwoot.assignee`.
- Fallback se nenhum agente disponível: atribui ao gestor da cidade ou cai em fila de cidade.
- Cidade não identificada: card fica em fila `triage` visível só para gestor geral.

### Regras

- Agente fora do escopo da cidade vê 403 ao tentar abrir lead.
- Transferência manual entre agentes registrada em `lead_history`.
- Mudança de cidade do lead reavalia roteamento e dispara `agent_transferred`.

### Eventos

`cities.identified`, `lead_assigned_to_agent`, `lead_assigned_to_city_queue`, `agent_transferred`, `routing_failed`.

### Telas

- Cidades (admin).
- Agentes + atribuições.
- Fila por cidade.
- Triage (gestor geral).

### APIs

`GET/POST/PATCH /api/cities`, `GET/POST /api/agents`, `POST /api/agents/:id/cities`, `POST /api/leads/:id/transfer`.

### Feature flag

`multi_city_routing.enabled` (default `enabled`).

### Critérios de aceite

- Lead vai para agente da cidade correta.
- Sem agente disponível → fila de cidade.
- Sem cidade → triagem.
- Transferência registra histórico.

---

## 9. Dashboard analítico

### Objetivo

Visão operacional confiável, alimentada por eventos.

### Métricas Fase 1 (habilitadas)

- Leads por dia (últimos 30 dias).
- Leads por cidade.
- Leads por estágio (snapshot atual).
- Conversão por etapa.
- Tempo médio por etapa.
- Simulações geradas (período).
- Análises por status.

### Métricas Fase 6 (visíveis-mas-desabilitadas no MVP)

- Conversão por agente.
- Tempo médio até primeiro atendimento humano.
- Follow-ups enviados / taxa de resposta.
- Cobranças enviadas / taxa de pagamento.
- Gargalos detectados (heurística).

### Implementação

- Views materializadas no Postgres (`mv_dashboard_overview`, `mv_funnel_conversion`, `mv_stage_dwell_time`).
- Refresh periódico via job (5 min).
- Filtros por cidade respeitam escopo do usuário (queries com filtro de `city_id IN (...)`).

### Telas

- Overview com cards.
- Funil.
- Performance por cidade/agente (gated).
- Detalhamento drill-down (futuro).

### APIs

`GET /api/dashboard/overview`, `GET /api/dashboard/funnel`, `GET /api/dashboard/by-city`.

### Feature flag

`dashboard.enabled` (parcial). Sub-flags por seção (`dashboard.by_agent.enabled`, `dashboard.followup_metrics.enabled`).

### Critérios de aceite

- Métricas batem com query SQL direta.
- Filtros respeitam escopo.
- Refresh automático funciona.

---

## 10. Integração Chatwoot

Detalhe completo em [07-integracoes-whatsapp-chatwoot.md](07-integracoes-whatsapp-chatwoot.md).

Resumo:

- Webhook → backend valida HMAC → grava interação → atualiza atributos → dispara IA.
- Backend pode atualizar conversa via API: assignee, custom attributes, notas internas.
- Handoff cria nota estruturada com resumo + simulação + cidade.
- Fallback: se Chatwoot indisponível, mensagem fica em outbox para reenvio.

---

## 11. Agente externo de pré-atendimento (LangGraph)

Detalhe completo em [06-langgraph-agentes.md](06-langgraph-agentes.md).
