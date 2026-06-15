-- =============================================================================
-- 0056_seed_cobranca_role_permissions.sql — Role `cobranca` + permissões de
--   cobrança, SPC, tarefas e notificações (F15-S01).
--
-- Contexto: docs/planejamento-2026-06-evolucao.md §F.2 (decisão D11: cobrança
--   com escopo GLOBAL — visão centralizada da carteira inteira, sem city_scope
--   obrigatório).
--
-- O que esta migration faz:
--   1. Cria o role `cobranca` com scope = 'global'.
--   2. Insere 9 permissões novas:
--        - billing:read         — leitura de parcelas e jobs (já existia em 0044;
--                                 repetida aqui com ON CONFLICT para vinculá-la
--                                 também ao role `cobranca` sem duplicar).
--        - billing:reconcile    — reconciliação manual de cobranças (baixa avulsa).
--        - spc:read             — visualizar status SPC de clientes.
--        - spc:manage           — inserir/remover cliente no SPC e alterar status.
--        - tasks:read           — listar tarefas atribuídas ao próprio role/cidade.
--        - tasks:write          — criar tarefas (sistema pode criar; agente humano tb).
--        - tasks:claim          — assumir uma tarefa (muda claimed_by, status→in_progress).
--        - tasks:complete       — concluir uma tarefa (status→done).
--        - notifications:read   — ler notificações in-app do usuário.
--   3. Vincula as permissões acima ao role `cobranca`.
--   4. Vincula `billing:read`, `spc:read`, `tasks:read`, `notifications:read`
--      ao role `admin` (escopo mínimo de leitura — outros billing:* já existem
--      em 0044/0054).
--   5. Vincula `billing:reconcile`, `spc:read`, `spc:manage`, `tasks:*`,
--      `notifications:read` ao role `gestor_geral` (gestão global).
--
-- Dependências:
--   - 0001_bent_mac_gargan.sql (permissions, roles, role_permissions)
--   - 0021_roles_scope_column.sql (role_scope enum + coluna scope NOT NULL)
--   - 0044_seed_billing_permissions.sql (permissões billing existentes)
--
-- Idempotente: INSERT ... ON CONFLICT DO NOTHING em todas as operações.
-- Regressão F12-S11: não usa DDL que bloqueie tabelas existentes; aplica limpo
--   em DB já populado.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Criar role `cobranca` com scope = 'global'
--
-- Escopo global por decisão D11: o departamento de cobrança enxerga todos os
-- clientes independentemente da cidade — não há city-scope neste role.
-- ---------------------------------------------------------------------------

INSERT INTO "roles" ("key", "label", "scope")
VALUES (
  'cobranca',
  'Cobrança',
  'global'
)
ON CONFLICT ("key") DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Inserir novas permissões
--
-- billing:read já existe (0044) — ON CONFLICT garante idempotência.
-- billing:reconcile é nova: baixa/reconciliação manual de parcelas pela equipe
--   de cobrança (diferente de billing:mark_paid, que é marcação no módulo
--   administrativo — reconcile vem de importação ou ajuste manual de cobrança).
-- spc:read / spc:manage: ciclo de vida do status SPC do cliente (none →
--   pending_inclusion → included → removed), regra "15 dias vencido → tarefa".
-- tasks:* / notifications:read: fundação para o sistema de tarefas + notificações
--   in-app; as tabelas serão criadas em slots subsequentes — as permissões ficam
--   pré-registradas para que o RBAC já funcione no dia em que as rotas subirem.
-- ---------------------------------------------------------------------------

INSERT INTO "permissions" ("key", "description")
VALUES
  ('billing:read',
   'Leitura de parcelas, regras de cobrança e jobs agendados (city-scoped para roles regionais)'),
  ('billing:reconcile',
   'Reconciliação/baixa manual de cobranças — marca parcela como conciliada via importação ou ajuste avulso'),
  ('spc:read',
   'Visualização do status SPC do cliente (none/pending_inclusion/included/removed) e histórico de alterações'),
  ('spc:manage',
   'Inserção, remoção e atualização do status SPC do cliente; dispara evento de outbox para auditoria'),
  ('tasks:read',
   'Listagem de tarefas atribuídas ao próprio role (filtradas por cidade via user_city_scopes quando role não é global)'),
  ('tasks:write',
   'Criação de tarefas — usada pelo sistema (scheduler/outbox) e por usuários com permissão explícita'),
  ('tasks:claim',
   'Assumir uma tarefa pendente (muda claimed_by para o usuário atual; status→in_progress)'),
  ('tasks:complete',
   'Concluir uma tarefa assumida (status→done; registra completed_at + completed_by)'),
  ('notifications:read',
   'Leitura das notificações in-app do usuário autenticado (badge + listagem); canal fan-out de outbox')
ON CONFLICT ("key") DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. Vincular TODAS as permissões acima ao role `cobranca`
--
-- O role `cobranca` recebe o conjunto completo porque é o papel central do
-- departamento: lê cobranças, reconcilia, gerencia SPC, opera tarefas e
-- recebe notificações — tudo com escopo global (sem city_scope forçado).
-- ---------------------------------------------------------------------------

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r.id, p.id
FROM "roles" r
CROSS JOIN "permissions" p
WHERE r.key = 'cobranca'
  AND p.key IN (
    'billing:read',
    'billing:reconcile',
    'spc:read',
    'spc:manage',
    'tasks:read',
    'tasks:write',
    'tasks:claim',
    'tasks:complete',
    'notifications:read'
  )
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4. Vincular ao role `admin` — permissões novas desta migration
--
-- `admin` já tem billing:read, billing:write, billing:mark_paid, billing:cancel_job
-- (via 0044) e billing:boleto:write (via 0054). Aqui adicionamos somente o que
-- é novo neste seed: billing:reconcile + spc:* + tasks:* + notifications:read.
-- ---------------------------------------------------------------------------

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r.id, p.id
FROM "roles" r
CROSS JOIN "permissions" p
WHERE r.key = 'admin'
  AND p.key IN (
    'billing:reconcile',
    'spc:read',
    'spc:manage',
    'tasks:read',
    'tasks:write',
    'tasks:claim',
    'tasks:complete',
    'notifications:read'
  )
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- 5. Vincular ao role `gestor_geral` — subconjunto sem spc:manage e tasks:write
--
-- gestor_geral: visão global + pode reconciliar e operar tarefas, mas a criação
-- de tarefas é responsabilidade do sistema (outbox/scheduler) — gestor_geral
-- pode criar tarefas manualmente também (tasks:write incluído para flexibilidade
-- operacional). SPC:manage incluído pois gestor_geral supervisa a operação.
-- ---------------------------------------------------------------------------

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r.id, p.id
FROM "roles" r
CROSS JOIN "permissions" p
WHERE r.key = 'gestor_geral'
  AND p.key IN (
    'billing:reconcile',
    'spc:read',
    'spc:manage',
    'tasks:read',
    'tasks:write',
    'tasks:claim',
    'tasks:complete',
    'notifications:read'
  )
ON CONFLICT DO NOTHING;
