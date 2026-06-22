---
id: F21-S03
title: Ajuda — revisar e enriquecer guias de Contratos e Boletos
phase: F21
task_ref: docs/20-central-de-ajuda.md#10
status: review
priority: low
estimated_size: S
agent_id: null
claimed_at: 2026-06-22T16:43:19Z
completed_at: 2026-06-22T16:51:31Z
pr_url: null
depends_on: []
blocks: []
source_docs:
  - docs/20-central-de-ajuda.md
  - docs/18-design-system.md
docs_required: true
docs_audience:
  - operador
  - gestor
docs_artifacts:
  - docs/help/guias/contratos/aba-contratos.mdx
  - docs/help/guias/contratos/criar-contrato.mdx
  - docs/help/guias/contratos/ficha-contrato-boletos.mdx
  - docs/help/guias/contratos/saude-de-boletos.mdx
  - docs/help/guias/contratos/winback.mdx
---

# F21-S03 — Ajuda: Contratos e Boletos (revisão de accuracy)

## Objetivo

Revisar os guias de Contratos & Boletos para garantir que descrevem a UI atual com precisão. A análise de lacunas (2026-06-22) **não encontrou lacuna de cobertura** nesta área — o foco aqui é accuracy e enriquecimento (clareza, cross-links, erros comuns), não criação de artigo novo.

## Contexto

`guias/contratos/` cobre ciclo de vida do contrato (rascunho → assinado → ativo → liquidado/inadimplente), aba Contratos, boletos (anexar, visualizar, URL/linha digitável/PIX), saúde de boletos e win-back. Há também `guias/crm/ficha-cliente-contratos.mdx` (visão consolidada do cliente: contratos, parcelas, SPC) que pertence a este slot por afinidade de tema.

## Escopo (faz)

- **Revisar accuracy** contra a UI real (rótulos, status, indicadores de saúde, botões, permissões):
  - `docs/help/guias/contratos/aba-contratos.mdx`
  - `docs/help/guias/contratos/criar-contrato.mdx`
  - `docs/help/guias/contratos/ficha-contrato-boletos.mdx`
  - `docs/help/guias/contratos/saude-de-boletos.mdx`
  - `docs/help/guias/contratos/winback.mdx`
  - `docs/help/guias/crm/ficha-cliente-contratos.mdx`
- Corrigir informação defasada, links `/ajuda/...` quebrados, e melhorar seções "Erros comuns" / "Veja também" onde estiverem fracas.
- Conferir consistência de terminologia com o glossário §14 (Contrato, Cliente, Análise de crédito, Régua, Job).

## Fora de escopo (NÃO faz)

- Criar artigos novos (não há lacuna).
- Tocar artigos fora de `guias/contratos/` e do único arquivo `guias/crm/ficha-cliente-contratos.mdx`.
- Mexer em código (`apps/**`, `packages/**`).

## Arquivos permitidos

- `docs/help/guias/contratos/aba-contratos.mdx`
- `docs/help/guias/contratos/criar-contrato.mdx`
- `docs/help/guias/contratos/ficha-contrato-boletos.mdx`
- `docs/help/guias/contratos/saude-de-boletos.mdx`
- `docs/help/guias/contratos/winback.mdx`
- `docs/help/guias/crm/ficha-cliente-contratos.mdx`
- `tasks/slots/F21/F21-S03-help-contratos-revisao.md`

## Arquivos proibidos

- `docs/help/guias/analise/**` (dono: F21-S01)
- `docs/help/guias/livechat/**` (dono: F21-S02)
- `docs/help/guias/cobranca/**`, `docs/help/guias/advocacia/**` (dono: F21-S04)
- Qualquer outro `docs/help/guias/crm/*.mdx` que NÃO seja `ficha-cliente-contratos.mdx`
- `apps/**`, `packages/**`
- `tasks/STATUS.md`

## Contratos de entrada

- Artigos existentes em `guias/contratos/` + `guias/crm/ficha-cliente-contratos.mdx`.

## Contratos de saída

- Guias de contratos/boletos precisos vs. UI atual, com cross-links e erros comuns reforçados.

## Definition of Done

- [ ] 6 artigos revisados e corrigidos contra a UI real
- [ ] MDX válido (sem `{#anchor}`, sem `{{...}}`, sem `{`/`}` cru)
- [ ] Glossário §14, sem PII, personas fictícias
- [ ] `<FeedbackWidget />` NÃO inline
- [ ] Validação MDX verde

## Comandos de validação

```powershell
pnpm install --frozen-lockfile
pnpm --filter @elemento/web exec vitest run src/features/help
```

## Notas para o agente

- **LEIA PRIMEIRO:** `docs/20-central-de-ajuda.md` (§6, §14) e `docs/help/_template.mdx`.
- Verifique a UI real com Glob/Grep: procure os componentes de contratos/boletos em `apps/web/src/features/` (ex.: `Glob apps/web/src/features/**/contract*` e `**/*boleto*`). Documente o que está na tela, não o que você imagina.
- Slot é só `.mdx`. Worktree sem `node_modules` → `pnpm install --frozen-lockfile` antes de validar.
- Mude o mínimo: este slot é de accuracy, não de reescrita. Se um artigo já estiver correto, registre no commit que foi revisado e está OK.
- Fluxo canônico: `brief` → `claim` → editar → validar → `git add`+`commit` → `finish` → `push origin feat/f21-s03` → `git log --stat`.
