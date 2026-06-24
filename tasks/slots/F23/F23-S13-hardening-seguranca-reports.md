---
id: F23-S13
title: Hardening de segurança do reports — rate-limit do export, assertion de escopo, filename
phase: F23
task_ref: docs/sessions/2026-06-24-reports-security.md
status: done
priority: medium
estimated_size: S
agent_id: null
claimed_at: 2026-06-24T21:00:38Z
completed_at: 2026-06-24T21:26:22Z
pr_url: https://github.com/Rogerio-auto/System-BP/pull/368
depends_on: [F23-S09]
blocks: []
labels: [backend, security, reports, hardening]
source_docs: [docs/sessions/2026-06-24-reports-security.md, docs/10-seguranca-permissoes.md]
docs_required: false
---

# F23-S13 — Hardening de segurança do módulo reports

## Objetivo

Fechar os findings acionáveis da revisão de segurança da F23 (M-01, M-02, B-01) antes do
go-live. M-03 (IP/UA em audit) é intencional e legalmente correto (art. 37 LGPD) — não é
código, é item de DPA; fora deste slot.

## Contexto

Relatório: `docs/sessions/2026-06-24-reports-security.md`. Gate aprovado (0 ALTO); estes são
follow-ups de defense-in-depth. O backend já é a fronteira de segurança real; isto reforça.

## Escopo (faz)

### M-02 — Rate limit específico no export (mais impactante)

- `POST /api/reports/export` é síncrono e gera XLSX/PDF (pesado). Hoje só o rate global
  (300/min/IP) protege. Adicionar rate limit específico **10–20 req/min por usuário/org** na
  rota de export, usando o mecanismo de rate-limit já existente na API (procurar o uso de
  `@fastify/rate-limit` ou config equivalente no projeto e seguir o padrão; rota-específico via
  `config.rateLimit` no `routes.ts` do reports/export).

### M-01 — Assertion defensiva papel↔escopo

- Em `apps/api/src/modules/reports/service.ts` (`resolveScopeAndValidate`), adicionar um
  **defensive check**: se o ator NÃO tem nenhuma permissão/role que justifique escopo global
  mas `cityScopeIds === null` (estado inconsistente), tratar como erro (Forbidden) em vez de
  conceder acesso global silenciosamente. Sem mudar o comportamento dos casos válidos. Comentar
  que é defense-in-depth (o JWT é derivado no servidor; isto cobre derivação incorreta).

### B-01 — Sanitização defensiva do filename do export

- Em `apps/api/src/modules/reports/export/controller.ts` (~linha 41), sanitizar o filename do
  `Content-Disposition` (allow-list `[a-zA-Z0-9._-]`, sem `/`, `\`, `..`), mesmo o filename
  sendo gerado por enum+data (sem input de usuário hoje) — preventivo.

## Fora de escopo (NÃO faz)

- M-03 (IP/UA em audit) — intencional; item de DPA (legal), não código.
- Mudar a lógica de RBAC/escopo dos endpoints (já correta).
- Export assíncrono / fila (futuro).

## Arquivos permitidos

- `apps/api/src/modules/reports/routes.ts`
- `apps/api/src/modules/reports/service.ts`
- `apps/api/src/modules/reports/export/controller.ts`
- `apps/api/src/modules/reports/__tests__/`

## Arquivos proibidos

- `apps/api/src/app.ts`
- `apps/web/**`
- `apps/api/src/db/migrations/**`
- `apps/api/src/modules/reports/repository.ts`

## Contratos de saída

- `POST /api/reports/export` tem rate limit específico (10–20/min); excesso → 429.
- `resolveScopeAndValidate` rejeita estado inconsistente (papel sem escopo global + cityScopeIds=null).
- Filename do export sanitizado (sem chars de path traversal).
- Sem regressão nos endpoints; `typecheck`/`lint`/`test` verdes.

## Definition of Done

- [ ] Rate limit específico no `POST /reports/export` (segue o padrão de rate-limit do projeto)
- [ ] Assertion defensiva papel↔escopo no service (Forbidden em estado inconsistente)
- [ ] Filename do export sanitizado (allow-list)
- [ ] Testes: 429 ao exceder rate; Forbidden no estado inconsistente; filename sanitizado
- [ ] `pnpm --filter @elemento/api typecheck`+`lint`+`test` verdes

## Validação

```powershell
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api test -- reports
```

## Notas para o agente

- Procurar o padrão de rate-limit já usado (ex: webhooks públicos têm rate-limit). Reusar, não inventar.
- A assertion de M-01 não pode quebrar os casos válidos (admin/gestor_geral global; gestor_regional city; agente self) — cobrir com teste.
- Sem `any`/`as` injustificado.
