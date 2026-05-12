# 11 — Roadmap Executável

> Roadmap em 8 fases (0 a 7). Cada fase tem objetivo claro, entregáveis, dependências, ordem sugerida, riscos e critérios de aceite. As tasks granulares estão em [12-tasks-tecnicas.md](12-tasks-tecnicas.md).

## Sumário das fases

| Fase | Foco                            | Resultado                                           |
| ---- | ------------------------------- | --------------------------------------------------- |
| 0    | Preparação                      | Monorepo + ambientes + DB + CI                      |
| 1    | Base operacional                | Auth, RBAC, CRM, Kanban, Flags, Chatwoot inicial    |
| 2    | Crédito e simulação             | Produtos, regras, simulador, tool da IA             |
| 3    | LangGraph e agente externo      | Grafo pré-atendimento + tools + handoff estruturado |
| 4    | Análise de crédito              | Manual + importação + versionamento                 |
| 5    | Automações                      | Follow-up + cobrança (gated)                        |
| 6    | Assistente interno + dashboards | Grafo interno + métricas                            |
| 7    | Migração + go-live              | Cutover, monitoramento, hardening                   |

---

## Fase 0 — Preparação

### Objetivo

Repositório, ambientes, banco e pipeline de CI prontos para receber as features.

### Entregáveis

- Monorepo `Elemento/` com `apps/web`, `apps/api`, `apps/langgraph-service`, `packages/*`.
- `docker-compose.yml` para dev (Postgres 16 + redis-stub futuro + serviços).
- `.env.example` completo.
- Migrations vazias inicializadas (Drizzle).
- ESLint, Prettier, Tsconfig, Pyproject configurados.
- GitHub Actions: lint + typecheck + test em PR.
- README com instruções de setup local.
- Tela de login básica + tela de erro + 404.

### Ordem

1. `pnpm` workspace + Turborepo.
2. Estrutura de pastas em cada app conforme [02-arquitetura-sistema.md](02-arquitetura-sistema.md).
3. Drizzle config + primeira migration vazia.
4. Fastify + plugin de health check (`/health`).
5. Vite + React + Tailwind + roteamento básico.
6. FastAPI + endpoint `/health` no LangGraph.
7. Docker compose com tudo isso de pé.
8. CI rodando.

### Critérios de aceite

- `pnpm dev` levanta web, api, langgraph e Postgres juntos.
- `pnpm test` roda suites vazias com sucesso.
- Pipeline verde em PR.

---

## Fase 1 — Base operacional

### Objetivo

Sistema usável com autenticação, gestão de usuários e cidades, CRM completo, Kanban e integração inicial com Chatwoot. Manager substitui Notion neste ponto.

### Entregáveis

- Autenticação (login, logout, refresh, sessões).
- RBAC + escopo por cidade.
- CRUD de usuários, papéis (seed inicial), cidades, agentes.
- CRM: leads + customers + cadastro manual + importação CSV.
- Kanban com stages, status, outcome, histórico.
- Integração Chatwoot: webhook + sync de atributos + criação de nota interna.
- Webhook WhatsApp + persistência de mensagens.
- Feature flags (banco + UI admin + middleware backend + worker check + cliente frontend).
- Audit logs.
- Outbox + worker básico.
- Telas: Login, Dashboard placeholder, CRM/lista, Detalhe do lead, Kanban, Detalhe do card, Cidades, Usuários, Agentes, Importações, Feature Flags, Audit, Logs/Integrações.

### Dependências

Fase 0.

### Ordem sugerida

1. Schema base: `organizations`, `users`, `roles`, `permissions`, `role_permissions`, `user_city_scopes`, `user_sessions`.
2. Auth + JWT + refresh + middleware authenticate/authorize.
3. CRUD de cidades + agentes.
4. Schema `leads`, `customers`, `lead_history`, `interactions`.
5. CRUD de leads (manual) com escopo por cidade.
6. Schema `kanban_stages`, `kanban_cards`, `kanban_stage_history`.
7. Kanban + transições.
8. Outbox (`event_outbox`, `event_processing_logs`) + worker outbox-publisher.
9. Eventos `leads.created`, `kanban.stage_updated`.
10. Importação de leads (8) — pipeline completo.
11. Webhook WhatsApp + persistência (sem IA ainda; resposta padrão).
12. Webhook Chatwoot + sync de atributos.
13. Tool de criação de nota interna no Chatwoot (mas ainda chamada manualmente).
14. Feature flags: tabela + UI + middlewares.
15. Audit logs.
16. Tela de logs/auditoria.

### Critérios de aceite

- Cadastrar lead manual, ver no Kanban, mover entre stages, ver histórico.
- Importar 100 leads via CSV com preview.
- Login/logout. Refresh. Bloqueio por cidade testado.
- Webhook WhatsApp grava mensagem; webhook Chatwoot atualiza atributos.
- Feature flag `crm.import.enabled=disabled` bloqueia tela e API.

### Riscos

