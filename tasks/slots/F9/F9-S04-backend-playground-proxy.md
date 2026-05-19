---
id: F9-S04
title: Backend — proxy /api/ai-console/playground + DLP na entrada do operador
phase: F9
task_ref: T9.4
status: available
priority: high
estimated_size: M
agent_id: backend-engineer
claimed_at:
completed_at:
pr_url:
depends_on: [F9-S03, F3-S33]
blocks: [F9-S07]
labels: [lgpd-impact]
source_docs:
  - docs/06-langgraph-agentes.md
  - docs/10-seguranca-permissoes.md
  - docs/12-tasks-tecnicas.md
  - docs/17-lgpd-protecao-dados.md
---

# F9-S04 — Backend: proxy do playground + DLP

## Objetivo

Backend recebe a requisição de playground do operador, aplica DLP na mensagem digitada, repassa ao LangGraph dry-run (F9-S03), aplica masking defensivo no trace de volta e devolve à UI.

## Escopo

- `apps/api/src/modules/ai-console/playground/`:
  - `repository.ts` — carrega contexto real (lead/city) via repositórios existentes em modo somente leitura, quando o operador passou `lead_id`/`city_id`.
  - `service.ts` — aplica DLP (`redact_pii` server-side, equivalente ao do langgraph-service) na mensagem do operador; chama o cliente LangGraph dry-run; aplica masking defensivo na resposta.
  - `controller.ts`, `schemas.ts`, `routes.ts`, `index.ts`.
  - `__tests__/playground.routes.test.ts` — RBAC (só admin); DLP testado (mensagem com CPF → API repassa com `<CPF_1>`); contexto real OK; contexto sintético OK; resposta com PII injetada no trace é mascarada.
- `apps/api/src/integrations/langgraph/playground-client.ts` — cliente HTTP que chama `POST /process/whatsapp/playground` do langgraph-service com `X-Internal-Token`; timeout próprio (12s, maior que produção — operador espera).
- `apps/api/src/app.ts` — registra plugin sob `/api/ai-console/playground`.

## Rota

- `POST /api/ai-console/playground` (`ai_playground:run`).
  - Body: `{ message: string, lead_id?: UUID, city_id?: UUID, use_real_context: boolean }`.
  - Quando `use_real_context = true`: carrega lead/city reais via repositórios existentes em modo somente leitura.
  - Quando `use_real_context = false`: passa `lead_id`/`city_id` como `null` (modo sintético).
  - **Autorização:** o middleware `authorize({ permissions: ['ai_playground:run'] })` é a única barreira. A matriz canônica em `docs/10 §3.2` mantém `ai_playground:run` exclusiva de `admin` — sem `role-name check` redundante no service. Se no futuro `gestor_geral` receber a permissão, basta atualizar a matriz; este slot não precisa mudar.

## DLP

- Antes de qualquer chamada ao LangGraph dry-run: aplicar `redactPii(message)` em `apps/api/src/lib/dlp.ts` (criar wrapper TS equivalente ao Python `app/llm/dlp.py`, ou expor o redactor via util compartilhado se já existir — verificar `packages/shared-*`).
- Justificativa em [doc 17 §8.4](../../../docs/17-lgpd-protecao-dados.md): mesmo o operador sendo admin, a mensagem pode ser uma colagem de mensagem real do cidadão. Gateway LLM é suboperador internacional.
- O response da rota carrega um campo `dlp_applied: boolean` e `dlp_tokens: list[string]` (lista de placeholders gerados, ex: `["<CPF_1>", "<PHONE_1>"]`) para que a UI mostre um aviso visível.

## RBAC

| Permissão           | Quem  |
| ------------------- | ----- |
| `ai_playground:run` | admin |

Sem escopo de cidade nessa rota (admin é global).

## Auditoria

- Audit log em cada execução: `actor_id`, `action = ai_playground.run_executed`, `metadata` com `trace_id`, `tokens_consumidos`, `prompt_versions_usadas`. **Não** registra a mensagem do operador no audit.
- Evento outbox `ai_playground.run_executed` na mesma transação.

## LGPD / Segurança

- Label `lgpd-impact`. Checklist §14.2 obrigatório.
- Logs sem a mensagem do operador.
- `pino.redact` cobre os novos campos: `*.message`, `*.dlp_tokens` (defesa).
- Idempotência: header `Idempotency-Key` recomendado — execuções repetidas em janela retornam o mesmo trace cacheado.

## Fora de escopo

- LangGraph dry-run (F9-S03 — pré-requisito).
- Frontend (F9-S07).
- Modo "comparar duas versões de prompt no mesmo run" (backlog).

## Arquivos permitidos

- `apps/api/src/modules/ai-console/playground/repository.ts`
- `apps/api/src/modules/ai-console/playground/service.ts`
- `apps/api/src/modules/ai-console/playground/controller.ts`
- `apps/api/src/modules/ai-console/playground/schemas.ts`
- `apps/api/src/modules/ai-console/playground/routes.ts`
- `apps/api/src/modules/ai-console/playground/index.ts`
- `apps/api/src/modules/ai-console/playground/__tests__/playground.routes.test.ts`
- `apps/api/src/integrations/langgraph/playground-client.ts`
- `apps/api/src/integrations/langgraph/__tests__/playground-client.test.ts`
- `apps/api/src/lib/dlp.ts` (se ainda não existir wrapper TS)
- `apps/api/src/lib/__tests__/dlp.test.ts`
- `apps/api/src/app.ts`
- `apps/api/src/db/seed/permissions.ts` (atribuir `ai_playground:run` a admin)

## Definition of Done

- [ ] Rota com Zod nas bordas.
- [ ] DLP aplicado antes do LangGraph; testado com fixture de mensagem com CPF/telefone/email.
- [ ] `dlp_applied` e `dlp_tokens` na resposta.
- [ ] Audit + outbox emitidos.
- [ ] Logs sem mensagem do operador (testado).
- [ ] RBAC: gestor_geral e abaixo → 403.
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` verdes.
- [ ] PR com label `lgpd-impact` e checklist §14.2.

## Validação

```powershell
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api test -- ai-console/playground
```
