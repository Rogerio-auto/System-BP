---
id: F22-S03
title: Infra — corrige E2E Smoke quebrado (tsbuildinfo stale na imagem Docker)
phase: F22
task_ref: docs/sessions/2026-06-22-security-audit.md
status: in-progress
priority: high
estimated_size: S
agent_id: null
claimed_at: 2026-06-22T23:58:47Z
completed_at: null
pr_url: null
depends_on: []
blocks: []
labels: [infra, ci, docker, e2e, hardening]
source_docs: [docs/19-runbook-go-live.md]
docs_required: false
---

# F22-S03 — Infra: corrige E2E Smoke quebrado (tsbuildinfo stale na imagem Docker)

## Objetivo

Destravar o gate **E2E Smoke** (`.github/workflows/e2e.yml`), que está **vermelho na
`main`**: a imagem Docker da API não sobe porque o `@elemento/shared-schemas/dist/index.js`
não é emitido durante o build da imagem.

## Contexto

Diagnóstico (sessão 2026-06-22, ao validar F22-S01/S02 antes do merge):

- O container `api` morre no boot com
  `ERR_MODULE_NOT_FOUND: '/app/node_modules/@elemento/shared-schemas/dist/index.js'`.
- Reproduzido **idêntico na `main` limpa** → não é regressão dos slots de segurança.
- Causa raiz: `tsconfig.base.json` usa `"incremental": true`, que gera
  `*.tsbuildinfo`. O `.dockerignore` exclui `dist`/`**/dist` mas **não** exclui
  `*.tsbuildinfo`. No `builder` do `apps/api/Dockerfile`, o `COPY . .` leva os
  `.tsbuildinfo` stale (com `dist` ausente) para a imagem; o `tsc -p tsconfig.build.json`
  do `shared-schemas`/`shared-types` então considera o output atualizado e **pula a
  emissão dos `.js`**, gerando apenas `.d.ts`. A API compilada importa o `.js` em runtime
  e quebra. Localmente o bug fica mascarado por `dist/*.js` stale de builds antigos.
- Confirmação local: remover os `*.tsbuildinfo` e rebuildar → `dist/index.js` volta a ser
  emitido.

## Escopo (faz)

1. Adicionar `*.tsbuildinfo` e `**/*.tsbuildinfo` ao `.dockerignore`, garantindo build
   Docker determinístico (sem herdar estado incremental do host).

## Fora de escopo (NÃO faz)

- Desligar `incremental` no `tsconfig.base.json` (afeta velocidade de build local; o
  problema é só o vazamento para a imagem Docker).
- Mudar a estratégia de `pnpm deploy` no Dockerfile (o deploy está correto — o symlink do
  workspace é resolvido; o que faltava era o `.js` no `dist`).
- Os fixes de F22-S01/S02.

## Arquivos permitidos

- `.dockerignore`

## Arquivos proibidos

- `apps/api/Dockerfile`
- `tsconfig.base.json`
- `apps/web/**`
- `apps/langgraph-service/**`

## Contratos de saída

- Build da imagem `elemento-ci-api` produz `node_modules/@elemento/shared-schemas/dist/index.js`
  (e `shared-types`).
- `docker compose -f docker-compose.ci.yml up -d` sobe `api` saudável (`/health` 200).
- `pnpm --filter @elemento/api e2e` roda contra a stack CI (gate E2E deixa de falhar no boot).

## Definition of Done

- [ ] `.dockerignore` exclui `*.tsbuildinfo`
- [ ] Imagem `api` builda e sobe saudável na stack `docker-compose.ci.yml`
- [ ] Migrations aplicam e a suíte E2E executa (sem o crash de `shared-schemas/dist`)

## Comandos de validação

```powershell
docker compose -f docker-compose.ci.yml build api
docker compose -f docker-compose.ci.yml up -d
# aguardar healthchecks; aplicar migrations; rodar e2e (ver e2e.yml)
pnpm --filter @elemento/api e2e
docker compose -f docker-compose.ci.yml down --volumes
```

## Notas para o agente

- Fix mínimo e cirúrgico — só `.dockerignore`. Não tocar Dockerfile nem tsconfig.
- Validar com build **sem cache** da camada de contexto (a mudança do `.dockerignore`
  invalida o `COPY . .`).
  </content>
  </invoke>
