---
id: F21-S02
title: Ajuda — revisar e enriquecer guias de Live Chat e Agente de IA
phase: F21
task_ref: docs/20-central-de-ajuda.md#10
status: done
priority: medium
estimated_size: M
agent_id: null
claimed_at: 2026-06-22T16:43:06Z
completed_at: 2026-06-22T16:51:54Z
pr_url: https://github.com/Rogerio-auto/System-BP/pull/344
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
  - docs/help/guias/livechat/agente-ia.mdx
  - docs/help/guias/livechat/caixa-de-entrada.mdx
  - docs/help/guias/livechat/responder-conversa.mdx
  - docs/help/guias/livechat/handoff-ia-humano.mdx
---
# F21-S02 — Ajuda: Live Chat + Agente de IA (revisão + tempo real / contexto da Ana Clara)

## Objetivo

Revisar os 8 guias de Live Chat para refletir a UI atual e **preencher a lacuna menor**: o comportamento em **tempo real** das respostas do agente de IA (outbound realtime, F16-S51 / commit `d06b045b`) e o fato de a Ana Clara manter **contexto/histórico** da conversa.

## Contexto

`guias/livechat/` tem 8 artigos (conectar-canal, caixa-de-entrada, responder-conversa, vinculo-automatico-crm, criar-lead-do-contato, agente-ia, tempo-real-e-leitura, handoff-ia-humano). A análise de lacunas (2026-06-22) confirmou cobertura ampla, com **uma lacuna**: nenhum artigo explica que as respostas do **agente de IA** aparecem ao vivo no painel (o `sendMessage` passou a emitir `message:new` também para mensagens OUTBOUND em F16-S51), nem que a Ana Clara lê o histórico da conversa para responder com coerência.

## Escopo (faz)

- **Revisar accuracy** dos 8 artigos de `guias/livechat/` contra a UI/worker reais (rótulos, botões, fluxo, permissões, allowlist de números, janela de 24h).
- **Preencher a lacuna** (escolha o melhor encaixe, sem duplicar o que já existe em `handoff-ia-humano.mdx` e `tempo-real-e-leitura.mdx`):
  - Em `agente-ia.mdx`: adicionar seção "Comportamento em tempo real e contexto da Ana Clara" — respostas do agente surgem ao vivo no painel; o agente considera o histórico recente da conversa; o que o operador vê enquanto a IA responde.
  - Ajustar cross-links entre `agente-ia.mdx`, `handoff-ia-humano.mdx` e `tempo-real-e-leitura.mdx` para "Veja também".
- Corrigir informação defasada (rótulos, passos inexistentes, links `/ajuda/...` quebrados).

## Fora de escopo (NÃO faz)

- Tocar artigos fora de `guias/livechat/`.
- Mexer em código (`apps/**`, `packages/**`).
- Reescrever os artigos do zero — enriqueça e corrija, preservando estilo/frontmatter.

## Arquivos permitidos

- `docs/help/guias/livechat/**` (os 8 artigos)
- `tasks/slots/F21/F21-S02-help-livechat-revisao.md`

## Arquivos proibidos

- `docs/help/guias/analise/**` (dono: F21-S01)
- `docs/help/guias/contratos/**`, `docs/help/guias/crm/**` (dono: F21-S03)
- `docs/help/guias/cobranca/**`, `docs/help/guias/advocacia/**` (dono: F21-S04)
- `apps/**`, `packages/**`
- `tasks/STATUS.md`

## Contratos de entrada

- Artigos existentes em `guias/livechat/`; features F16 (inbox realtime, agente Ana Clara, handoff, outbound realtime S51).

## Contratos de saída

- 8 guias de Live Chat precisos; comportamento em tempo real + contexto da Ana Clara documentado.

## Definition of Done

- [ ] 8 artigos revisados e corrigidos contra a UI/worker real
- [ ] Seção de tempo real + contexto adicionada (sem duplicar handoff / tempo-real-e-leitura)
- [ ] MDX válido (sem `{#anchor}`, sem `{{...}}`, sem `{`/`}` cru)
- [ ] Glossário §14, sem PII, personas fictícias; sem termos proibidos na voz do operador ("LangGraph", "outbox", "feature flag")
- [ ] `<FeedbackWidget />` NÃO inline
- [ ] Validação MDX verde

## Comandos de validação

```powershell
pnpm install --frozen-lockfile
pnpm --filter @elemento/web exec vitest run src/features/help
```

## Notas para o agente

- **LEIA PRIMEIRO:** `docs/20-central-de-ajuda.md` (§6, §12, §14) e `docs/help/_template.mdx`.
- Para verificar o comportamento real, inspecione (Read/Grep): `apps/web/src/features/conversations/**` (painel do chat), `apps/api/src/workers/livechat-ai.ts` (worker que aciona o agente) e o serviço que emite `message:new` para OUTBOUND (`grep -rn "message:new" apps/api/src`). Use Glob para achar os caminhos exatos.
- **Linguagem de produto:** o operador não precisa saber "LangGraph", "WebSocket", "evento outbound". Diga "as respostas da Ana Clara aparecem na hora no painel" e "ela considera o que já foi conversado".
- Worktree sem `node_modules` → `pnpm install --frozen-lockfile` antes de validar.
- Fluxo canônico: `brief` → `claim` → editar → validar → `git add`+`commit` → `finish` → `push origin feat/f21-s02` → `git log --stat`.
