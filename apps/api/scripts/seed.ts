// =============================================================================
// seed.ts — Dados iniciais idempotentes.
//
// Idempotente: rodar múltiplas vezes não duplica dados.
// Usa ON CONFLICT DO NOTHING em toda inserção.
//
// Senha admin:
//   - Gerada aleatoriamente com ≥ 24 caracteres (mix de letras, dígitos, símbolos)
//   - SOMENTE exibida via console.log neste script — nunca em pino, never em logs
//   - Apresentada apenas se o usuário admin foi criado nesta execução
//
// Para rodar: pnpm --filter @elemento/api db:seed
//
// ESLint: console.log é permitido em scripts de seed (não é código de produção).

// =============================================================================
/* eslint-disable no-console */
import crypto from 'node:crypto';

import bcrypt from 'bcryptjs';
import { sql } from 'drizzle-orm';

import { db, pool } from '../src/db/client.js';
import {
  organizations,
  roles,
  permissions,
  rolePermissions,
  users,
} from '../src/db/schema/index.js';

// ---------------------------------------------------------------------------
// Constantes de domínio
// ---------------------------------------------------------------------------

const ORG_SLUG = 'bdp-rondonia';
const ORG_NAME = 'Banco do Povo / SEDEC-RO';
const ADMIN_EMAIL = 'admin@bdp.ro.gov.br';

/** Papéis canônicos (doc 10 §3.1) */
const ROLES = [
  {
    key: 'admin',
    label: 'Administrador',
    description: 'Acesso global e configurações técnicas',
  },
  {
    key: 'gestor_geral',
    label: 'Gestor Geral',
    description: 'Acesso global a dados de todas as cidades',
  },
  {
    key: 'gestor_regional',
    label: 'Gestor Regional',
    description: 'Acesso a cidades em user_city_scopes',
  },
  {
    key: 'agente',
    label: 'Agente',
    description: 'Cidades em user_city_scopes, vê apenas leads atribuídos',
  },
  {
    key: 'operador',
    label: 'Operador',
    description: 'Atendimento básico, escopo de cidade, leitura ampla',
  },
  {
    key: 'leitura',
    label: 'Somente Leitura',
    description: 'Somente leitura, escopo configurável',
  },
] as const;

/** Permissões canônicas (doc 10 §3.2) */
const PERMISSIONS = [
  { key: 'leads:read', description: 'Visualizar leads' },
  { key: 'leads:write', description: 'Criar e editar leads' },
  { key: 'leads:merge', description: 'Mesclar leads duplicados' },
  { key: 'leads:transfer', description: 'Transferir leads entre agentes/cidades' },
  { key: 'customers:read', description: 'Visualizar clientes' },
  { key: 'customers:write', description: 'Criar e editar clientes' },
  { key: 'kanban:move', description: 'Mover cards no kanban' },
  { key: 'kanban:revert', description: 'Reverter stage de card no kanban' },
  { key: 'kanban:set_outcome', description: 'Definir outcome do card' },
  { key: 'simulations:create', description: 'Criar simulações de crédito' },
  { key: 'simulations:read', description: 'Visualizar simulações de crédito' },
  { key: 'analyses:read', description: 'Visualizar análises de crédito' },
  { key: 'analyses:write', description: 'Criar e editar análises de crédito' },
  { key: 'analyses:approve', description: 'Aprovar ou recusar análises de crédito' },
  { key: 'analyses:import', description: 'Importar análises de crédito' },
  { key: 'imports:run', description: 'Executar importações de dados' },
  { key: 'imports:cancel', description: 'Cancelar importações em andamento' },
  { key: 'cities:manage', description: 'Criar e editar cidades' },
  { key: 'agents:manage', description: 'Gerenciar agentes e atribuições' },
  { key: 'users:manage', description: 'Gerenciar usuários, roles e escopos' },
  { key: 'flags:manage', description: 'Ativar e desativar feature flags' },
  { key: 'flags:read', description: 'Visualizar estado das feature flags' },
  { key: 'audit:read', description: 'Visualizar logs de auditoria' },
  { key: 'dashboard:read', description: 'Visualizar dashboard geral' },
  { key: 'dashboard:read_by_agent', description: 'Visualizar dashboard por agente' },
  { key: 'assistant:query', description: 'Consultar assistente interno IA' },
  { key: 'assistant:confirm_actions', description: 'Confirmar ações do assistente interno' },
  { key: 'followup:manage', description: 'Gerenciar regras e jobs de follow-up' },
  { key: 'collection:manage', description: 'Gerenciar regras e jobs de cobrança' },
] as const;

