# 18 — Design System (canônico)

> **Status:** lei. Esta doc tem precedência sobre qualquer slot individual em decisões de UI.
> **Referência viva:** [`docs/design-system/index.html`](./design-system/index.html) — abra no navegador para inspecionar cada token, hover e componente em ambos os temas.
> **Versão:** v2.0 — _Banco do Povo de Rondônia_ · sistema com profundidade física, hovers que respondem, e identidade construída sobre a bandeira do estado.

---

## 1. Filosofia

1. **Light-first com toggle pra dark.** O padrão de boot é claro (creme suave, `#F7F4ED`). O dark existe e é first-class, mas o estado inicial e a maioria das telas de produto operam em light. Toggle pluga em `html[data-theme="light|dark"]` (no app web traduzimos pra estratégia de classe do Tailwind — ver §11).
2. **Cores da bandeira.** Azul institucional `#1B3A8C` (primary), verde Rondônia `#2E9B3E` (success/accent), amarelo solar `#F5C518` (warning/highlight), branco da estrela. Tudo o mais é neutro ou estado funcional.
3. **Profundidade é física, não decorativa.** Cada elevação combina sombra externa real + highlight superior (luz cai de cima) + depressão inferior (peso). Card não é "retângulo com shadow", é objeto.
4. **Hovers respondem ao toque.** Seis padrões nomeados (Lift, Glow, Shine, Border Gradient, Spotlight, Scale). Cada componente clicável escolhe um — nunca "sem feedback".
5. **Grain sutil em tudo.** Textura SVG fixa em `body::before` com `mix-blend-mode`. Não dá pra ver consciente, mas a tela inteira ganha presença. Reprova qualquer push que remova.
6. **Tipografia editorial em display, afiada em UI, monoespaçada em dados.** Três famílias, cada uma com função.
7. **Movimento contido.** Transições 150–400ms, easings curados (`ease`, `ease-out`, `ease-out-back`). Sem bounce gratuito.

---

## 2. Stack de fontes

| Família                 | Função                                                     | Pesos              | Notas                                                                     |
| ----------------------- | ---------------------------------------------------------- | ------------------ | ------------------------------------------------------------------------- |
| **Bricolage Grotesque** | Display (h1–h2, números grandes, hero)                     | 300–800 (variable) | `opsz` 12–96. Tracking negativo agressivo `-0.045em` em tamanhos grandes. |
| **Geist**               | Interface (corpo, botões, navegação, h3+)                  | 300–900            | Alto x-height. `font-feature-settings: 'ss01','cv01','cv11'`.             |
| **JetBrains Mono**      | Números, valores monetários, CPFs, códigos, tabelas densas | 400–600            | Tabular figures por default. Tracking `-0.01em` em valores grandes.       |

Carregamento: Google Fonts via `<link>` (já incluso no HTML de referência). Em apps/web, expor no `index.html` e mapear no `tailwind.config.js` (§11).

---

## 3. Tokens — Cores

Todas as cores são CSS variables com tema. Use **sempre** o token, **nunca** hex hardcoded.

### 3.1 Marca (idênticas nos dois temas — são identidade)

| Token                  | Light     | Dark      | Uso                                 |
| ---------------------- | --------- | --------- | ----------------------------------- |
| `--brand-azul`         | `#1B3A8C` | `#5E80E0` | Primary, links, foco                |
| `--brand-azul-deep`    | `#0F2563` | `#3D5FBA` | Hover/pressed do primary            |
| `--brand-azul-light`   | `#2E54B0` | `#8AA3EC` | Tints, decorações                   |
| `--brand-verde`        | `#2E9B3E` | `#4FB55F` | Success, accent, CTA secundário     |
| `--brand-verde-deep`   | `#1F7A2D` | `#2E9B3E` | Hover do verde                      |
| `--brand-verde-light`  | `#4FB55F` | `#7BCE89` | Tints                               |
| `--brand-amarelo`      | `#F5C518` | `#F5C518` | Warning, highlights, accents claros |
| `--brand-amarelo-deep` | `#D4A510` | `#D4A510` | Hover do amarelo                    |
| `--brand-branco`       | `#FFFFFF` | `#FFFFFF` | Estrela, contraste sobre brand      |

