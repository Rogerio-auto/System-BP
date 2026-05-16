---
id: F8-S10
title: Reconciliação RBAC — padronizar permissões em :manage
phase: F8
task_ref: F8.10
status: done
priority: medium
estimated_size: M
agent_id: backend-engineer
claimed_at: 2026-05-16T16:52:15Z
completed_at: 2026-05-16T17:02:48Z
pr_url: https://github.com/Rogerio-auto/System-BP/pull/72
depends_on: []
blocks: []
labels: []
source_docs:
  - docs/10-seguranca-permissoes.md
---

# F8-S10 — Reconciliação RBAC (convenção `:manage`)

## Contexto (incoerência descoberta em 2026-05-16)

O catálogo de permissões está inconsistente entre seed, migrations, rotas e doc:

- O seed canônico `apps/api/scripts/seed.ts` cria `users:manage`, `agents:manage`,
  `cities:manage` — e os atribui às roles. O doc 10 §3.2 bate com esse seed.
- Mas as **rotas** divergiram: `users/routes.ts` e `roles/routes.ts` exigem
  `users:admin`; `agents/routes.ts` exige `agents:admin`.
- **`users:admin` não é semeado em lugar nenhum.** Não existe na tabela `permissions`.
  As rotas que o exigem só funcionam hoje porque o usuário `admin` tem bypass de
  wildcard.
- **`agents:admin`** foi adicionado à parte pela migration `0019_seed_agents_permission.sql`,
  **duplicando** o `agents:manage` que o seed base já cria e já atribui.

Decisão (Rogério, 2026-05-16): **`:manage` é a convenção canônica.** É o que o seed e o
doc já usam para 30+ permissões; só os módulos `users` e `agents` fugiram. Este slot
elimina a divergência.

## Objetivo

Padronizar toda a autorização de gestão de usuários e agentes em `:manage`, remover a
permissão órfã `agents:admin`, e deixar seed + rotas + frontend + doc 10 coerentes.

## Escopo

### 1. Auditoria inicial (obrigatória)

`grep` por `users:admin` e `agents:admin` em TODO o repo (`apps/api`, `apps/web`,
ignorar `dist/` e `node_modules/`). Lista exaustiva de ocorrências antes de mudar nada.
Confirmar via query no banco que `users:manage` e `agents:manage` existem na tabela
`permissions` e estão atribuídos às roles esperadas (devem estar — vêm do seed base).

### 2. Rotas backend → `:manage`

- `users/routes.ts`: `users:admin` → `users:manage`.
- `roles/routes.ts`: `users:admin` → `users:manage` (gestão de papéis é parte de
  gestão de usuários).
- `agents/routes.ts` (e qualquer outro arquivo do módulo `agents`): `agents:admin` →
  `agents:manage`.
- Atualizar comentários de cabeçalho desses arquivos que citam a chave antiga.

### 3. Migration `0022_drop_agents_admin_permission.sql`

- `agents:admin` é redundante (`agents:manage` do seed base já cobre, já atribuído).
  Migration que **remove** a permissão `agents:admin` da tabela `permissions` — o
  `ON DELETE CASCADE` de `role_permissions` limpa os vínculos automaticamente.
- Idempotente (`DELETE ... WHERE key = 'agents:admin'` é naturalmente idempotente).
- **NÃO editar** `0019_seed_agents_permission.sql` (migration já aplicada — registro
  histórico imutável). A correção é uma migration nova.
- `_journal.json`: entrada `0022` com `when` ESTRITAMENTE MAIOR que o da `0021`
  (`1748995200000`) — use `1749081600000`. Migration com `when` não monotônico é
  silenciosamente pulada. Rodar `python scripts/slot.py check-migrations`.
- `users:admin` **não** precisa de migration — nunca foi semeado; some sozinho quando
  as rotas pararem de exigi-lo.

### 4. Frontend → `:manage`

- `apps/web/src/features/configuracoes/ConfiguracoesPage.tsx`: o hub gate os cards
  Usuários (`users:admin`) e Agentes (`agents:admin`) — trocar para `users:manage` /
  `agents:manage`.
