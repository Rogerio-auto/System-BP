---
id: F1-S18
title: Frontend importação — wizard 4 passos
phase: F1
task_ref: T1.18
status: blocked
priority: medium
estimated_size: L
agent_id: null
claimed_at: null
completed_at: null
pr_url: null
depends_on: [F1-S17]
blocks: []
source_docs:
  - docs/08-importacoes.md
  - docs/12-tasks-tecnicas.md#T1.18
  - docs/18-design-system.md
  - docs/design-system/index.html
---

# F1-S18 — UI importação

## Objetivo

Wizard `/imports/leads/new` com 4 passos: upload, mapping, preview, confirm. UX segue `docs/08-importacoes.md`. Padrão visual segue `docs/18-design-system.md`.

## Escopo

- Stepper horizontal no topo: 4 nós com label em caption-style, conectados por linha. Nó atual em `--brand-azul` (sólido + glow azul), passados em `--brand-verde` com check, futuros em `--border-strong`.
- Passo 1 (upload): drop zone com `border-dashed` 2px `--border-strong`, hover `--brand-azul` + bg `--surface-hover`, ícone grande de upload, microcopy clara. Ao arrastar arquivo: borda `--brand-verde` + Spotlight.
- Passo 2 (mapping): tabela com colunas do arquivo à esquerda e select de destino à direita. `Select` do DS. Preview de 3 linhas em sub-tabela densa abaixo de cada mapping.
- Passo 3 (preview): `stats` row mostrando totais (linhas válidas / com erro / duplicadas). Tabela do DS com badge de status por linha (success/warning/danger).
- Passo 4 (confirm): card de resumo com `--elev-3` + botão primário `lg` 100% width.
- Navegação entre passos: botões `outline` (voltar) + `primary` (avançar) no rodapé sticky.
- Estado em URL (search params) — recarregar a página mantém o passo + dados em memória.

## Definition of Done

- [ ] UX seguindo `docs/08-importacoes.md`
- [ ] Stepper visual seguindo `docs/18-design-system.md` (cores da bandeira, glow no atual)
- [ ] Estado preservado entre passos (URL state)
- [ ] Drop zone tem feedback visual ao arrastar (Spotlight + borda verde)
- [ ] Funciona em ambos os temas
- [ ] PR com recording (upload → mapping → preview → confirm)