> No dark mode os azuis/verdes são _aclarados_ — preservam matiz mas garantem contraste WCAG AA contra fundo escuro.

### 3.2 Neutros adaptáveis

| Token               | Light                   | Dark                     |
| ------------------- | ----------------------- | ------------------------ |
| `--bg`              | `#F7F4ED` (creme suave) | `#0A1228` (azul-noite)   |
| `--bg-elev-1`       | `#FFFFFF`               | `#131D38`                |
| `--bg-elev-2`       | `#FBF8F1`               | `#1C2748`                |
| `--bg-elev-3`       | `#FFFFFF`               | `#243156`                |
| `--bg-inset`        | `#EFEBE0`               | `#08101F`                |
| `--surface-muted`   | `#E8E2D3`               | `#243156`                |
| `--surface-hover`   | `#FAF6EC`               | `#1F2A4D`                |
| `--text`            | `#14213D`               | `#F1EEE3`                |
| `--text-2`          | `#3C4A6B`               | `#C8C3B0`                |
| `--text-3`          | `#6B7896`               | `#8E8A78`                |
| `--text-4`          | `#9AA3B8`               | `#5D5A4E`                |
| `--text-on-brand`   | `#FFFFFF`               | `#FFFFFF`                |
| `--border`          | `#DCD4C0`               | `#2A3760`                |
| `--border-strong`   | `#B8AE94`               | `#3D4D7E`                |
| `--border-subtle`   | `#E8E2D3`               | `#1C2748`                |
| `--border-hairline` | `rgba(20,33,61,0.06)`   | `rgba(255,255,255,0.06)` |

### 3.3 Estado

| Token                        | Light bg / fg         | Dark bg / fg          |
| ---------------------------- | --------------------- | --------------------- |
| `--success` / `--success-bg` | `#2E9B3E` / `#E3F4E6` | `#4FB55F` / `#1A3A20` |
| `--warning` / `--warning-bg` | `#B89500` / `#FBF1CF` | `#F5C518` / `#3D3210` |
| `--danger` / `--danger-bg`   | `#C8341F` / `#FBE5E1` | `#E55A45` / `#3D1A15` |
| `--info` / `--info-bg`       | `#1B3A8C` / `#DFE5F2` | `#5E80E0` / `#1A2545` |

### 3.4 Gradientes brand (compostos prontos)

| Token             | Valor                                                                                              |
| ----------------- | -------------------------------------------------------------------------------------------------- |
| `--grad-rondonia` | `linear-gradient(135deg, azul 0%, azul 45%, verde 45%, verde 100%)` — referência direta à bandeira |
| `--grad-azul`     | `linear-gradient(135deg, brand-azul → brand-azul-deep)`                                            |
| `--grad-verde`    | `linear-gradient(135deg, brand-verde → brand-verde-deep)`                                          |
| `--grad-amarelo`  | `linear-gradient(135deg, brand-amarelo → brand-amarelo-deep)`                                      |

Use `--grad-rondonia` em avatares, separadores institucionais e elementos que carregam identidade do estado. Os gradientes monocromáticos são pros botões principais.

---

## 4. Tokens — Tipografia

### 4.1 Escala (mobile-first, escala 1.25 modular)

| Token         | px  | Uso típico                     |
| ------------- | --- | ------------------------------ |
| `--text-xs`   | 12  | Captions, badges, meta         |
| `--text-sm`   | 14  | Body small, labels secundários |
| `--text-base` | 16  | Body padrão, botões            |
| `--text-lg`   | 18  | Body grande, lead-in           |
| `--text-xl`   | 20  | h4, títulos de cards           |
| `--text-2xl`  | 24  | h3, títulos de seção pequena   |
| `--text-3xl`  | 32  | h2 (seção)                     |
| `--text-4xl`  | 44  | h1 (página)                    |
| `--text-5xl`  | 60  | Display secundário             |
| `--text-6xl`  | 80  | Hero display                   |

### 4.2 Regras de aplicação

