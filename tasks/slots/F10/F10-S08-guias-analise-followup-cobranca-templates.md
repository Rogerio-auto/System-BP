---
id: F10-S08
title: Guias Análise + Follow-up + Cobrança + Templates
phase: F10
task_ref: docs/20-central-de-ajuda.md#5
status: in-progress
priority: high
estimated_size: M
agent_id: null
claimed_at: 2026-06-05T23:16:33Z
completed_at: null
pr_url: null
depends_on: [F10-S07]
blocks: []
source_docs:
  - docs/20-central-de-ajuda.md#5
  - docs/20-central-de-ajuda.md#6
  - docs/20-central-de-ajuda.md#14
  - docs/05-modulos-funcionais.md
  - docs/17-lgpd-protecao-dados.md
docs_required: false
docs_audience: []
docs_artifacts: []
---

# F10-S08 — Guias Análise + Follow-up + Cobrança + Templates

## Objetivo

Fechar a cobertura de guias dos módulos F2–F5 — análise de crédito, follow-up, cobrança e templates WhatsApp — encerrando o critério §13 da norma ("toda feature F1..F8 visível ao usuário tem ao menos 1 guia"). Foco em gestor e agente; admin entra só onde a ação é configuração de réguas/templates.

## Contexto

F10-S07 estabeleceu o padrão de guia (frontmatter, `<Step>`, callouts, cross-links, tom ClickUp). Este slot repete o padrão em 4 submódulos, 11 páginas no total. O agrupamento por submódulo (`guias/analise/`, `guias/follow-up/`, etc.) é proposital: quando o refactor de section-index entrar (F10-S15+), cada submódulo vira um agrupamento visual.

Análise de crédito é o módulo mais sensível em LGPD por causa do versionamento imutável (Art. 20 §1º). A norma §14 proíbe jargão como "outbox" e "idempotência" no corpo do guia — o agente precisa entender "por que não consigo apagar uma versão antiga" sem ler o conceito técnico. O guia de versionamento traduz isso em linguagem de operador.

## Escopo (faz)

Cria 11 guias divididos em 4 submódulos sob `docs/help/guias/`:

### Análise de crédito (`guias/analise/` — 3 páginas)

1. **`criar-analise.mdx`** — Abrir uma análise a partir de um lead. Pré-requisitos (lead em etapa "simulação"), campos obrigatórios, fluxo de aprovação. Callout `info`: "a análise vira uma versão imutável após assinada".
2. **`versionar-analise.mdx`** — Por que toda análise gera versão. Como ver versões anteriores. O que não pode mudar depois de assinada. Callout `info` com referência ao Art. 20 §1º LGPD (linguagem simples, sem jargão técnico).
3. **`regras.mdx`** — Como o motor de regras decide aprovação automática. Onde o admin configura. Como o agente lê o motivo de uma rejeição automática.

### Follow-up (`guias/follow-up/` — 2 páginas)

4. **`configurar-reguas.mdx`** — Como o gestor configura uma régua (quem, quando, qual template). Diferença entre régua de follow-up e cobrança. Pré-condições obrigatórias (template aprovado).
5. **`monitorar-jobs.mdx`** — Visão de jobs disparados. Status (agendado, enviado, falhou). Como reprocessar um job que falhou. Callout `warn` para limites de re-tentativa.

### Cobrança (`guias/cobranca/` — 3 páginas)

6. **`registrar-parcelas.mdx`** — Como uma parcela nasce, como marcar paga, atrasada, renegociada. Quem pode editar (admin/gestor).
7. **`configurar-reguas.mdx`** — Régua de cobrança automática por dia de atraso. Cascata (lembrete D-3 → cobrança D+1 → escalada D+15). Conexão com templates.
8. **`monitorar-jobs.mdx`** — Painel de jobs de cobrança. Status, evidência de envio, opt-out do destinatário (LGPD).

### Templates WhatsApp (`guias/templates/` — 3 páginas)

