---
id: F1-S19
title: Webhook WhatsApp — entrada + idempotência + persistência
phase: F1
task_ref: T1.19
status: done
priority: high
estimated_size: M
agent_id: claude-code
claimed_at: '2026-05-12T00:00:00Z'
completed_at: '2026-05-12T01:45:00Z'
pr_url: https://github.com/Rogerio-auto/System-BP/pull/20
depends_on: [F1-S15]
blocks: []
source_docs:
  - docs/07-integracoes-whatsapp-chatwoot.md
  - docs/12-tasks-tecnicas.md#T1.19
---

# F1-S19 — Webhook WhatsApp

## Objetivo

Endpoints `GET/POST /api/whatsapp/webhook` Cloud API Meta com verificação `hub.verify_token`, validação HMAC `X-Hub-Signature-256`, idempotência, persistência em `whatsapp_messages`.

## Escopo

- Schema `whatsapp_messages` (id, wa_message_id unique, conversation_id, direction, payload, received_at, ...).
- Schema `idempotency_keys` (key, endpoint, request_hash, response_body, created_at).
- Validação HMAC com `WHATSAPP_APP_SECRET`.
- Resposta padrão (sem IA ainda — apenas log).
- Evento `whatsapp.message_received` via outbox.
- Testes: assinatura inválida → 401, duplicado não cria duas linhas.

## Definition of Done

- [ ] Verificação webhook Meta funciona
- [ ] HMAC inválido → 401
- [ ] Duplicado é no-op
- [ ] PR aberto
