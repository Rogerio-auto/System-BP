# 07 — Integrações WhatsApp e Chatwoot

## 1. WhatsApp API Oficial (Cloud API Meta)

### 1.1 Webhook de entrada

**Rota:** `POST /api/whatsapp/webhook`

Validações:
- `hub.verify_token` no GET de verificação inicial.
- HMAC SHA-256 via header `X-Hub-Signature-256` em toda requisição.
- Idempotência: `wa_message.id` → `idempotency_keys` impede duplo processamento.

Pipeline:
1. Validar assinatura.
2. Persistir bruto em `whatsapp_messages` (status `received`, `direction='in'`).
3. Upsert `chatwoot_conversations` (criar se não existir, com `status='open'`).
4. Inserir `interactions` (`kind='whatsapp_message'`, `direction='in'`).
5. Emitir evento `whatsapp.message_received` (outbox).
6. Enfileirar processamento síncrono: chamar LangGraph `/process/whatsapp/message`.
7. Resposta 200 ao Meta o mais rápido possível (< 2s). Processamento pesado é assíncrono.

### 1.2 Envio de mensagens

**Rota interna:** `POST /api/whatsapp/send`

Tipos:
- `text` (dentro da janela 24h).
- `template` (fora da janela; usa `whatsapp_templates`).
- `interactive` (botões/listas) — Fase futura.

Toda chamada exige `Idempotency-Key`. Resposta do WhatsApp persistida com `wa_message_id`.

### 1.3 Janela de 24h

- Backend mantém `last_inbound_at` em `chatwoot_conversations`.
- Antes de enviar, valida: dentro da janela → texto livre. Fora → exige template.
- IA jamais envia template fora de regra.

### 1.4 Templates

- `whatsapp_templates` espelha cadastro Meta.
- Sincronização periódica (job `whatsapp-templates-sync`).
- Template usado em follow-up/cobrança definido em `followup_rules.template_id`.

### 1.5 Falhas e reentrega

- Mensagem com erro de envio → retry 3x com backoff (10s, 60s, 5min).
- Após falha definitiva → evento `whatsapp.message_failed`, alerta operacional.
- Status callbacks (`sent`, `delivered`, `read`) atualizam `whatsapp_messages.status`.

---

## 2. Chatwoot

### 2.1 Webhooks recebidos

Eventos suportados:
- `conversation_created`
- `conversation_updated`
- `message_created` (incluindo direction `incoming` e `outgoing` de agente humano)
- `conversation_status_changed`

**Rota:** `POST /api/chatwoot/webhook`

Segurança:
- Header `Api-Access-Token` ou validação por shared secret + `X-Chatwoot-Signature` se disponível.
- Idempotência por `(event_type, message_id|conversation_id, updated_at)`.

Tratamento:
- `message_created` (incoming): geralmente já recebido via WhatsApp webhook. Caso o canal seja Chatwoot direto, segue o mesmo pipeline da seção 1.
- `message_created` (outgoing por humano): persistir `interactions` + atualizar `last_inbound_at` se aplicável; **pausa follow-up** ativo via evento `customer_interaction_recorded`.
- `conversation_status_changed`: atualiza `chatwoot_conversations.status`.
- `conversation_assignee_changed`: atualiza `assignee_chatwoot_id`, registra `lead_history`.

### 2.2 Chamadas ao Chatwoot (saída)

API REST do Chatwoot. Endpoints usados:
- Atualizar custom attributes da conversa.
- Atribuir agente.
- Criar mensagem.
- Criar nota interna.
- Buscar contato.

Cliente HTTP encapsulado em `apps/api/src/integrations/chatwoot/client.ts`. Retry 3x com backoff.

### 2.3 Mapeamento de identidade

| Manager | Chatwoot |
|---------|----------|
| `leads.id` | `conversation.custom_attributes.lead_id` |
| `customers.id` | `contact.custom_attributes.customer_id` |
| `agents.user_id` | `assignee.id` (mapeamento via `agents.chatwoot_user_id`) |
| `cities.name` | `conversation.custom_attributes.cidade` |
| `kanban_cards.stage_key` | `conversation.custom_attributes.estagio` |
| `credit_simulations.id` | `conversation.custom_attributes.simulacao_id` |