9. **`criar-template.mdx`** — Estrutura de um template (header, body, footer, variáveis), categorias, idioma. Como mapear variáveis para campos do lead.
10. **`aprovacao-de-template.mdx`** — Ciclo de vida (rascunho → enviado → aprovado/rejeitado pela Meta). Tempo médio. O que fazer se rejeitado.
11. **`usar-template.mdx`** — Onde o template aparece (régua de follow-up, cobrança, envio manual). Limites de envio. Callout `warn` sobre janela de 24h do WhatsApp.

### Cross-links nos tracks (`comecar/`)

- **`comecar/admin.mdx`** — adiciona links para `configurar-reguas` (follow-up + cobrança) e `aprovacao-de-template`.
- **`comecar/gestor.mdx`** — adiciona links para `regras` (análise), `configurar-reguas` (ambos), `monitorar-jobs` (ambos), `criar-template`.

### Testes

- **`apps/web/src/features/help/__tests__/manifest.test.ts`** — asserta que os 11 slugs novos resolvem via `getArticleBySlug`. Asserta que a seção `guias` agora contém ≥17 artigos (6 de S07 + 11 de S08).
- **`apps/web/src/features/help/__tests__/search.test.ts`** — busca por "análise", "régua", "cobrança", "template", "parcela", "WhatsApp" encontra os respectivos guias no top-3.

## Fora de escopo (NÃO faz)

- Section index `docs/help/guias/index.mdx` ou submenu visual por submódulo — refactor de nav futuro (F10-S15+).
- Alterar `manifest.ts` (S06 já entregou o necessário).
- Guias de simulador, dashboard, configurações, admin — slots próprios futuros, não reservados ainda.
- Screenshots reais — backfill quando staging sem PII estiver disponível.
- `<FeedbackWidget />` — entra em F10-S13.
- Cross-links em `comecar/agente.mdx` — S07 já fez o necessário para o agente; análise/follow-up/cobrança/templates são mais relevantes para gestor/admin.

## Arquivos permitidos (`files_allowed`)

- `docs/help/guias/analise/criar-analise.mdx` (criar)
- `docs/help/guias/analise/versionar-analise.mdx` (criar)
- `docs/help/guias/analise/regras.mdx` (criar)
- `docs/help/guias/follow-up/configurar-reguas.mdx` (criar)
- `docs/help/guias/follow-up/monitorar-jobs.mdx` (criar)
- `docs/help/guias/cobranca/registrar-parcelas.mdx` (criar)
- `docs/help/guias/cobranca/configurar-reguas.mdx` (criar)
- `docs/help/guias/cobranca/monitorar-jobs.mdx` (criar)
- `docs/help/guias/templates/criar-template.mdx` (criar)
- `docs/help/guias/templates/aprovacao-de-template.mdx` (criar)
- `docs/help/guias/templates/usar-template.mdx` (criar)
- `docs/help/comecar/admin.mdx` (apenas adicionar bloco de cross-links)
- `docs/help/comecar/gestor.mdx` (apenas adicionar links na seção existente)
- `apps/web/src/features/help/__tests__/manifest.test.ts`
- `apps/web/src/features/help/__tests__/search.test.ts`
- `tasks/slots/F10/F10-S08-guias-analise-followup-cobranca-templates.md`

## Arquivos proibidos (`files_forbidden`)

- `apps/web/src/features/help/manifest.ts` (S06 já entregou label/order de `guias`).
- Qualquer outro arquivo em `apps/web/src/features/help/**` que não seja `__tests__/`.
- `docs/help/comecar/agente.mdx` (S07 já cobriu cross-links de agente; mexer aqui é reverter).
- `docs/help/index.mdx` (S06 trata da home).
- `docs/help/guias/crm/**` (entregue por S07; não tocar).
- `docs/help/conceitos/**` (S05 entregou; não tocar).
- `apps/api/**`, `apps/langgraph-service/**`, `packages/**`.
- `tasks/STATUS.md`.

