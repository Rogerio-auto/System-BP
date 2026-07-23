// =============================================================================
// quick-replies/__tests__/integration.test.ts — Testes de integração REAIS
// contra Postgres (F28-S08).
//
// Complementa service.test.ts (repository/audit/queue/storage MOCKADOS) e
// routes.test.ts (service MOCKADO) — aqui o service roda contra o repository
// e o SQL real, provando exatamente os pontos que um mock não pode provar:
// constraints/índices únicos do banco, isolamento de organização e de dono
// através de linhas reais, e concorrência real (race condition de shortcut).
//
// Cobre (doc 25 §14, itens 8/9/11 + isolamento implícito em toda a §5):
//   - Matriz de autorização das 3 permissões (read/write/manage) via
//     createQuickReplyService/updateQuickReplyService/deleteQuickReplyService/
//     reorderQuickRepliesService, com dados reais.
//   - Operador A NUNCA enxerga/altera/usa a resposta pessoal do operador B —
//     mesmo quando B tem `manage` (Correção F28-S03: não existe exceção
//     "tela admin com manage vê pessoais de terceiros").
//   - Isolamento entre organizações em list/get/update/delete/reorder/markUsed.
//   - Conflito de shortcut: pré-check (409) E constraint real do banco sob
//     concorrência (2 criações simultâneas do mesmo atalho org-wide — só uma
//     vence); sombreamento legítimo (pessoal pode repetir o atalho da org).
//   - Telemetria de uso: incrementa só a própria/organização; nunca a
//     resposta pessoal de outro operador (usage_count real, lido do banco).
//
// NÃO re-testa (já coberto em service.test.ts com o pacote real de Zod):
//   variável desconhecida, fallback ausente, PII no corpo, mediaUrl fora do
//   prefixo — são funções puras/superRefine, mock de repository não muda o
//   resultado.
//
// Banco: mesmo padrão de notification-rules/__tests__/integration.test.ts —
// probe pool.query('SELECT 1'); describe.runIf(dbAvailable) pula limpo sem DB.
// =============================================================================
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { db, pool } from '../../../db/client.js';
import { organizations, quickReplies, users } from '../../../db/schema/index.js';
import {
  createQuickReplyService,
  deleteQuickReplyService,
  getQuickReplyService,
  listQuickRepliesService,
  markQuickReplyUsedService,
  MANAGE_PERMISSION,
  READ_PERMISSION,
  reorderQuickRepliesService,
  updateQuickReplyService,
  WRITE_PERMISSION,
} from '../service.js';
import type { ActorContext } from '../service.js';

// ---------------------------------------------------------------------------
// Probe de disponibilidade do DB
// ---------------------------------------------------------------------------
let dbAvailable = false;
try {
  await pool.query('SELECT 1');
  dbAvailable = true;
} catch {
  // Sem DB local — describe.runIf pula a suíte inteira, limpo.
}

// ---------------------------------------------------------------------------
// IDs determinísticos por execução — evita colisão em DB compartilhado
// ---------------------------------------------------------------------------
const RUN_SUFFIX = String(Date.now()).slice(-10);
function makeUuid(prefix: string): string {
  const pad = RUN_SUFFIX.padStart(12, '0');
  return `${prefix.slice(0, 8)}-0000-0000-0000-${pad}`;
}

// Prefixos usam apenas [0-9a-f] — Postgres `uuid` rejeita caracteres fora do
// alfabeto hex.
const ORG_A_ID = makeUuid('a7000001');
const ORG_B_ID = makeUuid('a7000002');
const USER_A1_ID = makeUuid('a7100001'); // agente A — read+write (dono das próprias)
const USER_A2_ID = makeUuid('a7100002'); // agente A — read+write (outro operador)
const USER_A_MANAGE_ID = makeUuid('a7100003'); // gestor A — read+write+manage
const USER_B_MANAGE_ID = makeUuid('a7100004'); // gestor B (outra organização)

