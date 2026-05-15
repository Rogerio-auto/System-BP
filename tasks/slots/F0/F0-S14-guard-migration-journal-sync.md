---
id: F0-S14
title: Guard de sincronia entre migrations .sql e _journal.json do Drizzle
phase: F0
task_ref: TOOLCHAIN.14
status: done
priority: high
estimated_size: S
agent_id: backend-engineer
claimed_at: 2026-05-15T13:16:02Z
completed_at: 2026-05-15T13:23:20Z
pr_url: https://github.com/Rogerio-auto/System-BP/pull/61
depends_on: []
blocks: []
labels: []
source_docs:
  - tasks/PROTOCOL.md
  - scripts/slot.py
---

# F0-S14 — Guard de sincronia migration ↔ journal

## Contexto (incidente 2026-05-15)

Endpoint `GET /api/credit-products` retornou **403 Forbidden** em produção/dev. Causa raiz:

- Os arquivos `apps/api/src/db/migrations/0017_seed_credit_products_permissions.sql` e
  `0018_seed_simulations_permissions.sql` existiam no disco (criados por F2-S03 e F2-S04).
- Mas o `apps/api/src/db/migrations/meta/_journal.json` tinha entries só até
  `0016_credit_core`. **0017 e 0018 não estavam registradas.**
- O migrator do Drizzle aplica **apenas o que está no `_journal.json`** — então as
  permissões `credit_products:read/write` e `simulations:create/read` nunca foram
  inseridas no banco.
- O middleware `authorize()` faz query fresca em `role_permissions` a cada request →
  permissão inexistente → 403 no preHandler, antes do handler.

Hotfix aplicado em commit `c5e6e76` (entries 0017/0018 adicionadas à mão). **Este slot
corrige o PROCESSO** para que isso não se repita.

## Por que aconteceu

Os agentes de schema/migration (db-schema-engineer, backend-engineer) escreveram os
arquivos `.sql` **à mão** em vez de gerar via `drizzle-kit generate`. SQL manual não
atualiza o `_journal.json` automaticamente. F2-S01 lembrou de sincronizar o journal
(entry 0016); F2-S03 e F2-S04 esqueceram.

Nada no fluxo (`slot.py validate`, lint, CI) detecta um `.sql` órfão sem entry no journal.
O bug passou em todos os testes porque o banco de teste é migrado por outro caminho
(seed de RBAC próprio / `db:push`), não pelo journal.

## Objetivo

1. Adicionar um **guard automático** que falha se houver arquivo `NNNN_*.sql` em
   `apps/api/src/db/migrations/` sem entry correspondente (mesmo `tag`) no `_journal.json`
   — e vice-versa (entry sem arquivo).
2. Documentar no `PROTOCOL.md` o processo correto de criar migrations.
3. Auditar o estado atual do journal e reportar inconsistências.

## Escopo

### 1. Guard

Implementar um check — escolha o local mais efetivo (decisão do engenheiro):

- **Opção A:** novo subcomando `python scripts/slot.py check-migrations` que compara
  `glob(migrations/*.sql)` contra `journal.entries[].tag` e reporta diffs. Exit 1 se
  divergente.
- **Opção B:** estender `slot.py validate` — quando o slot tocou arquivos em
  `db/migrations/`, rodar a verificação de sincronia automaticamente.
- **Opção C:** um script `apps/api/scripts/check-migration-journal.mjs` invocado por um
  hook de pre-commit (lint-staged já existe) quando `migrations/**` muda.

Preferir A + B combinados: comando reutilizável + gate automático no `validate` de slots
que tocam migrations. Documentar a escolha no PR.

A verificação deve detectar:

- `.sql` no disco sem entry no journal (o bug que causou o incidente)
- entry no journal sem `.sql` no disco
- `idx` duplicado ou fora de sequência (opcional — warning, não erro: o gap 0014/0015 é
  esperado porque os slots F8-S01/S03 ainda não foram implementados)

### 2. Documentação

Atualizar `tasks/PROTOCOL.md` §3 (seção "Banco") com regra explícita:

> Migrations devem ser geradas via `drizzle-kit generate` sempre que possível — isso
> sincroniza o `_journal.json` automaticamente. Se a migration for escrita à mão (seed,
> data fix), **é obrigatório adicionar a entry correspondente no
> `apps/api/src/db/migrations/meta/_journal.json`** no mesmo commit. Rodar
> `python scripts/slot.py check-migrations` antes de fechar o slot.

### 3. Auditoria

Rodar o guard contra o estado atual de `main` (pós-hotfix `c5e6e76`) e reportar no PR:

- Confirmar que 0016/0017/0018 estão todas registradas e com arquivo.
- Confirmar que o gap 0014/0015 é só ausência de arquivo+entry (esperado — F8 não feito),
  não uma entry órfã.

## Arquivos permitidos

- `scripts/slot.py`
- `scripts/slot_lib/*.py` (se houver módulo — pode criar `migrations.py`)
- `apps/api/scripts/check-migration-journal.mjs` (se escolher opção C)
- `apps/api/package.json` (se adicionar script npm para o check)
- `tasks/PROTOCOL.md` (§3 — seção Banco)
- `scripts/__tests__/test_slot.py` (se houver estrutura de teste)

## Definition of Done

- [ ] Guard detecta `.sql` órfão sem entry no journal — exit 1 + mensagem clara.
- [ ] Guard detecta entry no journal sem `.sql` correspondente.
- [ ] Rodar o guard contra `main` atual passa (0016/0017/0018 ok após hotfix `c5e6e76`).
- [ ] `slot.py validate` de slot que toca `db/migrations/` roda o guard automaticamente
      (se escolher opção B).
- [ ] PROTOCOL.md §3 documenta o processo correto de criar migration.
- [ ] Teste: criar `.sql` fake sem entry → guard falha; remover → guard passa.
- [ ] PR aberto.

## Validação

```powershell
python scripts/slot.py check-migrations    # ou o comando equivalente escolhido
# Teste manual: criar migrations/9999_fake.sql sem entry, rodar guard, esperar exit 1
```
