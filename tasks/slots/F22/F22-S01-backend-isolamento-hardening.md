---
id: F22-S01
title: Backend — hardening de isolamento e headers (auditoria de segurança 2026-06-22)
phase: F22
task_ref: docs/sessions/2026-06-22-security-audit.md
status: in-progress
priority: high
estimated_size: M
agent_id: null
claimed_at: 2026-06-22T19:58:39Z
completed_at: null
pr_url: null
depends_on: []
blocks: []
labels: [backend, security, lgpd-impact, hardening, multi-tenant]
source_docs: [docs/10-seguranca-permissoes.md, docs/17-lgpd-protecao-dados.md]
docs_required: false
---

# F22-S01 — Backend: hardening de isolamento e headers

## Objetivo

Fechar os 4 findings ALTO de isolamento/hardening da auditoria de segurança de 2026-06-22
que são correções cirúrgicas de baixo risco (não tocam dependências). Todos são código
backend existente e **live** (não atrás de flag).

## Contexto

Auditoria L3 (`/hm-security`) de 2026-06-22 sobre o backend `apps/api`. Findings tratados
aqui: SEC-03, SEC-04, SEC-05, SEC-08. Os fixes de dependência (SEC-01 drizzle-orm, SEC-02
xlsx) estão em F22-S02 (isolados por exigirem validação própria). Os findings de LLM
(SEC-06/07) e o `trustProxy`/XFF (SEC-09, dependente da topologia de deploy) ficam fora
deste slot.

## Escopo (faz)

### SEC-03 — Dashboard de cobrança ignora escopo de cidade (vazamento cross-city)

`apps/api/src/modules/dashboard/service.ts` (`getCollectionDashboard`, ~linha 264) nunca
chama `assertCityInScope` nem propaga `cityScopeIds` para as funções de contagem do
repository. Um usuário com escopo restrito a uma cidade vê agregados financeiros
(inadimplência/SPC/valores em aberto) de **todas** as cidades da org.

- Espelhar o dashboard de leads (`getLeadsDashboard` já faz `assertCityInScope`).
- Quando `query.city_id` presente → `assertCityInScope(cityId, actor.cityScopeIds)`.
- Propagar `cityScopeIds` para `countDueSoon`/`countOverdueUncollected`/irmãs em
  `apps/api/src/modules/dashboard/repository.ts` (adicionar fragmento
  `AND <tabela>.city_id IN (...)` quando escopo restrito e nenhum `city_id`).

### SEC-04 — `/internal/simulations/:id/sent` sem escopo de org + token não timing-safe

`apps/api/src/modules/simulations/internal-routes.ts` (~linha 442 e 193/438):

- Substituir `if (token !== env.LANGGRAPH_INTERNAL_TOKEN)` por
  `verifyInternalToken(request.headers['x-internal-token'], env.LANGGRAPH_INTERNAL_TOKEN)`
  (import de `../../lib/auth/internal-token.js`) — timing-safe, como os demais internos.
- Exigir header `X-Organization-Id` (como em `internal/credit-analyses`); rejeitar com 400
  se ausente/vazio.
- Propagar `organizationId` até `markSimulationSent` em
  `apps/api/src/modules/simulations/service.ts` (~linha 398) e adicionar
  `AND organization_id = ${organizationId}` no `WHERE id = ${simulationId}`.

### SEC-05 — Login sem `.max()` na senha → DoS por bcrypt

`packages/shared-schemas/src/auth.ts` (~linha 19): o schema de login tem
`password: z.string().min(1)` sem limite superior. bcryptjs (JS puro) bloqueia o event
loop com entradas grandes (pré-auth, anônimo).

- Adicionar `.max(72, 'Senha inválida')` (bcrypt ignora bytes além de 72).

### SEC-08 — Content-Security-Policy desabilitado

`apps/api/src/app.ts` (~linha 224): `helmet, { contentSecurityPolicy: false }`. A API é
JSON-only → pode ter CSP estrito.

- Trocar para CSP restritivo:
  ```ts
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
    },
  });
  ```
- Verificar que o Swagger/OpenAPI (quando habilitado fora de prod) ainda carrega; se
  quebrar, condicionar o CSP estrito a produção.

## Fora de escopo (NÃO faz)

- Upgrade de dependências (drizzle-orm, xlsx) → F22-S02.
- Findings de LLM/LangGraph (SEC-06/07) → slot Python dedicado.
- `trustProxy`/X-Forwarded-For (SEC-09) → tratar no slot/PR de deploy (depende da topologia).
- Refresh reuse-detection, step-up auth, RLS → backlog de hardening pré-multi-tenant.
- Não tocar a lógica de negócio dos dashboards além do filtro de escopo.

## Arquivos permitidos

- `apps/api/src/modules/dashboard/service.ts`
- `apps/api/src/modules/dashboard/repository.ts`
- `apps/api/src/modules/simulations/internal-routes.ts`
- `apps/api/src/modules/simulations/service.ts`
- `apps/api/src/app.ts`
- `packages/shared-schemas/src/auth.ts`

## Arquivos proibidos

- `apps/api/package.json`
- `pnpm-lock.yaml`
- `apps/langgraph-service/**`
- `apps/web/**`
- `apps/api/src/config/env.ts`

## Contratos de saída

- `getCollectionDashboard` aplica `assertCityInScope` e propaga `cityScopeIds`; usuário
  escopado a uma cidade não vê agregados de outra (403 ao forçar `city_id` fora do escopo).
- `/internal/simulations/:id/sent` valida token timing-safe + exige `X-Organization-Id` +
  filtra `markSimulationSent` por org (404/escopo em simulação de outra org).
- Login rejeita senha > 72 chars com erro de validação (não chega ao bcrypt).
- Resposta HTTP da API inclui header `Content-Security-Policy` restritivo.
- `pnpm --filter @elemento/api typecheck` verde.

## Definition of Done

- [ ] SEC-03: dashboard de cobrança respeita escopo de cidade (assert + propagação)
- [ ] SEC-04: token interno timing-safe + X-Organization-Id obrigatório + filtro por org
- [ ] SEC-05: schema de login com `.max(72)`
- [ ] SEC-08: CSP restritivo habilitado no helmet
- [ ] Logs sem PII / sem token (manter `pino.redact`)
- [ ] `pnpm --filter @elemento/api typecheck` verde
- [ ] `pnpm --filter @elemento/api lint` verde
- [ ] Checklist LGPD §14.2 do doc 17 na descrição do PR (slot toca escopo de cidade/PII)

## Comandos de validação

```powershell
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api test
```

## Notas para o agente

- Usar `internal/credit-analyses/routes.ts` como referência canônica de internal correto
  (token timing-safe + X-Organization-Id + filtro por org + 404 + máscara LGPD).
- `assertCityInScope` e a semântica de `cityScopeIds` (`null`=global, `[]`=zero linhas,
  `[...]`=IN) estão em `apps/api/src/shared/scope.ts`.
- Não introduzir `any`/`as`. Erros tipados (`AppError`/`UnauthorizedError`).
- Confirmar que nenhum outro chamador de `markSimulationSent` quebra com o novo parâmetro
  `organizationId` obrigatório.
