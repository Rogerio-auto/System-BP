# 01 — PRD do Produto

## 1. Visão de produto

**Manager Banco do Povo** é a plataforma operacional única do Banco do Povo de Rondônia para originação, atendimento, simulação, análise e cobrança de crédito popular, integrando IA de pré-atendimento via WhatsApp e atendimento humano via Chatwoot, com operação distribuída por cidade e múltiplos agentes.

A plataforma substitui Notion (CRM) e Trello (pipeline) e centraliza a operação em um banco PostgreSQL único, com regras de negócio determinísticas em backend Node.js e orquestração de IA em serviço Python LangGraph isolado.

## 2. Objetivos do produto

| Objetivo                                    | Métrica de sucesso                                                                |
| ------------------------------------------- | --------------------------------------------------------------------------------- |
| Centralizar a operação                      | 100% dos leads, simulações e análises no Postgres. Notion/Trello descomissionados |
| Acelerar pré-atendimento                    | Tempo médio do primeiro contato à coleta básica < 3 min                           |
| Aumentar conversão                          | Conversão pré-atendimento → análise > baseline atual + 20%                        |
| Garantir conformidade operacional           | 100% das alterações sensíveis com audit log                                       |
| Permitir multi-cidade real                  | Isolamento de dados por cidade testado e auditado                                 |
| Eliminar deploy para mudar regra de crédito | Mudança de taxa/prazo/produto via UI, com versionamento                           |
| Reduzir handoffs sem contexto               | 100% dos handoffs no Chatwoot com nota interna estruturada                        |

## 3. Personas

### 3.1 Cliente final (lead)

- Pessoa de baixa/média renda em municípios de Rondônia.
- Canal primário: WhatsApp.
- Expectativa: resposta rápida, simulação clara, atendimento humano quando necessário.
- Nível digital: variado. Mensagens curtas, dúvidas frequentes, áudio comum.

### 3.2 Agente de crédito (operador)

- Atende clientes via Chatwoot.
- Faz simulações no Manager.
- Registra análise de crédito.
- Movimenta cards no Kanban.
- Gera follow-ups manuais.
- Vê apenas dados da(s) cidade(s) onde tem permissão.

### 3.3 Gestor regional / cidade

- Supervisiona múltiplos agentes em uma cidade.
- Vê dashboards da cidade.
- Reatribui leads.
- Confirma ações pendentes do assistente IA.
- Não vê dados de outras cidades.

### 3.4 Gestor geral

- Visão consolidada multi-cidade.
- Configura produtos de crédito, regras, taxas.
- Aprova migrações.
- Lê audit logs.

### 3.5 Administrador técnico

- Liga/desliga feature flags.
- Gerencia usuários, papéis, permissões.
- Acessa logs de erro e integrações.
- Faz importações em massa.

## 4. Jornadas críticas

### 4.1 Lead novo via WhatsApp (jornada feliz)

1. Cliente manda mensagem no WhatsApp oficial.
2. Webhook do WhatsApp → backend Node.js.
3. Backend persiste mensagem bruta (`whatsapp_messages`), gera/atualiza `chatwoot_conversations`, dispara processamento.
4. Backend chama LangGraph (`POST /internal/ai/conversations/process-message`) com contexto.
5. LangGraph carrega `ai_conversation_states`, classifica intenção, identifica/cria lead via tool `get_or_create_lead`.
6. Coleta nome e cidade. Tool `identify_city` resolve cidade (com fuzzy match).
7. Cliente pede simulação → tool `generate_credit_simulation` → backend valida contra `credit_products` + regra ativa, persiste `credit_simulations` com `rule_version`.
8. Backend cria `kanban_card` em stage `pre_atendimento`.
9. Cliente pede atendimento humano → tool `request_handoff` → backend cria handoff, atualiza Chatwoot via API com nota interna estruturada (resumo + simulação + cidade).
10. Card move para `documentacao`.
11. Agente humano atende no Chatwoot, registra análise no Manager, move card.
12. Eventos disparam follow-up agendado (D+1, D+3, D+7, D+15) — nesta fase, **agendados mas não enviados** se feature flag `followup.enabled` estiver `disabled`.

### 4.2 Lead manual (agente cadastra do balcão)

