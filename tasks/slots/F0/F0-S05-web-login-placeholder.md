---
id: F0-S05
title: Web — dev server + design tokens + tela de login placeholder
phase: F0
task_ref: T0.5
status: done
priority: medium
estimated_size: M
agent_id: claude-opus-4-7
claimed_at: 2026-05-11T00:00:00Z
completed_at: 2026-05-11T03:00:00Z
pr_url: null
depends_on: [F0-S01]
blocks: [F1-S08]
source_docs:
  - docs/12-tasks-tecnicas.md#T0.5
  - docs/18-design-system.md
  - docs/design-system/index.html
---

# F0-S05 — Frontend dev server + design tokens + login placeholder

## Objetivo

`pnpm --filter @elemento/web dev` sobe Vite na 5173 com **o Design System oficial em pé**: tokens CSS, fontes carregadas, theme toggle (light/dark) funcional, layout shell preparado, e uma tela `/login` minimalista mas visualmente refinada usando esses tokens. **Sem inputs funcionais ainda** — a lógica real virá em F1-S08.

## Contexto

Este slot estabelece a **base visual** que todo slot de UI subsequente vai consumir. Erros ou atalhos aqui propagam por todo o app. **Antes de codar:** leia `docs/18-design-system.md` e abra `docs/design-system/index.html` no navegador.

## Escopo (faz)

### Fontes e index.html

- `apps/web/index.html`:
  - `<html lang="pt-BR" data-theme="light">` (light é o default; dark é toggle).
  - `<meta name="color-scheme" content="light dark">`.
  - `<link>` Google Fonts: Bricolage Grotesque (opsz, weight 12..96, 300–800), Geist (300–900), JetBrains Mono (400–600). Use `preconnect`.
  - `<title>Banco do Povo · Manager</title>`.
  - Body sem classes utilitárias hardcoded — o `globals.css` cuida do bg/text.

### CSS variables e globals.css

- `apps/web/src/styles/globals.css`:
  - Declarar **todos os tokens** dos §3, §4, §5, §6, §7 de `docs/18-design-system.md` como CSS vars:
    - Light em `:root, :root[data-theme="light"], html.light` (suportar as 3 estratégias para o toggle funcionar via Tailwind class e/ou data-attribute).
    - Dark em `:root[data-theme="dark"], html.dark`.
  - Tokens estruturais (fontes, espaçamento, radius, easings) em `:root` único (não dependem de tema).
  - `body::before` com SVG grain inline (data URI) — copiar **exatamente** o trecho do HTML de referência. Opacidade 0.045 light / 0.08 dark via `--grain-opacity`.
  - `body::after` com 3 radial gradients sutis (glows ambiente). Versão dark com saturação reduzida.
  - `@tailwind base/components/utilities`.
  - Base: `body` herda `var(--bg)`, `var(--text)`, `font-family: var(--font-sans)`, `font-feature-settings: 'ss01','cv01','cv11'`.
  - `@media (prefers-reduced-motion: reduce)` neutraliza animações decorativas.

### Tailwind

- `apps/web/tailwind.config.js`: substituir o esqueleto atual pelo modelo canônico do §11 do DS:
  - `darkMode: ['class', '[data-theme="dark"]']`.
  - `fontFamily.display = ['"Bricolage Grotesque"', ...]`, `sans = ['Geist', ...]`, `mono = ['"JetBrains Mono"', ...]`.
  - `colors` mapeando CSS vars: `azul`, `verde`, `amarelo`, `bg`, `surface.*`, `ink.*`, `border.*`, `success.*`, `warning.*`, `danger.*`, `info.*`.
  - `boxShadow.e1..e5`, `boxShadow.glow-azul|verde|amarelo`.
  - `borderRadius.xs/sm/md/lg/xl` conforme DS.
  - `transitionTimingFunction.out` e `out-back`.
  - **Remover** a paleta `ink` numérica antiga (`50..950`) — o token de texto agora é `ink.DEFAULT|2|3|4` via CSS var.

### Theme provider e toggle

- `apps/web/src/app/ThemeProvider.tsx`:
  - Hook `useTheme()` que lê `localStorage.theme` ou `prefers-color-scheme` no boot (sem flash — aplique antes do React montar via inline script em `index.html` se necessário).
  - Aplica simultaneamente `html[data-theme]` e `html.classList` (`light`/`dark`) — assim Tailwind `dark:` e CSS vars funcionam juntos.
  - Persiste em `localStorage`.
- `apps/web/src/components/ui/ThemeToggle.tsx`: pill com 2 botões (Claro/Escuro) seguindo o design do `.theme-toggle` do HTML de referência (§MAIN .theme-toggle).

### Componentes primitivos mínimos (`components/ui/`)

Cobrir o **subconjunto necessário pra montar a tela de login**, todos seguindo o DS:

- `Button.tsx` — variantes `primary` (`bg: var(--grad-azul)`), `secondary`, `accent`, `outline`, `ghost`, `danger`. Tamanhos `sm`, default, `lg`. Hover com lift+glow conforme DS §9.1.
- `Input.tsx` — wrapping `<label>` + `<input>` + hint/error. Foco com ring azul 3px (rgba `var(--brand-azul)` 15%). Inset shadow interno. Erro com borda `--danger`.
- `Label.tsx` — `text-sm font-semibold` com slot pra `<span class="req">` quando required.
- `lib/cn.ts` — `clsx + tailwind-merge`.

### Tela de login

- `apps/web/src/features/auth/LoginPage.tsx`:
  - Layout em 2 colunas no desktop: à esquerda hero com marca + título display (Bricolage 800 + gradient azul→verde no `em`) + sub. À direita, card `bg: var(--bg-elev-1)` com `box-shadow: var(--elev-3)`, padding 32–48px, contendo o form.
  - Marca: SVG da estrela com gradient azul/verde (copiar trecho `.brand-mark` do HTML de referência).
  - Form: campo CPF, campo senha, link "esqueci a senha" (ghost), botão `primary lg` ocupando 100% da largura do card.
  - Toggle de tema visível (topo direito ou dentro do card).
  - Submit chama `console.warn('login submit (placeholder)', payload)` apenas. **Sem chamada à API.**
- `apps/web/src/App.tsx` mapeia `/` → redirect `/login`; `/login` → `<LoginPage />`. Router: `react-router-dom` (já permitido no DS — adicione no package.json com justificativa no PR).

## Fora de escopo (não faz)

- Chamada real à API.
- Persistência de sessão / refresh token.
- `useAuth` hook (vai pra F1-S08).
- `AuthGuard` (vai pra F1-S08).
- Demais componentes do catálogo (Card, Alert, Badge, Switch, Avatar, Stat, Table, Modal) — só os primitivos da tela de login.

## Arquivos permitidos

- `apps/web/index.html`
- `apps/web/tailwind.config.js`
- `apps/web/src/styles/globals.css`
- `apps/web/src/app/**` (apenas `ThemeProvider.tsx` e ajustes em providers)
- `apps/web/src/App.tsx`
- `apps/web/src/main.tsx` (apenas pra injetar ThemeProvider se necessário)
- `apps/web/src/features/auth/LoginPage.tsx`
- `apps/web/src/components/ui/Button.tsx`
- `apps/web/src/components/ui/Input.tsx`
- `apps/web/src/components/ui/Label.tsx`
- `apps/web/src/components/ui/ThemeToggle.tsx`
- `apps/web/src/lib/cn.ts`
- `apps/web/package.json` (adicionar `react-router-dom`, `clsx`, `tailwind-merge` — justificar no PR)

## Arquivos proibidos

- `apps/api/**`
- `apps/langgraph-service/**`
- Qualquer outra `features/*` que não seja `auth/`.

## Definition of Done

- [ ] `pnpm --filter @elemento/web dev` sobe sem warnings.
- [ ] Fontes (Bricolage, Geist, JetBrains Mono) carregadas — confirme no DevTools Network.
- [ ] CSS variables do DS declaradas para light e dark conforme `docs/18-design-system.md`.
- [ ] Theme toggle funcional, persiste em `localStorage`, sem flash de tema errado no refresh.
- [ ] Grain (`body::before`) e glows ambiente (`body::after`) visíveis nos dois temas.
- [ ] Tela `/login` renderiza light-first com refinement de produção em ambos os temas.
- [ ] Botão primário tem lift + glow no hover; depressão no active.
- [ ] Input tem focus ring 3px azul (rgba 15%).
- [ ] Marca em SVG inline com gradient azul→verde.
- [ ] Acessibilidade: labels semânticas, contraste WCAG AA, focus visível, área clicável ≥ 40×40px.
- [ ] `pnpm --filter @elemento/web typecheck` verde.
- [ ] `pnpm --filter @elemento/web lint` verde.
- [ ] `pnpm --filter @elemento/web build` verde.
- [ ] PR com **2 screenshots** (light + dark) e justificativa das deps adicionadas.

## Validação

```powershell
pnpm --filter @elemento/web dev          # validação visual nos 2 temas
pnpm --filter @elemento/web typecheck
pnpm --filter @elemento/web lint
pnpm --filter @elemento/web build
```

## Notas para o agente

- **Antes de codar**, abra `docs/design-system/index.html` no navegador (Chrome ou Firefox), navegue pelas seções `Cores`, `Tipografia`, `Profundidade`, `Hovers`, `Botões`, `Formulários`. Inspecione no DevTools. Os valores exatos estão lá.
- **Sem inventar.** Se o token existe no DS, use. Se não, abra issue `[DS] proposta:` em vez de improvisar.
- A paleta `ink` antiga (numérica 50–950) some neste slot. O token agora é `ink.DEFAULT | ink.2 | ink.3 | ink.4` (via CSS var). Migre `bg-ink-950 text-ink-100` em `body` para `bg-bg text-ink` (que resolve via var).
- O `prefers-color-scheme` deve respeitar a preferência do SO **no primeiro boot**, mas o toggle prevalece após escolha manual.
- Componente quebrado em 200+ linhas? Quebre. Não shippe Frankenstein.