## Contratos de entrada

- F10-S07 entregue: padrão de guia estabelecido, `guias/crm/` populado, `SECTION_LABELS["guias"]` ativo.
- Componentes MDX canônicos (`<Callout>`, `<Step>`, `<CodeBlock>`) disponíveis.
- `comecar/admin.mdx` e `comecar/gestor.mdx` existem com a estrutura de S06.

## Contratos de saída

- 11 rotas `/ajuda/guias/{analise,follow-up,cobranca,templates}/*` renderizam.
- A seção "Guias" no sidebar agora lista todos os 17 guias (6 CRM + 11 deste slot), ordenados pelo `order` de cada submódulo.
- Busca por "análise", "régua", "cobrança", "template", "WhatsApp", "parcela", "versão" retorna o guia correto no top-3.
- `comecar/admin.mdx` e `comecar/gestor.mdx` apontam para os guias relevantes.
- Nenhum guia usa "feature flag", "RBAC", "UUID", "outbox", "idempotência" no corpo (norma §14).
- Nenhum guia traz CPF, telefone, email ou nome real (norma §12 + LGPD doc 17).
- `versionar-analise.mdx` cita explicitamente o Art. 20 §1º LGPD em linguagem de operador.

## Definition of Done

- [ ] Código implementado conforme escopo
- [ ] `pnpm --filter @elemento/web typecheck` verde
- [ ] `pnpm --filter @elemento/web lint` verde
- [ ] `pnpm --filter @elemento/web test` verde
- [ ] `pnpm --filter @elemento/web build` verde com main bundle ≤ baseline + 15 KB gzipped
- [ ] Os 11 guias rendem em dev sem PII real em qualquer exemplo
- [ ] Busca por 6 termos pt-BR-chave devolve o guia certo em <100ms
- [ ] Critério §13 da norma 20 marcado como cumprido para CRM + Análise + Follow-up + Cobrança + Templates

## Comandos de validação

```powershell
pnpm --filter @elemento/web typecheck
pnpm --filter @elemento/web lint
pnpm --filter @elemento/web test
pnpm --filter @elemento/web build
```

## Notas para o agente

- **Tom:** ClickUp Help, não contrato bancário. Mesma régua de S07.
- **Frontmatter obrigatório:** `title`, `description`, `order` (use 10, 20, 30 dentro de cada submódulo), `keywords` (inclua sinônimos pt-BR — "régua/regua", "análise/analise", etc.).
- **Estrutura padrão por guia:** mesma de S07 (abertura → pré-req em callout → `<Step>` → erros comuns → "Veja também").
- **Callouts:**
  - `tip` — produtividade, atalho.
  - `info` — esclarecimento neutro (versão imutável, janela WhatsApp de 24h, opt-out).
  - `warn` — atenção sem dano (limite de re-tentativa, tamanho de payload).
  - Sem `danger` — LGPD já é coberta pelo conceito.
- **LGPD em destaque:**
  - `versionar-analise.mdx` deve citar Art. 20 §1º em linguagem de operador (sem "imutabilidade" — use "não pode ser apagada").
  - `cobranca/monitorar-jobs.mdx` deve mencionar opt-out do destinatário como direito do titular.
  - `templates/usar-template.mdx` deve explicar que mensagens automáticas seguem regras de janela e opt-out.
- **Cross-links:** sempre URL relativa começando com `/ajuda/...`. Links de submódulo para submódulo são esperados (régua de cobrança → guia de template, análise → CRM, etc.).
- **Tamanho:** 250-500 palavras por guia.
- **Vocabulário canônico:** "Análise de crédito", "Régua", "Job", "Módulo liberado", "Escopo de cidade" (norma §14). Nunca "feature flag", "RBAC", "UUID", "outbox", "idempotência".
- **Verificar localmente:** após criar os MDX, rodar `pnpm --filter @elemento/web dev`, navegar por amostragem (1 por submódulo), conferir TOC + sidebar + Cmd+K.
