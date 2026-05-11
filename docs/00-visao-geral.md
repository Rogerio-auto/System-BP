# 00 — Visão Geral

> **Projeto:** Manager Banco do Povo
> **Cliente:** Banco do Povo de Rondônia
> **Documento mãe:** este arquivo é o ponto de entrada da documentação técnica. Cada seção remete a um documento aprofundado.

---

## 1. Resumo executivo

O Banco do Povo de Rondônia opera hoje um MVP que validou o uso de IA no pré-atendimento via WhatsApp, integrado a Chatwoot, Notion e Trello, com simulação de crédito feita por agente conversacional usando dados fixos no código. O modelo provou tração, mas não é uma plataforma. É um conjunto de integrações no-code/low-code com lógica espalhada e regras codificadas a quente.

O **Manager Banco do Povo** é a evolução do MVP para uma **plataforma de produção**, multi-cidade, multiagente, orientada a eventos, com PostgreSQL como fonte central da verdade, backend Node.js/TypeScript com regras de negócio determinísticas, serviço Python LangGraph isolado para orquestração de IA, frontend React/Tailwind para operação interna e Chatwoot mantido apenas como interface de atendimento humano.

Notion e Trello deixam de existir no fluxo crítico.

---

## 2. O que existe hoje (MVP)

| Componente           | Função atual          | Limitação                                                                |
| -------------------- | --------------------- | ------------------------------------------------------------------------ |
| Agente IA WhatsApp   | Pré-atendimento       | Estado frágil, prompts não versionados, decisões sem log estruturado     |
| WhatsApp API oficial | Canal de mensagens    | OK como camada, mas sem reprocessamento robusto                          |
| Chatwoot             | Interface humana      | OK, mas sem contexto rico vindo da IA                                    |
| Notion               | "CRM"                 | Dados não relacionais, sem auditoria, sem permissão por cidade           |
| Trello               | "Kanban"              | Estado operacional fora do banco, sem eventos, sem histórico estruturado |
| Simulação            | Dados fixos no código | Mudança de taxa exige deploy                                             |
| Handoff              | Existe                | Sem contexto estruturado, sem garantia de entrega                        |

**Conclusão:** o MVP é uma colcha. Não tem fonte central da verdade. Cada alteração de regra de negócio é uma alteração de código. Cada nova cidade ou agente humano cria fricção operacional.

---

## 3. O que será construído

Uma plataforma com **cinco superfícies bem definidas**:

1. **Manager (frontend React)** — operação interna: CRM, Kanban, simulações, análises, importações, dashboards, assistente IA interno, configurações.
2. **API (backend Node.js)** — dono das regras de negócio, autenticação, autorização, persistência, eventos, integrações.
3. **LangGraph Service (Python)** — orquestração dos agentes de IA: pré-atendimento externo no WhatsApp e assistente interno do Manager.
4. **PostgreSQL** — fonte central da verdade. Único banco transacional.
5. **Chatwoot** — apenas interface de atendimento humano. Recebe contexto, não é fonte de dados.

WhatsApp API oficial e Chatwoot continuam, mas como **canais**, nunca como **estado**.

---

## 4. Princípios não-negociáveis

1. **Postgres é a fonte da verdade.** Notion e Trello somem.
2. **Backend Node.js é dono da regra.** A IA não escreve direto no banco. Tudo passa por API validada.
3. **LangGraph é serviço separado.** Sem misturar IA com regra transacional.
4. **Tudo é evento.** Domínio emite eventos persistidos em outbox. Workers consomem.
5. **Feature flags são reais.** Bloqueiam UI, API, jobs e tools de IA. Não são só CSS.
6. **Permissão por cidade é first-class.** Agente de cidade A não vê dado de cidade B. Ponto.
7. **Importação é módulo crítico.** Pré-validação obrigatória, preview antes de persistir, log por linha.
8. **Versionamento de regras de simulação.** Simulação antiga preserva a regra da época.
9. **Auditoria desde o primeiro commit.** Não é fase posterior.
10. **100% código.** Nada de no-code em fluxo crítico.
11. **LGPD by Design.** Privacidade é restrição de arquitetura, não checklist de compliance. Política normativa em [17-lgpd-protecao-dados.md](17-lgpd-protecao-dados.md).

---

## 5. Mapa da documentação

