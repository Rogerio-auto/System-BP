---
name: regression-guard
description: Detecta risco de regressão antes de editar arquivos. Lista commits `fix:` históricos e os arquivos que cada um tocou — use no INÍCIO de qualquer trabalho de frontend/backend para garantir que não vai reverter bug já corrigido. Obrigatório antes de mexer em rotas, schemas, modais ou hooks que tiveram fix recente.
---

# /regression-guard

Skill defensiva criada após o batch de regressões de 2026-05-14 (commits `a6d40ea`, `151f792`, `f89dfa3` voltaram a apresentar bugs em refactors posteriores).

## Causa raiz das regressões

1. Agentes paralelos editam o mesmo arquivo sem ver os fixes anteriores.
2. Refactors de UI/feature substituem componentes inteiros (ex: `NewLeadModal`) e perdem ajustes finos (forwardRef no Select, Bearer no upload, RBAC `cities:manage`).
3. Reinstalação de seed/migration zera fixes de seed (ex: role admin do usuário inicial).
4. Mudanças em hooks de kanban perdem o shape novo da API e voltam a usar mock.

## Quando usar (OBRIGATÓRIO)

- Antes de editar **qualquer** rota, controller, repository, schema ou middleware do `apps/api`.
- Antes de editar **qualquer** componente, hook ou página do `apps/web` que apareça na lista de fixes históricos.
- Antes de rodar `db:seed`, `db:reset` ou alterar `apps/api/scripts/seed.ts`.
- No início de qualquer sessão de implementação (junto com `/preflight`).

## Uso

```bash
# Listar todos os fixes históricos com os arquivos que tocaram
python scripts/regression_guard.py list

# Checar se um arquivo específico teve fix recente
python scripts/regression_guard.py check apps/web/src/features/crm/NewLeadModal.tsx

# JSON para automação
python scripts/regression_guard.py list --json
python scripts/regression_guard.py check <file> --json
```

## Procedimento (passo a passo)

1. Antes de editar um arquivo, rode `python scripts/regression_guard.py check <file>`.
2. Se retornar 1+ fix, **leia o commit completo** com `git show <sha>` e entenda o que foi corrigido.
3. Mantenha o ajuste do fix no seu refactor. Se precisar alterar, cite o sha do fix anterior no commit message (ex: `refactor(web): NewLeadModal — preserva forwardRef do Select (mantém fix a6d40ea)`).
4. Se for fazer um rewrite completo, rode os testes do módulo afetado (`pnpm --filter @elemento/api test -- kanban`) e abra a UI no browser para validar o golden path.
5. Nunca aplique `db:reset` + `db:seed` sem confirmar que o seed atual atribui role admin ao usuário inicial.

## Lista canônica de fixes que NÃO podem regredir

| SHA               | Data       | Bug evitado                                                                                                                                                                                 | Arquivos críticos                                                                                                                                                                                                                                                                          |
| ----------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `a6d40ea`         | 2026-05-12 | Seed sem role admin (403 pós-login)                                                                                                                                                         | `apps/api/scripts/seed.ts`                                                                                                                                                                                                                                                                 |
| `a6d40ea`         | 2026-05-12 | GET /api/kanban/stages e /cards faltavam                                                                                                                                                    | `apps/api/src/modules/kanban/{routes,controller,repository,service,schemas}.ts`                                                                                                                                                                                                            |
| `a6d40ea`         | 2026-05-12 | Select sem forwardRef quebra RHF                                                                                                                                                            | `apps/web/src/components/ui/Select.tsx`                                                                                                                                                                                                                                                    |
| `a6d40ea`         | 2026-05-12 | NewLeadModal não centralizado                                                                                                                                                               | `apps/web/src/features/crm/NewLeadModal.tsx`                                                                                                                                                                                                                                               |
| `a6d40ea`         | 2026-05-12 | uploadLeadsFile sem Authorization Bearer                                                                                                                                                    | `apps/web/src/lib/api/imports.ts`                                                                                                                                                                                                                                                          |
| `a6d40ea`         | 2026-05-12 | Hooks kanban com mock fallback (escondem 500)                                                                                                                                               | `apps/web/src/hooks/kanban/{useKanbanStages,useKanbanCards}.ts`                                                                                                                                                                                                                            |
| `151f792`         | 2026-05-12 | Worker import-processor não roda em `pnpm dev`                                                                                                                                              | `apps/api/package.json` (script `dev`)                                                                                                                                                                                                                                                     |
| `f89dfa3`         | 2026-05-12 | RBAC cities exigia `admin:cities:write` em vez de `cities:manage`                                                                                                                           | `apps/api/src/modules/cities/routes.ts`                                                                                                                                                                                                                                                    |
| `f89dfa3`         | 2026-05-12 | GET /api/cities (authenticate-only) para popular selects                                                                                                                                    | `apps/api/src/modules/cities/{routes,controller,schemas}.ts` + `apps/web/src/hooks/useCitiesList.ts`                                                                                                                                                                                       |
| `2c87555`         | 2026-05-11 | Web apontava para porta 3000 (Fastify é 3333)                                                                                                                                               | `apps/web/src/lib/api/*`                                                                                                                                                                                                                                                                   |
| `e5420b9`         | 2026-05-11 | authRoutes não registrado + sintaxe tsx watch errada                                                                                                                                        | `apps/api/src/app.ts`, `apps/api/package.json`                                                                                                                                                                                                                                             |
| _seed-kanban_     | 2026-05-14 | Kanban vazio após criar lead — seed dos 5 stages canônicos + `createLead` cria `kanban_card` no stage inicial na mesma tx + history `lead_created` + outbox `kanban.card_created`           | `apps/api/scripts/seed.ts`, `apps/api/src/modules/leads/service.ts`, `apps/api/src/modules/kanban/repository.ts`                                                                                                                                                                           |
| _kanban-dnd_      | 2026-05-14 | Drag&drop quebrado: payload era `stage_id`, backend espera `toStageId`; coluna vazia sem droppable; `verticalListSortingStrategy` causava shift visual; card original duplicava com overlay | `apps/web/src/hooks/kanban/useMoveCard.ts`, `apps/web/src/components/kanban/KanbanColumn.tsx`, `apps/web/src/components/kanban/KanbanCard.tsx`                                                                                                                                             |
| _kanban-overlay_  | 2026-05-14 | `DragOverlay` desalinhado do cursor — ancestores com `transform` (fade-up) criam containing-block para `position: fixed`                                                                    | `apps/web/src/pages/kanban/KanbanPage.tsx` (portal pro `document.body`), `apps/web/src/styles/globals.css` (`transform: none` explícito no `to` do keyframe fade-up)                                                                                                                       |
| _session-persist_ | 2026-05-14 | Reload exigia re-login: `csrf_token` cookie tinha `path=/api/auth` (invisível ao JS via `document.cookie`); refresh não retornava `user`; sem bootstrap no boot                             | `apps/api/src/modules/auth/controller.ts` (csrf path=`/`), `apps/api/src/modules/auth/service.ts` (refresh retorna user), `packages/shared-schemas/src/auth.ts`, `apps/web/src/lib/api.ts` (`bootstrapSession`), `apps/web/src/app/SessionBootstrap.tsx`, `apps/web/src/app/AuthGuard.tsx` |
| _outbox-locale_   | 2026-05-14 | Loop infinito do outbox-publisher: detecção de unique-violation por `msg.includes('unique')` falhava em Postgres pt-BR (`"duplicar valor da chave"`)                                        | `apps/api/src/workers/outbox-publisher.ts` (substituído por `.onConflictDoNothing(...).returning()`)                                                                                                                                                                                       |

