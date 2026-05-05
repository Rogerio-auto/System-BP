# CLAUDE.md — Instruções de projeto (Elemento — Banco do Povo)

> Lido automaticamente pelo Claude Code em toda sessão neste repositório.
> Complementa (não substitui) o `~/.claude/CLAUDE.md` do Rogério.

## Contexto do projeto

- **Tipo de execução:** Híbrido (backend Node + frontend React + serviço Python LangGraph + futuras automações n8n).
- **Tipo de ownership:** Cliente (Banco do Povo / SEDEC Rondônia).
- **Documentação canônica:** `docs/00-visao-geral.md` … `docs/16-revisao-critica.md`. **Sempre** consultar antes de implementar.
- **Sistema de tasks:** `tasks/PROTOCOL.md` é lei. `tasks/STATUS.md` é o board. Slots em `tasks/slots/F<n>/`.

## Stack obrigatória

- **Backend:** Node 20.11.0, pnpm 9, Fastify 5, TypeScript strict, Drizzle ORM, Zod, Pino, jose, bcryptjs.
- **Frontend:** React 18, Vite 5, Tailwind 3 (dark-first, paleta `ink`), TanStack Query, Zustand, React Hook Form.
- **Python:** 3.12, FastAPI, LangGraph 0.2, Pydantic v2, structlog, httpx, tenacity.
- **Banco:** Postgres 16 (extensões `pgcrypto`, `pg_trgm`, `unaccent`, `citext`).
- **LLM gateway:** OpenRouter (default). Não chamar Anthropic/OpenAI diretamente em código novo — usar `app/llm/gateway.py`.

## Regras invioláveis

1. **Postgres é fonte de verdade.** LangGraph nunca toca direto no DB — só via `/internal/*` do backend com header `X-Internal-Token`.
2. **Outbox pattern** para todo evento. Sem Redis no MVP.
3. **RBAC + escopo de cidade** em toda rota. Repository injeta `applyCityScope`.
4. **Sem `any`.** Sem `as` exceto em casos justificados em comentário.
5. **Validação Zod em todas as bordas** (HTTP, fila, webhook).
6. **Feature flags em 4 camadas** (UI/API/worker/tool).
7. **Auditoria + idempotência** em mutações sensíveis.
8. **Multi-tenant ready desde o dia 1** (`organization_id` em toda tabela de domínio).

## Como trabalhar neste repositório

1. Ler `tasks/PROTOCOL.md` na primeira mensagem da sessão.
2. Identificar o slot atual (passado pelo Rogério ou orquestrador).
3. Ler **apenas** os docs listados em `source_docs` do slot.
4. Implementar **somente** dentro de `files_allowed`. Tocar em `files_forbidden` é bloqueio.
5. Validar localmente com os comandos da seção `Validação` do slot.
6. Atualizar frontmatter do slot e `tasks/STATUS.md` antes de abrir PR.

## Comandos canônicos

```powershell
# Setup (uma vez)
pnpm install
Copy-Item .env.example .env   # editar valores reais
docker compose up -d postgres
pnpm --filter @elemento/api db:migrate

# Dev
docker compose up -d
pnpm dev                      # turbo orquestra api + web
# Python: cd apps/langgraph-service; uv sync; uv run uvicorn app.main:app --reload

# Validações antes de PR
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

## Hierarquia de subagentes (ver `.claude/agents/`)

```
orchestrator        ← entrada do Rogério
   ├─ backend-engineer        (apps/api, packages/shared-*)
   ├─ frontend-engineer       (apps/web)
   ├─ python-engineer         (apps/langgraph-service)
   ├─ db-schema-engineer      (apps/api/src/db/**)
   ├─ security-reviewer       (read-only, gate antes de merge)
   └─ qa-tester               (escreve/roda testes)
```

Sempre delegar via subagente especialista. Orquestrador **não** escreve código.

## Quando estiver em dúvida

- Stack: `~/.claude/CLAUDE.md` + este arquivo + `docs/02-arquitetura-sistema.md`.
- Regra de negócio: `docs/01-prd-produto.md` + `docs/05-modulos-funcionais.md`.
- Segurança: `docs/10-seguranca-permissoes.md`.
- Eventos: `docs/04-eventos.md`.
