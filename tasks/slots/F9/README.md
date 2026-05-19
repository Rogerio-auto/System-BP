# Fase 9 — Console do Agente de IA

> Criada em 2026-05-19 após o usuário sinalizar que a F3 (Agentes IA) entregou o agente 100% backend, sem UI para gerir o que foi construído. Vive dentro do **Hub de Configurações** (entregue em F8-S08) — sem rotas soltas.
>
> Documentação canônica (lida obrigatoriamente):
>
> - [docs/05-modulos-funcionais.md §12](../../../docs/05-modulos-funcionais.md) — definição do módulo.
> - [docs/10-seguranca-permissoes.md §3.2](../../../docs/10-seguranca-permissoes.md) — permissões `ai_prompts:*`, `ai_decisions:read`, `ai_playground:run`.
> - [docs/11-roadmap-executavel.md — Fase 9](../../../docs/11-roadmap-executavel.md) — entregáveis e critérios de aceite.
> - [docs/12-tasks-tecnicas.md — Fase 9](../../../docs/12-tasks-tecnicas.md) — tasks T9.0–T9.7.
> - [docs/17-lgpd-protecao-dados.md §8.4 e §8.4.1](../../../docs/17-lgpd-protecao-dados.md) — DLP no playground + masking no viewer.

## Premissas

- **Schemas existentes reaproveitados + 1 schema novo.** `prompt_versions` e `ai_decision_logs` foram criados em F3-S01. F9-S00 adiciona `model_pricing` para cálculo de custo em USD/BRL no viewer.
- **RBAC mandatório.** Admin tem console completo; manager (gestor_geral) tem leitura de prompts; gestor_regional tem leitura de decisões com escopo de cidade. `ai_playground:run` é admin-only (matriz canônica em `docs/10 §3.2` — sem checks por role-name redundantes no service).
- **Dry-run nunca persiste.** O endpoint `POST /process/whatsapp/playground` no LangGraph substitui o `InternalApiClient` por um sink in-memory e não chama Chatwoot. Validado por mock-count em teste.
- **DLP no operador.** A mensagem digitada no playground passa pelo mesmo `redact_pii` da entrada real antes de chegar ao gateway LLM (doc 17 §8.4).
- **Markdown editor com preview.** F9-S05 entrega edição de texto + preview de markdown side-by-side ao vivo.

## Slots

| ID     | Título                                                            | Specialist         | Depende de             | Labels      |
| ------ | ----------------------------------------------------------------- | ------------------ | ---------------------- | ----------- |
| F9-S00 | Schema `model_pricing` + helper de cálculo de custo               | db-schema-engineer | —                      | —           |
| F9-S01 | Backend: API de `prompt_versions` (CRUD + ativação transacional)  | backend-engineer   | F3-S01, F1-S04, F1-S16 | —           |
| F9-S02 | Backend: API read de `ai_decision_logs` (lista + timeline)        | backend-engineer   | F3-S01, F9-S00, F1-S04 | lgpd-impact |
| F9-S03 | LangGraph: endpoint dry-run (`POST /process/whatsapp/playground`) | python-engineer    | F3-S31, F3-S32         | lgpd-impact |
| F9-S04 | Backend: proxy `/api/ai-console/playground` + DLP                 | backend-engineer   | F9-S03, F3-S33         | lgpd-impact |
| F9-S05 | Frontend: gestão de prompts (editor + diff + ativação)            | frontend-engineer  | F9-S01, F8-S08, F1-S08 | —           |
| F9-S06 | Frontend: visualizador de decisões                                | frontend-engineer  | F9-S02, F8-S08, F1-S08 | lgpd-impact |
| F9-S07 | Frontend: playground (com contexto real opcional)                 | frontend-engineer  | F9-S04, F8-S08, F1-S08 | lgpd-impact |

## Ordem de execução (paralelismo viável a partir do B1, com `isolation: "worktree"`)

```
Batch 0 (sequencial — só ele):
   F9-S00 (schema model_pricing)    apps/api/src/db/migrations/0026_*.sql + schema/seed/lib/pricing

Batch 1 (paralelo, arquivos disjuntos):
   F9-S01 (backend prompts)         apps/api/src/modules/ai-console/prompts/**
   F9-S02 (backend decisions)       apps/api/src/modules/ai-console/decisions/**
   F9-S03 (langgraph dry-run)       apps/langgraph-service/app/api/playground.py + dry_run.py

Batch 2 (paralelo):
   F9-S04 (backend playground)      depende de F9-S03 + F3-S33
   F9-S05 (frontend prompts)        depende de F9-S01 + F8-S08
   F9-S06 (frontend decisions)      depende de F9-S02 + F8-S08

Batch 3:
   F9-S07 (frontend playground)     depende de F9-S04
```