- **Display (h1, hero)** → Bricolage Grotesque, peso 700–800, `letter-spacing: -0.04em a -0.05em`, `line-height: 0.95`, `font-variation-settings: 'opsz' 96`.
- **Heading menor (h3, h4)** → Geist, peso 700, `letter-spacing: -0.025em`.
- **Body** → Geist 400/500, `letter-spacing: -0.005em` (sutil), `line-height: 1.5–1.6`.
- **Caption / eyebrow** → Geist 600/700, `font-size: 12px`, `letter-spacing: 0.1em a 0.18em`, `text-transform: uppercase`.
- **Números (valores monetários, CPFs)** → JetBrains Mono, peso 500–600, `letter-spacing: -0.01em`.

### 4.3 Tratamentos de destaque

`em` dentro de display recebe gradiente azul→verde via `background-clip: text` (padrão para título-marca):

```css
.title em {
  background: linear-gradient(135deg, var(--brand-azul) 0%, var(--brand-verde) 100%);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  font-weight: 800;
  font-style: normal;
}
```

---

## 5. Tokens — Espaçamento

Escala base 4px. **Sempre** use os tokens, nunca números mágicos.

| Token       | px  |
| ----------- | --- |
| `--space-1` | 4   |
| `--space-2` | 8   |
| `--space-3` | 12  |
| `--space-4` | 16  |
| `--space-5` | 24  |
| `--space-6` | 32  |
| `--space-7` | 48  |
| `--space-8` | 64  |
| `--space-9` | 96  |

---

## 6. Tokens — Bordas e raios

### 6.1 Radius

| Token           | px    | Uso                       |
| --------------- | ----- | ------------------------- |
| `--radius-xs`   | 4     | Tags, microelementos      |
| `--radius-sm`   | 6     | Inputs, botões pequenos   |
| `--radius-md`   | 10    | Cards padrão, botões      |
| `--radius-lg`   | 16    | Cards de produto, modais  |
| `--radius-xl`   | 24    | Hero cards                |
| `--radius-pill` | 999px | Badges, switches, toggles |

### 6.2 Linhas internas (parte da profundidade)

| Token                  | Light                   | Dark                     | Uso                            |
| ---------------------- | ----------------------- | ------------------------ | ------------------------------ |
| `--border-inner-light` | `rgba(255,255,255,0.8)` | `rgba(255,255,255,0.05)` | Inset top (highlight de borda) |
| `--border-inner-dark`  | `rgba(20,33,61,0.04)`   | `rgba(0,0,0,0.4)`        | Inset bottom (depressão)       |

---

## 7. Sistema de profundidade — 6 níveis

Cada elevação combina **três camadas** numa única `box-shadow` composta:

1. Sombra externa (sombra real projetada)
2. `inset top` com luz sutil branca (highlight da borda superior — luz vem de cima)
3. `inset bottom` com sombra escura (depressão da borda inferior — peso)

Use o token, nunca recrie a sombra ad-hoc.

| Nível | Token      | Uso canônico                                                 |
| ----- | ---------- | ------------------------------------------------------------ |
| 0     | `--elev-0` | Plano. Fundos, elementos inline, separadores.                |
| 1     | `--elev-1` | Sutil. Inputs, sidebar, badges, cards passivos.              |
| 2     | `--elev-2` | Padrão. Botões em repouso, cards ativos, tabelas, demo-rows. |
| 3     | `--elev-3` | Hover. Estado de hover de cards default, dropdowns abertos.  |
| 4     | `--elev-4` | Destaque. Cards em foco, popovers, cartões de produto.       |
| 5     | `--elev-5` | Modal. Diálogos, sheets, conteúdo flutuante de topo.         |

**Receitas exatas** (light mode — dark é simétrico com sombras mais fortes e highlight superior crucial):