| Doc                                                                        | Conteúdo                                                                                                                                                                                |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [01-prd-produto.md](01-prd-produto.md)                                     | PRD funcional completo, personas, jornadas, escopo MVP vs evolução                                                                                                                      |
| [02-arquitetura-sistema.md](02-arquitetura-sistema.md)                     | Arquitetura alvo, componentes, comunicação entre serviços, estrutura de repositório                                                                                                     |
| [03-modelo-dados.md](03-modelo-dados.md)                                   | Schema PostgreSQL, tabelas, índices, relacionamentos                                                                                                                                    |
| [04-eventos.md](04-eventos.md)                                             | Catálogo de eventos, payloads, produtores, consumidores, idempotência                                                                                                                   |
| [05-modulos-funcionais.md](05-modulos-funcionais.md)                       | Detalhamento de cada módulo (CRM, Kanban, Simulação, Análise, Follow-up, Cobrança, Assistente, Multiagentes, Dashboard)                                                                 |
| [06-langgraph-agentes.md](06-langgraph-agentes.md)                         | Grafos, nós, estado, tools, prompts, contrato Node↔Python                                                                                                                              |
| [07-integracoes-whatsapp-chatwoot.md](07-integracoes-whatsapp-chatwoot.md) | Webhooks, idempotência, handoff, sync de metadados                                                                                                                                      |
| [08-importacoes.md](08-importacoes.md)                                     | Pipeline de importação, validações, preview, persistência                                                                                                                               |
| [09-feature-flags.md](09-feature-flags.md)                                 | Modelagem, comportamento UI/API/jobs                                                                                                                                                    |
| [10-seguranca-permissoes.md](10-seguranca-permissoes.md)                   | RBAC, escopo por cidade, auditoria, hardening                                                                                                                                           |
| [11-roadmap-executavel.md](11-roadmap-executavel.md)                       | Fases 0–7, ordem, dependências, entregáveis                                                                                                                                             |
| [12-tasks-tecnicas.md](12-tasks-tecnicas.md)                               | Tasks granulares com Definition of Done                                                                                                                                                 |
| [13-criterios-aceite.md](13-criterios-aceite.md)                           | Critérios globais e por módulo                                                                                                                                                          |
| [14-riscos-mitigacoes.md](14-riscos-mitigacoes.md)                         | Riscos técnicos e de negócio + mitigações                                                                                                                                               |
| [15-estrategia-desenvolvimento-ia.md](15-estrategia-desenvolvimento-ia.md) | Como executar com Opus, Sonnet, GPT, Gemini, Copilot                                                                                                                                    |
| [16-revisao-critica.md](16-revisao-critica.md)                             | Revisão crítica do PRD e o que fica para depois do MVP                                                                                                                                  |
| [17-lgpd-protecao-dados.md](17-lgpd-protecao-dados.md)                     | **LGPD e proteção de dados — política normativa, RoPA, direitos do titular, controles de dev/prod, IA, incidentes, DPIA, checklist de PR. Vence qualquer slot ou decisão em conflito.** |

---

## 6. Stack consolidada

| Camada         | Tecnologia                                                        | Razão                                                                           |
| -------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Frontend       | React + TypeScript + Tailwind + Vite                              | Ecossistema, velocidade, padrão de mercado world-class                          |
| Backend        | Node.js + TypeScript + Fastify                                    | Tipagem ponta a ponta, performance, contratos fortes                            |
| ORM            | Drizzle                                                           | SQL-first, tipado, migrations versionadas, sem mágica                           |
| Banco          | PostgreSQL 16                                                     | Transações, JSONB, índices parciais, outbox pattern                             |
| Validação      | Zod                                                               | Single source of truth para contratos                                           |
| IA             | Python + LangGraph + LangChain                                    | Estado tipado, grafos auditáveis, ferramenta certa para o problema              |
| Filas (MVP)    | PostgreSQL outbox + worker                                        | Sem dependência extra; caminho claro para BullMQ/Redis quando volume justificar |
| Filas (escala) | BullMQ + Redis                                                    | Decisão futura se volume de mensagens crescer                                   |
| Auth           | Lucia ou Better-Auth + JWT curto + refresh                        | Controle total, sem vendor lock                                                 |
| Logs           | Pino + OpenTelemetry                                              | Estruturado, exportável                                                         |
| Deploy         | Docker + Docker Compose (dev) → Fly.io / Railway / Coolify (prod) | A definir conforme infra do cliente                                             |
| Versionamento  | Git + GitHub + monorepo (Turborepo ou pnpm workspaces)            | Fricção mínima para devs e agentes IA                                           |

Justificativa detalhada em [02-arquitetura-sistema.md](02-arquitetura-sistema.md).

---

## 7. Escopo MVP vs evolução (resumo)

**MVP habilitado (Fase 1–4):**

- Auth, usuários, cidades, RBAC com escopo por cidade
- CRM com cadastro manual + importação
- Kanban com stages + status + outcome
- Produtos de crédito configuráveis + simulação dinâmica versionada
- Análise de crédito manual + importação
- LangGraph com grafo de pré-atendimento + tools controladas
- Integração Chatwoot com handoff estruturado
- Feature flags reais (UI + API + jobs + tools)
- Auditoria mínima (audit_logs + ai_decision_logs + event_outbox)

**Visível mas desabilitado por flag (Fase 5–6):**

- Motor de follow-up automático
- Motor de cobrança automático
- Assistente IA interno (somente leitura na primeira versão)
- Dashboard analítico (versão completa)
- Exportação de relatórios

**Pós-MVP (evolução):**

- Multi-tenant real
- Score interno
- Integração com sistema externo de análise de crédito (quando o cliente tiver)
- PWA
- Renegociação automatizada

Detalhes em [11-roadmap-executavel.md](11-roadmap-executavel.md) e [16-revisao-critica.md](16-revisao-critica.md).

---

## 8. Aviso crítico sobre prazo

A proposta comercial sugere 45 dias para entrega. **45 dias para fazer tudo na qualidade descrita aqui é arriscado.** A estratégia adotada neste PRD é:

- Entregar a **fundação** (auth, CRM, Kanban, simulação dinâmica, análise manual, LangGraph básico, Chatwoot, importação) com qualidade de produção em ~45 dias.
- Entregar **follow-up, cobrança, assistente interno e dashboard completo** como features visíveis-mas-desabilitadas e habilitar em ondas após o go-live.
- Não shippar nada meia-boca. Cada feature ligada está pronta de verdade.

A análise crítica completa está em [16-revisao-critica.md](16-revisao-critica.md).
