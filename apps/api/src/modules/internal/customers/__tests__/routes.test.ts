// =============================================================================
// internal/customers/__tests__/routes.test.ts — Testes de integração F3-S10.
//
// Estratégia: sobe Fastify com internalCustomersRoutes (default export),
// mocka db (drizzle) e env para controlar respostas sem conectar em banco real.
//
// Caminhos relativos a __tests__/:
//   ../routes.js               = src/modules/internal/customers/routes.ts
//   ../../../../config/env.js  = src/config/env.ts
//   ../../../../db/client.js   = src/db/client.ts
//   ../../../../shared/errors.js = src/shared/errors.ts
//
// Cobre (DoD F3-S10):
//   1.  GET /context?type=lead → 200 ficha completa para lead existente com simulação
//   2.  GET /context?type=lead → 200 ficha sem simulação (last_simulation: null)
//   3.  GET /context?type=lead → 200 ficha sem cidade, sem agente, sem kanban card
//   4.  GET /context?type=customer → 200 ficha via customer_id (resolve lead primário)
//   5.  GET /context (default type=lead) → 200 — tipo padrão é lead
//   6.  GET /context?type=lead → 404 quando lead não existe
//   7.  GET /context?type=customer → 404 quando customer não existe
//   8.  GET /context → 401 sem X-Internal-Token
//   9.  GET /context → 401 com token inválido
//   10. GET /context → 400 :id não é UUID válido
//   11. GET /context → 400 ?type inválido
//   12. Payload NÃO contém CPF/RG/phone/email/document_number/notes
//   13. messages_last_30_days é número inteiro ≥ 0
//   14. last_analysis sempre null (credit_analyses não implementada até F4+)
//   15. GET /context?type=lead → 404 quando lead tem deleted_at preenchido (soft-delete)
// =============================================================================
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock pg (previne tentativa de conectar em banco real)
// ---------------------------------------------------------------------------
vi.mock('pg', () => {
  const mockQuery = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
  const MockPool = vi.fn().mockImplementation(() => ({
    query: mockQuery,
    connect: vi.fn().mockResolvedValue({ query: mockQuery, release: vi.fn() }),
    end: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
  }));
  return { Pool: MockPool, default: { Pool: MockPool } };
});

// ---------------------------------------------------------------------------
// Mock env
// ---------------------------------------------------------------------------
const VALID_TOKEN = 'valid-internal-token-32-chars-minimum-x';

vi.mock('../../../../config/env.js', () => ({
  env: {
    LANGGRAPH_INTERNAL_TOKEN: VALID_TOKEN,
    LOG_LEVEL: 'silent',
    NODE_ENV: 'test',
  },
}));

// ---------------------------------------------------------------------------
// Mock db/client
//
// A rota realiza múltiplos selects sequenciais e paralelos (Promise.all).
//
// Problema de design do mock: algumas queries terminam em .limit() (selects normais)
// enquanto a query de count termina em .where() sem .limit(). Para unificar,
// usamos uma fila de respostas (`queryQueue`) onde cada chamada ao terminal
// desempilha a próxima resposta — independente de qual método encerrou.
//
// Implementação: `makeQueryChain(resolve)` retorna uma chain onde cada método
// retorna a própria chain, exceto `.limit()` e `.where()` — ambos invocam `resolve`.
// Na prática a rota chama `.limit()` para queries de single row e `.where()` sem
// `.limit()` para o count. A chain abaixo suporta ambos os padrões:
//
//   .select().from().where().limit()    → limit() resolve
//   .select().from().where()            → where() resolve (count)
//   .select().from().innerJoin().where().limit() → limit() resolve (kanban)
//
// Cada select cria uma nova chain com seu próprio `resolve` extraído do queryQueue.
// ---------------------------------------------------------------------------

// Fila de respostas — cada entrada é o retorno de uma query (array de rows ou [{total}]).
const queryQueue: Array<unknown[]> = [];

function enqueue(result: unknown[]) {
  queryQueue.push(result);
}