1. Agente abre Manager → CRM → Novo lead.
2. Preenche form (nome, telefone, cidade automática pela permissão, produto de interesse).
3. Backend valida, dedupa por telefone normalizado, cria `lead`, `customer` e `kanban_card`.
4. Agente abre lead, gera simulação manual.
5. Registra análise.
6. Move card.

### 4.3 Importação de leads

1. Admin → Importações → Leads → Upload CSV/XLSX.
2. Sistema parseia, identifica colunas, exibe mapeamento sugerido.
3. Usuário confirma mapeamento.
4. Sistema valida linha por linha (telefone, cidade, dedupe).
5. Preview: válidas, inválidas, duplicadas, avisos.
6. Usuário confirma. Job processa em background.
7. Relatório final com `import_batches.id`. Cada linha em `import_rows`.
8. Eventos `lead_imported` emitidos por linha aprovada.

### 4.4 Handoff e contexto no Chatwoot

1. LangGraph decide handoff.
2. Backend cria registro em `chatwoot_handoffs` com `summary`, `simulation_id`, `lead_id`.
3. Backend chama API do Chatwoot:
   - Atualiza custom attributes da conversa (`lead_id`, `cidade`, `produto`, `valor`, `prazo`, `simulacao_id`).
   - Cria nota interna com resumo estruturado.
   - Atribui agente conforme regra de roteamento por cidade.
4. Agente humano abre Chatwoot, vê nota e atributos, atende com contexto.

### 4.5 Assistente IA interno (Fase 6, visível-mas-desabilitado no MVP)

1. Gestor digita: "Quais leads de Porto Velho estão parados há mais de 7 dias?"
2. Frontend chama `POST /api/internal-assistant/query`.
3. Backend valida feature flag e permissão.
4. Encaminha para LangGraph (grafo `internal_assistant`).
5. LangGraph carrega contexto do usuário, valida escopo, escolhe tools (consulta apenas dentro do escopo do usuário).
6. Retorna resposta + lista de leads + ações sugeridas (que exigem confirmação).
7. Log persistido em `assistant_queries`.

## 5. Escopo funcional

### 5.1 Features habilitadas no MVP (Fase 1–4)

| Feature                                                    | Status MVP |
| ---------------------------------------------------------- | ---------- |
| Autenticação + RBAC + escopo por cidade                    | Habilitado |
| Gestão de usuários, papéis, cidades                        | Habilitado |
| CRM (lead, customer, contatos, histórico)                  | Habilitado |
| Cadastro manual + importação de leads                      | Habilitado |
| Kanban com stages + status + outcome                       | Habilitado |
| Produtos de crédito configuráveis + versionamento de regra | Habilitado |
| Simulação dinâmica (UI + tool IA)                          | Habilitado |
| Análise de crédito manual + importação                     | Habilitado |
| LangGraph: grafo pré-atendimento WhatsApp                  | Habilitado |
| Integração Chatwoot (webhook + atributos + nota interna)   | Habilitado |
| Integração WhatsApp API oficial                            | Habilitado |
| Audit logs + AI decision logs + event outbox               | Habilitado |
| Feature flags (banco + UI + API + jobs + tools)            | Habilitado |
| Tela de logs/auditoria (admin)                             | Habilitado |

### 5.2 Features visíveis-mas-desabilitadas no MVP

| Feature                          | Status MVP                                                  | Quando habilitar |
| -------------------------------- | ----------------------------------------------------------- | ---------------- |
| Motor de follow-up automático    | Visível, badge "Em desenvolvimento"                         | Fase 5           |
| Motor de cobrança automático     | Visível, badge "Em desenvolvimento"                         | Fase 5           |
| Assistente IA interno            | Visível, somente leitura básica                             | Fase 6           |
| Dashboard analítico completo     | Visível com métricas básicas; cards avançados desabilitados | Fase 6           |
| Exportação PDF/CSV de relatórios | Visível, botão desabilitado                                 | Fase 6           |
| PWA / app mobile                 | Sem entrada visível                                         | Pós-MVP          |
| Score interno                    | Visível em formulário, não calculado                        | Pós-MVP          |
| Integração externa de bureau     | Não disponível                                              | Pós-MVP          |

