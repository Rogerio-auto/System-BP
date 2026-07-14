---
id: F6-S23
title: Gate — parecer do DPO oficial sobre o histórico persistente (bloqueia Fases 2–4)
phase: F6
task_ref: docs/anexos/lgpd/dpia-historico-copiloto.md
status: blocked
priority: high
estimated_size: S
agent_id: null
depends_on: []
blocks: [F6-S24, F6-S25, F6-S26, F6-S27, F6-S28, F6-S29]
labels: [lgpd, gate, non-code]
source_docs: [docs/anexos/lgpd/dpia-historico-copiloto.md, docs/17-lgpd-protecao-dados.md]
docs_required: false
---

# F6-S23 — Gate: parecer do DPO oficial

## Objetivo

Marcador (não-código) que **bloqueia toda a persistência** (Fases 2–4) do histórico do copiloto até o
parecer do DPO oficial no DPIA `docs/anexos/lgpd/dpia-historico-copiloto.md` §6.

## O que destrava este gate

- [ ] DPO oficial preencheu o §6 do DPIA (aprovado com/sem ressalvas).
- [ ] Ressalvas, se houver, incorporadas ao desenho (ex.: prazo de retenção, política de título).
- [ ] Autorização do Controlador registrada (Art. 39 §2º) se aplicável.

Quando isso ocorrer, marcar este slot como `done` via `scripts/slot.py done F6-S23` — o que torna as Fases
2–4 elegíveis. **Nenhum código de persistência antes disto.**

## Fora de escopo

- Código. Este slot é um portão de conformidade.

## Definition of Done

- [ ] Parecer do DPO oficial registrado no DPIA §6
- [ ] Eventuais ressalvas refletidas nos slots F6-S24..S29 antes do dispatch

## Notas

- A Fase 1 (F6-S20/S21/S22 — refactor da resposta, sem persistência) **não** depende deste gate.
