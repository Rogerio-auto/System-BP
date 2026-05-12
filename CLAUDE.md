# CLAUDE.md — Instruções de projeto (Elemento — Banco do Povo)

> Lido automaticamente pelo Claude Code em toda sessão neste repositório.
> Complementa (não substitui) o `~/.claude/CLAUDE.md` do Rogério.

## Contexto do projeto

- **Tipo de execução:** Híbrido (backend Node + frontend React + serviço Python LangGraph + futuras automações n8n).
- **Tipo de ownership:** Cliente (Banco do Povo / SEDEC Rondônia).
- **Documentação canônica:** `docs/00-visao-geral.md` … `docs/18-design-system.md`. **Sempre** consultar antes de implementar.
- **Sistema de tasks:** `tasks/PROTOCOL.md` é lei. `tasks/STATUS.md` é o board. Slots em `tasks/slots/F<n>/`.
- **Política LGPD:** `docs/17-lgpd-protecao-dados.md` é normativa. Vence qualquer slot, PR ou decisão informal em conflito. Tratamento de dados pessoais sem ler o doc 17 é violação.
- **Design System (lei visual):** `docs/18-design-system.md` (tokens, profundidade, hovers, componentes) + `docs/design-system/index.html` (referência viva — abrir no navegador). Vence qualquer slot de UI em conflito. PR de frontend que não usa os tokens canônicos é bloqueado.

## Stack obrigatória

- **Backend:** Node 20.11.0, pnpm 9, Fastify 5, TypeScript strict, Drizzle ORM, Zod, Pino, jose, bcryptjs.
- **Frontend:** React 18, Vite 5, Tailwind 3 (light-first com dark toggle, tokens do DS oficial em `docs/18-design-system.md` — Bricolage Grotesque + Geist + JetBrains Mono, cores da bandeira de Rondônia), TanStack Query, Zustand, React Hook Form.
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
9. **LGPD não-negociável.** CPF cifrado em coluna + hash HMAC para dedupe; logs com `pino.redact` da lista canônica; DLP antes de qualquer chamada ao gateway LLM (nada de PII bruta para suboperador internacional); outbox sem PII bruta; retenção por job; direitos do titular implementáveis em ≤15 dias úteis. Regras detalhadas em `docs/17-lgpd-protecao-dados.md`. PR que toca PII sem checklist do §14.2 do doc 17 é bloqueado.

## Como trabalhar neste repositório

1. Ler `tasks/PROTOCOL.md` na primeira mensagem da sessão.
2. Identificar o slot atual (passado pelo Rogério ou orquestrador).
3. Ler **apenas** os docs listados em `source_docs` do slot.
4. Implementar **somente** dentro de `files_allowed`. Tocar em `files_forbidden` é bloqueio.
5. Validar com `python scripts/slot.py validate <SLOT-ID>`.
6. **NUNCA** editar `tasks/STATUS.md` à mão ou criar branch manualmente — usar `scripts/slot.py`.

## Regras anti-bug (aprendidas em 2026-05-11)

1. **1 working tree = 1 agente.** Mais que isso só com `isolation: "worktree"` no `Task`. Sem exceções.
2. **`scripts/slot.py` é a única forma de claim/finish/sync.** STATUS.md é view derivada dos frontmatters — edição direta é proibida.
3. **Pre-flight obrigatório:** `git status --short && git rev-parse --abbrev-ref HEAD` no início de qualquer agente. Sujo ou branch errado = abortar.
4. **Sem `--no-verify`.** Se o hook falhar, conserte o root cause.

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

# Slot lifecycle (SEMPRE estes — nunca git manual em frontmatter/STATUS.md)
python scripts/slot.py status                    # resumo do board
python scripts/slot.py list-available            # slots prontos
python scripts/slot.py claim   <SLOT-ID>         # reserva + branch + frontmatter + commit chore
python scripts/slot.py validate <SLOT-ID>        # roda bloco Validação do slot
python scripts/slot.py finish  <SLOT-ID>         # frontmatter review + commit chore
python scripts/slot.py reconcile-merged --write  # pós-merge: marca slots done

# Validações antes de fechar slot
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
- LGPD / proteção de dados: `docs/17-lgpd-protecao-dados.md`.
- UI / design / tokens / componentes: `docs/18-design-system.md` + `docs/design-system/index.html`.
