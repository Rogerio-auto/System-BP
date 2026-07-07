---
id: F25-S09
title: Docs — Central de Ajuda: ações do agente no funil + revisar/reverter
phase: F25
task_ref: docs/22-agente-interno-acoes.md
status: available
priority: medium
estimated_size: S
agent_id: null
depends_on: [F25-S07]
blocks: []
labels: [docs, help-center, ai-agent]
source_docs: [docs/22-agente-interno-acoes.md, docs/20-central-de-ajuda.md]
docs_required: true
docs_artifacts:
  [docs/help/guias/livechat/acoes-do-agente-no-funil.mdx, docs/help/guias/livechat/revisar-e-reverter-acoes-da-ia.mdx]

---

# F25-S09 — Docs: ações do agente no funil (Central de Ajuda)

## Objetivo

Atualizar a ajuda no ar (doc 22 §13) para os usuários entenderem o que a IA passou a fazer no
funil e como revisar/reverter — respeitando o processo "doc como DoD" (doc 20 §10).

## Escopo (faz)

- **Atualizar** `docs/help/guias/livechat/agente-ia.mdx`: a Ana Clara agora qualifica e atualiza o
  Kanban; o limite (não decide crédito).
- **Criar** `docs/help/guias/livechat/acoes-do-agente-no-funil.mdx` (audience `[operador, gestor]`):
  tabela simplificada da fronteira (§4), como qualificação/abandono aparecem no card, aviso de que
  a IA não manda mensagem sozinha (§7.1). `order: 70`.
- **Criar** `docs/help/guias/livechat/revisar-e-reverter-acoes-da-ia.mdx` (audience `[gestor, admin]`):
  painel "IA nas últimas 24h" e reversão em 1 clique. `<Permission name="ai_actions:read" />` +
  `<Permission name="ai_actions:revert" />`. `order: 80`.
- **Atualizar** `docs/help/conceitos/modulos-liberados.mdx` (flag `internal_assistant.actions.enabled`)
  e `docs/help/conceitos/papeis-e-cidades.mdx` (permissões `ai_actions:*`).

## Fora de escopo (NÃO faz)

- Artigos do copiloto interno (F6, superfície B).
- Qualquer código.

## Arquivos permitidos

- `docs/help/guias/livechat/agente-ia.mdx`
- `docs/help/guias/livechat/acoes-do-agente-no-funil.mdx`
- `docs/help/guias/livechat/revisar-e-reverter-acoes-da-ia.mdx`
- `docs/help/conceitos/modulos-liberados.mdx`
- `docs/help/conceitos/papeis-e-cidades.mdx`

## Arquivos proibidos

- Qualquer `.ts`/`.py`/`.tsx`

## Definition of Done

- [ ] 2 artigos novos + 3 atualizados, frontmatter válido (title ≤60, description, order, keywords, audience)
- [ ] `<Callout type="warn">` no limite (não aprova crédito; não envia outbound)
- [ ] `<RelatedArticles>` linkando `agente-ia` e `handoff-ia-humano`
- [ ] MDX válido — `pnpm --filter @elemento/web test` (manifest.test) verde
- [ ] Slugs kebab-case ASCII

## Validação

```powershell
pnpm --filter @elemento/web test -- manifest
python scripts/slot.py validate F25-S09
```

## Notas para o agente

- Seguir `docs/help/_template.mdx` e a norma do doc 20. MDX inválido quebra o manifest.test do web.
- Escrever para o usuário final (operador/gestor), não em jargão técnico.
