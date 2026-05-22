---
id: F7-S08
title: Treinamento dos agentes humanos + material de apoio
phase: F7
task_ref: T7.8
status: available
priority: medium
estimated_size: M
agent_id: backend-engineer
claimed_at: null
completed_at: null
pr_url: null
depends_on: [F7-S06]
blocks: [F7-S09]
labels: []
source_docs:
  - docs/01-prd-produto.md
  - docs/05-modulos-funcionais.md
  - docs/19-runbook-go-live.md
---

# F7-S08 — Treinamento dos agentes + material

## Objetivo

Garantir que os agentes humanos do Banco do Povo conseguem operar o sistema no D0 — sem este preparo, a melhor stack do mundo trava no primeiro atendimento real.

## Escopo

- Material em `docs/treinamento/`:
  - `01-visao-geral-agente.md` — o que muda do Notion para o Elemento (1 página)
  - `02-fluxo-pre-atendimento.md` — como ler o que a IA fez, intervir, fazer handoff
  - `03-kanban-na-pratica.md` — mover cards, registrar outcomes, ver histórico
  - `04-simulador-e-analise.md` — gerar simulação manual, criar análise, decidir
  - `05-faq-erros-comuns.md` — top 20 erros e como sair
- 3 sessões de treinamento online (Zoom/Meet) gravadas:
  - Sessão 1: visão geral + login + perfil + 2FA (1h)
  - Sessão 2: CRM + Kanban + simulador (1h30)
  - Sessão 3: análise de crédito + handoff + casos edge (1h)
- Vídeos hospedados em pasta compartilhada (Drive/Vimeo — definir com cliente)
- Quiz curto (Google Forms) após cada sessão para confirmar entendimento
- Lista de participantes com presença → critério: 100% dos agentes ativos treinados antes do D0

## Fora de escopo

- Suporte permanente pós-launch (slot operacional)
- Treinamento de gestores admin (sessão separada conduzida pelo Rogério)

## Arquivos permitidos

```
docs/treinamento/01-visao-geral-agente.md
docs/treinamento/02-fluxo-pre-atendimento.md
docs/treinamento/03-kanban-na-pratica.md
docs/treinamento/04-simulador-e-analise.md
docs/treinamento/05-faq-erros-comuns.md
docs/treinamento/_assets/
docs/treinamento/README.md
docs/00-visao-geral.md
```

## Definition of Done

- [ ] 5 documentos escritos com screenshots
- [ ] 3 sessões agendadas e realizadas
- [ ] Gravações disponibilizadas
- [ ] Quiz aplicado e respostas avaliadas
- [ ] 100% dos agentes ativos treinados (lista nominal anexa ao PR)
- [ ] Doc 00 atualizado com referência à pasta `treinamento/`

## Validação

```powershell
test-path docs/treinamento/01-visao-geral-agente.md
test-path docs/treinamento/05-faq-erros-comuns.md
test-path docs/treinamento/README.md
```
