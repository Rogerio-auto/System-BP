---
id: F22-S03
title: Infra — ressuscita E2E Smoke (tsbuildinfo + rabbitmq CI + topologia socket-relay)
phase: F22
task_ref: docs/sessions/2026-06-22-security-audit.md
status: done
priority: high
estimated_size: S
agent_id: null
claimed_at: 2026-06-22T23:58:47Z
completed_at: 2026-06-23T11:54:31Z
pr_url: https://github.com/Rogerio-auto/System-BP/pull/349
depends_on: []
blocks: []
labels: [infra, ci, docker, e2e, hardening]
source_docs: [docs/19-runbook-go-live.md]
docs_required: false
---

# F22-S03 — Infra: ressuscita o E2E Smoke (3 camadas)

## Objetivo

Destravar o gate **E2E Smoke** (`.github/workflows/e2e.yml`), **vermelho na `main`**: a
imagem Docker da API nunca completava o boot no CI por 3 quebras empilhadas (dist sem `.js`,
rabbitmq ausente, topologia não declarada). Ver §Escopo para as três correções.

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

O E2E Smoke estava quebrado em **3 camadas empilhadas** (cada uma mascarava a próxima);
o boot da API nunca completava no CI. As três correções:

1. **tsbuildinfo (`.dockerignore`)** — adicionar `*.tsbuildinfo` e `**/*.tsbuildinfo`,
   garantindo build Docker determinístico (sem herdar estado incremental do host que
   suprimia a emissão dos `.js` de shared-schemas/shared-types).
2. **rabbitmq ausente no CI (`docker-compose.ci.yml`)** — a API conecta no amqp no boot
   (`RABBITMQ_URL`, live chat F16-S01) e crashava com `ECONNREFUSED 5672`. Adicionado
   serviço `rabbitmq` stateless + `RABBITMQ_URL` na API + `depends_on` healthy. Healthcheck
   usa `check_port_connectivity` (o listener 5672 pode não estar pronto quando `ping` passa).
3. **topologia não declarada antes do consumo (`workers/livechat-socket-relay.ts`)** — o
   relay criava canal dedicado e consumia `hm.q.socket.relay` sem `assertTopology` antes →
   `404 NOT_FOUND` em broker fresco (CI stateless). Adicionado `assertTopology(channel)`
   (idempotente) antes do `consume`. Em dev/prod o bug ficava mascarado por filas duráveis
   de boots anteriores.

## Fora de escopo (NÃO faz)

- Desligar `incremental` no `tsconfig.base.json` (afeta velocidade de build local; o
  problema é só o vazamento para a imagem Docker).
- Mudar a estratégia de `pnpm deploy` no Dockerfile (o deploy está correto).
- Os fixes de F22-S01/S02.

## Arquivos permitidos

- `.dockerignore`
- `docker-compose.ci.yml`
- `apps/api/src/workers/livechat-socket-relay.ts`

## Arquivos proibidos

- `apps/api/Dockerfile`
- `tsconfig.base.json`
- `apps/web/**`
- `apps/langgraph-service/**`

## Contratos de saída

- Build da imagem `elemento-ci-api` produz `node_modules/@elemento/shared-schemas/dist/index.js`
  (e `shared-types`).
- `docker compose -f docker-compose.ci.yml up -d` sobe `api` **saudável** (`/health` 200)
  com rabbitmq + langgraph na rede.
- `pnpm --filter @elemento/api e2e` roda **verde** contra a stack CI.

## Definition of Done

- [x] `.dockerignore` exclui `*.tsbuildinfo`
- [x] CI compose tem `rabbitmq` e a API recebe `RABBITMQ_URL`
- [x] `socket-relay` assert a topologia antes de consumir
- [x] Imagem `api` builda e sobe **saudável** na stack `docker-compose.ci.yml`
- [x] Migrations aplicam e a suíte E2E roda **verde** (11/11)

## Comandos de validação

```powershell
docker compose -f docker-compose.ci.yml build api
docker compose -f docker-compose.ci.yml up -d
# aguardar healthchecks; aplicar migrations; rodar e2e (ver e2e.yml)
pnpm --filter @elemento/api e2e
docker compose -f docker-compose.ci.yml down --volumes
```

## Notas para o agente

- Escopo cresceu durante a execução: começou só `.dockerignore`, mas o boot da API
  revelou 2 camadas adicionais (rabbitmq, topologia). Validado end-to-end: `pnpm e2e` 11/11.
- Não tocar Dockerfile nem tsconfig.base — os fixes são determinísticos sem isso.
- `assertTopology` é idempotente; chamá-lo no consumer não conflita com o publisher.
