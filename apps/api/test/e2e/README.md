# E2E Smoke Tests — Elemento API

Testes ponta a ponta que sobem a stack completa e validam o caminho crítico.

## Pré-requisitos

- Docker + Docker Compose v2
- Node 20.18.3 + pnpm 9
- Porta `5433` livre (Postgres CI), porta `3333` (API), porta `8000` (LangGraph)

## Como rodar localmente

```powershell
# 1. Subir a stack
docker compose -f docker-compose.ci.yml up -d

# 2. Aguardar serviços (pode levar 30-60s na primeira vez)
# Verificar se todos os healthchecks passaram:
docker compose -f docker-compose.ci.yml ps

# 3. Aplicar migrations
$env:DATABASE_URL = "postgres://elemento:elemento_ci_secret@localhost:5433/elemento_e2e"
pnpm --filter @elemento/api db:migrate

# 4. Rodar testes E2E
$env:DATABASE_URL = "postgres://elemento:elemento_ci_secret@localhost:5433/elemento_e2e"
$env:E2E_API_URL = "http://localhost:3333"
$env:CI = "false"
pnpm --filter @elemento/api e2e

# 5. Derrubar stack
docker compose -f docker-compose.ci.yml down --volumes
```

## Cenários cobertos

### Cenário 1 — Golden path WhatsApp → lead → outbox

Arquivo: `whatsapp-lead-to-simulation.e2e.test.ts`

- POST `/api/whatsapp/webhook` com payload sintético e HMAC válido → 200
- `whatsapp_messages` persiste com `direction='inbound'`
- `outbox_event` `whatsapp.message_received` emitido (LGPD: sem PII no payload)
- Idempotência: segundo POST com mesmo `wa_message_id` → `skipped=1`
- HMAC inválido → 401

### Cenário 2 — LangGraph indisponível → handoff fallback (F3-S34)

Arquivo: `handoff-on-langgraph-failure.e2e.test.ts`

- POST `/internal/handoffs` com `reason='ai_unavailable'` → 200
- `chatwoot_handoffs` criado com `status='requested'`
- Idempotência: mesmo `Idempotency-Key` retorna mesmo `handoff_id`
- Sem `X-Internal-Token` → 401
- Sem `Idempotency-Key` → 400

## Arquitetura dos testes

```
test/e2e/
├── README.md                               (este arquivo)
├── setup.ts                                (globalSetup: env vars para containers)
├── seed.ts                                 (seed idempotente + cleanE2eData)
├── whatsapp-lead-to-simulation.e2e.test.ts (cenário 1)
└── handoff-on-langgraph-failure.e2e.test.ts (cenário 2)
```

Os testes fazem chamadas HTTP reais ao container da API — não importam
módulos internos do app (exceto o Drizzle client para asserções no DB).

## Isolamento

- `seed.ts` usa `ON CONFLICT DO NOTHING` — idempotente.
- `cleanE2eData()` deleta apenas linhas criadas na última hora com prefixo `wamid.e2e.*`.
- Não trunca tabelas inteiras — seed de produção não é afetado.

## Troubleshooting

**API não sobe (healthcheck falha):**

```powershell
docker compose -f docker-compose.ci.yml logs api --tail 50
```

Causas comuns: migration não rodou, env var faltando, conflito de porta.

**LangGraph não sobe:**

```powershell
docker compose -f docker-compose.ci.yml logs langgraph --tail 30
```

O serviço sobe com `E2E_MOCK_MODE=true` — não precisa de chave OpenRouter.

**Erro `connection refused` nos testes:**
Verificar se o compose está saudável antes de rodar:

```powershell
docker compose -f docker-compose.ci.yml ps
```

Todos os serviços devem estar `(healthy)`.

**Porta 5433 em uso:**

```powershell
docker compose -f docker-compose.ci.yml down --volumes
```

E reiniciar.