- Subestimar dedupe de telefone. **Mitigação:** índices únicos parciais + testes desde o início.
- RBAC virar "filtro frouxo". **Mitigação:** repository força escopo, com testes específicos.

---

## Fase 2 — Crédito e simulação

### Objetivo

Produtos de crédito configuráveis pela UI, com versionamento de regras. Simulador interno funcional. Base para a IA gerar simulações.

### Entregáveis

- Schema `credit_products`, `credit_product_rules`, `credit_simulations`.
- CRUD de produtos + UI de gestão de regras com timeline de versões.
- Simulador interno (UI + cálculo Price + tabela de amortização).
- Endpoint `POST /api/simulations` (UI) e `POST /internal/simulations` (preparação para IA).
- Eventos `credit.product_*`, `credit.rule_published`, `simulations.generated`.
- Histórico de simulações no detalhe do lead/customer.

### Dependências

Fase 1.

### Ordem

1. Schema + migrations.
2. Service de cálculo (puro, testável, sem dependência de banco).
3. CRUD produtos + regras (com versionamento ao publicar).
4. Endpoint de simulação + persistência.
5. Tela do simulador interno.
6. Tela de produtos.
7. Eventos.
8. Card do Kanban exibe `last_simulation_id`.

### Critérios de aceite

- Criar produto + regra → simular → resultado correto.
- Atualizar regra → nova versão. Simulação antiga ainda válida e visível com badge de versão.
- Validações de limite funcionam.
- IA não usada ainda; endpoint interno pronto para Fase 3.

---

## Fase 3 — LangGraph e agente externo

### Objetivo

Pré-atendimento WhatsApp orquestrado por LangGraph. Tools controladas. Estado persistente. Handoff estruturado.

### Entregáveis

- Serviço Python rodando com FastAPI + LangGraph.
- Grafo `whatsapp_pre_attendance` com nós descritos em [06-langgraph-agentes.md](06-langgraph-agentes.md).
- Tools: `get_or_create_lead`, `update_lead_profile`, `identify_city`, `list_credit_products`, `generate_credit_simulation`, `mark_simulation_sent`, `request_handoff`, `create_chatwoot_note`, `get_customer_context`, `log_ai_decision`.
- Estado persistente em `ai_conversation_states`.
- Endpoints `/internal/...` no backend para cada tool.
- Backend chama LangGraph quando webhook WhatsApp chega.
- Resposta da IA enviada via WhatsApp.
- Logs em `ai_decision_logs`.
- Prompts versionados em arquivos.

### Dependências

Fase 1 + Fase 2 (precisa de produtos para simular).

### Ordem

1. Boilerplate FastAPI + LangGraph + endpoint de health.
2. Schema do estado + persistência (carregar/salvar via tool).
3. Cliente HTTP autenticado para tools.
4. Implementar tools uma a uma com testes unitários.
5. Endpoints `/internal/...` no backend (cada um espelha uma tool).
6. Implementar nós: `receive_message`, `load_state`, `classify_intent`.
7. Implementar `identify_or_create_lead`, `identify_city` (fluxo até cidade).
8. Implementar `qualify_credit_interest`, `generate_simulation`, `save_simulation`.
9. Implementar `decide_next_step`, `request_handoff`, `send_response`, `persist_state`, `log_decision`.
10. Roteamento (edges).
11. Backend: integrar webhook → chamar LangGraph → enviar resposta.
12. Testes conversacionais com fixtures.
13. Prompt injection tests.
14. Fallback de handoff quando LangGraph indisponível.

### Critérios de aceite

- Conversa real WhatsApp → IA responde, identifica cidade, gera simulação, registra tudo.
- IA não escreve direto no banco em nenhuma operação (verificável por logs).
- Reinício do serviço LangGraph não perde contexto.
- Falha de tool cai em handoff humano com mensagem segura.
- 5 conversas-fixture passam testes.

### Riscos

- Latência alta do LLM. **Mitigação:** modelo otimizado (Sonnet/Haiku) + cache de prompt + token limits + warmup.
- Custo descontrolado. **Mitigação:** monitoramento por conversa + alerta + limite por dia.
- IA "alucinar" simulação. **Mitigação:** simulação sempre via tool → backend → cálculo determinístico.

---

## Fase 4 — Análise de crédito

### Objetivo

Substituir o registro espalhado em Notion por análise estruturada, versionada, com importação massiva.

### Entregáveis

- Schema `credit_analyses`, `credit_analysis_versions`.
- CRUD de análise + edição = nova versão.
- Importação de análises (8).
- Tool `get_credit_analysis_history` (somente leitura, mascarada para grafo externo).
- Eventos.
- Tela de lista + detalhe + form de nova versão.
- Vinculação com simulação e card do Kanban.

### Dependências

Fase 1 + Fase 2.

### Ordem

1. Schema + migrations.
2. Service: criação + nova versão (imutabilidade da anterior).
3. Endpoints + telas.
4. Importação.
5. Tool de leitura para IA.
6. Promoção a aprovado/recusado dispara mudança de Kanban via evento.

