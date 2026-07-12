---
id: F6-S15
title: Prompt — copiloto v2: saída em markdown + capacidade de resumo de conversa
phase: F6
task_ref: docs/22-agente-interno-acoes.md
status: review
priority: medium
estimated_size: S
agent_id: null
depends_on: [F6-S14]
blocks: []
labels: [prompt, ai-assistant, db]
source_docs: [docs/22-agente-interno-acoes.md]
docs_required: false
claimed_at: 2026-07-12T17:13:55Z
completed_at: 2026-07-12T17:17:03Z

---

# F6-S15 — Prompt: copiloto v2 (markdown + resumo)

## Objetivo

Publicar a **v2** do prompt `internal_assistant`: instruir o agente a responder em **markdown** e a usar a
nova tool de **resumo de conversa** (F6-S14). Via migration de seed, como o 0086.

## Contexto

O prompt vem de `prompt_versions` em runtime (`GET /internal/prompts/active/internal_assistant`), seedado
pela migration `0086` (v1). O loader pega a versão `active`. Próxima migration: **0087**.
O `.md` fonte no repo é `apps/langgraph-service/app/prompts/internal_assistant.md` — atualizar também
(mantém repo e banco coerentes), mas o que vigora em runtime é a linha do banco.

## Escopo (faz)

- **Atualizar** `apps/langgraph-service/app/prompts/internal_assistant.md` com:
  - Instrução de **formato markdown**: usar **tabelas** para dados tabulares (métricas por stage, contagens),
    **negrito** para números-chave, listas para enumerações, títulos curtos. Respostas limpas e escaneáveis.
  - A nova capacidade de **resumo de conversa**, descrevendo o **fluxo de 2 tools**: quando o usuário
    nomear um lead, usar `find_lead(nome)` para localizar; se houver vários candidatos, **perguntar qual**
    (listar nome + cidade); depois `summarize_lead_conversation(lead_id)`. Read-only; resumo objetivo do
    andamento do atendimento, sem expor PII bruta (telefone/CPF).
  - Manter as regras atuais (RBAC/DLP/limites: não decide crédito, não inventa números, cita fontes).
- **Migration 0087** `0087_seed_internal_assistant_prompt_v2.sql` espelhando o 0086:
  - INSERT em `prompt_versions` com `key='internal_assistant'`, `version=2`, `active=true`, `body`=novo
    conteúdo, `content_hash=encode(digest($body$...$body$,'sha256'),'hex')`, mesmo model/temperature/max_tokens.
  - **Desativar a v1**: `UPDATE prompt_versions SET active=false WHERE key='internal_assistant' AND version=1;`
    (só uma versão ativa por key). Fazer na mesma migration, antes ou depois do INSERT, idempotente.
  - `ON CONFLICT (key, version) DO NOTHING` no INSERT.
  - Adicionar a entry no `meta/_journal.json` (idx 87, when > 1784100000000).

## Fora de escopo (NÃO faz)

- Código de tool (F6-S14). Frontend (F6-S12). Endpoint (F6-S13).

## Arquivos permitidos

- `apps/langgraph-service/app/prompts/internal_assistant.md`
- `apps/api/src/db/migrations/0087_seed_internal_assistant_prompt_v2.sql`
- `apps/api/src/db/migrations/meta/_journal.json`

## Arquivos proibidos

- `apps/api/src/db/migrations/0086_seed_internal_assistant_prompt.sql`
- Qualquer outro `.sql` existente

## Definition of Done

- [ ] `internal_assistant.md` instrui markdown (tabelas/negrito/listas) + descreve o resumo de conversa
- [ ] Migration 0087 insere v2 active=true + desativa v1; content_hash inline; idempotente
- [ ] Entry no journal (idx 87, when > 0086) — `python scripts/slot.py check-migrations` OK
- [ ] Apenas 1 versão ativa por key após a migration

## Validação

```powershell
python scripts/slot.py check-migrations
```

## Notas para o agente

- **Não** coloque `slot.py validate` no bloco Validação (fork bomb). Não rode `taskkill python`.
- Espelhe o 0086 (mesma estrutura de INSERT, `$body$` dollar-quote, `ON CONFLICT (key, version)`).
- O body v2 deve ser sem PII, sem acentos problemáticos (o v1 já é assim). ≤60s para vigorar em runtime
  (o loader não cacheia mais que isso). Não é preciso redeploy do langgraph — só a migration.
