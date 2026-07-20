import path from 'node:path';

import mdx from '@mdx-js/rollup';
import react from '@vitejs/plugin-react';
import rehypeAutolinkHeadings from 'rehype-autolink-headings';
import rehypeSlug from 'rehype-slug';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import remarkMdxFrontmatter from 'remark-mdx-frontmatter';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    // enforce:'pre' garante que MDX transforma .mdx -> JSX ANTES do react plugin
    // tentar parsear como babel.
    {
      enforce: 'pre',
      ...mdx({
        remarkPlugins: [
          remarkGfm,
          remarkFrontmatter,
          // Expõe YAML frontmatter como named export `frontmatter` em cada .mdx,
          // permitindo que o manifest leia título/descrição via dynamic import.
          [remarkMdxFrontmatter, { name: 'frontmatter' }],
        ],
        rehypePlugins: [rehypeSlug, rehypeAutolinkHeadings],
        providerImportSource: '@mdx-js/react',
      }),
    },
    react(),
    // ─── PWA (F27-S01) ──────────────────────────────────────────────────────
    // Modo `injectManifest`: o SW é escrito à mão em `src/sw/service-worker.ts`
    // (não `generateSW`) porque o F27-S07 precisa adicionar handlers custom de
    // `push`/`notificationclick` no mesmo arquivo — o modo automático do
    // Workbox não permite. `registerType: 'prompt'` — atualização nunca é
    // silenciosa (doc 24 §3.4): o operador confirma via UpdatePrompt.
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src/sw',
      filename: 'service-worker.ts',
      injectRegister: false, // registro manual via src/pwa/register.ts
      registerType: 'prompt',
      devOptions: {
        enabled: false, // evita ruído de SW durante `pnpm dev`
      },
      manifest: {
        name: 'Manager — Banco do Povo',
        short_name: 'Manager',
        id: '/',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'any',
        lang: 'pt-BR',
        // Tokens do DS v2 (docs/18-design-system.md §3.2) — cor da bandeira de
        // Rondônia como identidade do app instalado.
        theme_color: '#1B3A8C', // --brand-azul (light)
        background_color: '#F7F4ED', // --bg (light)
        categories: ['business', 'productivity'],
        icons: [
          // Ícones definitivos entram no F27-S02 (@vite-pwa/assets-generator);
          // caminhos referenciados aqui para não bloquear o app-shell.
          { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/pwa-maskable-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
        shortcuts: [
          { name: 'Conversas', url: '/conversas' },
          { name: 'CRM', url: '/crm' },
          { name: 'Relatórios', url: '/relatorios' },
        ],
      },
      injectManifest: {
        // Assets de build do app-shell (JS/CSS/HTML). Não inclui nada de
        // `api.*` — é outra origem e nunca é cacheada (doc 24 §3.4/§9 LGPD).
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
      },
    }),
  ],
  envDir: path.resolve(__dirname, '../..'),
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // MDX em docs/help/ (fora de apps/web) precisa resolver providerImportSource
      // pelo path absoluto — Node resolution sobe a partir do .mdx e não acha
      // node_modules em CI clean. Alias força o caminho exato.
      '@mdx-js/react': path.resolve(__dirname, 'node_modules/@mdx-js/react'),
    },
  },
  optimizeDeps: {
    // Pré-bundle obrigatório de @mdx-js/react. Sem isso, MDX em docs/help/ (fora
    // do project root) só é descoberto sob demanda → Vite re-otimiza deps em
    // tempo de navegação → emite novo hash ?v= → instâncias duplicadas de
    // @mdx-js/react → useContext(null) → "Invalid hook call".
    include: ['@mdx-js/react'],
  },
  server: {
    port: 5173,
    host: true,
    // Vite por default só serve arquivos dentro do project root (apps/web).
    // docs/ está no monorepo root — precisamos liberar acesso.
    fs: {
      allow: [path.resolve(__dirname, '../..')],
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      onwarn(warning, defaultHandler) {
        if (
          warning.code === 'SOURCEMAP_ERROR' &&
          warning.loc?.file?.includes('@tanstack/react-query')
        ) {
          return;
        }
        defaultHandler(warning);
      },
    },
  },
});
