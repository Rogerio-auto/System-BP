---
id: F1-S10
title: Helper de normalização de telefone (E.164 BR)
phase: F1
task_ref: T1.10
status: available
priority: high
estimated_size: XS
agent_id: null
claimed_at: null
completed_at: null
pr_url: null
depends_on: []
blocks: [F1-S11]
source_docs:
  - docs/12-tasks-tecnicas.md#T1.10
---

# F1-S10 — Normalização de telefone

## Objetivo

`normalizePhone(input: string, defaultCountry='BR')` → `{ e164, normalized, isValid }` usando `libphonenumber-js`.

## Escopo

- `apps/api/src/shared/phone.ts`
- Testes unit cobrindo:
  - `(11) 91234-5678` → `+5511912345678`
  - `11912345678` → `+5511912345678`
  - `+5511912345678` (já normalizado)
  - inputs inválidos retornam `isValid: false`
  - 8 dígitos antigos com prefixo de cidade

## Definition of Done

- [ ] Testes verdes
- [ ] Função pura (sem efeitos)
- [ ] PR aberto
