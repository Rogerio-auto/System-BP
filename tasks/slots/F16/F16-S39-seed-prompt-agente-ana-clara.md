---
id: F16-S39
title: Seed do prompt do agente Ana Clara em prompt_versions (key pre_attendance_agent)
phase: F16
task_ref: docs/planejamento-fluxo-conversacional-pre-atendimento.md
status: available
priority: critical
estimated_size: S
agent_id: null
claimed_at: null
completed_at: null
pr_url: null
depends_on: []
blocks: [F16-S40]
labels:
  - lgpd-impact
source_docs:
  - docs/06-langgraph-agentes.md
  - docs/planejamento-fluxo-conversacional-pre-atendimento.md
  - apps/langgraph-service/app/prompts/pre_attendance_agent.md
docs_required: false
docs_audience: []
docs_artifacts: []
---

# F16-S39 — Seed do prompt do agente Ana Clara (B1)

## Objetivo

Inserir a **v1 ativa** do prompt do agente de pré-atendimento na tabela `prompt_versions`
sob a key canônica **`pre_attendance_agent`**, de forma que o nó `agent_turn` (F16-S40) o carregue
em runtime via `GET /internal/prompts/active/:key` (loader já existente, F9-S09).

Bloco B (núcleo agêntico) do `docs/planejamento-fluxo-conversacional-pre-atendimento.md` §11.

## Contexto

- Hoje existem 3 prompts seedados (`pre_attendance_classify`, `pre_attendance_qualify`, `simulation`)
  via `apps/api/src/db/migrations/0031_seed_initial_prompts.sql`. Este slot adiciona a 4ª key.
- O agente reconstruído (F16-S40) substitui o funil determinístico por um **único prompt forte**
  (estilo Ana Clara): identifica-se como IA, "sente o lead", coleta na ordem da conversa, chama tools.
- O **texto canônico do prompt** está em `apps/langgraph-service/app/prompts/pre_attendance_agent.md`
  (fornecido pelo Rogério, 2026-06-18). É a fonte da verdade. NÃO inventar nem reescrever; o `body`
  da migration é exatamente esse texto (do título `# Prompt Otimizado: ...` até o fim; o comentário
  HTML de cabeçalho do arquivo NÃO entra no body).
- Edições futuras passam a ser feitas pela UI de gestão de prompts (F9-S05) — este seed é só a v1.

## Escopo (faz)

- Migration SQL nova em `apps/api/src/db/migrations/` que faz `INSERT` em `prompt_versions`:
  - `key = 'pre_attendance_agent'`, `version = 1`, `is_active = true`, `body = <texto canônico>`.
  - Idempotente: `ON CONFLICT (key, version) DO NOTHING` (mesmo padrão da 0031).
  - Parâmetros LLM (model/temperature/max_tokens) coerentes com as outras keys; reasoner para conversa.
- **Adicionar a entry correspondente em `_journal.json`** no mesmo commit (migration à mão — §3 PROTOCOL).
- Atualizar `apps/langgraph-service/app/prompts/README.md` (tabela de keys) com a nova key.

## Fora de escopo (NÃO faz)

- Nó `agent_turn` / loop de tool-calling (F16-S40).
- Tools de negócio (simulação com regras, faq_rag, scr) — Bloco C.
- Qualquer texto de prompt "rascunho" inventado pelo agente: o body é o fornecido pelo Rogério.

## Arquivos permitidos

- `apps/api/src/db/migrations/*.sql`
- `apps/api/src/db/migrations/meta/_journal.json`
- `apps/langgraph-service/app/prompts/README.md`

## Arquivos proibidos

- `apps/api/src/db/migrations/0031_seed_initial_prompts.sql` (não editar seed existente)
- `apps/langgraph-service/app/graphs/**`

## Contratos

- `prompt_versions` schema: `apps/api/src/db/schema/promptVersions.ts`. Respeitar colunas e a
  constraint única `(key, version)`. `is_active = true` exatamente em 1 versão por key.

## Definition of Done

- [ ] Migration insere `pre_attendance_agent` v1 ativa, idempotente, com o texto canônico do Rogério
- [ ] Entry adicionada em `_journal.json` (rodar `python scripts/slot.py check-migrations` verde)
- [ ] README de prompts atualizado com a nova key
- [ ] LGPD §14.2 checklist preenchido no PR (prompt do LangGraph é gatilho lgpd-impact)
- [ ] PR aberto com link para o slot

## Conteúdo do prompt (v1)

O texto canônico está em **`apps/langgraph-service/app/prompts/pre_attendance_agent.md`**. O `body`
da v1 é exatamente esse arquivo (do título `# Prompt Otimizado: ...` até o fim; o comentário HTML do
topo não entra). Transcrever sem alterar.

## Comandos de validação

```powershell
python scripts/slot.py check-migrations
pnpm --filter @elemento/api db:migrate
```

## Notas para o agente

- O loader do LangGraph (`app/prompts/loader.py`) lê por key via backend; nada a mudar lá.
- LGPD: o prompt não pode instruir o modelo a solicitar/repetir PII bruta em log; respeitar DLP (doc 17).