```css
--elev-1: 0 1px 2px rgba(20, 33, 61, 0.04), inset 0 1px 0 rgba(255, 255, 255, 0.9);

--elev-2: 0 2px 4px rgba(20, 33, 61, 0.05), 0 4px 12px rgba(20, 33, 61, 0.04),
  inset 0 1px 0 rgba(255, 255, 255, 1), inset 0 -1px 0 rgba(20, 33, 61, 0.03);

--elev-3: 0 4px 8px rgba(20, 33, 61, 0.06), 0 8px 24px rgba(20, 33, 61, 0.08),
  inset 0 1px 0 rgba(255, 255, 255, 1), inset 0 -1px 0 rgba(20, 33, 61, 0.04);

--elev-4: 0 8px 16px rgba(20, 33, 61, 0.08), 0 16px 40px rgba(20, 33, 61, 0.12),
  inset 0 1px 0 rgba(255, 255, 255, 1), inset 0 -1px 0 rgba(20, 33, 61, 0.05);

--elev-5: 0 12px 24px rgba(20, 33, 61, 0.1), 0 24px 56px rgba(20, 33, 61, 0.16),
  inset 0 1px 0 rgba(255, 255, 255, 1), inset 0 -1px 0 rgba(20, 33, 61, 0.06);
```

### 7.1 Glows brand (substitui border no hover de primários)

```css
--glow-azul: 0 0 0 1px rgba(27, 58, 140, 0.12), 0 8px 24px rgba(27, 58, 140, 0.2);
--glow-verde: 0 0 0 1px rgba(46, 155, 62, 0.15), 0 8px 24px rgba(46, 155, 62, 0.22);
--glow-amarelo: 0 0 0 1px rgba(245, 197, 24, 0.2), 0 8px 24px rgba(245, 197, 24, 0.28);
```

---

## 8. Padrões de hover

Seis padrões nomeados. Cada componente clicável escolhe **um** e o aplica em toda instância. Nunca misture aleatoriamente.

| Padrão              | Quando usar                                         | Implementação                                                                                       |
| ------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| **Lift**            | Cards clicáveis, itens de grid, listas de produto.  | `transform: translateY(-4px)` + sobe de `elev-1` para `elev-4`.                                     |
| **Glow**            | Botões primários, CTAs, elementos com cor da marca. | Borda some, `box-shadow: var(--glow-azul\|verde\|amarelo)`.                                         |
| **Shine**           | Cards de produto premium, hero items.               | Pseudo-elemento `::after` com gradiente diagonal que cruza o card em 600ms. Usar com **moderação**. |
| **Border Gradient** | Itens importantes que precisam destaque visual.     | Borda gradiente azul→verde→amarelo via `mask-composite`.                                            |
| **Spotlight**       | Cards default, stats, conteúdo informativo.         | Halo radial verde acompanha o cursor via JS (`--mx`, `--my`). Default em `.card` e `.stat`.         |
| **Scale**           | Thumbnails, avatares, imagens, ícones de seleção.   | `transform: scale(1.03)` + sobe de `elev-2` para `elev-3`.                                          |

Easings:

```css
--ease: cubic-bezier(0.4, 0, 0.2, 1); /* padrão */
--ease-out: cubic-bezier(0.16, 1, 0.3, 1); /* hovers, entrada */
--ease-out-back: cubic-bezier(0.34, 1.56, 0.64, 1); /* micro-celebrações apenas */

--dur-fast: 150ms;
--dur: 250ms;
--dur-slow: 400ms;
```

---

## 9. Componentes canônicos

A lista a seguir é o **catálogo mínimo** que o app web deve expor em `src/components/ui/`. Cada um vem com os estados explícitos.

### 9.1 Botão

Variantes: `primary` (azul), `secondary` (verde), `accent` (amarelo, texto azul-deep), `outline`, `ghost`, `danger`. Tamanhos: `sm`, padrão, `lg`. Sempre com:

- Padding canônico `12px 22px` (padrão), `8px 14px` (sm), `16px 28px` (lg).
- `font-weight: 600`, `letter-spacing: -0.005em`.
- Hover **sempre** com lift + glow (`translateY(-2px)` + `glow-*`).
- Active: `translateY(0)` + sombra interna sutil (depressão).
- Disabled: `opacity: 0.5; pointer-events: none`.
- Inset highlight no topo: `inset 0 1px 0 rgba(255,255,255,0.15)` (em variantes preenchidas) — dá brilho de superfície.

