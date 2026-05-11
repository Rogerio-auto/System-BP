# apps/web

Frontend React + Vite + TypeScript estrito + Tailwind 3 (dark-first).

Veja [docs/02-arquitetura-sistema.md](../../docs/02-arquitetura-sistema.md). Padrão de design: Linear / Vercel / Stripe (refinar em `/hm-designer`).

## Comandos

| Comando          | O que faz                    |
| ---------------- | ---------------------------- |
| `pnpm dev`       | Vite dev server (porta 5173) |
| `pnpm build`     | Build de produção em `dist/` |
| `pnpm preview`   | Serve o build localmente     |
| `pnpm typecheck` | TS project references        |
| `pnpm lint`      | ESLint                       |
| `pnpm test`      | Vitest                       |

## Estrutura prevista (criada conforme as tasks)

```
src/
├── features/         # CRM, Kanban, Auth, etc — agrupado por domínio
├── components/       # primitivos de UI reutilizáveis
├── lib/              # api client, query helpers, utils
├── hooks/            # hooks compartilhados
├── routes/           # roteamento (se virar centralizado)
└── styles/           # globals.css, tokens
```
