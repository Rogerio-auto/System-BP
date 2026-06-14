# Fase 16 — Live Chat Próprio: Funcionalidade de Mensagem

> Origem: `docs/planejamento-live-chat-proprio.md` (baldes B0–B6). Substitui a dependência
> do Chatwoot por um inbox próprio multicanal. Reaproveita o transporte do repo `tagix`.
> **Escopo desta fase:** inbound + domínio + outbound + mídia + realtime + UI de mensagem.
> **Fora desta fase:** Embedded Signup/coexistência (onboarding), Instagram completo,
> migração/cutover do Chatwoot, notas internas/routing/contact-panel.

| ID      | Título                                                  | Tipo          | Size |
| ------- | ------------------------------------------------------- | ------------- | ---- |
| F16-S01 | Infra base — Redis + RabbitMQ + R2                      | backend/infra | M    |
| F16-S02 | Schema multicanal (channels/conversations/messages)     | db-schema     | L    |
| F16-S03 | Contratos compartilhados (unions + Zod + socket events) | shared        | M    |
| F16-S04 | packages/channels core — graphClient + hmac por-canal   | backend       | M    |
| F16-S05 | Adapter Meta WhatsApp (parser + serializer + adapter)   | backend       | L    |
| F16-S06 | Webhook Meta (Fastify) + dedup + publish                | backend       | M    |
| F16-S07 | Domínio livechat — repo + service (persistência)        | backend       | L    |
| F16-S08 | Worker inbound — parse → persist → relay                | backend       | L    |
| F16-S09 | Worker media — download → R2 → media_ready              | backend       | M    |
| F16-S10 | Worker outbound — FIFO lock → send → status             | backend       | M    |
| F16-S11 | Canais — connect manual + list                          | backend       | M    |
| F16-S12 | API conversas (read) — list/get/messages/window         | backend       | M    |
| F16-S13 | API envio de mensagem (janela 24h + idempotência)       | backend       | M    |
| F16-S14 | Socket server + relay (Socket.io no Fastify)            | backend       | M    |
| F16-S15 | Web — camada de dados + realtime (SocketProvider)       | frontend      | M    |
| F16-S16 | Web — Inbox: layout + ChatList                          | frontend      | L    |
| F16-S17 | Web — Conversa: MessageBubble + Composer + envio        | frontend      | L    |

**Grafo:** S01·S02·S03 (paralelos) → S04 → S05 → {S06, S07} → {S08, S09, S10} ; S07 → {S11, S12} → S13 ; {S01,S07} → S14 ; {S03,S12,S14} → S15 → {S16, S17}.
