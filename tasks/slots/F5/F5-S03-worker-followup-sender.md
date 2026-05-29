---
id: F5-S03
title: Worker followup-sender + cliente Meta WhatsApp templates
phase: F5
task_ref: T5.3
status: done
priority: high
estimated_size: L
agent_id: backend-engineer
claimed_at: 2026-05-29T23:02:00Z
completed_at: 2026-05-29T23:19:00Z
pr_url: https://github.com/Rogerio-auto/System-BP/pull/164
depends_on: [F5-S01, F5-S02, F1-S15, F1-S20]
blocks: []
labels: [lgpd-impact]
source_docs:
  - docs/05-modulos-funcionais.md
  - docs/07-integracoes-whatsapp-chatwoot.md
  - docs/17-lgpd-protecao-dados.md
---

# F5-S03 — Worker followup-sender + cliente Meta templates

## Objetivo

Worker que consome `followup_jobs` com `status='scheduled' AND scheduled_at <= now()` e envia o template via Meta WhatsApp Cloud API — **gated por `followup.sender.enabled`**. Implementa cliente Meta dedicado (separado do Chatwoot) para enviar template message com variáveis.

## Escopo

- Worker `apps/api/src/workers/followup-sender.ts`:
  - Loop: busca lote `WHERE status='scheduled' AND scheduled_at <= now() LIMIT 50`
  - Para cada job:
    - Valida lead ativo (não merged, não arquivado)
    - Renderiza variáveis do template (`{{customer_name}}`, `{{simulation_amount}}`, etc) a partir do lead/customer/simulação
    - Chama cliente Meta — `POST https://graph.facebook.com/v20.0/{phone_number_id}/messages`
    - Atualiza job: `status='sent'`, `sent_message_id=<wamid>`, `attempt_count++`
    - Em erro: `attempt_count++`, `last_error`, `status='failed'` se `>= rule.max_attempts`
  - Emite outbox `followup.sent`/`followup.failed`
  - **Flag gating:** `followup.sender.enabled=disabled` → não envia (dry-run loga mensagem composta sem chamar API)
  - Backoff: failure → próximo tick com `scheduled_at = now() + exponential_backoff(attempt_count)`
- Cliente Meta `apps/api/src/integrations/meta-whatsapp/client.ts`:
  - Construtor com `accessToken` (env `META_WHATSAPP_ACCESS_TOKEN`), `phoneNumberId` (env `META_WHATSAPP_PHONE_NUMBER_ID`)
  - Método `sendTemplate({ to, templateName, language, components }) → { wamid }`
  - Rate-limit conservador (Meta tier-based) + retry 429/5xx com tenacity-like (backoff exponencial, max 3)
  - Logs estruturados sem PII (`to_hash`, não `to`)

### LGPD

- **Janela 24h:** template é única forma de mensagem fora da janela — auditoria de cada envio em `audit_logs`
- **Consentimento:** envio só se `customer.consent_at IS NOT NULL` (verificação no worker, não no cliente)
- **PII:** `to` (telefone) **nunca** em log estruturado; usar `to_hash` (HMAC já implementado em F1-S24)
- **Outbox:** payload `followup.sent` carrega `job_id`, `lead_id`, `template_key`, `wamid` — sem telefone bruto
- **DPA Meta:** suboperador já registrado (doc 17 §11). Sem novo DPIA.

## Fora de escopo

- Cobrança (F5-S06..S08)
- UI (F5-S05)
- Webhook de delivery status do Meta (slot futuro)

## Arquivos permitidos

```
apps/api/src/workers/followup-sender.ts
apps/api/src/workers/index.ts
apps/api/src/workers/__tests__/followup-sender.test.ts
apps/api/src/integrations/meta-whatsapp/client.ts
apps/api/src/integrations/meta-whatsapp/types.ts
apps/api/src/integrations/meta-whatsapp/__tests__/client.test.ts
apps/api/src/events/types.ts
apps/api/src/env.ts
.env.example
```

## Definition of Done

- [ ] Worker enviando templates com renderização correta de variáveis
- [ ] Flag-gating em 2 camadas (sem chamada à API quando off)
- [ ] Backoff exponencial em failure
- [ ] Cliente Meta com retry 429/5xx
- [ ] Consent check antes de enviar
- [ ] PII redact em logs (`to_hash` em vez de `to`)
- [ ] Outbox `followup.sent`/`followup.failed` emitido
- [ ] Audit log por envio
- [ ] Testes: dry-run, envio bem sucedido, 429 com retry, max_attempts atingido
- [ ] PR com label `lgpd-impact` + checklist doc 17

## Validação

```powershell
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api test -- followup-sender
pnpm --filter @elemento/api test -- meta-whatsapp
```
