import path from 'node:path';

import mdx from '@mdx-js/rollup';
import react from '@vitejs/plugin-react';
import rehypeAutolinkHeadings from 'rehype-autolink-headings';
import rehypeSlug from 'rehype-slug';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import remarkMdxFrontmatter from 'remark-mdx-frontmatter';
import { defineConfig } from 'vite';

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
