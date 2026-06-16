---
id: F19-S06
title: LangGraph — nó lawyer_handoff (envio autônomo do contato do advogado)
phase: F19
task_ref: docs/planejamento-2026-06-evolucao.md
status: done
priority: medium
estimated_size: M
agent_id: null
claimed_at: null
completed_at: 2026-06-16T19:05:34Z
pr_url: https://github.com/Rogerio-auto/System-BP/pull/296
depends_on: [F19-S03]
blocks: []
labels: [langgraph, advocacia, ai, cobranca, lgpd]
source_docs:
  - docs/planejamento-2026-06-evolucao.md
  - docs/17-lgpd-protecao-dados.md
docs_required: false
---

# F19-S06 — LangGraph: lawyer_handoff

## Objetivo

Implementar tool e nó LangGraph que detecta cliente inadimplente com escritório vinculado e, seguindo guard-rails D17, cumprimenta, confirma identidade e envia o contato do advogado automaticamente.

## Contexto

Item 10 / F.3c. Quando cliente inadimplente (com escritório de advocacia vinculado) entra em contato via WhatsApp, o agente IA assume e encaminha para o advogado sem intervenção humana. Guard-rails D17: cumprimentar → confirmar identidade → só então enviar. Cooldown 7 dias (backend enforça). LGPD Art. 20: decisão automatizada = registrar em `ai_decision_logs`.

## Escopo (faz)

### Tool: `check_law_firm_status`

- `GET /internal/law-firm-status?customer_id={id}` com `X-Internal-Token`
- Retorna: `LawFirmStatus` (eligible, law_firm: {id, name, contact_phone} | None, cooldown_until)
- DLP: NÃO loga nem passa ao LLM nome/CPF do customer — apenas primeiro nome para cumprimento (buscar de contexto separado)

### Tool: `send_law_firm_referral_ai`

- `POST /internal/customers/{customer_id}/law-firm-referral` com `{ law_firm_id, channel: 'ai' }` e `X-Internal-Token`
- Registra no backend + cooldown automático
- Retorna `{ ok, referral_id, cooldown_until }`

### Nó: `lawyer_handoff_node`

- Condição de ativação no roteador: `check_law_firm_status(customer_id).eligible == True`
- Feature flag: verificar `law_firm.ai_handoff.enabled` via `GET /internal/feature-flags` (ou constante de env); se false → escalar para humano normalmente
- Fluxo D17 (3 turnos):
  1. **Cumprimentar**: "Olá, [primeiro_nome]! Eu sou o assistente do Banco do Povo."
  2. **Confirmar identidade**: "Estou falando com [primeiro_nome] [sobrenome]?" — aguarda confirmação positiva
  3. **Se confirmado**: "Seu processo de regularização foi encaminhado para o Escritório [nome]. Entre em contato pelo número: [contact_phone]." → chamar `send_law_firm_referral_ai`
  4. **Se negado / sem resposta após 2 tentativas**: escalar para agente humano
- Registrar decisão em `ai_decision_logs` via `/internal/audit/ai-decision`
- Cooldown: se `cooldown_until` futuro → informar ao cliente e encerrar sem re-enviar

## Fora de escopo (NÃO faz)

- CRUD de escritórios ou UI
- Envio manual pelo agente humano (F19-S05)
- Lógica de WhatsApp/template (o backend já cuida disso via outbox)

## Arquivos permitidos (`files_allowed`)

- `apps/langgraph-service/app/tools/lawyer_handoff.py`
- `apps/langgraph-service/app/nodes/lawyer_handoff_node.py`
- `apps/langgraph-service/app/graph.py`
- `apps/langgraph-service/app/tools/__init__.py`
- `apps/langgraph-service/tests/test_lawyer_handoff.py`

## Arquivos proibidos (`files_forbidden`)

- `apps/api/**`
- `apps/web/**`
- `apps/langgraph-service/app/tools/simulation.py`
- `apps/langgraph-service/app/tools/followup.py`

## Contratos de entrada

- `GET /internal/law-firm-status?customer_id=` → `{ eligible, law_firm, cooldown_until }` (F19-S03)
- `POST /internal/customers/:id/law-firm-referral` → `{ ok, referral_id }` (F19-S03)
- Feature flag `law_firm.ai_handoff.enabled`

## Definition of Done

- [ ] Tool `check_law_firm_status` retorna elegibilidade via /internal
- [ ] Fluxo D17: cumprimento → confirmação → envio (3 turnos)
- [ ] Cooldown respeitado: não re-envia se cooldown_until futuro
- [ ] Feature flag `law_firm.ai_handoff.enabled` bloqueia nó se desligado
- [ ] DLP: sem PII bruta (nome completo/CPF/telefone do customer) no contexto do LLM
- [ ] `ai_decision_logs` registrado após envio
- [ ] Testes: eligible + não-eligible + cooldown ativo + flag desligada
- [ ] `uv run pytest apps/langgraph-service -k lawyer_handoff` verde

## Comandos de validação

```powershell
cd apps/langgraph-service
uv run pytest -k lawyer_handoff -v
```

## Notas para o agente

- **Regra #1 inviolável:** LangGraph NUNCA acessa Postgres diretamente. Tudo via /internal/\*.
- **DLP:** ao montar o prompt, use APENAS o primeiro nome do customer para cumprimento. Não inclua CPF, nome completo, endereço ou telefone no contexto enviado ao gateway LLM. O `contact_phone` do ESCRITÓRIO (não do customer) pode aparecer na mensagem de saída.
- LGPD Art. 20 (decisão automatizada): registrar em `ai_decision_logs` inclui: quem (customer_id), o quê (law_firm_referral), quando, canal (ai), confidence (se aplicável). O titular pode pedir revisão humana — isso é implementado via live chat (escalação normal).
- Roteador em `graph.py`: adicionar edge condicional que checa `eligible` ANTES dos nós de atendimento normal. Se eligible E flag ativa → `lawyer_handoff_node`; senão → fluxo normal.
- Use `httpx.AsyncClient` com timeout para chamadas /internal (já padrão no projeto).
