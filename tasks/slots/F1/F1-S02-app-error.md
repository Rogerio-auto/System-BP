---
id: F1-S02
title: Helpers de erro e resposta padronizados
phase: F1
task_ref: T0.4
status: available
priority: high
estimated_size: S
agent_id: null
claimed_at: null
completed_at: null
pr_url: null
depends_on: [F0-S03]
blocks: [F1-S03, F1-S07, F1-S09]
source_docs:
  - docs/02-arquitetura-sistema.md
---

# F1-S02 — AppError + error handler padrão

## Objetivo

Tipos de erro consistentes em toda a API. Error handler do Fastify converte `AppError` em resposta JSON padronizada.

## Escopo

- `apps/api/src/shared/errors.ts`:
  - `AppError` (status, code, message, details?)
  - Subclasses: `NotFoundError`, `UnauthorizedError`, `ForbiddenError`, `ConflictError`, `ValidationError`, `RateLimitedError`, `ExternalServiceError`.
- Atualizar `app.setErrorHandler` em `apps/api/src/app.ts` para converter `AppError` em payload `{ error: code, message, details }` com status correto.
- Testes unit cobrindo cada subclasse.

## Arquivos permitidos

- `apps/api/src/shared/errors.ts`
- `apps/api/src/shared/errors.test.ts`
- `apps/api/src/app.ts` (apenas o `setErrorHandler`)

## Definition of Done

- [ ] Testes verdes
- [ ] Error de validação Zod retorna 400 com lista de issues
- [ ] PR aberto