### 9.2 Input / Select / Textarea

- `border: 1px solid var(--border-strong)`.
- Profundidade interna sutil: `box-shadow: inset 0 1px 2px var(--border-inner-dark)`.
- Foco: borda vira `--brand-azul` + ring `0 0 0 3px rgba(27,58,140,0.15)`.
- Erro: borda vira `--danger` + ring rosa.
- Disabled: `opacity: 0.5; cursor: not-allowed`.
- Sempre acompanhado de label semântica e (quando relevante) `hint` ou `error message` abaixo.
- Inputs com ícone: `padding-left: 38px` + ícone absolute em `left: 12px`, cor `--text-3`.

### 9.3 Card

- `bg: var(--bg-elev-1)`, `border: 1px solid var(--border)`, `box-shadow: var(--elev-2)`, `border-radius: var(--radius-md)`.
- Hover: Spotlight (halo verde segue cursor via `--mx`/`--my`) **+** Lift (`translateY(-3px)` para `elev-4` + borda vira `--border-strong`).
- Header com `card-icon` (44×44, bg de estado, `elev-1`) e badge opcional.
- Title em Bricolage 700 `text-xl` `letter-spacing -0.028em`.
- Body em Geist 400 `text-sm`, cor `--text-2`.

### 9.4 Card de produto (hero)

- `--grad-azul` ou `--grad-verde` como background.
- `box-shadow: var(--elev-4)`. Hover sobe pra `elev-5 + glow-azul`.
- Pseudo-elementos decorativos: glow brand radial atrás + estrela ★ marca d'água em `rgba(255,255,255,0.06)`.
- Valor monetário em Bricolage 800, `text-4xl`, com `text-shadow: 0 2px 12px rgba(0,0,0,0.2)`.

### 9.5 Badge

- Pill com bola colorida prefixada (`::before` 6×6 com `box-shadow` da própria cor — glow).
- Variantes: `success`, `warning`, `danger`, `info`, `neutral`.
- `font-size: 0.7rem`, `font-weight: 700`, `letter-spacing: 0.06em`, uppercase.
- `box-shadow: var(--elev-1)`.

### 9.6 Alert

- Border-left de 3px na cor do estado.
- Fundo no `--*-bg` correspondente.
- Estrutura: ícone + `alert-title` (bold) + `alert-text` (regular, cor `--text-2`).
- `box-shadow: var(--elev-1)`.

### 9.7 Tabela

- Wrapper com `bg: var(--bg-elev-1)`, `box-shadow: var(--elev-2)`, `border-radius: var(--radius-md)`, overflow hidden.
- `th`: caption-style (uppercase, tracking, peso 700), bg `--bg-elev-2`, cor `--text-3`.
- `td`: borda inferior `--border-subtle`, peso 500.
- Hover de linha: bg vira `--surface-hover` (transição rápida).
- Coluna de valor: classe `td-amount` força JetBrains Mono.
- Avatar circular 36×36 com `--grad-rondonia` (ou variantes verde/amarelo/azul), `box-shadow: var(--elev-2) + inset highlight`.

### 9.8 Stat / KPI

- Card com `bg-elev-1`, `elev-2`.
- Label uppercase tracking, valor em Bricolage 800 `text-3xl`.
- Trend pill: `↑/↓ X%` em JetBrains Mono, bg do estado correspondente (success-bg ou danger-bg).
- Decoração: radial gradient sutil top-right em verde 8%.

### 9.9 Switch / Toggle

- 44×24 pill. Track em `--surface-muted`, thumb 20×20 branca com shadow.
- Inset shadow no track: `inset 0 1px 3px rgba(0,0,0,0.15)`.
- Checked: track vira `--brand-verde`, thumb translada 20px.

### 9.10 Avatar

- Circular, 36×36 padrão.
- Background: `--grad-rondonia` (padrão) ou variantes `variant-verde`, `variant-amarelo` (texto `--brand-azul-deep`), `variant-azul`.
- Inset highlight superior + sombra externa elev-2.
- Iniciais em Geist 700, `text-xs`, `letter-spacing: -0.02em`.

