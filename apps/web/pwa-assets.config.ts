import type {
  AppleDeviceName,
  AssetType,
  ResolvedAssetSize,
} from '@vite-pwa/assets-generator/config';
import {
  combinePresetAndAppleSplashScreens,
  defineConfig,
} from '@vite-pwa/assets-generator/config';

// ─── F27-S02 — Ícones e splash PWA (doc 24 §3.3) ─────────────────────────────
//
// Gera o conjunto de assets do PWA a partir da arte-fonte única
// `public/pwa-source.svg` (identidade do DS v2 — ver comentário no próprio
// SVG). Os nomes de arquivo são fixados pelo manifesto que o F27-S01 já
// referenciou em `vite.config.ts` — não renomear sem atualizar os dois
// lugares.

// Arte-fonte = logo do Banco do Povo (`public/pwa-source.png`, o brasão das três
// figuras nas cores de Rondônia — copiado de `src/assets/brand/icone-bp.png`). A
// logo NÃO é full-bleed (tem transparência ao redor), então compositamos sobre
// fundo branco com um respiro. O maskable ganha padding maior (safe-zone: a
// máscara do SO pode recortar ~10% de cada borda) para a logo não ser cortada.
const BRAND_BG = '#FFFFFF';

/** Logo sobre fundo branco com `padding` (fração da borda que vira margem). */
function onBrandBg(padding: number) {
  return {
    padding,
    resizeOptions: { fit: 'contain' as const, background: BRAND_BG },
  };
}

/**
 * Nomes exatos referenciados pelo manifesto do F27-S01
 * (`apps/web/vite.config.ts`): `/pwa-192x192.png`, `/pwa-512x512.png`,
 * `/pwa-maskable-512x512.png`. O apple-touch-icon mantém o padrão
 * descritivo do gerador (`apple-touch-icon-<size>.png`) — referenciado
 * pelo `href` em `index.html`.
 */
function assetName(type: AssetType, size: ResolvedAssetSize): string {
  if (type === 'maskable') {
    return `pwa-maskable-${size.width}x${size.height}.png`;
  }
  if (type === 'apple') {
    return `apple-touch-icon-${size.width}x${size.height}.png`;
  }
  return `pwa-${size.width}x${size.height}.png`;
}

/**
 * Splash screens iOS (doc 24 §3.3 / §11 — iOS não usa maskable, precisa de
 * `apple-touch-startup-image` dedicado). Conjunto curado dos aparelhos
 * atuais mais comuns (iPhone 15/16 + iPad Pro/Air/mini/10.2") em vez de
 * `AllAppleDeviceNames` (55 aparelhos, incluindo modelos descontinuados há
 * anos) — mantém o repo enxuto sem abrir mão da cobertura real de uso.
 * Fundo `--bg` (creme, light-first — mesmo valor do `background_color` do
 * manifesto) para uma tela de abertura coesa com o resto do DS.
 */
const splashDevices: AppleDeviceName[] = [
  'iPhone 16 Pro Max',
  'iPhone 16 Pro',
  'iPhone 16 Plus',
  'iPhone 16',
  'iPhone 16e',
  'iPhone 15 Pro Max',
  'iPhone 15 Pro',
  'iPhone 15',
  'iPhone SE 4.7"',
  'iPad Pro 12.9"',
  'iPad Pro 11"',
  'iPad Air 11"',
  'iPad 10.2"',
  'iPad mini 8.3"',
];

const preset = combinePresetAndAppleSplashScreens(
  {
    transparent: {
      ...onBrandBg(0.1),
      sizes: [192, 512],
      favicons: [[48, 'favicon.ico']],
    },
    maskable: {
      ...onBrandBg(0.2),
      sizes: [512],
    },
    apple: {
      ...onBrandBg(0.12),
      sizes: [180],
    },
    assetName,
  },
  {
    resizeOptions: { fit: 'contain', background: '#F7F4ED' }, // --bg (light)
  },
  splashDevices,
);

export default defineConfig({
  headLinkOptions: {
    preset: '2023',
  },
  preset,
  images: ['public/pwa-source.png'],
});
