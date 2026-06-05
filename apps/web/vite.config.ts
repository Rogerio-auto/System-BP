import path from 'node:path';

import mdx from '@mdx-js/rollup';
import react from '@vitejs/plugin-react';
import rehypeAutolinkHeadings from 'rehype-autolink-headings';
import rehypeSlug from 'rehype-slug';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    mdx({
      remarkPlugins: [remarkGfm, remarkFrontmatter],
      rehypePlugins: [rehypeSlug, rehypeAutolinkHeadings],
      providerImportSource: '@mdx-js/react',
    }),
    react({ include: /\.(jsx|tsx|mdx)$/ }),
  ],
  envDir: path.resolve(__dirname, '../..'),
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: {
    port: 5173,
    host: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    // O WASM da oniguruma (shiki) é ~622 KB — esperado, lazy-loaded.
    // 700 KB acomoda sem mascarar regressões reais do app bundle.
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      // Sourcemap warnings de deps externas (@tanstack/react-query) poluem o log
      // sem indicar problema real do nosso código. Silenciamos só esse subtipo.
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