### Critérios de aceite

- Criar análise, editar (nova versão), versão antiga visível e imutável.
- Importar planilha de análises do gestor com preview.
- IA tentando alterar análise → 403 (testado).
- Promoção a aprovado move card para concluido com outcome.

---

## Fase 5 — Automações (visíveis-mas-desabilitadas)

### Objetivo

Construir motor de follow-up e cobrança com flags `disabled`. UI mostra "Em desenvolvimento" mas estrutura está pronta para ligar.

### Entregáveis

- Schema `followup_rules`, `followup_jobs`, `payment_dues`, `collection_rules`, `collection_jobs`, `whatsapp_templates`.
- Workers `followup-scheduler`, `followup-sender`, `collection-scheduler`, `collection-sender`.
- Templates Meta integrados.
- Eventos.
- UI listas + cancelamento manual (ainda gated).

### Dependências

Fase 1 + 3.

### Ordem

1. Schemas.
2. Régua de follow-up (sem envio real ainda).
3. Worker scheduler agenda jobs com flag `disabled` → cancelados.
4. Worker sender preparado mas gated.
5. Cliente HTTP para envio de templates Meta.
6. UI: listas, detalhe, cancelamento, pausa.
7. Espelho para cobrança.
8. Validação ponta a ponta em staging com flag ligada.

### Critérios de aceite (Fase 5 entrega)

- Com flag desligada: nada é enviado.
- Com flag ligada em staging: régua dispara corretamente, resposta do cliente cancela próximos.
- Idempotência testada (não envia 2x).

---

## Fase 6 — Assistente interno e dashboards

### Objetivo

Assistente IA interno (somente leitura) operando dentro do Manager. Dashboards completos.

### Entregáveis

- Grafo `internal_assistant`.
- Tools de leitura.
- Endpoints `/internal/assistant/...`.
- Tela de chat do assistente.
- Confirmação de ações (estrutura pronta, ações mutantes pós-MVP).
- Views materializadas + jobs de refresh.
- Dashboards: overview, funil, por cidade. Gated: por agente, follow-up metrics.
- Exportação de relatórios (gated).

### Dependências

Fase 1 a 5.

### Ordem

1. Views materializadas + refresh.
2. APIs de dashboard.
3. Telas de dashboard.
4. Grafo do assistente.
5. Tools.
6. Tela do assistente.
7. Logs `assistant_queries`.

### Critérios de aceite

- Gestor regional pergunta "leads parados há 7+ dias" e recebe lista correta limitada à sua cidade.
- Agente pergunta "meus clientes pendentes" e recebe lista correta.
- Tentativa de pergunta cross-cidade é bloqueada e logada.
- Métricas batem com SQL direto.

---

## Fase 7 — Migração e go-live

### Objetivo

Migrar dados de Notion/Trello/MVP atual e cutover para o novo sistema com risco controlado.

### Entregáveis

- Scripts de export (Notion API, Trello API).
- Importação em homologação.
- Conferência manual com usuários-chave.
- Treinamento (sessões + materiais).
- Plano de cutover documentado.
- Operação paralela documentada.
- Monitoramento ativo nos primeiros 7 dias.
- Rollback documentado.

### Atividades

1. Inventário de dados.
2. Export Notion → CSV → import em staging.
3. Export Trello → JSON → import em staging.
4. Conferência com gestor.
5. Ajustes finais de mapping.
6. Treinamento dos agentes.
7. Cutover: desligar gravação no Notion/Trello (mantém leitura).
8. WhatsApp aponta 100% para Manager.
9. Operação paralela 7 dias (Notion/Trello somente leitura).
10. Decommissioning de Notion/Trello no fluxo.
11. Pós go-live: revisão de feature flags, plano de habilitar follow-up.

### Critérios de aceite

- 100% dos leads ativos do Notion presentes no Manager.
- 100% dos cards do Trello refletidos no Kanban.
- Operação rodando 7 dias sem incidente bloqueante.
- Rollback testado em staging.

---

## Estimativa de prazo (calibração)

| Fase | Esforço relativo | Observação                    |
| ---- | ---------------- | ----------------------------- |
| 0    | 5%               | crítico, paralelizável        |
| 1    | 25%              | maior bloco; base de tudo     |
| 2    | 10%              | dependente de 1               |
| 3    | 20%              | LangGraph é a maior incerteza |
| 4    | 10%              | depende de 2                  |
| 5    | 10%              | feita "pronta-mas-desligada"  |
| 6    | 10%              | depende de 1–5                |
| 7    | 10%              | janela final, sensível        |

Para entrega em 45 dias com qualidade real: **Fases 0–4 + Fase 5 com flags desligadas + Fase 7 inicial.** Fase 6 (assistente interno e dashboards completos) entra em onda 2 pós go-live. Justificativa em [16-revisao-critica.md](16-revisao-critica.md).
