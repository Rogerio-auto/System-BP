---
id: F16-S11
title: Canais — connect manual (provider-discriminado, segredo cifrado) + list
phase: F16
task_ref: docs/planejamento-live-chat-proprio.md#5-onboarding-coexistencia-decisao-d3
status: available
priority: high
estimated_size: M
agent_id: null
claimed_at: null
completed_at: null
pr_url: null
depends_on: [F16-S02, F16-S03, F16-S04]
blocks: []
labels: [lgpd-impact]
source_docs:
  - docs/planejamento-live-chat-proprio.md
  - docs/10-seguranca-permissoes.md
  - docs/17-lgpd-protecao-dados.md
docs_required: true
docs_audience: [gestor, dev]
docs_artifacts:
  - docs/help/guias/livechat/conectar-canal.mdx
---

# F16-S11 — Conexão de canal (connect manual + list)

## Objetivo

Permitir conectar um canal (WhatsApp/Instagram) por **entrada manual de credenciais** (token + ids
obtidos no painel da Meta) e listar os canais do tenant — com o segredo cifrado e nunca retornado.

## Contexto

Para receber/enviar mensagens é preciso ter um `channel` com credencial. O Embedded Signup + coexistência
(SDK real) é fase de onboarding separada (D3); aqui entregamos o caminho manual — que é o mesmo contrato
`POST /channels/connect` do tagix (o seam `fb-login.ts` cai nesse modo manual). Desbloqueia testar
mensagem ponta-a-ponta.

## Escopo (faz)

- `modules/channels/routes.ts`: `GET /api/channels` (RBAC `channel.connect` + escopo de cidade, colunas
  públicas — sem segredos) + `POST /api/channels/connect` (discriminated por provider, valida Zod,
  cifra `access_token`/`app_secret` via `lib/crypto`, persiste em `channel_secrets`).
- `modules/channels/schemas.ts`: `connectSchema` discriminado (`meta_whatsapp`/`meta_instagram`/`waha`).
- `modules/channels/service.ts`: criação transacional canal + segredo; idempotência por `(org, provider, phone_number_id)`.
- Permissão `channel.connect` no catálogo de roles (se ausente).
- Doc `docs/help/guias/livechat/conectar-canal.mdx`.

## Fora de escopo (NÃO faz)

- Embedded Signup / FB JS SDK / coexistência (fase onboarding).
- Webhook (S06) e conversas (S12).

## Arquivos permitidos (`files_allowed`)

- `apps/api/src/modules/channels/**`
- `apps/api/src/db/seeds/permissions_livechat.ts`
- `docs/help/guias/livechat/conectar-canal.mdx`

## Arquivos proibidos (`files_forbidden`)

- `apps/api/src/modules/conversations/**`
- `apps/api/src/modules/meta-webhook/**`

## Contratos de saída

- `GET /api/channels` (lista pública), `POST /api/channels/connect` — consumidos pelo front de config.

## Definition of Done

- [ ] `POST /connect` cifra segredo (nunca texto plano, nunca no response)
- [ ] `GET /channels` nunca devolve colunas de `channel_secrets`
- [ ] RBAC `channel.connect` + escopo de cidade (teste positivo + negativo)
- [ ] Idempotência na criação (mesmo número não duplica)
- [ ] **LGPD:** token = segredo (doc 17); label `lgpd-impact`; checklist §14.2
- [ ] Doc `conectar-canal.mdx` criado (com `<FeedbackWidget />`)
- [ ] `pnpm --filter @elemento/api typecheck` / `lint` / `test` verdes

## Comandos de validação

```powershell
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api test -- channels
```

## Notas para o agente

- Portar `apps/api/src/routes/channels/index.ts` do tagix (Express → Fastify), reusando `PUBLIC_CHANNEL_COLUMNS`.
- `app_secret` por canal é o que o webhook (S06) usa para HMAC — alinhe o nome da coluna com S02.
- Se a permissão `channel.connect` exigir migration de seed, sincronizar `_journal.json`.
