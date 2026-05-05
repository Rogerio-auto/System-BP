# apps/api

Backend Fastify + TypeScript estrito + Drizzle ORM.

Veja [docs/02-arquitetura-sistema.md](../../docs/02-arquitetura-sistema.md) para arquitetura e [docs/12-tasks-tecnicas.md](../../docs/12-tasks-tecnicas.md) para tasks.

## Comandos

| Comando | O que faz |
|---|---|
| `pnpm dev` | Sobe API com hot reload (tsx watch) |
| `pnpm build` | Compila TS para `dist/` |
| `pnpm start` | Roda `dist/server.js` (produção) |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` | ESLint |
| `pnpm test` | Vitest |
| `pnpm db:generate` | Gera SQL de migration a partir de mudança no schema |
| `pnpm db:migrate` | Aplica migrations no banco |
| `pnpm db:studio` | Abre Drizzle Studio |
