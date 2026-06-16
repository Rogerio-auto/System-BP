---
id: F16-S10
title: Worker outbound — FIFO lock por conversa, dispatch por provider, send, view_status
phase: F16
task_ref: docs/planejamento-live-chat-proprio.md#3-outbound-flow
status: done
priority: high
estimated_size: M
agent_id: null
claimed_at: 2026-06-16T05:46:17Z
completed_at: 2026-06-16T06:07:39Z
pr_url: #270
depends_on: [F16-S01, F16-S05, F16-S07]
blocks: [F16-S13]
labels: [lgpd-impact]
source_docs:
  - docs/planejamento-live-chat-proprio.md
  - docs/07-integracoes-whatsapp-chatwoot.md
  - docs/17-lgpd-protecao-dados.md
docs_required: false
docs_audience: [dev]
docs_artifacts: []
---

# F16-S10 — Worker outbound

## Objetivo

Consumir `hm.q.outbound.request`, garantir ordem FIFO por conversa (lock Redis), despachar por
provider+tipo, enviar via adapter, persistir a mensagem e atualizar `view_status` — emitindo socket.

## Contexto

Passo de envio do planejamento §3. O envio é assíncrono: a API (S13) só valida + enfileira; este worker
executa. O lock FIFO (Redlock, S01) garante ordem entre mensagens rápidas (FX-007 do tagix).

## Escopo (faz)

- `workers/livechat-outbound.ts`:
  1. `parseOutboundEnvelope` (Zod, contrato S03); 2. `runWithDistributedLock(hm:lock:outbound:{convId})`;
  2. `dispatchOutbound` (valida coerência `kind ↔ channel.provider` — template só WA, ig\_\* só IG);
  3. `adapter.send*`; 5. `livechatService.persistOutboundMessage` + `updateViewStatus`;
  4. publish `socket.relay` (`message:status_changed`); 7. ack/nack com retry/backoff (10s/60s/5min).
- Typing/recording pré-envio quando configurado (`pre_action`).
- Falha definitiva → `message:status_changed: failed` + evento de falha.

## Fora de escopo (NÃO faz)

- Endpoint HTTP de envio (S13).
- Inbound/media (S08/S09).

## Arquivos permitidos (`files_allowed`)

- `apps/api/src/workers/livechat-outbound.ts`
- `apps/api/src/workers/__tests__/livechat-outbound.test.ts`

## Arquivos proibidos (`files_forbidden`)

- `apps/api/src/workers/index.ts` (registrado por S08 — sequenciar se necessário)
- `apps/api/src/modules/livechat/**`

## Contratos de entrada

- Job `outbound.request` (S13), `getAdapter` (S05), `runWithDistributedLock` (S01), `livechatService` (S07).

## Definition of Done

- [ ] Lock FIFO por conversa garante ordem (teste com 2 mensagens concorrentes)
- [ ] `dispatchOutbound` rejeita `kind` incoerente com o provider (falha rápida, não na borda Meta)
- [ ] Envio persistido + `view_status` atualizado (sent → delivered/read via callback do inbound)
- [ ] Retry com backoff; falha definitiva marca `failed` + evento
- [ ] **LGPD:** logs só com ids + tipo, sem conteúdo; label `lgpd-impact`; checklist §14.2
- [ ] `pnpm --filter @elemento/api typecheck` / `lint` / `test` verdes

## Comandos de validação

```powershell
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api test -- livechat-outbound
```

## Notas para o agente

- Portar `dispatch.ts`/`processOutbound`/`finalizeOutbound` do tagix; adaptar lock ao Redlock de S01.
- A janela 24h é validada na borda (S13) **e** reconfirmada aqui antes de chamar a Meta (defesa em profundidade).
- Registro do worker: depende de S08 ter criado `workers/index.ts` (coordenar).
