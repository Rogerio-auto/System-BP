---
id: F9-S01
title: Backend — API de prompt_versions (CRUD + ativação transacional)
phase: F9
task_ref: T9.1
status: done
priority: high
estimated_size: M
agent_id: backend-engineer
claimed_at: 2026-05-19T22:12:23Z
completed_at: 2026-05-19T22:31:53Z
pr_url: https://github.com/Rogerio-auto/System-BP/pull/114
depends_on: [F3-S01, F1-S04, F1-S16]
blocks: [F9-S05]
labels: []
source_docs:
  - docs/05-modulos-funcionais.md
  - docs/10-seguranca-permissoes.md
  - docs/12-tasks-tecnicas.md
---

# F9-S01 — Backend: API de `prompt_versions`

## Objetivo

Expor `prompt_versions` via HTTP para o Console de IA, permitindo que admin crie e ative versões sem SQL. Manager tem acesso somente leitura.

## Escopo

- `apps/api/src/modules/ai-console/prompts/`:
  - `repository.ts` — queries (list keys com active, list versions, find by key+version, insert new version, transactional activate).
  - `service.ts` — orquestra: cálculo de `content_hash` (SHA-256 do `body`), `version = max(version) + 1` por key, transação de ativação (`UPDATE ... SET active = false WHERE key = $1 AND active = true; UPDATE ... SET active = true WHERE id = $2`).
  - `controller.ts` — handlers Fastify; Zod nas bordas.
  - `schemas.ts` — Zod schemas request/response (sem `any`).
  - `routes.ts` — registra as 5 rotas com `authenticate()` + `authorize({ permissions: [...] })`.
  - `__tests__/prompts.routes.test.ts` — integração com mock de DB; cobre RBAC para admin, gestor_geral, agente; testa ativação atômica (rollback se falhar).
- `apps/api/src/app.ts` — registra o plugin `ai-console/prompts` sob prefixo `/api/ai-console/prompts`.

## Rotas

- `GET /api/ai-console/prompts` — lista keys com versão ativa (`ai_prompts:read`).
- `GET /api/ai-console/prompts/:key/versions` — histórico de versões (`ai_prompts:read`).
- `GET /api/ai-console/prompts/:key/versions/:version` — detalhe (`ai_prompts:read`).
- `POST /api/ai-console/prompts/:key/versions` — cria nova versão (`ai_prompts:write`). Body: `{ body, model_recommended?, notes? }`. Calcula `content_hash`. Idempotência via header `Idempotency-Key` recomendada — body idêntico dentro de janela retorna a versão existente.
- `POST /api/ai-console/prompts/:key/versions/:version/activate` — ativa numa transação (`ai_prompts:activate`).

## Permissões (doc 10 §3.2)

| Rota             | Permissão exigida     | Quem                |
| ---------------- | --------------------- | ------------------- |
| GET (todas)      | `ai_prompts:read`     | admin, gestor_geral |
| POST nova versão | `ai_prompts:write`    | admin               |
| POST activate    | `ai_prompts:activate` | admin               |

Sem escopo de cidade (prompts são globais).

## Auditoria

Audit log em cada `POST` (criação e ativação): `actor_id`, `action` (`ai_prompts.created` / `ai_prompts.activated`), `before`/`after` com `key` e `version` (nunca o `body` completo no audit — referência por hash).

## Eventos

- `ai_prompts.version_created` no `event_outbox` na mesma transação da criação.
- `ai_prompts.version_activated` no outbox na mesma transação da ativação.

## LGPD / Segurança

- `body` do prompt nunca contém PII (regra do próprio schema — doc 03). Validar com regex defensiva no `service`: rejeitar criação se o body conter pattern de CPF/email/telefone, com mensagem clara ao operador.
- Logs sem `body` do prompt (pode ser grande; logar `key`, `version`, `content_hash`).

## Fora de escopo

- Frontend (F9-S05). Edição de prompts ativos (proibida por design — só nova versão). Histórico de quem leu o quê (não auditado nesta fase).

## Arquivos permitidos

- `apps/api/src/modules/ai-console/prompts/repository.ts`
- `apps/api/src/modules/ai-console/prompts/service.ts`
- `apps/api/src/modules/ai-console/prompts/controller.ts`
- `apps/api/src/modules/ai-console/prompts/schemas.ts`
- `apps/api/src/modules/ai-console/prompts/routes.ts`
- `apps/api/src/modules/ai-console/prompts/index.ts`
- `apps/api/src/modules/ai-console/prompts/__tests__/prompts.routes.test.ts`
- `apps/api/src/app.ts`
- `apps/api/src/db/seed/permissions.ts` (adicionar as 3 permissões novas + atribuir a admin/gestor_geral conforme matriz)

## Definition of Done

- [ ] As 5 rotas implementadas com Zod nas bordas.
- [ ] Ativação atômica testada (incluindo rollback simulado).
- [ ] Audit em criação e ativação.
- [ ] Outbox emitido em criação e ativação na mesma transação.
- [ ] RBAC testado positivo (admin) e negativo (gestor_geral em write/activate, agente em read).
- [ ] Permissões novas adicionadas ao seed e atribuídas conforme doc 10.
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` verdes.
- [ ] Sem `any`/`as` injustificado.

## Validação

```powershell
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api test -- ai-console/prompts
```
