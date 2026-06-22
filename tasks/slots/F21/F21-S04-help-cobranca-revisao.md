---
id: F21-S04
title: Ajuda — revisar e enriquecer guias de Cobrança, SPC e Advocacia
phase: F21
task_ref: docs/20-central-de-ajuda.md#10
status: in-progress
priority: low
estimated_size: M
agent_id: null
claimed_at: 2026-06-22T16:43:28Z
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
  - docs/help/guias/cobranca/tarefas-notificacoes.mdx
  - docs/help/guias/cobranca/dashboard-cobranca.mdx
  - docs/help/guias/cobranca/configurar-reguas.mdx
  - docs/help/guias/advocacia/cadastro-escritorios.mdx
  - docs/help/guias/advocacia/encaminhar-cliente.mdx
---

# F21-S04 — Ajuda: Cobrança, SPC e Advocacia (revisão de accuracy)

## Objetivo

Revisar os guias de Cobrança (incl. painel de tarefas e ciclo de SPC) e Advocacia para garantir precisão vs. a UI atual. A análise de lacunas (2026-06-22) **não encontrou lacuna de cobertura** — o foco é accuracy e enriquecimento, não artigo novo.

## Contexto

`guias/cobranca/` cobre painel de tarefas (`/tarefas`: tipos SPC/Recuperação/Manual, assumir/concluir, notificações), dashboard de cobrança (segmentos + ciclo SPC: Sem SPC → Solicitar inclusão → Pendente → Incluído → Removido), réguas (D-3/D+1/D+15), anexar boleto, cobrança com boleto, registrar parcelas, monitorar jobs. `guias/advocacia/` cobre cadastro de escritórios e encaminhamento manual de cliente (com cooldown). Tudo já documentado — confirme accuracy.

## Escopo (faz)

- **Revisar accuracy** contra a UI real (rótulos, segmentos do dashboard, estados do SPC, ações, permissões, cooldown de advocacia):
  - `docs/help/guias/cobranca/tarefas-notificacoes.mdx`
  - `docs/help/guias/cobranca/dashboard-cobranca.mdx`
  - `docs/help/guias/cobranca/configurar-reguas.mdx`
  - `docs/help/guias/cobranca/anexar-boleto.mdx`
  - `docs/help/guias/cobranca/anexar-boleto-ui.mdx`
  - `docs/help/guias/cobranca/cobranca-com-boleto.mdx`
  - `docs/help/guias/cobranca/registrar-parcelas.mdx`
  - `docs/help/guias/cobranca/monitorar-jobs.mdx`
  - `docs/help/guias/advocacia/cadastro-escritorios.mdx`
  - `docs/help/guias/advocacia/encaminhar-cliente.mdx`
- Corrigir informação defasada, links `/ajuda/...` quebrados; reforçar "Erros comuns" / "Veja também".
- Conferir consistência com glossário §14 (Régua, Job, Escopo de cidade) e que o SPC está descrito como ação manual do operador (Serasa fora do sistema).

## Fora de escopo (NÃO faz)

- Criar artigos novos (não há lacuna).
- Tocar artigos fora de `guias/cobranca/` e `guias/advocacia/`.
- Mexer em código (`apps/**`, `packages/**`).

## Arquivos permitidos

- `docs/help/guias/cobranca/**` (os 8 artigos)
- `docs/help/guias/advocacia/**` (os 2 artigos)
- `tasks/slots/F21/F21-S04-help-cobranca-revisao.md`

## Arquivos proibidos

- `docs/help/guias/analise/**` (dono: F21-S01)
- `docs/help/guias/livechat/**` (dono: F21-S02)
- `docs/help/guias/contratos/**`, `docs/help/guias/crm/**` (dono: F21-S03)
- `apps/**`, `packages/**`
- `tasks/STATUS.md`

## Contratos de entrada

- Artigos existentes em `guias/cobranca/` e `guias/advocacia/`; features F15/F19 (tarefas, SPC, advocacia).

## Contratos de saída

- Guias de cobrança/SPC/advocacia precisos vs. UI atual, com cross-links e erros comuns reforçados.

## Definition of Done

- [ ] 10 artigos revisados e corrigidos contra a UI real
- [ ] MDX válido (sem `{#anchor}`, sem `{{...}}`, sem `{`/`}` cru)
- [ ] Glossário §14, sem PII, personas fictícias; SPC descrito como ação manual (Serasa externo)
- [ ] `<FeedbackWidget />` NÃO inline
- [ ] Validação MDX verde

## Comandos de validação

```powershell
pnpm install --frozen-lockfile
pnpm --filter @elemento/web exec vitest run src/features/help
```

## Notas para o agente

- **LEIA PRIMEIRO:** `docs/20-central-de-ajuda.md` (§6, §14) e `docs/help/_template.mdx`.
- Verifique a UI real com Glob/Grep: páginas/components de cobrança e tarefas em `apps/web/src/` (ex.: `Grep -n "tarefas" apps/web/src/App.tsx` para achar a rota, depois os components; `Glob apps/web/src/features/**/*collection*` / `**/*cobranca*` / `**/*spc*`). Documente o que está na tela.
- Slot é só `.mdx`. Worktree sem `node_modules` → `pnpm install --frozen-lockfile` antes de validar.
- Accuracy, não reescrita. Artigo já correto → registre "revisado, OK" no commit.
- Fluxo canônico: `brief` → `claim` → editar → validar → `git add`+`commit` → `finish` → `push origin feat/f21-s04` → `git log --stat`.
