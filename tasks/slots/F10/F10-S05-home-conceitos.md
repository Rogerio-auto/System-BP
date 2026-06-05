---
id: F10-S05
title: Home da Central + 3 conceitos base (papéis, LGPD, módulos liberados)
phase: F10
task_ref: docs/20-central-de-ajuda.md#5
status: available
priority: high
estimated_size: S
agent_id: null
claimed_at: null
completed_at: null
pr_url: null
depends_on: [F10-S02]
blocks: []
source_docs:
  - docs/20-central-de-ajuda.md#5
  - docs/20-central-de-ajuda.md#14
  - docs/10-seguranca-permissoes.md
  - docs/17-lgpd-protecao-dados.md
docs_required: false
docs_audience: []
docs_artifacts: []
---

# F10-S05 — Home da Central + 3 conceitos base

## Objetivo

Substituir o conteúdo placeholder do F10-S02 por uma home de boas-vindas real + os 3 conceitos transversais que todo operador/gestor precisa entender antes de usar o sistema. Linguagem amigável (sem jargão técnico), tom Banco do Povo.

## Contexto

A norma §5 lista 6 conceitos transversais (`rbac`, `escopo-cidade`, `lgpd`, `feature-flags`, `outbox-eventos`, `idempotencia`). Os 3 últimos são de natureza de desenvolvedor (vão para a seção API quando F10-S09+ chegar). Para a Persona A/B (operador + gestor), os 3 imediatamente necessários são:

1. **Papéis e Cidades** — substitui `rbac.mdx` (jargão proibido pela norma §14).
2. **LGPD** — proteção dos dados dos atendidos.
3. **Módulos liberados** — substitui `feature-flags.mdx`.

A página dev-only `docs/help/conceitos/pipeline-mdx.mdx` (smoke test de S01/S02) é removida — sua função volta no F10-S15 como guia de autoria.

## Escopo (faz)

- Reescreve `docs/help/index.mdx` com:
  - Hero curto (Bricolage no h1, body em Geist via MDX provider já configurado).
  - 4 sections com links para as 4 áreas (Começar / Guias / Conceitos / API). Áreas ainda não disponíveis aparecem como "Em breve" sem link.
  - Callout informando o atalho Cmd+K (agora real, S03+S04 entregues).
  - Lista de links diretos para os 3 conceitos novos.
- Cria `docs/help/conceitos/papeis-e-cidades.mdx`:
  - O que é um papel — admin / gestor geral / gestor regional / agente / operador / leitura.
  - Escopo de cidade — por que operador de Porto Velho não vê leads de Vilhena.
  - Cenários comuns.
  - Quem cuida (admin via `/admin/users` + `/admin/agents`).
- Cria `docs/help/conceitos/lgpd.mdx`:
  - O que é LGPD em 1 parágrafo simples.
  - O que o sistema protege automaticamente (CPF cifrado, telefone mascarado em listas, logs sem PII).
  - Direitos do titular — o que esperar quando alguém pede acesso/exclusão.
  - Callout `danger`: o que nunca fazer (print de tela com dados reais, anotação em planilha externa, compartilhar links com PII).
  - A quem reportar dúvidas.
- Cria `docs/help/conceitos/modulos-liberados.mdx`:
  - O que é um módulo (substitui "feature flag" — norma §14).
  - Por que algumas funcionalidades aparecem como "em desenvolvimento".
  - Quem libera (admin via `/admin/feature-flags`).
  - Exemplos atuais (Cobrança, Follow-up, Templates WhatsApp).
- Remove `docs/help/conceitos/pipeline-mdx.mdx`.
- Atualiza `apps/web/src/features/help/__tests__/manifest.test.ts` para asseverar nos novos artigos em vez de `pipeline-mdx`.
- Atualiza `apps/web/src/features/help/__tests__/search.test.ts` para buscar termos pt-BR dos novos artigos.

## Fora de escopo (NÃO faz)

- Conceitos de desenvolvedor (outbox, idempotência) — entram na seção API (F10-S09+).
- Getting started por papel — F10-S06.
- Guias por módulo — F10-S07 + F10-S08.
- Section landing pages (`docs/help/conceitos/index.mdx`) — o manifest atual coloca slug sem `/` como `__top__` e filtra; section index é refactor pra slot futuro.
- "Populares" e ranking — F10-S12 + F10-S13.

## Arquivos permitidos (`files_allowed`)

- `docs/help/index.mdx`
- `docs/help/conceitos/papeis-e-cidades.mdx` (criar)
- `docs/help/conceitos/lgpd.mdx` (criar)
- `docs/help/conceitos/modulos-liberados.mdx` (criar)
- `docs/help/conceitos/pipeline-mdx.mdx` (remover)
- `apps/web/src/features/help/__tests__/manifest.test.ts`
- `apps/web/src/features/help/__tests__/search.test.ts`
- `tasks/slots/F10/F10-S05-home-conceitos.md`

## Arquivos proibidos (`files_forbidden`)

- Qualquer `apps/web/src/features/help/**` que não seja `__tests__/`.
- `apps/api/**`, `apps/langgraph-service/**`, `packages/**`.
- `tasks/STATUS.md`.

## Contratos de entrada

- F10-S02 entregue: `/ajuda` renderiza, manifest filesystem-driven funcional, MDX provider com componentes canônicos.

## Contratos de saída

- `/ajuda` renderiza a home reescrita.
- `/ajuda/conceitos/papeis-e-cidades`, `/lgpd`, `/modulos-liberados` renderizam com nav + TOC funcionais.
- Conceitos aparecem ordenados pela ordem da frontmatter (10, 20, 30).
- Busca por "papéis", "LGPD", "módulos" encontra os artigos certos.
- Nenhum dos 3 conceitos usa "feature flag", "RBAC", "UUID", "outbox" no corpo (cumpre norma §14).

## Definition of Done

- [ ] Código implementado conforme escopo
- [ ] `pnpm --filter @elemento/web typecheck` verde
- [ ] `pnpm --filter @elemento/web lint` verde
- [ ] `pnpm --filter @elemento/web test` verde
- [ ] `pnpm --filter @elemento/web build` verde com main bundle ≤ baseline + 5 KB gzipped
- [ ] As 3 páginas e a home rendem em dev sem PII real em qualquer exemplo

## Comandos de validação

```powershell
pnpm --filter @elemento/web typecheck
pnpm --filter @elemento/web lint
pnpm --filter @elemento/web test
pnpm --filter @elemento/web build
```

## Notas para o agente

- **Pt-BR conversacional, não burocrático.** Como ClickUp Help, não como contrato de banco.
- **Frontmatter:** `title`, `description`, `order` (10/20/30), `keywords` (array para busca).
- **Callouts:** usar `tip` para resumos rápidos, `info` para esclarecimentos neutros, `danger` para condutas a evitar.
- **Sem PII em exemplos.** "Ana Paula", "Carlos Eduardo" (personas fictícias da norma §12 — OK).
- **Cross-links** entre os 3 conceitos onde fizer sentido (LGPD menciona escopo de cidade etc.).
- **Tamanho:** cada conceito ~250-450 palavras. Não é livro.
- **Linguagem proibida** (norma §14): "feature flag", "RBAC", "UUID", "outbox", "idempotência" no corpo visível ao operador. "LGPD" é aceito (termo legal).
