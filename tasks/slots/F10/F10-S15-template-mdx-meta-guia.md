---
id: F10-S15
title: Template MDX canônico + meta-guia "Como escrever uma página de ajuda"
phase: F10
task_ref: docs/20-central-de-ajuda.md#10
status: done
priority: low
estimated_size: S
agent_id: null
claimed_at: 2026-06-09T13:01:52Z
completed_at: 2026-06-09T13:09:27Z
pr_url: https://github.com/Rogerio-auto/System-BP/pull/200
depends_on: [F10-S14]
blocks: []
source_docs:
  - docs/20-central-de-ajuda.md#5
  - docs/20-central-de-ajuda.md#6
  - docs/20-central-de-ajuda.md#10
  - docs/20-central-de-ajuda.md#14
docs_required: true
docs_audience:
  - dev
docs_artifacts:
  - docs/help/_template.mdx
  - docs/help/conceitos/como-escrever-uma-pagina.mdx
---

# F10-S15 — Template MDX + meta-guia

## Objetivo

Encerrar F10 com a parte editorial: um template canônico `docs/help/_template.mdx` (referenciado pelos agentes em F10-S14) + uma meta-página de Conceitos explicando "como escrever uma página de ajuda" que se torna a referência viva para humanos e IA. Após este slot, qualquer slot futuro com `docs_required: true` parte de um molde testado.

## Contexto

A norma §10 cita explicitamente o template MDX e o meta-guia. Os 17 guias entregues em F10-S07/S08 e os 3 conceitos de S05 estabeleceram convenções de fato — agora codificamos. O template já tem todas as decisões cristalizadas: frontmatter padrão, abertura, `<Step>`, "Erros comuns", "Veja também", `<FeedbackWidget />` automático pelo DocLayout (F10-S13), vocabulário canônico §14.

Este é o primeiro slot da Central de Ajuda com `docs_required: true` no próprio slot — o agente vai sentir a regra ao tentar fechar. Caminho perfeito para validar S14 ao mesmo tempo.

## Escopo (faz)

### `docs/help/_template.mdx`

Arquivo canônico de referência. Não é renderizado em `/ajuda/_template` — começa com `_` (underscore) e o manifest builder pula arquivos `_*` (precisa adicionar essa regra ao manifest? **Verificar primeiro**; se já pula, OK; se não, este slot **NÃO** mexe em `manifest.ts` — em vez disso, frontmatter `draft: true` + uma assertion no test que pula renders draft).

Conteúdo do template (~120 linhas):

- Bloco `<!-- meta: leia primeiro -->` no topo apontando para `docs/help/conceitos/como-escrever-uma-pagina.mdx`.
- Frontmatter exemplar com todos os campos (`title`, `description`, `order`, `keywords`).
- Estrutura da página:
  1. **Abertura (1-2 frases)** — "Use este guia quando…"
  2. **Pré-requisitos** em `<Callout type="info">` (opcional)
  3. **Passos** com `<Step number={1}>` … `<Step number={N}>`
  4. **Erros comuns** (h2) com causa + correção
  5. **Veja também** com 2-3 links relativos `/ajuda/...`
  6. (FeedbackWidget é injetado pelo DocLayout — **não** incluir inline)
- Cada bloco com comentário explicando convenção (vocabulário §14 proibido, sem PII real, callouts permitidos: `info`/`tip`/`warn`/`danger` apenas).

### `docs/help/conceitos/como-escrever-uma-pagina.mdx`

Página renderizada em `/ajuda/conceitos/como-escrever-uma-pagina`. Audiência: dev/autor. ~400 palavras.

Estrutura:

- Abertura: "Toda página da Central nasce de um molde — e esse molde existe por boas razões. Veja por quê."
- **Os 5 princípios** (h2):
  1. Resposta em <500 palavras. Não livro. Não whitepaper.
  2. Tom ClickUp Help: direto. "Você vai…" > "O usuário deverá proceder a…".
  3. Vocabulário canônico (norma §14). Sem "feature flag", "RBAC", "UUID", "outbox", "idempotência" no corpo. Com "módulo liberado", "papel", "régua", "job".
  4. Zero PII. Personas fictícias (Ana Paula, Carlos Eduardo, norma §12). Mascarar com `***` se reproduzir UI real.
  5. Cross-links sempre por URL relativa `/ajuda/...`, nunca path de arquivo.
