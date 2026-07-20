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

/**
 * `padding: 0` em todo o pipeline (transparent/maskable/apple): a
 * arte-fonte já é full-bleed (fundo `--grad-rondonia` cobre 0,0→512,512) e
 * já contém a safe-zone da estrela embutida. Deixar o gerador aplicar um
 * padding adicional criaria uma faixa morta (branca/transparente) nas
 * bordas — quebra o "full bleed" exigido pelo maskable e destoa da
 * identidade nos ícones "any".
 */
const fullBleed = {
  padding: 0,
  resizeOptions: { fit: 'contain' as const },
};

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
      ...fullBleed,
      sizes: [192, 512],
      favicons: [[48, 'favicon.ico']],
    },
    maskable: {
      ...fullBleed,
      sizes: [512],
    },
    apple: {
      ...fullBleed,
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
  images: ['public/pwa-source.svg'],
});
