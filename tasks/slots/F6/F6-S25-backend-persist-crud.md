---
id: F6-S25
title: Backend — persistência + CRUD das conversas do copiloto (nomeação por intenção)
phase: F6
task_ref: docs/anexos/lgpd/dpia-historico-copiloto.md
status: blocked
priority: medium
estimated_size: L
agent_id: null
depends_on: [F6-S24, F6-S21]
blocks: [F6-S29]
labels: [backend, ai-assistant, rbac, lgpd-impact]
source_docs: [docs/anexos/lgpd/dpia-historico-copiloto.md, docs/17-lgpd-protecao-dados.md]
docs_required: false
---

# F6-S25 — Backend: persistência + CRUD das conversas

## Objetivo

Gravar cada turno (sem PII) e expor CRUD das conversas do copiloto, escopado ao usuário dono.

## Escopo (faz)

- No fluxo do `/api/internal-assistant/query`: após responder, **persistir** o turno —
  `question_sanitized` (mascarar nome + DLP de CPF/telefone), `narrative`, `blocks` **só `{type, ref}`**
  (descartar `value`), `sources`. Criar/atualizar a conversa; **nomear por intenção** (regra simples ou LLM
  sobre texto já higienizado — **sem nome do titular**).
- Endpoints: `GET /api/assistant/conversations` (lista do usuário), `GET /api/assistant/conversations/:id`
  (turnos), `POST` (nova), `PATCH :id` (renomear), `DELETE :id` (soft-delete). Todos **owner-scoped** +
  `ai_assistant:use`; conversa de outro usuário → 404 (sem vazar existência).
- **NUNCA** persistir `value`/PII; **nunca** logar conteúdo. Zod nas bordas.

## Fora de escopo (NÃO faz)

- Schema (F6-S24). Hidratação viva (F6-S27). Retenção (F6-S26). Frontend.

## Arquivos permitidos

- `apps/api/src/modules/assistant-history/**`
- `apps/api/src/modules/internal-assistant/service.ts`
- `apps/api/src/app.ts`

## Definition of Done

- [ ] Turno persistido sem PII (`blocks` só refs; pergunta e narrativa higienizadas)
- [ ] Título por intenção, sem nome do titular
- [ ] CRUD owner-scoped; conversa de outro usuário → 404
- [ ] `value`/PII nunca persistido nem logado; Zod nas bordas
- [ ] Testes: persistência sem PII, isolamento por dono, nomeação sem nome
- [ ] `pnpm --filter @elemento/api typecheck` + `lint` + `test` verdes

## Notas para o agente

- **Bloqueado até F6-S23.** Não coloque `slot.py validate` no bloco. Checklist §14.2 do doc 17 no relatório.
- A gravação sem `value` é o invariante central — teste que `blocks` gravado não tem valor hidratado.