**Esta tabela é atualizada toda vez que um commit `fix:` for criado.** Rodar `python scripts/regression_guard.py sync-table` regenera a seção `<!-- regression-guard:table -->` abaixo (a lista canônica de cima é mantida à mão para incluir o contexto humano).

## Regra inviolável

**Refactor que reverte um fix sem justificativa explícita é BLOQUEIO de PR.** O reviewer (`/security-review`, `/hm-engineer`) deve rodar `python scripts/regression_guard.py check` em todos os arquivos do diff e abortar se algum match não tiver citação ao fix anterior no commit message.

## Tabela gerada (sync-table)

<!-- regression-guard:table:start -->

| SHA       | Data       | Subject                                                                                       | Arquivos                                                                                                                                                                                                                                                                            |
| --------- | ---------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `f89dfa3` | 2026-05-12 | fix: rbac cities (cities:manage) + select dinamico de cidade no NewLeadModal                  | `apps/api/src/app.ts`<br>`apps/api/src/modules/cities/__tests__/routes.test.ts`<br>`apps/api/src/modules/cities/controller.ts`<br>`apps/api/src/modules/cities/routes.ts`<br>`apps/api/src/modules/cities/schemas.ts`<br>`apps/web/src/features/crm/NewLeadModal.tsx`<br>… (+2)     |
| `a6d40ea` | 2026-05-12 | fix: batch de 8 bugs runtime (seed roles, kanban GETs, modal, upload auth, select forwardref) | `apps/api/scripts/seed.ts`<br>`apps/api/src/modules/kanban/__tests__/routes.test.ts`<br>`apps/api/src/modules/kanban/controller.ts`<br>`apps/api/src/modules/kanban/repository.ts`<br>`apps/api/src/modules/kanban/routes.ts`<br>`apps/api/src/modules/kanban/schemas.ts`<br>… (+6) |
| `2464ddb` | 2026-05-12 | fix(tools): reconcile-merged em 2 camadas (gh PR detect + filtro de chore)                    | `scripts/slot.py`                                                                                                                                                                                                                                                                   |
| `2c87555` | 2026-05-12 | fix(web): default API_BASE alinhado ao backend Fastify (3333 nao 3000)                        | `apps/web/src/lib/api.ts`                                                                                                                                                                                                                                                           |
| `e5420b9` | 2026-05-12 | fix(api): registra authRoutes + corrige sintaxe tsx watch no script dev                       | `apps/api/package.json`<br>`apps/api/src/app.ts`                                                                                                                                                                                                                                    |
| `b85a71c` | 2026-05-12 | fix(api): F1-S28 separa drizzle.config.ts do typecheck do api (tsconfig.tools.json) (#34)     | `apps/api/package.json`<br>`apps/api/tsconfig.json`<br>`apps/api/tsconfig.tools.json`                                                                                                                                                                                               |
| `37e5696` | 2026-05-12 | fix(db): F1-S27 corrige encadeamento .using('gin') em schemas Drizzle (#31)                   | `apps/api/src/db/schema/cities.ts`<br>`apps/api/src/db/schema/leads.ts`                                                                                                                                                                                                             |
| `2a1b42d` | 2026-05-11 | fix(web): remove form payload from placeholder console.warn [F0-S05]                          | `apps/web/src/features/auth/LoginPage.tsx`                                                                                                                                                                                                                                          |

<!-- regression-guard:table:end -->
