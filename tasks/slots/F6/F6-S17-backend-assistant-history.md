---
id: F6-S17
title: Backend — copiloto aceita histórico de conversa (memória de sessão)
phase: F6
task_ref: docs/22-agente-interno-acoes.md
status: done
priority: high
estimated_size: S
agent_id: null
depends_on: [F6-S08]
blocks: [F6-S19]
labels: [backend, ai-assistant, ux]
source_docs: [docs/22-agente-interno-acoes.md]
docs_required: false
claimed_at: 2026-07-13T13:06:19Z
completed_at: 2026-07-13T13:18:23Z
---

# F6-S17 — Backend: histórico de conversa no copiloto

## Objetivo

Fazer o endpoint do copiloto aceitar o **histórico dos turnos** e repassá-lo ao LangGraph, para o
assistente ter memória de sessão (perguntas de acompanhamento funcionam). Sem armazenar nada em repouso.

## Contexto

Hoje o copiloto é stateless: `POST /api/internal-assistant/query` recebe só `{ question }` e o LangGraph
monta `[system, question]` — sem histórico (confirmado nos logs: `message_count: 2`). O histórico vive no
cliente (F6-S19) e é enviado a cada pergunta; a DLP do gateway continua redigindo PII antes do LLM.

Schemas em `apps/api/src/modules/internal-assistant/schemas.ts`:

- `AssistantQueryBodySchema` = `{ question }` (frontend→Node).
- `LangGraphAssistantRequestSchema` = `{ principal, question, correlation_id? }` (Node→langgraph).

## Escopo (faz)

- **`AssistantQueryBodySchema`**: adicionar `history` opcional.
  Contrato EXATO: `history: z.array(z.object({ role: z.enum(['user','assistant']), content: z.string().min(1).max(4000) })).max(10).optional()`.
  (Máx 10 mensagens = ~5 turnos; controla tokens.)
- **`LangGraphAssistantRequestSchema`**: adicionar o mesmo `history` opcional (Node→langgraph).
- **service/controller**: threat `history` do body → request do LangGraph (`POST /process/assistant/query`).
  Se vier mais que 10, o Zod já rejeita (`.max(10)`) — retornar 400 com mensagem clara, OU truncar para os
  últimos 10 no service antes do Zod (escolha a mais limpa; documente). Preferência: **truncar** para os
  últimos 10 no service (o cliente pode mandar mais sem quebrar).
- Não persistir `history` em lugar nenhum (nem em `assistant_queries`). Não logar `content` do history.

## Fora de escopo (NÃO faz)

- LangGraph (F6-S18). Frontend (F6-S19).
- Persistência entre sessões (decisão de LGPD à parte).

## Arquivos permitidos

- `apps/api/src/modules/internal-assistant/schemas.ts`
- `apps/api/src/modules/internal-assistant/service.ts`
- `apps/api/src/modules/internal-assistant/controller.ts`
- `apps/api/src/modules/internal-assistant/__tests__/**`

## Arquivos proibidos

- `apps/web/**`
- `apps/langgraph-service/**`
- `apps/api/src/db/**`

## Definition of Done

- [ ] `AssistantQueryBodySchema` aceita `history` opcional (role/content, max 10, content max 4000)
- [ ] `LangGraphAssistantRequestSchema` repassa `history`; service threa body→langgraph
- [ ] > 10 turnos truncado para os últimos 10 (ou 400 claro); `content` do history nunca logado
- [ ] `history` não persistido em `assistant_queries` nem em nenhuma tabela
- [ ] Testes: sem history (compat), com history repassado, truncamento, content não logado
- [ ] `pnpm --filter @elemento/api typecheck` + `lint` + `test` verdes

## Validação

```powershell
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api test
```

## Notas para o agente

- **Não** coloque `slot.py validate` no bloco Validação (fork bomb). Não rode `taskkill python`.
- `history` é retrocompatível (opcional) — chamadas antigas sem history continuam funcionando.
- O `content` do history pode conter PII (respostas anteriores citam dados de lead). Nunca logar; a DLP do
  gateway (F6-S18) redige antes do LLM. Mantém a política de não logar PII do módulo.
