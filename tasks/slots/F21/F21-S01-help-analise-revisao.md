---
id: F21-S01
title: Ajuda — revisar e enriquecer guias de Análise de crédito
phase: F21
task_ref: docs/20-central-de-ajuda.md#10
status: in-progress
priority: medium
estimated_size: M
agent_id: null
claimed_at: 2026-06-22T16:43:03Z
completed_at: null
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
  - docs/help/guias/analise/criar-analise.mdx
  - docs/help/guias/analise/regras.mdx
  - docs/help/guias/analise/versionar-analise.mdx
---

# F21-S01 — Ajuda: Análise de crédito (revisão + pré-preenchimento pela simulação)

## Objetivo

Revisar os 3 guias de Análise de crédito para garantir que descrevem a UI atual com precisão, e **preencher a lacuna real**: o pré-preenchimento da análise a partir da simulação vinculada (feature do PR #342, ainda não mergeado em `main`).

## Contexto

A Central de Ajuda (norma `docs/20-central-de-ajuda.md`) já tem 3 artigos em `guias/analise/`. A análise de lacunas (sessão 2026-06-22) encontrou **uma lacuna sólida**: nenhum artigo explica que, ao criar uma análise, é possível **vincular uma simulação** e os campos (valor solicitado, prazo, taxa) vêm **pré-preenchidos** a partir dela, com edição manual livre por cima.

Essa feature vive no PR #342 (branch `feat/credit-analysis-prefill-simulacao`), que **não está em `main`**. Como este slot roda em worktree de `origin/main`, o código da feature NÃO estará presente no checkout. Para documentar com precisão, **inspecione o diff da branch** (não copie suposições):

```powershell
git fetch origin
git show origin/feat/credit-analysis-prefill-simulacao -- apps/web/src/features/credit-analyses/components/CreditAnalysisForm.tsx
git show origin/feat/credit-analysis-prefill-simulacao -- apps/web/src/components/comboboxes/SimulationSelect.tsx
```

## Escopo (faz)

- **Revisar accuracy** dos 3 artigos contra a UI real (campos, botões, rótulos, permissões, fluxo):
  - `docs/help/guias/analise/criar-analise.mdx`
  - `docs/help/guias/analise/regras.mdx`
  - `docs/help/guias/analise/versionar-analise.mdx`
- **Preencher a lacuna** em `criar-analise.mdx`: adicionar seção "Pré-preencher pela simulação vinculada" (`<Step>` ou subseção `##`), explicando que selecionar uma simulação do lead popula automaticamente valor/prazo/taxa e que o operador pode ajustar manualmente. Sem expor a taxa percentual ao titular (regra de negócio da Ana Clara não se aplica aqui, mas mantenha linguagem de produto).
- Corrigir qualquer informação defasada que encontrar (rótulos antigos, passos que não existem mais, links quebrados `/ajuda/...`).
- Atualizar `keywords` do frontmatter dos artigos tocados quando fizer sentido (ex.: `simulacao`, `pre-preenchimento`, `vinculo`).

## Fora de escopo (NÃO faz)

- Tocar em qualquer artigo fora de `guias/analise/`.
- Mexer em código (`apps/**`, `packages/**`) — este slot é 100% documentação.
- Criar screenshots novos (opcional; se criar, sem PII, em `docs/help/_assets/`).
- Alterar a feature do PR #342.

## Arquivos permitidos

- `docs/help/guias/analise/criar-analise.mdx`
- `docs/help/guias/analise/regras.mdx`
- `docs/help/guias/analise/versionar-analise.mdx`
- `tasks/slots/F21/F21-S01-help-analise-revisao.md`

## Arquivos proibidos

- `docs/help/guias/livechat/**` (dono: F21-S02)
- `docs/help/guias/contratos/**`, `docs/help/guias/crm/**` (dono: F21-S03)
- `docs/help/guias/cobranca/**`, `docs/help/guias/advocacia/**` (dono: F21-S04)
- `apps/**`, `packages/**`
- `tasks/STATUS.md` (gerado por slot.py)

## Contratos de entrada

- Artigos existentes em `guias/analise/` + feature de pré-preenchimento na branch `feat/credit-analysis-prefill-simulacao`.

## Contratos de saída

- 3 guias de análise precisos vs. UI atual; pré-preenchimento pela simulação documentado em `criar-analise.mdx`.

## Definition of Done

- [ ] 3 artigos revisados e corrigidos contra a UI real
- [ ] Seção de pré-preenchimento pela simulação adicionada a `criar-analise.mdx`
- [ ] MDX válido (sem `{#anchor}`, sem `{{...}}`, sem `{`/`}` cru — só componentes canônicos do §6)
- [ ] Glossário do §14 respeitado; sem PII; personas fictícias (Ana Paula / Carlos Eduardo)
- [ ] `<FeedbackWidget />` NÃO inserido inline (DocLayout injeta)
- [ ] Validação MDX verde (manifest test do help)

## Comandos de validação

```powershell
pnpm install --frozen-lockfile
pnpm --filter @elemento/web exec vitest run src/features/help
```

## Notas para o agente

- **LEIA PRIMEIRO:** `docs/20-central-de-ajuda.md` (§5 naming, §6 componentes, §12 LGPD, §14 glossário) e `docs/help/_template.mdx` (estrutura canônica: abertura → pré-requisitos `<Callout>` → `<Step>` → erros comuns → veja também).
- Você é **frontend-engineer**, mas este slot é só `.mdx`. Não rode typecheck/lint do app — só o teste do help.
- Worktree não tem `node_modules` → rode `pnpm install --frozen-lockfile` antes de validar (senão dá falso-vermelho).
- Preserve o estilo e o frontmatter dos artigos existentes; mude o mínimo necessário fora da lacuna.
- Use `<Permission requires="...">` com a permissão real (confirme no código/artigo existente; não invente chave).
- Siga o fluxo canônico: `slot.py brief F21-S01` → `slot.py claim F21-S01` → editar → validar → `git add` + `git commit` → `slot.py finish F21-S01` → `git push origin feat/f21-s01` → `git log --stat origin/feat/f21-s01`.
