---
id: F6-S32
title: Docs — escalação ao Crédito (doc 22 normativo + RoPA/LGPD)
phase: F6
task_ref: docs/22-agente-interno-acoes.md
status: review
priority: low
estimated_size: S
agent_id: null
depends_on: []
blocks: []
labels: [docs, lgpd-impact]
source_docs: [docs/22-agente-interno-acoes.md, docs/17-lgpd-protecao-dados.md]
docs_required: false
claimed_at: 2026-07-14T19:08:15Z
completed_at: 2026-07-14T19:13:56Z
---

# F6-S32 — Docs: escalação ao Crédito

## Objetivo

Documentar a escalação de lead ao Departamento de Crédito como ação normativa do agente interno e registrar o
tratamento de dados correspondente (LGPD).

## Escopo (faz)

- `docs/22-agente-interno-acoes.md`: nova seção **"Escalar lead ao Crédito"** — gatilho (operador, a partir do
  card do copiloto), ator (o humano; a IA nunca escala sozinha), destinatário (analista de crédito da
  **matriz**, `organizations.settings.matriz_city_id`), canais (in-app + email), idempotência, auditoria
  (`assistant.lead_escalated`), evento (`assistant.escalation.created`, sem PII bruta) e reversibilidade
  (a notificação é informativa: não move o lead nem decide crédito).
- `docs/17-lgpd-protecao-dados.md`: linha no **RoPA** para a notificação de escalação (finalidade: comunicação
  interna para análise de crédito; base legal Art. 7º IX / execução de política pública; dados: referência ao
  lead + nota do operador; **sem PII bruta no outbox**; destinatários: equipe de crédito da matriz; retenção
  conforme a política já vigente de notificações).
- Registrar a config `matriz_city_id` em `organizations.settings` (onde setar, o que acontece se ausente).

## Fora de escopo (NÃO faz)

- Código (F6-S30/S31).

## Arquivos permitidos

- `docs/22-agente-interno-acoes.md`
- `docs/17-lgpd-protecao-dados.md`

## Arquivos proibidos

- `apps/**`, `tasks/**`

## Definition of Done

- [ ] Doc 22 com a seção da escalação (gatilho, ator humano, destinatário matriz, canais, audit, evento)
- [ ] Doc 17 com a linha de RoPA + a nota de "sem PII bruta no outbox"
- [ ] Config `matriz_city_id` documentada

## Validação

```powershell
git diff --stat
```

## Notas para o agente

- **Não** coloque `slot.py validate` no bloco Validação (fork bomb). Não rode `taskkill python`.
- Doc 17 é normativo — escreva no formato das linhas de RoPA já existentes (não invente estrutura nova).
