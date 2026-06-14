---
id: F16-S01
title: Infra base do live chat — Redis + RabbitMQ + R2 (clientes + topologia de filas)
phase: F16
task_ref: docs/planejamento-live-chat-proprio.md#6-adr-override-da-regra-sem-redis-no-mvp
status: available
priority: critical
estimated_size: M
agent_id: null
claimed_at: null
completed_at: null
pr_url: null
depends_on: []
blocks: [F16-S08, F16-S09, F16-S10, F16-S14]
labels: []
source_docs:
  - docs/planejamento-live-chat-proprio.md
  - docs/02-arquitetura-sistema.md
docs_required: false
docs_audience: [dev]
docs_artifacts: []
---

# F16-S01 — Infra base do live chat (Redis + RabbitMQ + R2)

## Objetivo

Disponibilizar os clientes de infra do domínio de mensagem — Redis (locks/cache), RabbitMQ
(filas inbound/outbound/media/socket-relay) e Cloudflare R2 (storage de mídia) — com bootstrap,
health check e topologia de filas declarada, sem ainda consumir/produzir mensagens.

## Contexto

Decisão **D1** do planejamento: o domínio do live chat adota Redis + RabbitMQ + Socket.io
(override consciente da regra nº2, **só para o live chat** — o resto segue outbox). Decisão **D6**:
storage em **Cloudflare R2**. Este slot é a fundação que os workers (S08/S09/S10) e o socket (S14)
consomem.

## Escopo (faz)

- `docker-compose.yml`: serviços `redis` e `rabbitmq` (com management) para dev; volumes nomeados.
- `apps/api/src/lib/queue/**`: cliente RabbitMQ (amqplib) com reconexão, e **declaração da topologia**
  (exchange `hm.channels`, filas `hm.q.inbound.message`, `hm.q.inbound.media`, `hm.q.outbound.request`,
  `hm.q.socket.relay`, DLX + retry). Helpers `publish()` / `assertTopology()`.
- `apps/api/src/lib/redis/**`: cliente Redis (ioredis) + `runWithDistributedLock(key, ttl, fn)` (Redlock single-instance).
- `apps/api/src/lib/storage/**`: cliente R2 (S3 SDK compatível) — `putObject`, `getSignedUrl`, `headObject`.
- `apps/api/src/config/env.ts`: adicionar vars (`REDIS_URL`, `RABBITMQ_URL`, `R2_*`) validadas por Zod.
- `.env.example`: novas vars documentadas (sem valores reais).

## Fora de escopo (NÃO faz)

- Consumir/produzir mensagens (workers são S08/S09/S10).
- Socket.io server (S14).
- Conversão de mídia ffmpeg/sharp (S09).

## Arquivos permitidos (`files_allowed`)

- `docker-compose.yml`
- `.env.example`
- `apps/api/src/config/env.ts`
- `apps/api/src/lib/queue/**`
- `apps/api/src/lib/redis/**`
- `apps/api/src/lib/storage/**`
- `apps/api/src/lib/__tests__/queue.test.ts`
- `apps/api/src/lib/__tests__/redis.test.ts`

## Arquivos proibidos (`files_forbidden`)

- `apps/api/src/workers/**` (S08/S09/S10 são donos)
- `apps/api/src/db/**`

## Contratos de saída

- `publish(routingKey, payload)`, `assertTopology()`, `runWithDistributedLock()`, cliente R2 e
  validação de env — consumidos por S08/S09/S10/S14.

## Definition of Done

- [ ] `docker compose config` válido com redis + rabbitmq
- [ ] Topologia declarada idempotente (`assertTopology()` testado com mock)
- [ ] `runWithDistributedLock` cobre aquisição + liberação + timeout (teste)
- [ ] Cliente R2 com `getSignedUrl` testado (mock SDK)
- [ ] Env nova validada por Zod; `.env.example` atualizado
- [ ] Dependências novas (`amqplib`, `ioredis`, `@aws-sdk/client-s3`) justificadas no PR
- [ ] `pnpm --filter @elemento/api typecheck` / `lint` / `test` verdes

## Comandos de validação

```powershell
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api test -- queue redis
docker compose config
```

## Notas para o agente

- Reaproveitar a estrutura do tagix (`apps/api/src/lib`/workers) como referência de topologia
  (`hm.channels`, `hm.q.*`, DLX). Nomes de fila idênticos ajudam a portar os workers depois.
- Redlock single-instance é suficiente no MVP (1 Redis). Não introduzir cluster.
- Nada de segredo commitado — só `.env.example`.