### 5.3 Fora de escopo do MVP

- Multi-tenancy real (mas a modelagem deixa porta aberta com `organization_id`).
- Renegociação automatizada.
- Contrato eletrônico / assinatura digital.
- Integração com sistema bancário/ERP externo.
- App nativo iOS/Android.

## 6. Requisitos não-funcionais

| Categoria            | Requisito                                                                                                |
| -------------------- | -------------------------------------------------------------------------------------------------------- |
| Performance          | p95 de endpoint CRUD < 250ms, p95 de tool da IA < 800ms                                                  |
| Disponibilidade alvo | 99,5% para API, 99% para LangGraph (com fallback de handoff)                                             |
| Segurança            | RBAC obrigatório, validação Zod server-side, idempotency em todos webhooks, rate limiting                |
| Auditoria            | Toda alteração em `credit_analyses`, `credit_products`, `kanban_cards.stage`, permissões, gera audit log |
| Privacidade          | Dados de cliente isolados por cidade. Mascaramento de CPF em listas                                      |
| Observabilidade      | Logs estruturados, correlation_id ponta a ponta, métricas básicas Prometheus-style                       |
| Manutenibilidade     | Zero regra de negócio em controller. Camadas service/repository/schema                                   |
| Acessibilidade       | WCAG AA mínimo nos fluxos principais                                                                     |
| Compatibilidade      | Chrome, Firefox, Safari últimos 2 anos. Responsivo desktop-first com mobile funcional                    |
| Idioma               | pt-BR. Sem i18n no MVP, mas strings centralizadas                                                        |

## 7. Princípio de UX

- Densidade controlada, mas com respiração editorial. Referências: Linear, Stripe, Vercel.
- Dark-first opcional via toggle, light como default.
- Tipografia: Inter ou Geist. Sem fontes decorativas.
- Cores: cinza-frio com acento único de marca; status com semântica clara (sucesso, atenção, erro, neutro).
- Tabelas pesadas (CRM, Kanban) precisam de virtualização e filtros persistidos.
- Forms com validação em tempo real, espelhando Zod do backend.
- Estados sempre cobertos: vazio, carregando, erro, sem permissão, feature desligada.

## 8. Conformidade e legal

- LGPD: registro de finalidade, base legal, retenção. Dados pessoais com criptografia em repouso (PostgreSQL TDE / pgcrypto para campos sensíveis se exigido).
- Logs de acesso a dados de cliente (audit log) para responder pedidos de titular.
- Consentimento de tratamento via WhatsApp registrado em `customers.consent_at` quando aplicável.
- Conformidade Meta/WhatsApp: respeitar templates aprovados, janela de 24h, opt-out.

## 9. Critérios de sucesso do MVP

Em [13-criterios-aceite.md](13-criterios-aceite.md). Resumo:

- Lead WhatsApp → CRM → Kanban → Chatwoot funciona ponta a ponta.
- Simulação dinâmica versionada funciona via UI e via IA.
- Análise manual + importação funcionam com auditoria.
- Permissão por cidade testada e bloqueando acesso indevido.
- Importação de planilha real do Notion/Trello funciona com preview.
- Feature flag desabilitada bloqueia em UI, API e tool.

## 10. Glossário

| Termo        | Definição                                                                              |
| ------------ | -------------------------------------------------------------------------------------- |
| Lead         | Contato em estágio de pré-cliente, antes de virar cliente com crédito                  |
| Customer     | Pessoa identificada formalmente (CPF/dados completos)                                  |
| Stage        | Estágio macro do Kanban (pre_atendimento, simulação, documentação, análise, concluído) |
| Status       | Subestado dentro do stage (ex: aguardando_documento)                                   |
| Outcome      | Resultado final (aprovado, recusado, abandonado, contratado)                           |
| Handoff      | Passagem da IA para agente humano via Chatwoot                                         |
| Tool         | Função controlada que a IA pode chamar via LangGraph                                   |
| Outbox       | Tabela de eventos pendentes de processamento                                           |
| Régua        | Sequência temporal de mensagens (D+1, D+3...)                                          |
| Rule version | Versão de regra de simulação preservada para histórico                                 |