/**
 * Mapeamento role → permissões (doc 10 §3.3).
 * Inclui apenas permissões explícitas por papel — sem herança implícita.
 */
const ROLE_PERMISSIONS: Record<string, string[]> = {
  admin: [
    'leads:read',
    'leads:write',
    'leads:merge',
    'leads:transfer',
    'customers:read',
    'customers:write',
    'kanban:move',
    'kanban:revert',
    'kanban:set_outcome',
    'simulations:create',
    'simulations:read',
    'analyses:read',
    'analyses:write',
    'analyses:approve',
    'analyses:import',
    'imports:run',
    'imports:cancel',
    'cities:manage',
    'agents:manage',
    'users:manage',
    'flags:manage',
    'flags:read',
    'audit:read',
    'dashboard:read',
    'dashboard:read_by_agent',
    'assistant:query',
    'assistant:confirm_actions',
    'followup:manage',
    'collection:manage',
  ],
  gestor_geral: [
    'leads:read',
    'leads:write',
    'leads:merge',
    'leads:transfer',
    'customers:read',
    'customers:write',
    'kanban:move',
    'kanban:revert',
    'kanban:set_outcome',
    'simulations:create',
    'simulations:read',
    'analyses:read',
    'analyses:write',
    'analyses:approve',
    'analyses:import',
    'imports:run',
    'imports:cancel',
    'cities:manage',
    'agents:manage',
    'users:manage',
    'flags:read',
    'audit:read',
    'dashboard:read',
    'dashboard:read_by_agent',
    'assistant:query',
    'assistant:confirm_actions',
  ],
  gestor_regional: [
    'leads:read',
    'leads:write',
    'leads:merge',
    'leads:transfer',
    'customers:read',
    'customers:write',
    'kanban:move',
    'kanban:revert',
    'kanban:set_outcome',
    'simulations:create',
    'simulations:read',
    'analyses:read',
    'analyses:write',
    'analyses:approve',
    'imports:run',
    'agents:manage',
    'flags:read',
    'audit:read',
    'dashboard:read',
    'dashboard:read_by_agent',
    'assistant:query',
    'assistant:confirm_actions',
  ],
  agente: [
    'leads:read',
    'leads:write',
    'customers:read',
    'customers:write',
    'kanban:move',
    'simulations:create',
    'simulations:read',
    'analyses:read',
    'analyses:write',
    'dashboard:read_by_agent',
    'assistant:query',
  ],
  operador: [
    'leads:read',
    'leads:write',
    'customers:read',
    'kanban:move',
    'simulations:read',
    'analyses:read',
    'dashboard:read_by_agent',
  ],
  leitura: ['leads:read', 'customers:read', 'simulations:read', 'analyses:read', 'dashboard:read'],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Gera senha aleatória forte com mínimo 24 caracteres.
 * Mix de letras maiúsculas, minúsculas, dígitos e símbolos seguros.
 */
function generateStrongPassword(length = 32): string {
  const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const lower = 'abcdefghijklmnopqrstuvwxyz';
  const digits = '0123456789';
  const symbols = '!@#$%^&*()-_=+[]{}|;:,.<>?';
  const all = upper + lower + digits + symbols;

  // Garante ao menos 1 de cada categoria
  const required = [
    upper[crypto.randomInt(upper.length)],
    lower[crypto.randomInt(lower.length)],
    digits[crypto.randomInt(digits.length)],
    symbols[crypto.randomInt(symbols.length)],
  ];

  const rest = Array.from(
    { length: length - required.length },
    () => all[crypto.randomInt(all.length)],
  );

  // Embaralha para não deixar os caracteres obrigatórios no início
  const chars = [...required, ...rest];
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }

  return chars.join('');
}