### 9.11 Ícones

- Estilo: linear, `stroke-width: 2`, viewport 24×24.
- Container em grid: `icon-cell` com border, padding, hover Border + Scale.
- Não usar emoji em UI séria. Só ícones SVG inline.

---

## 10. Textura e atmosfera

### 10.1 Grain global

Aplicar em `body::before`, fixed, `z-index: 100`, `pointer-events: none`:

```css
body::before {
  background-image: url("data:image/svg+xml;utf8,<svg ...feTurbulence baseFrequency='0.9' numOctaves='3' .../></svg>");
  opacity: var(--grain-opacity); /* 0.045 light · 0.08 dark */
  mix-blend-mode: var(--grain-mode); /* multiply light · overlay dark */
}
```

A SVG completa está no HTML de referência. **Não remover.**

### 10.2 Glows ambiente de fundo

Em `body::after`, fixed, três radial gradients sutis nas cores da bandeira nos cantos da tela. Light: verde top-left, azul bottom-right, amarelo bottom-center. Dark: mais saturado mas mais difuso.

### 10.3 Animação de entrada

Seções com `animation: fade-up var(--dur-slow) var(--ease-out)` e delays escalonados (0.05s, 0.1s, 0.15s, ...). Respeite `prefers-reduced-motion: reduce` desativando.

---

## 11. Mapeamento Tailwind

O sistema é **CSS variables primeiro, Tailwind segundo**. O `tailwind.config.js` apenas expõe os tokens como classes utilitárias.

```js
// apps/web/tailwind.config.js (esqueleto canônico)
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['class', '[data-theme="dark"]'], // suporta as duas estratégias
  theme: {
    extend: {
      fontFamily: {
        display: ['"Bricolage Grotesque"', 'system-ui', 'sans-serif'],
        sans: ['Geist', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      colors: {
        // Brand
        azul: {
          DEFAULT: 'var(--brand-azul)',
          deep: 'var(--brand-azul-deep)',
          light: 'var(--brand-azul-light)',
        },
        verde: {
          DEFAULT: 'var(--brand-verde)',
          deep: 'var(--brand-verde-deep)',
          light: 'var(--brand-verde-light)',
        },
        amarelo: { DEFAULT: 'var(--brand-amarelo)', deep: 'var(--brand-amarelo-deep)' },

        // Neutros adaptáveis
        bg: 'var(--bg)',
        surface: {
          1: 'var(--bg-elev-1)',
          2: 'var(--bg-elev-2)',
          3: 'var(--bg-elev-3)',
          inset: 'var(--bg-inset)',
          muted: 'var(--surface-muted)',
          hover: 'var(--surface-hover)',
        },
        ink: {
          DEFAULT: 'var(--text)',
          2: 'var(--text-2)',
          3: 'var(--text-3)',
          4: 'var(--text-4)',
        },
        border: {
          DEFAULT: 'var(--border)',
          strong: 'var(--border-strong)',
          subtle: 'var(--border-subtle)',
        },

        // Estado
        success: { DEFAULT: 'var(--success)', bg: 'var(--success-bg)' },
        warning: { DEFAULT: 'var(--warning)', bg: 'var(--warning-bg)' },
        danger: { DEFAULT: 'var(--danger)', bg: 'var(--danger-bg)' },
        info: { DEFAULT: 'var(--info)', bg: 'var(--info-bg)' },
      },
      boxShadow: {
        e1: 'var(--elev-1)',
        e2: 'var(--elev-2)',
        e3: 'var(--elev-3)',
        e4: 'var(--elev-4)',
        e5: 'var(--elev-5)',
        'glow-azul': 'var(--glow-azul)',
        'glow-verde': 'var(--glow-verde)',
        'glow-amarelo': 'var(--glow-amarelo)',
      },
      borderRadius: {
        xs: '4px',
        sm: '6px',
        md: '10px',
        lg: '16px',
        xl: '24px',
      },
      spacing: {
        // Escala em rem alinhada com space-* (4px base)
        1: '0.25rem',
        2: '0.5rem',
        3: '0.75rem',
        4: '1rem',
        5: '1.5rem',
        6: '2rem',
        7: '3rem',
        8: '4rem',
        9: '6rem',
      },
      transitionTimingFunction: {
        out: 'cubic-bezier(0.16, 1, 0.3, 1)',
        'out-back': 'cubic-bezier(0.34, 1.56, 0.64, 1)',
      },
      transitionDuration: {
        fast: '150ms',
        DEFAULT: '250ms',
        slow: '400ms',
      },
    },
  },
  plugins: [],
};
```

