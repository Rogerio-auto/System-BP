---
id: F6-S23
title: Gate — parecer do DPO oficial antes de LIGAR o histórico persistente em produção
phase: F6
task_ref: docs/anexos/lgpd/dpia-historico-copiloto.md
status: blocked
priority: high
estimated_size: S
agent_id: null
depends_on: []
blocks: []
labels: [lgpd, gate, non-code]
source_docs: [docs/anexos/lgpd/dpia-historico-copiloto.md, docs/17-lgpd-protecao-dados.md]
docs_required: false
---

# F6-S23 — Gate: parecer do DPO oficial (ativação em produção)

## O que este gate trava (revisado em 2026-07-14)

Trava a **ativação em produção** da flag `assistant.history.enabled` — ou seja, o momento em que o sistema
efetivamente começa a **tratar dados pessoais** gravando o histórico do copiloto.

**Não** trava o desenvolvimento. Código mergeado com a flag desligada não persiste nada e não trata dado
pessoal algum — é o mesmo padrão de dark deploy do F25. As Fases 2–4 (F6-S24..S29) podem ser construídas,
revisadas, testadas e até deployadas com a flag **OFF**.

O invariante que sustenta essa separação: **a persistência é no-op quando `assistant.history.enabled` está
desligada** (imposto no F6-S25). Se esse invariante cair, este gate volta a travar o merge.

## O que destrava este gate

- [ ] DPO oficial do **Controlador** (Banco do Povo / SEDEC-RO) preencheu o §6 do DPIA
      (`docs/anexos/lgpd/dpia-historico-copiloto.md`) — aprovado com ou sem ressalvas.
- [ ] Ressalvas, se houver, incorporadas ao desenho antes do flip (ex.: prazo de retenção ≠ 90d,
      política de título, direito de exclusão).
- [ ] Autorização do Controlador registrada (Art. 39 §2º), se aplicável.

Quando isso ocorrer: `python scripts/slot.py done F6-S23` e **só então** ligar a flag em produção.

## Definition of Done

- [ ] Parecer do DPO registrado no DPIA §6
- [ ] Ressalvas refletidas no código antes do flip
- [ ] Flag `assistant.history.enabled` ligada em produção

## Notas

- A Fase 1 (F6-S20/S21/S22 — resposta estruturada, sem persistência) não depende deste gate e já está em
  produção (deployada em 2026-07-14).
- Enquanto o parecer não vier, **ninguém liga a flag** — nem para "testar rapidinho". Ligar a flag = tratar
  dado pessoal sem DPIA aprovado = violação do doc 17.