// ---------------------------------------------------------------------------
// Seed principal
// ---------------------------------------------------------------------------

async function seed(): Promise<void> {
  console.log('[seed] Iniciando seed idempotente...');

  // 1. Organização
  console.log('[seed] Inserindo organização...');
  const [org] = await db
    .insert(organizations)
    .values({ slug: ORG_SLUG, name: ORG_NAME })
    .onConflictDoNothing({ target: organizations.slug })
    .returning({ id: organizations.id });

  // Se já existia, buscar o id existente
  const orgId =
    org?.id ??
    (await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(sql`${organizations.slug} = ${ORG_SLUG}`)
      .then((r) => r[0]!.id));

  // 2. Roles
  console.log('[seed] Inserindo roles...');
  await db
    .insert(roles)
    .values(ROLES.map(({ key, label, description }) => ({ key, label, description })))
    .onConflictDoNothing({ target: roles.key });

  // Carregar todos os roles com ids
  const allRoles = await db.select({ id: roles.id, key: roles.key }).from(roles);
  const roleByKey = Object.fromEntries(allRoles.map((r) => [r.key, r.id])) as Record<
    string,
    string
  >;

  // 3. Permissions
  console.log('[seed] Inserindo permissions...');
  await db
    .insert(permissions)
    .values(PERMISSIONS.map(({ key, description }) => ({ key, description })))
    .onConflictDoNothing({ target: permissions.key });

  // Carregar todas as permissions com ids
  const allPerms = await db.select({ id: permissions.id, key: permissions.key }).from(permissions);
  const permByKey = Object.fromEntries(allPerms.map((p) => [p.key, p.id])) as Record<
    string,
    string
  >;

  // 4. Role → Permission mapping
  console.log('[seed] Inserindo role_permissions...');
  const rolePerm: Array<{ roleId: string; permissionId: string }> = [];

  for (const [roleKey, permKeys] of Object.entries(ROLE_PERMISSIONS)) {
    const roleId = roleByKey[roleKey];
    if (!roleId) {
      console.warn(`[seed] AVISO: role '${roleKey}' não encontrado — pulando`);
      continue;
    }
    for (const permKey of permKeys) {
      const permId = permByKey[permKey];
      if (!permId) {
        console.warn(`[seed] AVISO: permission '${permKey}' não encontrada — pulando`);
        continue;
      }
      rolePerm.push({ roleId, permissionId: permId });
    }
  }

  if (rolePerm.length > 0) {
    // Inserir em lote, ignorar duplicatas (ON CONFLICT DO NOTHING via PK composta)
    await db.insert(rolePermissions).values(rolePerm).onConflictDoNothing();
  }

  // 5. Admin user
  console.log('[seed] Verificando usuário admin...');
  const existingAdmin = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`${users.email} = ${ADMIN_EMAIL} AND ${users.deletedAt} IS NULL`)
    .then((r) => r[0]);

  if (!existingAdmin) {
    const plainPassword = generateStrongPassword(32);
    const passwordHash = await bcrypt.hash(plainPassword, 12);

    await db.insert(users).values({
      organizationId: orgId,
      email: ADMIN_EMAIL,
      passwordHash,
      fullName: 'Administrador do Sistema',
      status: 'active',
    });

    // Senha exibida SOMENTE aqui, SOMENTE no stdout do seed.
    // Nunca via pino, nunca em banco, nunca em arquivo de log.
    console.log('');
    console.log('='.repeat(60));
    console.log('[seed] ADMIN CRIADO — ANOTE A SENHA ABAIXO:');
    console.log(`  Email : ${ADMIN_EMAIL}`);
    console.log(`  Senha : ${plainPassword}`);
    console.log('='.repeat(60));
    console.log('');
  } else {
    console.log('[seed] Usuário admin já existe — senha não alterada.');
  }

  console.log('[seed] Seed concluído com sucesso.');
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

seed()
  .catch((err: unknown) => {
    console.error('[seed] ERRO:', err);
    process.exit(1);
  })
  .finally(() => {
    void pool.end();
  });