- **Estrutura padrão** (h2): cita o template + breve explicação de cada bloco (abertura, pré-req, steps, erros comuns, veja também).
- **Componentes MDX** (h2): tabela curta com `<Callout>`, `<Step>`, `<CodeBlock>`, `<EndpointCard>`, `<Permission>`, `<FeedbackWidget>` (automático). Link para norma §6.
- **Como criar uma página** (h2):
  - `<Step number={1}>` copiar template
  - `<Step number={2}>` adaptar frontmatter
  - `<Step number={3}>` escrever conteúdo nas seções
  - `<Step number={4}>` rodar `pnpm --filter @elemento/web dev` e navegar para validar
  - `<Step number={5}>` adicionar `docs_artifacts` no frontmatter do slot
- **Veja também:** `docs/20-central-de-ajuda.md` (norma), `docs/18-design-system.md` (DS), `docs/17-lgpd-protecao-dados.md` (LGPD), `comecar/` (exemplos práticos).

### Manifest: pular templates

- Verificar se o manifest builder em `apps/web/src/features/help/manifest.ts` ignora arquivos que começam com `_`. Se **não** ignora, este slot precisa adicionar essa regra — mas isso violaria `files_forbidden` (manifest está em "qualquer outro arquivo em features/help/" no padrão de slots de F10). Alternativa preferida: frontmatter `draft: true` e ajuste no manifest builder via slot futuro.

**Decisão deste slot:** o template usa `draft: true` no frontmatter. Manifest **continua** indexando, mas testes em F10-S05+ já valem como verificação de não-regressão. Como o slug é `_template` (com underscore), navegação direta funciona mas não há link no nav (manifest agrupa por primeira parte; `_template` vira top-level singleton sem section). Aceitar isso por enquanto; refactor de section-index futuro pode formalizar.

### Atualização do meta-guia em `comecar/agente.mdx` ou similar?

- **Não.** O meta-guia é para autor (dev), não operador. Cross-link só na home se fizer sentido — mas a home (S05) é para todos os usuários; não poluir.
- Adicionar referência cruzada na seção "Conceitos" implicitamente: o manifest filesystem-driven já lista todos os conceitos no nav, incluindo o novo.

### Testes

- `apps/web/src/features/help/__tests__/manifest.test.ts`:
  - Assertion: `como-escrever-uma-pagina` resolve via `getArticleBySlug('conceitos/como-escrever-uma-pagina')`.
  - Assertion: `_template` é resolvível (não renderizado em nav mas existe para `getArticleBySlug('_template')` retornar não-nulo? Aqui depende: se quiser que `_template` esteja oculto até do search, frontmatter `keywords: []` + `draft: true` é suficiente).
- `apps/web/src/features/help/__tests__/search.test.ts`:
  - Busca por "como escrever" devolve o meta-guia no top-3.
  - Busca por "template" **não** retorna `_template` (frontmatter sem `keywords` relevantes).

## Fora de escopo (NÃO faz)

- Mexer em `manifest.ts` para esconder drafts/templates (refactor futuro).
- Mexer no DocLayout para esconder `_template` no nav (mesma justificativa).
- Reescrever conceitos existentes (S05) ou guias (S07/S08).
- Adicionar i18n ou template em outros idiomas.
- Criar tutorial guiado (F11).
- Criar variação do template por tipo de slot (refactor/migration/etc.).
- Lint que valida formato do MDX contra o template — slot futuro de hardening.

## Arquivos permitidos (`files_allowed`)

- `docs/help/_template.mdx` (criar)
- `docs/help/conceitos/como-escrever-uma-pagina.mdx` (criar)
- `apps/web/src/features/help/__tests__/manifest.test.ts` (atualizar)
- `apps/web/src/features/help/__tests__/search.test.ts` (atualizar)
- `tasks/slots/F10/F10-S15-template-mdx-meta-guia.md`