> **Importante:** o ponto único de verdade dos valores é `apps/web/src/styles/globals.css` (onde as CSS vars são declaradas por tema). O Tailwind apenas referencia.

---

## 12. Acessibilidade

- **Contraste:** todos os pares fg/bg da paleta passam WCAG AA. Não altere sem rodar checker.
- **Focus visível:** todo elemento interativo expõe focus ring `0 0 0 3px rgba(27,58,140,0.15)` (azul, 3px). Não esconda outline sem substituto.
- **Movimento:** envelopar animações decorativas com `@media (prefers-reduced-motion: reduce) { animation: none; transition: none; }`.
- **Toque:** botões e área clicável mínima 40×40px.
- **Texto:** body mínimo 14px. CTAs e links nunca abaixo de 14px.
- **Form labels:** sempre `<label for>` ou `aria-label`. Placeholder não substitui label.
- **Dark mode:** respeite `prefers-color-scheme` no primeiro boot (sem flash). Toggle persiste em `localStorage`.

---

## 13. Anti-padrões — reprovam revisão

1. Cor hex hardcoded em componente (`#1B3A8C`) → usar token (`var(--brand-azul)` ou classe `bg-azul`).
2. `box-shadow` ad-hoc → usar `var(--elev-N)`.
3. Hover sem feedback visual → escolher um dos 6 padrões.
4. Tipografia padrão de sistema → sempre Bricolage/Geist/Mono.
5. Botão sem estado active/disabled/focus → todos os 4 estados são obrigatórios.
6. Card sem border + sem shadow → "card chapado" é reprovado.
7. Remoção do grain ou dos glows ambiente → reprovado, é identidade.
8. Dark mode com sombras idênticas ao light → no dark a sombra é mais sutil mas o `inset 0 1px 0` (highlight superior) é **crucial**.
9. Avatar com background sólido → sempre `--grad-*`.
10. Tabela com linhas igualmente espaçadas mas sem hover de linha → reprovado, perde escaneabilidade.
11. Modal/popover sem `--elev-5` → falta de hierarquia visual.
12. Input sem inset shadow interno → parece "sticker", não campo de entrada.
13. Texto branco puro sobre fundo creme/escuro → usar `--text` (que respeita o tema).
14. Quebrar a estrutura de 3 camadas da elevação (sombra ext + inset top + inset bottom) → "pode parecer igual mas perde a sensação física".

---

## 14. Referência viva

A doc HTML em [`docs/design-system/index.html`](./design-system/index.html) é a **verdade visual**. Quando o markdown e o HTML divergirem, o HTML vence — atualize o markdown.

Ao implementar qualquer slot de UI:

1. Abra a referência HTML no navegador (`open docs/design-system/index.html` ou drag-and-drop).
2. Identifique os componentes que sua tela usa.
3. Inspecione no DevTools as classes/tokens aplicados.
4. Implemente usando os tokens descritos aqui, **sem reinventar**.

---

## 15. Como propor mudanças no DS

O DS não é estático, mas mudanças têm cerimônia:

1. Abrir issue com título `[DS] proposta: <mudança>` descrevendo o que muda, por quê, e qual o impacto nos componentes existentes.
2. Atualizar `docs/design-system/index.html` em PR separado (não junto com slot de produto).
3. Atualizar este documento (`docs/18-design-system.md`) no mesmo PR.
4. Bump da versão (v2.0 → v2.1 para adição compatível; v3.0 para breaking).
5. Aprovação do Rogério obrigatória.