- `apps/web/src/components/layout/Sidebar.tsx`: conferir se ainda referencia as chaves
  antigas (F8-S08 removeu a seção Administração; pode não restar nada). Se restar,
  trocar; se não, não tocar.
- Esta é a ÚNICA mudança de frontend — renomear strings de chave. Sem mudança de UI.

### 5. Testes

- Atualizar os testes que usam `users:admin` / `agents:admin` como fixture
  (`users/__tests__`, `roles/__tests__`, `agents/__tests__`, `featureFlags` e quaisquer
  outros que a auditoria do passo 1 encontrar). Os testes devem passar a refletir
  `:manage`.

### 6. Documentação

- `docs/10-seguranca-permissoes.md` §3.2 / §3.3: garantir que o catálogo e o mapeamento
  role→permissão refletem o estado real após este slot. O §3.2 já usa `:manage` para
  users/agents/cities — confirmar. Se o §3.2 estiver **incompleto** vs o catálogo real
  do seed (`scripts/seed.ts`) — incluir as permissões faltantes (ex: as de
  `credit_products` semeadas pela migration `0017`, `dlq:manage`). O objetivo é o doc
  espelhar o que o seed efetivamente cria.
- `apps/api/src/db/schema/permissions.ts`: o comentário de cabeçalho (linhas ~8-20)
  lista o catálogo — alinhar com o doc 10 §3.2 corrigido.

## Fora de escopo

- Mudar as permissões de `credit_products` / `dashboard` / `simulations` em si — só
  documentá-las se faltarem no doc. Elas já são consistentes entre código e uso.
- Qualquer mudança de UI além de renomear strings de chave.
- Mudar o mecanismo de wildcard (`*`) do `authorize`.

## Arquivos permitidos

- `apps/api/src/modules/users/routes.ts`
- `apps/api/src/modules/roles/routes.ts`
- `apps/api/src/modules/agents/routes.ts`
- `apps/api/src/modules/users/__tests__/**`
- `apps/api/src/modules/roles/__tests__/**`
- `apps/api/src/modules/agents/__tests__/**`
- `apps/api/src/modules/featureFlags/__tests__/**`
- `apps/api/src/db/migrations/0022_drop_agents_admin_permission.sql`
- `apps/api/src/db/migrations/meta/_journal.json`
- `apps/api/src/db/schema/permissions.ts`
- `apps/api/scripts/seed.ts` (só se a auditoria achar divergência real — provavelmente já correto)
- `apps/web/src/features/configuracoes/ConfiguracoesPage.tsx`
- `apps/web/src/components/layout/Sidebar.tsx`
- `docs/10-seguranca-permissoes.md`

> Se a auditoria do passo 1 encontrar `users:admin`/`agents:admin` num arquivo fora
> desta lista, **pare e reporte** — não toque fora do permitido sem alinhar.

## Definition of Done

- [ ] Nenhuma ocorrência de `users:admin` ou `agents:admin` no código de produção
      (`apps/api/src`, `apps/web/src`) — só `:manage`.
- [ ] Rotas de users/roles exigem `users:manage`; rotas de agents exigem `agents:manage`.
- [ ] Migration `0022` remove a permissão `agents:admin`; `_journal.json` monotônico;
      `slot.py check-migrations` verde.
- [ ] Hub `/configuracoes` gate os cards com as chaves novas.
- [ ] Testes atualizados e verdes.
- [ ] doc 10 §3.2/§3.3 e o comentário de `permissions.ts` refletem o catálogo real.
- [ ] `pnpm --filter @elemento/api db:migrate && test && lint` verdes;
      `pnpm --filter @elemento/web typecheck && lint && test && build` verdes.
      (typecheck da API pode ter erro sistêmico pré-existente de Fastify — reportar,
      não arrumar.)
- [ ] PR aberto.

## Validação

```powershell
pnpm --filter @elemento/api db:migrate
python scripts/slot.py check-migrations
pnpm --filter @elemento/api test
pnpm --filter @elemento/api lint
pnpm --filter @elemento/web typecheck
pnpm --filter @elemento/web test
```
