---
id: F27-S02
title: Frontend — ícones e splash PWA (assets-generator, maskable, apple-touch)
phase: F27
task_ref: docs/24-pwa.md
status: review
priority: medium
estimated_size: S
agent_id: null
depends_on: [F27-S01]
blocks: []
labels: [frontend, design-system, pwa]
source_docs: [docs/24-pwa.md, docs/18-design-system.md]
docs_required: false
claimed_at: 2026-07-20T13:23:07Z
completed_at: 2026-07-20T13:46:44Z
---

# F27-S02 — Ícones e splash PWA

## Objetivo

Gerar o conjunto de ícones do PWA (192, 512, maskable, apple-touch) e splash screens a partir de
uma arte-fonte única nas cores do DS v2, e fiá-los ao manifesto/HTML. Fecha a instalabilidade
visual iniciada no F27-S01.

## Contexto

Doc 24 §3.3. Hoje só existe `apps/web/public/favicon.png`. O F27-S01 já referencia os caminhos
`/pwa-192x192.png`, `/pwa-512x512.png`, `/pwa-maskable-512x512.png` no manifesto — este slot os
produz. Usar `@vite-pwa/assets-generator` para não versionar PNGs à mão de forma inconsistente.

## Escopo (faz)

- Arte-fonte única (SVG ou PNG alta-res) nas cores da bandeira de Rondônia / tokens do DS v2, em
  `apps/web/public/` (ex.: `pwa-source.svg`).
- `apps/web/pwa-assets.config.ts` configurando o `@vite-pwa/assets-generator` (preset com maskable
  - safe-zone, apple-touch, splash iOS).
- Script `pnpm --filter @elemento/web generate-pwa-assets` no `package.json`.
- Gerar e commitar os ícones em `apps/web/public/` (192, 512, maskable 512, apple-touch, favicons).
- `index.html`: apontar `apple-touch-icon` para o ícone gerado (hoje aponta pro `favicon.png`).

## Fora de escopo (NÃO faz)

- Config do `vite-plugin-pwa`/manifest (F27-S01 já fez — só consumir os assets).
- Qualquer lógica de SW/push.
- Redesenho de marca — usar a identidade do DS v2 existente.

## Arquivos permitidos

- `apps/web/pwa-assets.config.ts`
- `apps/web/public/**`
- `apps/web/index.html`
- `apps/web/package.json`

## Arquivos proibidos

- `apps/api/**`
- `apps/langgraph-service/**`
- `apps/web/src/**`
- `apps/web/vite.config.ts`
- `packages/**`

## Definition of Done

- [ ] `@vite-pwa/assets-generator` configurado; script gera 192/512/maskable/apple-touch/favicons
- [ ] Ícones commitados em `apps/web/public/` nos caminhos referenciados pelo manifesto (F27-S01)
- [ ] Maskable com safe-zone correta (não corta em máscara circular/rounded)
- [ ] `apple-touch-icon` no `index.html` aponta para o ícone PWA gerado
- [ ] Cores do DS v2 (sem cor fora dos tokens); dependência justificada no PR (PROTOCOL §1.3)
- [ ] `pnpm --filter @elemento/web build` verde; Lighthouse "installable" reconhece os ícones

## Validação

```powershell
pnpm --filter @elemento/web build
```

## Notas para o agente

- Os caminhos dos ícones já foram fixados no manifesto pelo F27-S01 — não renomear, só preencher.
- Maskable exige safe-zone (~80% central) — validar em máscara circular e squircle.
- iOS não usa maskable; garantir `apple-touch-icon` e splash dedicados (doc 24 §11).
  </content>
