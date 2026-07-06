---
id: F6-S11
title: Docs — Central de Ajuda do copiloto interno (perguntar sobre seus dados / RBAC)
phase: F6
task_ref: docs/22-agente-interno-acoes.md
status: available
priority: medium
estimated_size: S
agent_id: null
depends_on: [F6-S09]
blocks: []
labels: [docs, help-center, ai-assistant]
source_docs: [docs/22-agente-interno-acoes.md, docs/20-central-de-ajuda.md]
docs_required: true
docs_artifacts:
  [
    docs/help/guias/assistente/perguntar-sobre-seus-dados.mdx,
    docs/help/guias/assistente/o-que-o-copiloto-ve.mdx,
  ]
---

# F6-S11 — Docs: copiloto interno (Central de Ajuda)

## Objetivo

Documentar para o usuário final o copiloto interno e — o ponto central — que ele **respeita as
permissões e o escopo de cidade** de quem pergunta (doc 22 §13).

## Escopo (faz)

- **Criar** `docs/help/guias/assistente/perguntar-sobre-seus-dados.mdx` (audience
  `[operador, gestor, admin]`): como usar o copiloto, exemplos de perguntas, e o aviso de que você
  só recebe o que já pode ver. `<Permission name="ai_assistant:use" />`.
- **Criar** `docs/help/guias/assistente/o-que-o-copiloto-ve.mdx` (audience `[gestor, admin]`):
  o modelo de RBAC do copiloto (§12.2/§12.6), por que respostas variam por role/cidade, e que ele
  não decide crédito nem escreve no funil.
- Garantir que a nova seção "Assistente" apareça no manifest (frontmatter `order` coerente);
  atualizar `docs/help/conceitos/papeis-e-cidades.mdx` mencionando `ai_assistant:use` (se ainda não
  feito por F25-S09).

## Fora de escopo (NÃO faz)

- Artigos da superfície A (F25-S09).
- Qualquer código.

## Arquivos permitidos

- `docs/help/guias/assistente/perguntar-sobre-seus-dados.mdx`
- `docs/help/guias/assistente/o-que-o-copiloto-ve.mdx`
- `docs/help/conceitos/papeis-e-cidades.mdx`

## Arquivos proibidos

- Qualquer `.ts`/`.py`/`.tsx`

## Definition of Done

- [ ] 2 artigos novos, frontmatter válido (title ≤60, description, order, keywords, audience)
- [ ] `<Callout type="warn">` no limite (não decide crédito; não escreve; só o que você pode ver)
- [ ] `<RelatedArticles>` linkando o agente de IA
- [ ] MDX válido — `manifest.test` do web verde; slugs kebab-case ASCII

## Validação

```powershell
pnpm --filter @elemento/web test -- manifest
python scripts/slot.py validate F6-S11
```

## Notas para o agente

- Seguir `docs/help/_template.mdx` e a norma do doc 20. MDX inválido quebra o manifest.test do web.
- O recado central, em linguagem simples: "o copiloto respeita suas permissões e sua cidade".