// ---------------------------------------------------------------------------
// Atores — permissões espelham a matriz real do doc 25 §5 (migration 0095):
// admin/gestor_geral = read+write+manage; agente = read+write (sem manage).
// ---------------------------------------------------------------------------
function makeActor(overrides: Partial<ActorContext> = {}): ActorContext {
  return {
    userId: USER_A1_ID,
    organizationId: ORG_A_ID,
    permissions: [READ_PERMISSION, WRITE_PERMISSION],
    cityScopeIds: null,
    ip: '127.0.0.1',
    userAgent: 'vitest-integration',
    ...overrides,
  };
}

const actorA1 = makeActor(); // agente A1 — read+write
const actorA2 = makeActor({ userId: USER_A2_ID }); // agente A2 — read+write
const actorAManage = makeActor({
  userId: USER_A_MANAGE_ID,
  permissions: [READ_PERMISSION, WRITE_PERMISSION, MANAGE_PERMISSION],
});
const actorBManage = makeActor({
  userId: USER_B_MANAGE_ID,
  organizationId: ORG_B_ID,
  permissions: [READ_PERMISSION, WRITE_PERMISSION, MANAGE_PERMISSION],
});

// ---------------------------------------------------------------------------
// beforeAll — seed mínimo (2 orgs, 4 usuários)
// ---------------------------------------------------------------------------
beforeAll(async () => {
  if (!dbAvailable) return;

  await db
    .insert(organizations)
    .values([
      { id: ORG_A_ID, slug: 'qr-int-a-' + RUN_SUFFIX, name: 'QR IntOrg A', settings: {} },
      { id: ORG_B_ID, slug: 'qr-int-b-' + RUN_SUFFIX, name: 'QR IntOrg B', settings: {} },
    ])
    .onConflictDoNothing();

  await db
    .insert(users)
    .values([
      {
        id: USER_A1_ID,
        organizationId: ORG_A_ID,
        email: 'qr-int-a1-' + RUN_SUFFIX + '@test.local',
        passwordHash: 'x',
        fullName: 'QR IntUser A1 Agente',
        status: 'active',
      },
      {
        id: USER_A2_ID,
        organizationId: ORG_A_ID,
        email: 'qr-int-a2-' + RUN_SUFFIX + '@test.local',
        passwordHash: 'x',
        fullName: 'QR IntUser A2 Agente',
        status: 'active',
      },
      {
        id: USER_A_MANAGE_ID,
        organizationId: ORG_A_ID,
        email: 'qr-int-a-manage-' + RUN_SUFFIX + '@test.local',
        passwordHash: 'x',
        fullName: 'QR IntUser A Gestora',
        status: 'active',
      },
      {
        id: USER_B_MANAGE_ID,
        organizationId: ORG_B_ID,
        email: 'qr-int-b-manage-' + RUN_SUFFIX + '@test.local',
        passwordHash: 'x',
        fullName: 'QR IntUser B Gestor',
        status: 'active',
      },
    ])
    .onConflictDoNothing();
}, 30_000);

afterAll(async () => {
  if (!dbAvailable) return;
  try {
    // organization_id cobre tudo criado nesta suíte (org-wide + pessoais).
    await db.delete(quickReplies).where(inArray(quickReplies.organizationId, [ORG_A_ID, ORG_B_ID]));
    await db
      .delete(users)
      .where(inArray(users.id, [USER_A1_ID, USER_A2_ID, USER_A_MANAGE_ID, USER_B_MANAGE_ID]));
    await db.delete(organizations).where(inArray(organizations.id, [ORG_A_ID, ORG_B_ID]));
  } finally {
    await pool.end();
  }
});

// ---------------------------------------------------------------------------
// Helper de payload de criação válido
// ---------------------------------------------------------------------------
function buildBody(overrides: Record<string, unknown> = {}) {
  return {
    visibility: 'organization' as const,
    shortcut: 'saudacao-' + RUN_SUFFIX,
    title: 'Saudação padrão',
    body: 'Olá {{atendente.primeiro_nome|equipe}}, tudo bem?',
    ...overrides,
  };
}

