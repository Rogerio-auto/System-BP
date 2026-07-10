---
id: F24-S15
title: Docs — doc canônico de notificações + flags + runbook go-live
phase: F24
task_ref: docs/planejamento-notificacoes.md
status: in-progress
priority: medium
estimated_size: M
agent_id: null
depends_on: [F24-S05, F24-S07, F24-S12]
blocks: []
labels: [docs, notifications]
source_docs:
  [docs/planejamento-notificacoes.md, docs/09-feature-flags.md, docs/19-runbook-go-live.md]
docs_required: false
claimed_at: 2026-07-10T14:12:13Z
---

# F24-S15 — Docs: canônico + flags + runbook

## Objetivo

Documentar o sistema de notificações de forma canônica: novo `docs/23-notificacoes.md`, registro das
4 flags no catálogo (`docs/09-feature-flags.md`) e os passos/ordem de flip no runbook de go-live.

## Contexto

Planejamento §4/§8. `docs/23` é o próximo número canônico livre — `docs/22` foi tomado por
`docs/22-agente-interno-acoes.md`, autorado depois deste slot. Manter consistência com o catálogo
real de gatilhos e o modelo de dados implementado em F24-S01.

## Escopo (faz)

- `docs/23-notificacoes.md` — arquitetura (event vs stage_inactivity), catálogo de gatilhos, modelo de
  dados (`notification_rules`, `notification_rule_deliveries`, `notification_preferences.category`),
  contratos de API, RBAC/flags, LGPD, telas (Admin + preferências).
- `docs/09-feature-flags.md` — registrar `notifications.rules.enabled`, `notifications.sla.enabled`,
  `notifications.email.enabled`, `notifications.realtime.enabled`.
- `docs/19-runbook-go-live.md` — seção de notificações com ordem de flip (email → rules → realtime → sla)
  e checklist de validação.

## Fora de escopo (NÃO faz)

- Código.
- Help mdx de usuário (já em F24-S10/S12).

## Arquivos permitidos

- `docs/23-notificacoes.md`
- `docs/09-feature-flags.md`
- `docs/19-runbook-go-live.md`

## Arquivos proibidos

- `apps/**`
- `packages/**`

## Definition of Done

- [ ] `docs/23-notificacoes.md` cobre arquitetura, dados, API, RBAC, flags, LGPD, telas
- [ ] 4 flags registradas no catálogo `docs/09`
- [ ] Runbook com ordem de flip + checklist
- [ ] Coerente com o que foi implementado (sem divergência docs×schema)

## Validação

```powershell
python scripts/slot.py validate F24-S15
```

## Notas para o agente

- Refletir o catálogo de gatilhos REAL implementado em F24-S04 (não inventar chaves).
- Linkar de volta para `docs/planejamento-notificacoes.md` e `negocio/decisoes-arquiteturais-notificacoes.md`.