## Arquivos proibidos (`files_forbidden`)

- `apps/web/src/features/help/manifest.ts`
- `apps/web/src/features/help/DocLayout.tsx`, `DocPage.tsx`, `HelpNav.tsx`
- `apps/web/src/features/help/mdx-components/**`
- `docs/help/index.mdx`
- `docs/help/comecar/**`, `docs/help/guias/**`
- `docs/help/conceitos/papeis-e-cidades.mdx`, `docs/help/conceitos/lgpd.mdx`, `docs/help/conceitos/modulos-liberados.mdx`
- `docs/20-central-de-ajuda.md` (norma é imutável aqui — só consulta)
- `apps/api/**`, `apps/langgraph-service/**`, `packages/**`
- `tasks/STATUS.md`

## Contratos de entrada

- F10-S14 entregue: regra `docs_required` enforced por `slot.py finish`.
- F10-S13 entregue: `<FeedbackWidget />` injetado pelo DocLayout (template assume isso).
- Conceitos e guias da Central como referência viva.

## Contratos de saída

- `/ajuda/conceitos/como-escrever-uma-pagina` renderiza.
- `docs/help/_template.mdx` existe com toda a estrutura padrão documentada.
- Busca por "como escrever" devolve o meta-guia.
- Agentes de S14 podem citar `docs/help/_template.mdx` como referência canônica.
- Este slot fecha com `slot.py finish` validando que os 2 artefatos existem (smoke real da regra de S14).

## Definition of Done

- [ ] `_template.mdx` cobre todos os blocos do molde padrão
- [ ] Meta-guia cobre os 5 princípios + como criar uma página
- [ ] `pnpm --filter @elemento/web typecheck` verde
- [ ] `pnpm --filter @elemento/web lint` verde
- [ ] `pnpm --filter @elemento/web test` verde com asserts novos
- [ ] `pnpm --filter @elemento/web build` verde
- [ ] `python scripts/slot.py finish F10-S15` **passa** porque os 2 docs_artifacts existem (validação de S14 funcionando)
- [ ] Manual: navegar `/ajuda/conceitos/como-escrever-uma-pagina`, confirmar TOC + busca + render

## Comandos de validação

```powershell
pnpm --filter @elemento/web typecheck
pnpm --filter @elemento/web lint
pnpm --filter @elemento/web test
pnpm --filter @elemento/web build
```

## Notas para o agente

- **Tom:** o meta-guia é para autor — pode ser mais técnico que os guias do operador. Mas ainda direto. "Escreva 3 parágrafos, não 30" > "convém o autor exercer parcimônia textual".
- **`_template.mdx`:** comentários `{/* ... */}` (sintaxe MDX) explicando cada decisão. Quem copiar o template lê os comentários antes de apagá-los.
- **Não duplique a norma.** O meta-guia **resume** + **aplica**; a norma 20 é a fonte. Sempre linkar para a §correspondente.
- **Vocabulário §14:** o meta-guia é o lugar para listar a lista proibida com exemplos. Operador não lê, mas o autor sim.
- **FeedbackWidget:** o template documenta que é **automático** pelo DocLayout, **não incluir inline** — esse é um dos erros mais prováveis do autor iniciante.
- **Validação de S14:** ao tentar `slot.py finish F10-S15`, a regra recém-aprovada vai verificar que `docs_artifacts` apontam para os 2 arquivos. Se você ainda não criou, recusa. É um teste de fogo do S14 — proposital.
- **Cross-links:** sempre URL relativa `/ajuda/...`. O autor que copiar o template tende a usar caminhos de arquivo (`/docs/help/...`); o template deve mostrar o jeito certo no exemplo.
- **Não adicione PII real** em nenhum exemplo. Cada exemplo usa personas fictícias da norma §12.
- **Frontmatter do \_template.mdx:** `title: "Template — copie e edite"`, `description: "Molde canônico para páginas da Central de Ajuda"`, `draft: true`. Sem `keywords` para não poluir a busca.