describe.runIf(dbAvailable)('[INTEGRATION] quick-replies — SQL real', () => {
  // -------------------------------------------------------------------------
  // Matriz de autorização (doc 25 §5, §14 critério 8)
  // -------------------------------------------------------------------------
  describe('matriz de autorização — 3 permissões', () => {
    it('agente (read+write, sem manage) NÃO cria resposta da organização — 403', async () => {
      await expect(
        createQuickReplyService(db, actorA1, buildBody({ shortcut: 'org-' + RUN_SUFFIX })),
      ).rejects.toMatchObject({ statusCode: 403 });
    });

    it('agente (read+write) CRIA resposta pessoal normalmente', async () => {
      const created = await createQuickReplyService(
        db,
        actorA1,
        buildBody({ visibility: 'personal', shortcut: 'pessoal-a1-' + RUN_SUFFIX }),
      );
      expect(created.visibility).toBe('personal');
      expect(created.ownerUserId).toBe(USER_A1_ID);
    });

    it('gestor (manage) CRIA resposta da organização normalmente', async () => {
      const created = await createQuickReplyService(
        db,
        actorAManage,
        buildBody({ shortcut: 'org-manage-' + RUN_SUFFIX }),
      );
      expect(created.visibility).toBe('organization');
      expect(created.ownerUserId).toBeNull();
    });

    it('agente (sem manage) NÃO edita/apaga resposta org-wide criada pelo gestor — 403', async () => {
      const created = await createQuickReplyService(
        db,
        actorAManage,
        buildBody({ shortcut: 'org-edita-' + RUN_SUFFIX }),
      );

      await expect(
        updateQuickReplyService(db, actorA1, created.id, { title: 'Tentativa de edição' }),
      ).rejects.toMatchObject({ statusCode: 403 });
      await expect(deleteQuickReplyService(db, actorA1, created.id)).rejects.toMatchObject({
        statusCode: 403,
      });
    });

    it('criar personal FORÇA ownerUserId=actor mesmo tentando injetar outro no body (real, não mock)', async () => {
      const created = await createQuickReplyService(db, actorA1, {
        ...buildBody({ visibility: 'personal', shortcut: 'forcado-' + RUN_SUFFIX }),
        // Campo fora do contrato Zod — não deveria influenciar nada.
        ownerUserId: USER_A2_ID,
      });
      expect(created.ownerUserId).toBe(USER_A1_ID);

      const [row] = await db.select().from(quickReplies).where(eq(quickReplies.id, created.id));
      expect(row?.ownerUserId).toBe(USER_A1_ID);
    });
  });

  // -------------------------------------------------------------------------
  // Operador A nunca enxerga/altera/usa a resposta pessoal de B
  // (doc 25 §14 critério 9 + Correção F28-S03: nem com `manage`)
  // -------------------------------------------------------------------------
  describe('isolamento entre operadores — resposta pessoal', () => {
    it('A2 recebe 404 ao tentar ver a pessoal de A1 (get/update/delete/used)', async () => {
      const created = await createQuickReplyService(
        db,
        actorA1,
        buildBody({ visibility: 'personal', shortcut: 'privada-a1-' + RUN_SUFFIX }),
      );

      await expect(getQuickReplyService(db, actorA2, created.id)).rejects.toMatchObject({
        statusCode: 404,
      });
      await expect(
        updateQuickReplyService(db, actorA2, created.id, { title: 'x' }),
      ).rejects.toMatchObject({ statusCode: 404 });
      await expect(deleteQuickReplyService(db, actorA2, created.id)).rejects.toMatchObject({
        statusCode: 404,
      });
      await expect(markQuickReplyUsedService(db, actorA2, created.id)).rejects.toMatchObject({
        statusCode: 404,
      });
    });

    it('gestor da MESMA organização (com manage) TAMBÉM recebe 404 na pessoal de A1 — sem exceção', async () => {
      const created = await createQuickReplyService(
        db,
        actorA1,
        buildBody({ visibility: 'personal', shortcut: 'privada-a1-manage-' + RUN_SUFFIX }),
      );

      // Correção F28-S03: a exceção "tela admin com manage vê pessoais de
      // terceiros" foi descartada — visibilidade é uniforme para toda rota.
      await expect(getQuickReplyService(db, actorAManage, created.id)).rejects.toMatchObject({
        statusCode: 404,
      });
      await expect(
        updateQuickReplyService(db, actorAManage, created.id, { title: 'x' }),
      ).rejects.toMatchObject({ statusCode: 404 });
    });

    it('a pessoal de A1 NÃO aparece na listagem de A2 nem na do gestor', async () => {
      const created = await createQuickReplyService(
        db,
        actorA1,
        buildBody({ visibility: 'personal', shortcut: 'privada-lista-' + RUN_SUFFIX }),
      );

      const listA2 = await listQuickRepliesService(db, actorA2, { limit: 100 });
      expect(listA2.data.map((r) => r.id)).not.toContain(created.id);

      const listManage = await listQuickRepliesService(db, actorAManage, { limit: 100 });
      expect(listManage.data.map((r) => r.id)).not.toContain(created.id);

      // A própria A1 continua vendo a sua.
      const listA1 = await listQuickRepliesService(db, actorA1, { limit: 100 });
      expect(listA1.data.map((r) => r.id)).toContain(created.id);
    });
  });

  // -------------------------------------------------------------------------
  // Isolamento entre organizações (D6 — organization_id é a fronteira real)
  // -------------------------------------------------------------------------
  describe('isolamento entre organizações', () => {
    it('actor da org B recebe 404 ao ver/editar/apagar/usar resposta da org A', async () => {
      const created = await createQuickReplyService(
        db,
        actorAManage,
        buildBody({ shortcut: 'org-a-cross-' + RUN_SUFFIX }),
      );

      await expect(getQuickReplyService(db, actorBManage, created.id)).rejects.toMatchObject({
        statusCode: 404,
      });
      await expect(
        updateQuickReplyService(db, actorBManage, created.id, { title: 'x' }),
      ).rejects.toMatchObject({ statusCode: 404 });
      await expect(deleteQuickReplyService(db, actorBManage, created.id)).rejects.toMatchObject({
        statusCode: 404,
      });
      await expect(markQuickReplyUsedService(db, actorBManage, created.id)).rejects.toMatchObject({
        statusCode: 404,
      });
    });

    it('a listagem da org B nunca inclui itens org-wide da org A', async () => {
      const created = await createQuickReplyService(
        db,
        actorAManage,
        buildBody({ shortcut: 'org-a-lista-cross-' + RUN_SUFFIX }),
      );

      const listB = await listQuickRepliesService(db, actorBManage, { limit: 100 });
      expect(listB.data.map((r) => r.id)).not.toContain(created.id);
    });

    it('reorder da org B com um id da org A é rejeitado — 404, nada é atualizado', async () => {
      const created = await createQuickReplyService(
        db,
        actorAManage,
        buildBody({ shortcut: 'org-a-reorder-cross-' + RUN_SUFFIX }),
      );

      await expect(
        reorderQuickRepliesService(db, actorBManage, [{ id: created.id, sortOrder: 9 }]),
      ).rejects.toMatchObject({ statusCode: 404 });

      const [row] = await db.select().from(quickReplies).where(eq(quickReplies.id, created.id));
      expect(row?.sortOrder).toBe(0); // sortOrder default — não foi tocado pela org B
    });

    it('mesmo shortcut em organizações diferentes NÃO conflita (constraint é por organization_id)', async () => {
      const shortcut = 'mesmo-atalho-orgs-' + RUN_SUFFIX;
      await expect(
        createQuickReplyService(db, actorAManage, buildBody({ shortcut })),
      ).resolves.toBeDefined();
      await expect(
        createQuickReplyService(db, actorBManage, buildBody({ shortcut })),
      ).resolves.toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // Conflito de shortcut — pré-check (409) + constraint real do banco sob
  // concorrência + sombreamento legítimo pessoal > organização (doc 25 §4.1,
  // §14 critério 11)
  // -------------------------------------------------------------------------
  describe('conflito de shortcut — real (não mockado)', () => {
    it('409 QUICK_REPLY_SHORTCUT_CONFLICT ao repetir o mesmo atalho org-wide', async () => {
      const shortcut = 'duplicado-org-' + RUN_SUFFIX;
      await createQuickReplyService(db, actorAManage, buildBody({ shortcut }));

      await expect(
        createQuickReplyService(db, actorAManage, buildBody({ shortcut })),
      ).rejects.toMatchObject({
        statusCode: 409,
        details: expect.objectContaining({ code: 'QUICK_REPLY_SHORTCUT_CONFLICT' }),
      });
    });

    it('sombreamento legítimo: pessoal do operador pode repetir o atalho org-wide', async () => {
      const shortcut = 'sombra-' + RUN_SUFFIX;
      await createQuickReplyService(db, actorAManage, buildBody({ shortcut }));

      const personal = await createQuickReplyService(
        db,
        actorA1,
        buildBody({ visibility: 'personal', shortcut }),
      );
      expect(personal.shortcut).toBe(shortcut);
      expect(personal.visibility).toBe('personal');
    });

    it('donos diferentes têm namespaces de atalho pessoal independentes', async () => {
      const shortcut = 'namespace-proprio-' + RUN_SUFFIX;
      await expect(
        createQuickReplyService(db, actorA1, buildBody({ visibility: 'personal', shortcut })),
      ).resolves.toBeDefined();
      await expect(
        createQuickReplyService(db, actorA2, buildBody({ visibility: 'personal', shortcut })),
      ).resolves.toBeDefined();
    });

    it('race condition real: 2 criações concorrentes do mesmo atalho org-wide — só 1 vence', async () => {
      const shortcut = 'race-' + RUN_SUFFIX;

      const results = await Promise.allSettled([
        createQuickReplyService(db, actorAManage, buildBody({ shortcut })),
        createQuickReplyService(db, actorAManage, buildBody({ shortcut })),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      const rejectedReason = rejected[0] as PromiseRejectedResult;
      expect(rejectedReason.reason).toMatchObject({
        statusCode: 409,
        details: expect.objectContaining({ code: 'QUICK_REPLY_SHORTCUT_CONFLICT' }),
      });

      // Confirma no banco: exatamente 1 linha viva com esse atalho org-wide.
      const rows = await db.select().from(quickReplies).where(eq(quickReplies.shortcut, shortcut));
      expect(rows.filter((r) => r.deletedAt === null)).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // Telemetria de uso — nunca incrementa a resposta de outro operador
  // (doc 25 §10 + §14 — corrobora o mock de service.test.ts com dado real)
  // -------------------------------------------------------------------------
  describe('telemetria de uso — isolamento real', () => {
    it('markQuickReplyUsedService incrementa usage_count só quando visível ao ator', async () => {
      const created = await createQuickReplyService(
        db,
        actorA1,
        buildBody({ visibility: 'personal', shortcut: 'telemetria-a1-' + RUN_SUFFIX }),
      );

      await markQuickReplyUsedService(db, actorA1, created.id);

      const [afterOwner] = await db
        .select()
        .from(quickReplies)
        .where(eq(quickReplies.id, created.id));
      expect(afterOwner?.usageCount).toBe(1);
      expect(afterOwner?.lastUsedAt).not.toBeNull();

      // A2 tenta usar a pessoal de A1 — 404, e o contador NÃO muda.
      await expect(markQuickReplyUsedService(db, actorA2, created.id)).rejects.toMatchObject({
        statusCode: 404,
      });

      const [afterOther] = await db
        .select()
        .from(quickReplies)
        .where(eq(quickReplies.id, created.id));
      expect(afterOther?.usageCount).toBe(1); // inalterado
    });

    it('reorder org-wide atualiza sort_order de fato (happy path, real)', async () => {
      const created = await createQuickReplyService(
        db,
        actorAManage,
        buildBody({ shortcut: 'reorder-happy-' + RUN_SUFFIX }),
      );

      const result = await reorderQuickRepliesService(db, actorAManage, [
        { id: created.id, sortOrder: 7 },
      ]);
      expect(result).toEqual({ updated: 1 });

      const [row] = await db.select().from(quickReplies).where(eq(quickReplies.id, created.id));
      expect(row?.sortOrder).toBe(7);
    });

    it('reorder rejeita id de resposta PESSOAL (mesmo do próprio ator com manage) — 404', async () => {
      const personal = await createQuickReplyService(
        db,
        actorAManage,
        buildBody({ visibility: 'personal', shortcut: 'reorder-pessoal-' + RUN_SUFFIX }),
      );

      await expect(
        reorderQuickRepliesService(db, actorAManage, [{ id: personal.id, sortOrder: 3 }]),
      ).rejects.toMatchObject({ statusCode: 404 });
    });
  });
});