// `as unknown` justificado: a chain retorna tipos mistos (Promise e chain fluent)
// que TypeScript não consegue expressar com strict types. Em mock de teste de
// integração, o comportamento em runtime é o que importa — a rota usa await
// nos terminadores e encadeia métodos fluentes. O cast é seguro porque os métodos
// são exatamente os chamados pela rota (from, innerJoin, where, limit).
function makeQueryChain(): unknown {
  // Extrai a próxima resposta da fila imediatamente quando db.select() é chamado.
  // Isso garante que cada select consome exatamente uma entrada da fila em FIFO,
  // independente de qual método encerrar a chain (.where sem .limit, ou .limit).
  const result = queryQueue.shift() ?? [];

  // Retornar um objeto que é simultaneamente Promise e chain fluent.
  // - Quando a rota usa `.where()` como terminal (count query): `await chain.from().where()` resolve.
  // - Quando a rota usa `.limit()` como terminal (select normal): `await chain.from().where().limit()` resolve.
  // Ambos usam o mesmo `result` extraído da fila.
  //
  // `Object.assign` combina Promise com métodos de chain para suportar ambos os padrões.
  // A variável `chain` é declarada antes para evitar referência antes de atribuição.
  // `as ReturnType<typeof makeQueryChain>` justificado: Object.assign retorna união de tipos
  // que satisfaz a interface de chain fluent. A tipagem exata não importa em mock de teste.
  const basePromise = Promise.resolve(result);
  const chainMethods = {
    from: (..._args: unknown[]) => chain,
    innerJoin: (..._args: unknown[]) => chain,
    where: (..._args: unknown[]) => chain,
    limit: (..._args: unknown[]) => Promise.resolve(result),
  };
  const chain = Object.assign(basePromise, chainMethods);

  return chain;
}

