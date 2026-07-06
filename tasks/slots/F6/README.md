# Fase 6 — Assistente interno (copiloto RBAC-bound)

> Norma canônica: `docs/22-agente-interno-acoes.md` §12 (Superfície B).

**Dashboards migraram para F23.** Os itens provisórios originais de dashboards
(views materializadas, job de refresh, APIs de dashboard, frontend de cards) foram
entregues na Fase 23 (Relatórios & Métricas). O que resta em F6 é o **copiloto interno**:
o agente que responde ao funcionário sobre dados operacionais, respeitando o RBAC + escopo
de cidade do usuário que pergunta.

| ID     | Título                                                             | Specialist    |
| ------ | ------------------------------------------------------------------ | ------------- |
| F6-S05 | DB/Seed — `ai_assistant:use` + flag + tabela `assistant_queries`   | db-schema     |
| F6-S06 | Backend — endpoints de leitura RBAC-bound (principal + city scope) | backend       |
| F6-S07 | Python — grafo `internal_assistant` + tools de leitura + prompt    | python        |
| F6-S08 | Backend — `POST /api/internal-assistant/query` + guard + log       | backend       |
| F6-S09 | Frontend — tela de chat (evolui o `InternalAssistantButton`)       | frontend      |
| F6-S10 | QA — testes RBAC-bound (por role/cidade, negação, DLP, flag)       | qa            |
| F6-S11 | Docs — Central de Ajuda do copiloto                                | frontend/docs |

Tudo atrás da flag `ai.internal_assistant.enabled` (disabled). Read-only nesta fase
(§12.7). Superfície A (Ana Clara escrevendo no funil) é a **F25**.