Tabela auxiliar `chatwoot_user_map` (`user_id`, `chatwoot_user_id`) — preenchida em onboarding.

### 2.4 Handoff: nota interna padrão

Sempre que IA pede handoff, backend cria nota interna com este formato:

```
🤝 Handoff da IA para atendente humano

Cliente: Maria Silva
Telefone: +55 69 99999-9999
Cidade: Porto Velho

Resumo do atendimento:
- Cliente solicitou crédito de R$ 5.000 em 12 meses.
- Simulação gerada (#a1b2c3): parcela R$ 487,44, taxa 2,5% a.m.
- Cliente pediu para falar com atendente.

Próximas ações sugeridas:
- Confirmar interesse e produto.
- Coletar documentos (RG, CPF, comprovante de renda).
- Encaminhar para análise.

Stage atual: documentacao
Card: <link>
Lead ID: <uuid>
Simulação ID: <uuid>
```

Template renderizado por `apps/api/src/modules/chatwoot/handoff-note.template.ts`. Versionado.

### 2.5 Sincronização de status do Kanban

Mudança de stage no Manager → atualiza atributos no Chatwoot.
Mudança de status no Chatwoot (resolved) → backend pode mover card para `concluido` se não houver outcome definido (com flag `auto_complete_on_chatwoot_resolved.enabled`, default `disabled`).

### 2.6 Falhas

- API Chatwoot indisponível: enfileirar em `chatwoot_sync_queue` (worker `chatwoot-sync`).
- Webhook duplicado: idempotency.
- Webhook fora de ordem: backend usa `updated_at` do payload + comparação com estado atual antes de aplicar mudança.

### 2.7 Reprocessamento

Tela admin `/admin/integrations/chatwoot` com:
- Lista de webhooks recentes.
- Status (processado, falho).
- Botão reprocessar.
- Filtro DLQ.

---

## 3. Estratégia de duplicidade

Caso o cliente envie mensagem que chegue tanto pelo webhook do WhatsApp quanto pelo do Chatwoot:
- Backend deduplica por `(channel='whatsapp', wa_message_id)` em `whatsapp_messages`.
- Apenas o primeiro webhook processado dispara LangGraph.
- Idempotency key combina origem do webhook + id externo.

---

## 4. Resumo das diferenças de responsabilidade

| Responsabilidade | Manager (Postgres) | Chatwoot |
|------------------|--------------------|----------|
| Estado canônico do lead/cliente | sim | não |
| Stage/outcome | sim | espelho via custom attributes |
| Histórico de mensagens autoritativo | sim (`whatsapp_messages` + `interactions`) | espelho operacional |
| Atribuição de agente | sim (`assigned_agent_id`) | espelhado |
| Decisões da IA | sim (`ai_decision_logs`) | nota interna humanamente legível |
| Templates de mensagem | sim (`whatsapp_templates`) | leitura |
| Conversa visualizada pelo agente humano | não | sim |

Chatwoot é **interface**, não estado.

---

## 5. Critérios de aceite das integrações

- Webhook duplicado não cria duas mensagens nem dois processos da IA.
- Mensagem do cliente pausa follow-up ativo automaticamente.
- Handoff cria nota com simulação correta.
- Custom attributes do Chatwoot espelham estado atual após eventos.
- Falha do Chatwoot não impede recebimento de mensagem (degradação graciosa).
- Reprocessamento manual recupera webhooks falhos.

## 6. Segurança

- Tokens armazenados em secrets manager.
- Rotação de tokens documentada.
- Logs **não** registram corpo de mensagem com PII em texto plano além do necessário; PII em logs estruturados é mascarada (telefone parcial, sem CPF).
- Rate limit nos webhooks públicos para evitar abuso.