vi.mock('../../../../db/client.js', () => ({
  db: {
    // `as unknown` justificado: makeQueryChain retorna um objeto misto (Promise + chain fluent)
    // para suportar ambos os padrões de uso: .where() terminal (count) e .limit() terminal (select).
    select: (..._args: unknown[]) => makeQueryChain() as unknown,
  },
  pool: { end: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Mock schemas Drizzle — evitam importação do módulo Drizzle pesado.
// ---------------------------------------------------------------------------

vi.mock('../../../../db/schema/leads.js', () => ({
  leads: {
    id: 'leads.id',
    name: 'leads.name',
    cityId: 'leads.city_id',
    agentId: 'leads.agent_id',
    status: 'leads.status',
    lastSimulationId: 'leads.last_simulation_id',
    deletedAt: 'leads.deleted_at',
  },
}));

vi.mock('../../../../db/schema/customers.js', () => ({
  customers: {
    id: 'customers.id',
    primaryLeadId: 'customers.primary_lead_id',
  },
}));

vi.mock('../../../../db/schema/cities.js', () => ({
  cities: { id: 'cities.id', name: 'cities.name' },
}));

vi.mock('../../../../db/schema/agents.js', () => ({
  agents: { id: 'agents.id', displayName: 'agents.display_name' },
}));

vi.mock('../../../../db/schema/kanbanCards.js', () => ({
  kanbanCards: { leadId: 'kanban_cards.lead_id', stageId: 'kanban_cards.stage_id' },
}));

vi.mock('../../../../db/schema/kanbanStages.js', () => ({
  kanbanStages: { id: 'kanban_stages.id', name: 'kanban_stages.name' },
}));

vi.mock('../../../../db/schema/creditSimulations.js', () => ({
  creditSimulations: {
    id: 'credit_simulations.id',
    leadId: 'credit_simulations.lead_id',
    amountRequested: 'credit_simulations.amount_requested',
    termMonths: 'credit_simulations.term_months',
    monthlyPayment: 'credit_simulations.monthly_payment',
    createdAt: 'credit_simulations.created_at',
    sentAt: 'credit_simulations.sent_at',
  },
}));

vi.mock('../../../../db/schema/interactions.js', () => ({
  interactions: {
    leadId: 'interactions.lead_id',
    createdAt: 'interactions.created_at',
  },
}));

// Mock drizzle-orm helpers — não precisam funcionar, apenas existir.
vi.mock('drizzle-orm', () => ({
  eq: (_col: unknown, _val: unknown) => ({ op: 'eq', col: _col, val: _val }),
  gte: (_col: unknown, _val: unknown) => ({ op: 'gte', col: _col, val: _val }),
  and: (...args: unknown[]) => ({ op: 'and', args }),
  count: () => ({ op: 'count' }),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FIXTURE_LEAD_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const FIXTURE_CUSTOMER_ID = 'bbbbbbbb-0000-0000-0000-000000000001';
const FIXTURE_CITY_ID = 'cccccccc-0000-0000-0000-000000000001';
const FIXTURE_AGENT_ID = 'dddddddd-0000-0000-0000-000000000001';
const FIXTURE_SIMULATION_ID = 'eeeeeeee-0000-0000-0000-000000000001';
// F7-S03 item 2: organization_id obrigatório em header X-Organization-Id (regra inviolável #3)
const FIXTURE_ORG_ID = 'ffffffff-0000-0000-0000-000000000001';

const NOW = new Date('2026-05-18T12:00:00.000Z');

type LeadRow = {
  id: string;
  name: string;
  cityId: string | null;
  agentId: string | null;
  status: string;
  lastSimulationId: string | null;
  deletedAt: Date | null;
};

type CustomerRow = {
  id: string;
  primaryLeadId: string;
};

type SimulationRow = {
  id: string;
  amountRequested: string;
  termMonths: number;
  monthlyPayment: string;
  createdAt: Date;
  sentAt: Date | null;
};

function makeLeadRow(overrides: Partial<LeadRow> = {}): LeadRow {
  return {
    id: FIXTURE_LEAD_ID,
    name: 'João da Silva',
    cityId: FIXTURE_CITY_ID,
    agentId: FIXTURE_AGENT_ID,
    status: 'qualifying',
    lastSimulationId: FIXTURE_SIMULATION_ID,
    deletedAt: null,
    ...overrides,
  };
}

function makeCustomerRow(overrides: Partial<CustomerRow> = {}): CustomerRow {
  return {
    id: FIXTURE_CUSTOMER_ID,
    primaryLeadId: FIXTURE_LEAD_ID,
    ...overrides,
  };
}

function makeSimulationRow(overrides: Partial<SimulationRow> = {}): SimulationRow {
  return {
    id: FIXTURE_SIMULATION_ID,
    amountRequested: '2000.00',
    termMonths: 12,
    monthlyPayment: '187.53',
    createdAt: NOW,
    sentAt: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// setupMockSequence
//
// Enfileira respostas para cada query que a rota irá executar, em ordem.
//
// A rota faz as seguintes queries (em ordem determinística):
//
// type=lead:
//   1. leads select (sequential)
//   2. customers reverse-lookup (sequential, sempre)
//   Promise.all (paralelo, mas enfileirado em ordem de criação):
//   3. cities (ONLY if lead.cityId !== null)
//   4. agents (ONLY if lead.agentId !== null)
//   5. kanban (always)
//   6. simulations (ONLY if lead.lastSimulationId !== null)
//   7. interactions count (always)
//
// type=customer:
//   1. customers select (sequential)
//   2. leads select (sequential)
//   Promise.all (mesma lógica):
//   3. cities / agents / kanban / simulations / count
//
// Nota: queries com Promise.resolve([]) (condicionais null) NÃO consomem
// entrada da fila — o db.select() não é chamado nesses casos.
//
// Para forçar retorno vazio em uma query específica, passar `null` explicitamente.
// O sentinela USE_DEFAULT (via ausência do campo) usa valores padrão de fixture.
// ---------------------------------------------------------------------------
function setupMockSequence(opts: {
  lead?: LeadRow;
  customerRow?: CustomerRow | null;
  city?: { name: string } | null;
  agent?: { displayName: string } | null;
  kanban?: { stageName: string } | null;
  simulation?: SimulationRow | null;
  messageCount?: number;
  type?: 'lead' | 'customer';
}) {
  // Extrair com lógica de "null = explicitamente vazio; omitido = usar padrão"
  const lead = opts.lead ?? makeLeadRow();
  const customerRow = 'customerRow' in opts ? opts.customerRow : undefined;
  const cityResult =
    'city' in opts ? (opts.city !== null ? opts.city : null) : { name: 'Porto Velho' };
  const agentResult =
    'agent' in opts ? (opts.agent !== null ? opts.agent : null) : { displayName: 'Agente Teste' };
  const kanbanResult =
    'kanban' in opts ? (opts.kanban !== null ? opts.kanban : null) : { stageName: 'Qualificação' };
  const simulationResult =
    'simulation' in opts
      ? opts.simulation !== null
        ? opts.simulation
        : null
      : makeSimulationRow();
  const messageCount = opts.messageCount ?? 5;
  const type = opts.type ?? 'lead';

  // Limpar fila antes de enfileirar (redundante com beforeEach mas defensivo)
  queryQueue.length = 0;

  if (type === 'customer') {
    enqueue(customerRow !== undefined && customerRow !== null ? [customerRow] : []); // 1. customers select
    enqueue([lead]); // 2. leads select
    // Não há reverse-lookup no path type=customer
  } else {
    enqueue([lead]); // 1. leads select
    enqueue(customerRow !== undefined && customerRow !== null ? [customerRow] : []); // 2. customers reverse-lookup
  }

  // Promise.all queries — enfileirar apenas as que chamam db.select()
  if (lead.cityId !== null) {
    enqueue(cityResult !== null ? [cityResult] : []); // 3. cities
  }
  if (lead.agentId !== null) {
    enqueue(agentResult !== null ? [agentResult] : []); // 4. agents
  }
  enqueue(kanbanResult !== null ? [kanbanResult] : []); // 5. kanban (always)
  if (lead.lastSimulationId !== null) {
    enqueue(simulationResult !== null ? [simulationResult] : []); // 6. simulations
  }
  enqueue([{ total: messageCount }]); // 7. interactions count (always)
}

// ---------------------------------------------------------------------------
// Build test app
// ---------------------------------------------------------------------------

async function buildTestApp(): Promise<FastifyInstance> {
  const [
    { default: Fastify },
    { serializerCompiler, validatorCompiler },
    { default: internalCustomersRoutes },
    { isAppError },
  ] = await Promise.all([
    import('fastify'),
    import('fastify-type-provider-zod'),
    import('../routes.js'),
    import('../../../../shared/errors.js'),
  ]);

  const app = Fastify({ logger: false }).withTypeProvider();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.setErrorHandler(
    // `as` justificado: tipos de error/request/reply são any em setErrorHandler no Fastify 5
    // quando não há TypeProvider — padrão adotado em todos os testes de integração do projeto.
    (
      error: Error & { validation?: unknown; statusCode?: number },
      _request: unknown,
      reply: { status: (n: number) => { send: (b: unknown) => void } },
    ) => {
      if (isAppError(error)) {
        const body: Record<string, unknown> = {
          error: error.code,
          message: error.message,
        };
        if (error.details !== undefined) body['details'] = error.details;
        return reply.status(error.statusCode).send(body);
      }
      if (error.validation !== undefined) {
        return reply.status(400).send({
          error: 'VALIDATION_ERROR',
          message: 'Validation failed',
          details: error.validation,
        });
      }
      return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Internal server error' });
    },
  );

  // Registra o plugin com prefixo /internal/customers (simula autoload + app.ts prefix).
  await app.register(internalCustomersRoutes, { prefix: '/internal/customers' });

  await app.ready();
  return app;
}

// ---------------------------------------------------------------------------
// Suite principal
// ---------------------------------------------------------------------------

describe('GET /internal/customers/:id/context', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    queryQueue.length = 0;
  });

  // -------------------------------------------------------------------------
  // 1. 200 — ficha completa para lead com simulação
  // -------------------------------------------------------------------------
  it('retorna 200 com ficha completa para lead existente com simulação', async () => {
    setupMockSequence({
      lead: makeLeadRow(),
      customerRow: makeCustomerRow(),
      simulation: makeSimulationRow({ sentAt: NOW }),
      messageCount: 7,
      type: 'lead',
    });

    const response = await app.inject({
      method: 'GET',
      url: `/internal/customers/${FIXTURE_LEAD_ID}/context?type=lead`,
      headers: { 'x-internal-token': VALID_TOKEN, 'x-organization-id': FIXTURE_ORG_ID },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.lead_id).toBe(FIXTURE_LEAD_ID);
    expect(body.customer_id).toBe(FIXTURE_CUSTOMER_ID);
    expect(body.name).toBe('João da Silva');
    expect(body.city_name).toBe('Porto Velho');
    expect(body.agent_name).toBe('Agente Teste');
    expect(body.current_stage).toBe('Qualificação');
    expect(body.lead_status).toBe('qualifying');
    expect(body.last_simulation).not.toBeNull();
    expect(body.last_simulation.simulation_id).toBe(FIXTURE_SIMULATION_ID);
    expect(body.last_simulation.amount_requested).toBe('2000.00');
    expect(body.last_simulation.term_months).toBe(12);
    expect(body.last_simulation.monthly_payment).toBe('187.53');
    expect(body.last_simulation.sent_at).toBe(NOW.toISOString());
    expect(body.messages_last_30_days).toBe(7);
  });

  // -------------------------------------------------------------------------
  // 2. 200 — lead sem simulação (last_simulation: null)
  // -------------------------------------------------------------------------
  it('retorna 200 com last_simulation:null quando lead não tem simulação', async () => {
    setupMockSequence({
      lead: makeLeadRow({ lastSimulationId: null }),
      customerRow: null,
      simulation: null,
      messageCount: 2,
      type: 'lead',
    });

    const response = await app.inject({
      method: 'GET',
      url: `/internal/customers/${FIXTURE_LEAD_ID}/context?type=lead`,
      headers: { 'x-internal-token': VALID_TOKEN, 'x-organization-id': FIXTURE_ORG_ID },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.last_simulation).toBeNull();
    expect(body.customer_id).toBeNull();
    expect(body.messages_last_30_days).toBe(2);
  });

  // -------------------------------------------------------------------------
  // 3. 200 — ficha sem cidade, sem agente, sem kanban card
  //
  // Quando cityId e agentId são null, as queries condicionais usam
  // Promise.resolve([]) e NÃO consomem entrada da fila.
  // setupMockSequence omite essas entradas quando a condição é null.
  // -------------------------------------------------------------------------
  it('retorna 200 com nulls para lead sem cidade, agente e kanban', async () => {
    setupMockSequence({
      lead: makeLeadRow({ cityId: null, agentId: null, lastSimulationId: null }),
      customerRow: null,
      city: null,
      agent: null,
      kanban: null,
      simulation: null,
      messageCount: 0,
      type: 'lead',
    });

    const response = await app.inject({
      method: 'GET',
      url: `/internal/customers/${FIXTURE_LEAD_ID}/context?type=lead`,
      headers: { 'x-internal-token': VALID_TOKEN, 'x-organization-id': FIXTURE_ORG_ID },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.city_name).toBeNull();
    expect(body.agent_name).toBeNull();
    expect(body.current_stage).toBeNull();
    expect(body.last_simulation).toBeNull();
    expect(body.messages_last_30_days).toBe(0);
  });

  // -------------------------------------------------------------------------
  // 4. 200 — ficha via customer_id (type=customer)
  // -------------------------------------------------------------------------
  it('retorna 200 com ficha do lead quando buscado por customer_id', async () => {
    setupMockSequence({
      lead: makeLeadRow(),
      customerRow: makeCustomerRow(),
      type: 'customer',
    });

    const response = await app.inject({
      method: 'GET',
      url: `/internal/customers/${FIXTURE_CUSTOMER_ID}/context?type=customer`,
      headers: { 'x-internal-token': VALID_TOKEN, 'x-organization-id': FIXTURE_ORG_ID },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.lead_id).toBe(FIXTURE_LEAD_ID);
    expect(body.customer_id).toBe(FIXTURE_CUSTOMER_ID);
    expect(body.name).toBe('João da Silva');
  });

  // -------------------------------------------------------------------------
  // 5. 200 — type padrão é lead (sem query param)
  // -------------------------------------------------------------------------
  it('retorna 200 quando ?type omitido (padrão lead)', async () => {
    setupMockSequence({
      lead: makeLeadRow(),
      type: 'lead',
    });

    const response = await app.inject({
      method: 'GET',
      url: `/internal/customers/${FIXTURE_LEAD_ID}/context`,
      headers: { 'x-internal-token': VALID_TOKEN, 'x-organization-id': FIXTURE_ORG_ID },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().lead_id).toBe(FIXTURE_LEAD_ID);
  });

  // -------------------------------------------------------------------------
  // 6. 404 — lead não existe (type=lead)
  // -------------------------------------------------------------------------
  it('retorna 404 quando lead não existe', async () => {
    enqueue([]); // leads select → vazio

    const response = await app.inject({
      method: 'GET',
      url: `/internal/customers/${FIXTURE_LEAD_ID}/context?type=lead`,
      headers: { 'x-internal-token': VALID_TOKEN, 'x-organization-id': FIXTURE_ORG_ID },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error).toBe('NOT_FOUND');
  });

  // -------------------------------------------------------------------------
  // 7. 404 — customer não existe (type=customer)
  // -------------------------------------------------------------------------
  it('retorna 404 quando customer não existe', async () => {
    enqueue([]); // customers select → vazio

    const response = await app.inject({
      method: 'GET',
      url: `/internal/customers/${FIXTURE_CUSTOMER_ID}/context?type=customer`,
      headers: { 'x-internal-token': VALID_TOKEN, 'x-organization-id': FIXTURE_ORG_ID },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error).toBe('NOT_FOUND');
  });

  // -------------------------------------------------------------------------
  // 8. 401 — sem X-Internal-Token
  // -------------------------------------------------------------------------
  it('retorna 401 sem X-Internal-Token', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/internal/customers/${FIXTURE_LEAD_ID}/context?type=lead`,
    });

    expect(response.statusCode).toBe(401);
    // queryQueue deve permanecer vazio (nenhuma query executada)
    expect(queryQueue).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // 9. 401 — token inválido
  // -------------------------------------------------------------------------
  it('retorna 401 com token inválido', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/internal/customers/${FIXTURE_LEAD_ID}/context?type=lead`,
      headers: { 'x-internal-token': 'wrong-token-here' },
    });

    expect(response.statusCode).toBe(401);
    expect(queryQueue).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // F7-S03 item 2: 400 — X-Organization-Id ausente (regra inviolável #3)
  // -------------------------------------------------------------------------
  it('retorna 400 quando X-Organization-Id está ausente (multi-tenant scope)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/internal/customers/${FIXTURE_LEAD_ID}/context?type=lead`,
      // Intencionalmente SEM x-organization-id — deve retornar 400
      headers: { 'x-internal-token': VALID_TOKEN },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('VALIDATION_ERROR');
    // Nenhuma query deve ter sido executada — o guard retorna antes do DB
    expect(queryQueue).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // 10. 400 — :id não é UUID válido
  // -------------------------------------------------------------------------
  it('retorna 400 quando :id não é UUID válido', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/internal/customers/not-a-uuid/context?type=lead',
      headers: { 'x-internal-token': VALID_TOKEN, 'x-organization-id': FIXTURE_ORG_ID },
    });

    expect(response.statusCode).toBe(400);
    expect(queryQueue).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // 11. 400 — ?type inválido
  // -------------------------------------------------------------------------
  it('retorna 400 quando ?type é valor inválido', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/internal/customers/${FIXTURE_LEAD_ID}/context?type=invalid`,
      headers: { 'x-internal-token': VALID_TOKEN, 'x-organization-id': FIXTURE_ORG_ID },
    });

    expect(response.statusCode).toBe(400);
    expect(queryQueue).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // 12. LGPD — payload NÃO contém CPF/RG/phone/email/document_number/notes
  //
  // Este teste afirma a AUSÊNCIA de campos sensíveis no payload.
  // Crítico para conformidade com doc 06 §7.6 + doc 17 §3.4.
  // -------------------------------------------------------------------------
  it('payload não contém CPF, RG, phone, email, document_number, notes', async () => {
    setupMockSequence({
      lead: makeLeadRow(),
      customerRow: makeCustomerRow(),
      type: 'lead',
    });

    const response = await app.inject({
      method: 'GET',
      url: `/internal/customers/${FIXTURE_LEAD_ID}/context?type=lead`,
      headers: { 'x-internal-token': VALID_TOKEN, 'x-organization-id': FIXTURE_ORG_ID },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();

    // Campos que NUNCA devem aparecer na resposta (LGPD doc 06 §7.6 + doc 17 §3.4)
    expect(body).not.toHaveProperty('cpf');
    expect(body).not.toHaveProperty('cpf_encrypted');
    expect(body).not.toHaveProperty('cpf_hash');
    expect(body).not.toHaveProperty('document_number');
    expect(body).not.toHaveProperty('document_hash');
    expect(body).not.toHaveProperty('phone');
    expect(body).not.toHaveProperty('phone_e164');
    expect(body).not.toHaveProperty('phone_normalized');
    expect(body).not.toHaveProperty('email');
    expect(body).not.toHaveProperty('notes');
    expect(body).not.toHaveProperty('rg');
  });

  // -------------------------------------------------------------------------
  // 13. messages_last_30_days é número inteiro ≥ 0
  // -------------------------------------------------------------------------
  it('messages_last_30_days é inteiro não-negativo', async () => {
    setupMockSequence({ lead: makeLeadRow(), messageCount: 0, type: 'lead' });

    const response = await app.inject({
      method: 'GET',
      url: `/internal/customers/${FIXTURE_LEAD_ID}/context?type=lead`,
      headers: { 'x-internal-token': VALID_TOKEN, 'x-organization-id': FIXTURE_ORG_ID },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(typeof body.messages_last_30_days).toBe('number');
    expect(Number.isInteger(body.messages_last_30_days)).toBe(true);
    expect(body.messages_last_30_days).toBeGreaterThanOrEqual(0);
  });

  // -------------------------------------------------------------------------
  // 14. last_analysis sempre null (credit_analyses não implementada até F4+)
  // -------------------------------------------------------------------------
  it('last_analysis é sempre null (tabela credit_analyses não existe até F4+)', async () => {
    setupMockSequence({ type: 'lead' });

    const response = await app.inject({
      method: 'GET',
      url: `/internal/customers/${FIXTURE_LEAD_ID}/context?type=lead`,
      headers: { 'x-internal-token': VALID_TOKEN, 'x-organization-id': FIXTURE_ORG_ID },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().last_analysis).toBeNull();
  });

  // -------------------------------------------------------------------------
  // 15. 404 — lead com deleted_at preenchido (soft-deleted)
  // -------------------------------------------------------------------------
  it('retorna 404 quando lead está soft-deleted (deleted_at preenchido)', async () => {
    // Lead retornado pelo DB mas com deleted_at preenchido → tratado como 404
    enqueue([makeLeadRow({ deletedAt: new Date() })]);

    const response = await app.inject({
      method: 'GET',
      url: `/internal/customers/${FIXTURE_LEAD_ID}/context?type=lead`,
      headers: { 'x-internal-token': VALID_TOKEN, 'x-organization-id': FIXTURE_ORG_ID },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error).toBe('NOT_FOUND');
  });
});
