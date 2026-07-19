---
id: F27-S01
title: Frontend — fundação PWA (vite-plugin-pwa injectManifest, manifest, SW base, página offline)
phase: F27
task_ref: docs/24-pwa.md
status: in-progress
priority: high
estimated_size: M
agent_id: null
depends_on: []
blocks: []
labels: [frontend, pwa, build]
source_docs: [docs/24-pwa.md, docs/18-design-system.md]
docs_required: false
claimed_at: 2026-07-19T23:49:13Z
---

# F27-S01 — Fundação PWA instalável

## Objetivo

Tornar o Manager (`apps/web`) tecnicamente instalável: `vite-plugin-pwa` em modo `injectManifest`,
manifesto, service worker base (precache do shell + navigation fallback), página offline e o
`theme-color`/`<link rel=manifest>` no HTML. Sem push ainda (F27-S07) e sem ícones definitivos
(F27-S02). Base para todo o resto da fase.

## Contexto

Doc 24 §3. Hoje não existe nenhuma infra PWA: sem plugin, sem SW, sem manifest (`apps/web/public/`
só tem `favicon.png` + `api-reference.json`). `index.html` não tem `theme-color` nem `<link
rel=manifest>`. O build é `tsc -b && vite build`, e o `tsc -b` vaza `apps/web/vite.config.d.ts`
como untracked — corrigir no `.gitignore`.

## Escopo (faz)

- Adicionar `vite-plugin-pwa` ao `apps/web/vite.config.ts` no modo **`injectManifest`** (não
  `generateSW`), `registerType: 'prompt'`. Config do manifesto conforme doc 24 §3.2 (name,
  short_name, id, start_url, scope, `display: standalone`, `theme_color`/`background_color` com
  tokens do DS v2, `lang: pt-BR`, shortcuts para `/conversas` `/crm` `/relatorios`). Ícones ficam
  para F27-S02 — referenciar os caminhos que S02 vai gerar.
- SW-fonte tipado em `apps/web/src/sw/service-worker.ts`: precache Workbox (`injectManifest`),
  navigation route → `index.html` (SPA), **sem** cachear `api.*`. Estrutura pronta para receber os
  handlers de push no F27-S07 (deixar o arquivo, sem `push`/`notificationclick` ainda).
- `apps/web/src/pwa/register.ts` — registro do SW + fluxo de update (`prompt`).
- `apps/web/src/pwa/OfflinePage.tsx` — página offline (DS v2) para cold start sem rede.
- `apps/web/src/pwa/UpdatePrompt.tsx` — toast "Nova versão disponível" que chama `skipWaiting` sob
  ação do usuário (doc 24 §3.4).
- Fiar registro + UpdatePrompt no `apps/web/src/main.tsx`.
- `index.html`: `<meta name="theme-color">` (com variante dark) — o `<link rel=manifest>` é
  injetado pelo plugin.
- `.gitignore`: ignorar `apps/web/vite.config.d.ts` (+ `.map`).

## Fora de escopo (NÃO faz)

- Ícones/splash definitivos (F27-S02).
- Handlers de push/notificationclick e opt-in (F27-S07).
- Responsividade de layout (F27-S03/S04).
- Qualquer cache de resposta de API (proibido por doc 24 §3.4 — network-only).

## Arquivos permitidos

- `apps/web/vite.config.ts`
- `apps/web/package.json`
- `apps/web/index.html`
- `apps/web/src/main.tsx`
- `apps/web/src/sw/service-worker.ts`
- `apps/web/src/pwa/register.ts`
- `apps/web/src/pwa/OfflinePage.tsx`
- `apps/web/src/pwa/UpdatePrompt.tsx`
- `.gitignore`
- `apps/web/src/**/*.test.ts`
- `apps/web/src/**/*.test.tsx`

## Arquivos proibidos

- `apps/api/**`
- `apps/langgraph-service/**`
- `apps/web/src/features/**`
- `apps/web/src/components/layout/**`
- `packages/**`

## Definition of Done

- [ ] `vite-plugin-pwa` (injectManifest, `registerType: 'prompt'`) configurado; `pnpm --filter @elemento/web build` gera `manifest.webmanifest` + `sw.js`
- [ ] SW faz precache do shell e navigation fallback para `index.html`; NÃO cacheia `api.*`
- [ ] App abre offline no shell; cold start sem rede mostra a página offline
- [ ] Update de build oferece prompt de atualização (sem shell preso)
- [ ] `theme-color` no `index.html` (light+dark); `<link rel=manifest>` presente no build
- [ ] `apps/web/vite.config.d.ts` ignorado pelo git
- [ ] Dependência nova justificada no PR (PROTOCOL §1.3)
- [ ] `pnpm --filter @elemento/web typecheck` + `lint` + `test` + `build` verdes; `manifest.test.ts` intacto

## Validação

```powershell
pnpm --filter @elemento/web typecheck
pnpm --filter @elemento/web lint
pnpm --filter @elemento/web test
pnpm --filter @elemento/web build
```

## Notas para o agente

- **Modo `injectManifest` é obrigatório** (não `generateSW`) — o F27-S07 precisa adicionar handlers
  custom de `push`/`notificationclick` no mesmo SW.
- **Nunca cachear `api.*`** (cross-origin, network-only) — é a decisão de LGPD do doc 24 §2/§3.4
  (zero PII em repouso). Não introduzir runtime caching de API.
- Não confundir com `apps/web/src/features/help/manifest.ts` (Central de Ajuda) — não tocar.
- Ícones ainda não existem; referencie os caminhos (`/pwa-192x192.png`, `/pwa-512x512.png`,
  `/pwa-maskable-512x512.png`) que o F27-S02 vai gerar em `public/`.
  </content>
