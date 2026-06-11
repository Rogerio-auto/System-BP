// =============================================================================
// seed-demo.ts — Seed de DEMONSTRAÇÃO para apresentação ao cliente.
//
// Gera um cenário completo, realista e INTERLIGADO sobre a organização
// canônica `bdp-rondonia` (criada por seed.ts). Pensado para uma apresentação
// presencial: dashboard cheio, CRM/Kanban povoado, simulações, análises de
// crédito, clientes, cobrança (parcelas), follow-up e decisões da IA — tudo
// navegável e coerente entre as telas.
//
// LGPD (doc 17 §9.3): TODOS os dados são fictícios.
//   - CPFs gerados com DV matematicamente correto, porém sintéticos.
//   - Nomes/telefones via faker pt_BR (determinístico, seed fixa).
//   - PROIBIDO clonar produção. Este é o caminho aprovado.
//
// Idempotente por REESCRITA: limpa o domínio (mantendo a fundação — org,
// roles, permissões, stages, cidade-capital, produto base, admin) e repovoa.
//
// Login de demonstração (todos com a MESMA senha): ver DEMO_PASSWORD abaixo.
//
// Rodar: pnpm --filter @elemento/api db:seed-demo
//
// ESLint: console.log permitido em scripts de seed.
// =============================================================================
/* eslint-disable no-console */
import crypto from 'node:crypto';

import { faker } from '@faker-js/faker/locale/pt_BR';
import bcrypt from 'bcryptjs';
import pg from 'pg';

import { encryptPii, hashDocument } from '../lib/crypto/pii.js';

const { Pool } = pg;

// ---------------------------------------------------------------------------
// Configuração
// ---------------------------------------------------------------------------

const DEMO_PASSWORD = 'Demo@2026';
const ORG_SLUG = 'bdp-rondonia';
const ADMIN_EMAIL = 'admin@bdp.ro.gov.br';
const EMAIL_DOMAIN = 'bdp.ro.gov.br';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// ---------------------------------------------------------------------------
// Helpers genéricos
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

let client: pg.PoolClient;

async function q<T = Row>(text: string, params: unknown[] = []): Promise<T[]> {
  const r = await client.query(text, params);
  return r.rows as T[];
}

/** INSERT genérico que devolve a(s) coluna(s) `returning`. */
async function insert(table: string, row: Row, returning = 'id'): Promise<Row> {
  const keys = Object.keys(row);
  const cols = keys.map((k) => `"${k}"`).join(', ');
  const ph = keys.map((_, i) => `$${i + 1}`).join(', ');
  const vals = keys.map((k) => row[k]);
  const r = await client.query(
    `insert into ${table} (${cols}) values (${ph}) returning ${returning}`,
    vals,
  );
  return r.rows[0] as Row;
}

const money = (n: number): string => n.toFixed(2);
const round2 = (n: number): number => Math.round(n * 100) / 100;
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)]!;
const randInt = (min: number, max: number): number =>
  Math.floor(Math.random() * (max - min + 1)) + min;

/** Data no passado (dias atrás) com hora aleatória. */
function daysAgo(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(randInt(8, 18), randInt(0, 59), randInt(0, 59), 0);
  return d;
}

/** Data no futuro (dias à frente). */
function daysAhead(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}

/** Formata Date → 'YYYY-MM-DD' (coluna date). */
function dateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// CPF sintético (DV válido, fictício — LGPD doc 17 §9.3)
// ---------------------------------------------------------------------------

function generateFakeCpf(): string {
  const digits: number[] = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
  const sum1 = digits.reduce((acc, d, i) => acc + d * (10 - i), 0);
  const d1 = (sum1 * 10) % 11;
  digits.push(d1 >= 10 ? 0 : d1);
  const sum2 = digits.reduce((acc, d, i) => acc + d * (11 - i), 0);
  const d2 = (sum2 * 10) % 11;
  digits.push(d2 >= 10 ? 0 : d2);
  return digits.join('');
}

async function encCpf(): Promise<{ enc: Buffer; hash: string }> {
  const cpf = generateFakeCpf();
  const enc = Buffer.from(await encryptPii(cpf));
  return { enc, hash: hashDocument(cpf) };
}

// ---------------------------------------------------------------------------
// Tabela PRICE — mesma forma usada pela aplicação (objeto, não array)
// ---------------------------------------------------------------------------

interface AmortResult {
  monthlyPayment: number;
  totalPayment: number;
  totalInterest: number;
  table: object;
}

function priceSchedule(amount: number, monthlyRate: number, termMonths: number): AmortResult {
  const i = monthlyRate;
  const n = termMonths;
  const pmt = round2((amount * i) / (1 - Math.pow(1 + i, -n)));
  let balance = amount;
  let totalPayment = 0;
  const installments: object[] = [];
  for (let k = 1; k <= n; k++) {
    const interest = round2(balance * i);
    let principal = round2(pmt - interest);
    let payment = pmt;
    if (k === n) {
      principal = round2(balance);
      payment = round2(principal + interest);
      balance = 0;
    } else {
      balance = round2(balance - principal);
    }
    totalPayment = round2(totalPayment + payment);
    installments.push({ number: k, balance, payment, interest, principal });
  }
  const totalInterest = round2(totalPayment - amount);
  return {
    monthlyPayment: pmt,
    totalPayment,
    totalInterest,
    table: {
      amount,
      method: 'price',
      termMonths: n,
      monthlyRate: i,
      installments,
      totalPayment,
      totalInterest,
    },
  };
}

// ---------------------------------------------------------------------------
// Dados de domínio (Rondônia)
// ---------------------------------------------------------------------------

const RO_CITIES = [
  { name: 'Porto Velho', ibge: '1100205', aliases: ['PVH', 'porto velho', 'p. velho'] },
  { name: 'Ji-Paraná', ibge: '1100122', aliases: ['ji parana', 'jiparana', 'JP'] },
  { name: 'Ariquemes', ibge: '1100023', aliases: ['ariquemes'] },
  { name: 'Cacoal', ibge: '1100049', aliases: ['cacoal'] },
  { name: 'Vilhena', ibge: '1100304', aliases: ['vilhena'] },
  { name: 'Rolim de Moura', ibge: '1100254', aliases: ['rolim', 'rolim de moura'] },
  { name: 'Jaru', ibge: '1100114', aliases: ['jaru'] },
  { name: 'Guajará-Mirim', ibge: '1100106', aliases: ['guajara mirim', 'guaja'] },
] as const;

function normalizeName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .trim();
}

function slugify(s: string): string {
  return normalizeName(s).replace(/\s+/g, '-');
}

const PROFESSIONS = [
  'Comerciante',
  'Costureira',
  'Mecânico',
  'Cabeleireira',
  'Pedreiro',
  'Autônomo(a)',
  'Vendedor(a)',
  'Agricultor(a)',
  'Microempreendedor(a)',
  'Padeiro(a)',
  'Eletricista',
  'Manicure',
];
const PURPOSES = [
  'Capital de giro para o negócio',
  'Compra de equipamentos',
  'Reforma do ponto comercial',
  'Estoque para revenda',
  'Ampliação da produção',
  'Compra de matéria-prima',
];

// ---------------------------------------------------------------------------
// Wipe do domínio (mantém a fundação)
// ---------------------------------------------------------------------------

async function wipe(orgId: string): Promise<void> {
  console.log('[seed-demo] Limpando domínio (mantendo fundação)...');
  // Ordem segura para FKs.
  await q('delete from ai_decision_logs');
  await q('delete from interactions');
  await q('delete from lead_history');
  await q('delete from collection_jobs');
  await q('delete from followup_jobs');
  await q('delete from collection_rules');
  await q('delete from followup_rules');
  await q('delete from payment_dues');
  await q(
    'update credit_analyses set current_version_id = null, simulation_id = null, customer_id = null',
  );
  await q('update leads set last_simulation_id = null, last_analysis_id = null');
  await q('delete from kanban_stage_history');
  await q('delete from kanban_cards');
  await q('delete from credit_analysis_versions');
  await q('delete from credit_analyses');
  await q('delete from credit_simulations');
  await q('delete from customers');
  await q('delete from leads');
  await q('delete from agents');
  await q('delete from whatsapp_templates');
  // Produtos extras (mantém o produto base microcredito_pessoal).
  await q(
    `delete from credit_product_rules where product_id in (select id from credit_products where key in ('capital_giro','microcredito_produtivo'))`,
  );
  await q(`delete from credit_products where key in ('capital_giro','microcredito_produtivo')`);
  // Usuários de demo (mantém admin).
  await q(
    `delete from user_city_scopes where user_id in (select id from users where organization_id = $1 and email <> $2)`,
    [orgId, ADMIN_EMAIL],
  );
  await q(
    `delete from user_roles where user_id in (select id from users where organization_id = $1 and email <> $2)`,
    [orgId, ADMIN_EMAIL],
  );
  await q(`delete from users where organization_id = $1 and email <> $2`, [orgId, ADMIN_EMAIL]);
}

// ---------------------------------------------------------------------------
// Seed principal
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  faker.seed(2026);

  client = await pool.connect();
  try {
    await client.query('begin');

    // -- Fundação -----------------------------------------------------------
    const [org] = await q<{ id: string }>(`select id from organizations where slug = $1`, [
      ORG_SLUG,
    ]);
    if (!org) throw new Error(`Org ${ORG_SLUG} não encontrada — rode 'db:seed' antes.`);
    const orgId = org.id;

    const [admin] = await q<{ id: string }>(`select id from users where email = $1`, [ADMIN_EMAIL]);
    if (!admin) throw new Error(`Admin ${ADMIN_EMAIL} não encontrado — rode 'db:seed' antes.`);
    const adminId = admin.id;

    const stages = await q<{ id: string; name: string; order_index: number }>(
      `select id, name, order_index from kanban_stages where organization_id = $1 order by order_index`,
      [orgId],
    );
    const stageByName = new Map(stages.map((s) => [s.name, s.id]));
    const stagePre = stageByName.get('Pré-atendimento')!;
    const stageSim = stageByName.get('Simulação')!;
    const stageDoc = stageByName.get('Documentação')!;
    const stageAna = stageByName.get('Análise de crédito')!;
    const stageDone = stageByName.get('Concluído')!;

    await wipe(orgId);

    // -- Senha de demo para o admin (login conhecido) ----------------------
    const pwHash = await bcrypt.hash(DEMO_PASSWORD, 10);
    await q(`update users set password_hash = $1, status = 'active' where id = $2`, [
      pwHash,
      adminId,
    ]);

    // -- Cidades ------------------------------------------------------------
    console.log('[seed-demo] Cidades...');
    const cityIds: Record<string, string> = {};
    for (const c of RO_CITIES) {
      const existing = await q<{ id: string }>(
        `select id from cities where organization_id = $1 and ibge_code = $2`,
        [orgId, c.ibge],
      );
      if (existing[0]) {
        await q(`update cities set is_active = true, aliases = $2 where id = $1`, [
          existing[0].id,
          c.aliases as unknown as string[],
        ]);
        cityIds[c.name] = existing[0].id;
        continue;
      }
      const row = await insert('cities', {
        organization_id: orgId,
        name: c.name,
        name_normalized: normalizeName(c.name),
        aliases: c.aliases as unknown as string[],
        slug: slugify(c.name),
        ibge_code: c.ibge,
        state_uf: 'RO',
        is_active: true,
      });
      cityIds[c.name] = row.id as string;
    }
    const allCityIds = Object.values(cityIds);

    // -- Produtos de crédito + regras --------------------------------------
    console.log('[seed-demo] Produtos de crédito...');
    const [baseProduct] = await q<{ id: string }>(
      `select id from credit_products where key = 'microcredito_pessoal' and organization_id = $1`,
      [orgId],
    );
    const [baseRule] = await q<{ id: string; monthly_rate: string }>(
      `select id, monthly_rate from credit_product_rules where product_id = $1 order by version desc limit 1`,
      [baseProduct!.id],
    );

    interface ProdInfo {
      productId: string;
      ruleId: string;
      rate: number;
      min: number;
      max: number;
      minTerm: number;
      maxTerm: number;
    }
    const products: ProdInfo[] = [
      {
        productId: baseProduct!.id,
        ruleId: baseRule!.id,
        rate: Number(baseRule!.monthly_rate),
        min: 5000,
        max: 30000,
        minTerm: 3,
        maxTerm: 36,
      },
    ];

    const extraProducts = [
      {
        key: 'capital_giro',
        name: 'Capital de Giro PJ',
        description: 'Linha para microempresas e MEIs — capital de giro e fluxo de caixa.',
        rate: 0.0389,
        iof: 0.00041,
        min: 5000,
        max: 50000,
        minTerm: 6,
        maxTerm: 48,
      },
      {
        key: 'microcredito_produtivo',
        name: 'Microcrédito Produtivo Orientado',
        description: 'Crédito orientado ao empreendedor de baixa renda (PNMPO).',
        rate: 0.0295,
        iof: 0.00038,
        min: 2000,
        max: 21000,
        minTerm: 4,
        maxTerm: 24,
      },
    ];
    for (const p of extraProducts) {
      const prod = await insert('credit_products', {
        organization_id: orgId,
        key: p.key,
        name: p.name,
        description: p.description,
        is_active: true,
      });
      const rule = await insert('credit_product_rules', {
        product_id: prod.id,
        version: 1,
        min_amount: money(p.min),
        max_amount: money(p.max),
        min_term_months: p.minTerm,
        max_term_months: p.maxTerm,
        monthly_rate: p.rate.toFixed(6),
        iof_rate: p.iof.toFixed(6),
        amortization: 'price',
        city_scope: allCityIds,
        effective_from: daysAgo(120),
        is_active: true,
        created_by: adminId,
      });
      products.push({
        productId: prod.id as string,
        ruleId: rule.id as string,
        rate: p.rate,
        min: p.min,
        max: p.max,
        minTerm: p.minTerm,
        maxTerm: p.maxTerm,
      });
    }

    // -- Usuários (agentes + gestores) + agents ----------------------------
    console.log('[seed-demo] Usuários e agentes...');
    const [roleAgente] = await q<{ id: string }>(`select id from roles where key = 'agente'`);
    const [roleGestorReg] = await q<{ id: string }>(
      `select id from roles where key = 'gestor_regional'`,
    );
    const [roleGestorGer] = await q<{ id: string }>(
      `select id from roles where key = 'gestor_geral'`,
    );

    interface AgentInfo {
      agentId: string;
      userId: string;
      name: string;
      cities: string[];
    }
    const agents: AgentInfo[] = [];

    const agentSpecs = [
      { name: 'Mariana Albuquerque', cities: ['Porto Velho'] },
      { name: 'Carlos Henrique Souza', cities: ['Porto Velho', 'Guajará-Mirim'] },
      { name: 'Patrícia Nogueira', cities: ['Ji-Paraná', 'Jaru'] },
      { name: 'Rafael Tavares', cities: ['Ariquemes'] },
      { name: 'Juliana Mendes', cities: ['Cacoal', 'Rolim de Moura'] },
      { name: 'Anderson Lima', cities: ['Vilhena'] },
    ];

    let emailSeq = 0;
    function mkEmail(name: string): string {
      const base = normalizeName(name).replace(/\s+/g, '.');
      emailSeq += 1;
      return `${base}.${emailSeq}@${EMAIL_DOMAIN}`;
    }

    for (const spec of agentSpecs) {
      const email = mkEmail(spec.name);
      const user = await insert('users', {
        organization_id: orgId,
        email,
        password_hash: pwHash,
        full_name: spec.name,
        status: 'active',
        last_login_at: daysAgo(randInt(0, 4)),
      });
      await q(`insert into user_roles (user_id, role_id) values ($1, $2) on conflict do nothing`, [
        user.id,
        roleAgente!.id,
      ]);
      for (let ci = 0; ci < spec.cities.length; ci++) {
        await q(
          `insert into user_city_scopes (user_id, city_id, is_primary) values ($1, $2, $3) on conflict do nothing`,
          [user.id, cityIds[spec.cities[ci]!], ci === 0],
        );
      }
      const phone = `+5569${randInt(98000, 99999)}${randInt(1000, 9999)}`;
      const agent = await insert('agents', {
        organization_id: orgId,
        user_id: user.id,
        display_name: spec.name,
        phone,
        is_active: true,
      });
      agents.push({
        agentId: agent.id as string,
        userId: user.id as string,
        name: spec.name,
        cities: spec.cities.map((n) => cityIds[n]!),
      });
    }

    // Gestores (para a tela de usuários — sem agent vinculado)
    const gestores = [
      { name: 'Eduardo Camargo', role: roleGestorGer!.id, cities: [] as string[] },
      { name: 'Simone Rezende', role: roleGestorReg!.id, cities: ['Porto Velho', 'Ji-Paraná'] },
      { name: 'Fernando Brito', role: roleGestorReg!.id, cities: ['Cacoal', 'Vilhena'] },
    ];
    for (const g of gestores) {
      const user = await insert('users', {
        organization_id: orgId,
        email: mkEmail(g.name),
        password_hash: pwHash,
        full_name: g.name,
        status: 'active',
        last_login_at: daysAgo(randInt(0, 10)),
      });
      await q(`insert into user_roles (user_id, role_id) values ($1, $2) on conflict do nothing`, [
        user.id,
        g.role,
      ]);
      for (let ci = 0; ci < g.cities.length; ci++) {
        await q(
          `insert into user_city_scopes (user_id, city_id, is_primary) values ($1, $2, $3) on conflict do nothing`,
          [user.id, cityIds[g.cities[ci]!], ci === 0],
        );
      }
    }

    function agentForCity(cityId: string): AgentInfo {
      const candidates = agents.filter((a) => a.cities.includes(cityId));
      return candidates.length ? pick(candidates) : pick(agents);
    }

    // -- Leads + Kanban cards ----------------------------------------------
    console.log('[seed-demo] Leads e Kanban...');

    interface LeadInfo {
      id: string;
      name: string;
      cityId: string;
      cityName: string;
      agent: AgentInfo;
      status: string;
      stageId: string;
      cardId: string | null;
      createdAt: Date;
    }
    const leads: LeadInfo[] = [];
    let phoneSeq = 0;

    const SOURCES = ['whatsapp', 'manual', 'import', 'chatwoot', 'api'] as const;

    // Distribuição por estágio do funil.
    const plan: {
      stageId: string;
      status: string;
      count: number;
      ageMin: number;
      ageMax: number;
    }[] = [
      { stageId: stagePre, status: 'new', count: 14, ageMin: 0, ageMax: 12 },
      { stageId: stageSim, status: 'simulation', count: 12, ageMin: 3, ageMax: 25 },
      { stageId: stageDoc, status: 'qualifying', count: 9, ageMin: 8, ageMax: 35 },
      { stageId: stageAna, status: 'qualifying', count: 9, ageMin: 12, ageMax: 45 },
      { stageId: stageDone, status: 'closed_won', count: 12, ageMin: 25, ageMax: 80 },
      // closed_lost: sem card (saiu do board)
      { stageId: '', status: 'closed_lost', count: 6, ageMin: 20, ageMax: 70 },
    ];

    const cityNames = Object.keys(cityIds);
    for (const p of plan) {
      for (let n = 0; n < p.count; n++) {
        const cityName = pick(cityNames);
        const cityId = cityIds[cityName]!;
        const agent = agentForCity(cityId);
        const fullName = faker.person.fullName();
        phoneSeq += 1;
        const ddd = '69';
        const numero = `9${String(80000000 + phoneSeq * 137 + randInt(0, 99)).slice(0, 8)}`;
        const phoneNorm = `55${ddd}${numero}`;
        const phoneE164 = `+${phoneNorm}`;
        const { enc, hash } = await encCpf();
        const createdAt = daysAgo(randInt(p.ageMin, p.ageMax));
        const profession = pick(PROFESSIONS);
        const lead = await insert('leads', {
          organization_id: orgId,
          city_id: cityId,
          agent_id: agent.agentId,
          name: fullName,
          phone_e164: phoneE164,
          phone_normalized: phoneNorm,
          source: pick(SOURCES),
          status: p.status,
          email: faker.internet
            .email({ firstName: fullName.split(' ')[0] ?? 'cliente' })
            .toLowerCase(),
          cpf_encrypted: enc,
          cpf_hash: hash,
          notes:
            p.status === 'closed_lost'
              ? 'Cliente optou por não seguir — buscou crédito em outra instituição.'
              : `${profession}. ${pick(PURPOSES)}.`,
          metadata: JSON.stringify({
            seed: 'demo',
            profession,
            monthly_income_brl: randInt(1800, 9000),
            purpose: pick(PURPOSES),
          }),
          created_at: createdAt,
          updated_at: createdAt,
        });

        let cardId: string | null = null;
        if (p.stageId) {
          const enteredAt = daysAgo(randInt(0, Math.max(1, p.ageMin)));
          const card = await insert('kanban_cards', {
            organization_id: orgId,
            lead_id: lead.id,
            stage_id: p.stageId,
            assignee_user_id: agent.userId,
            priority: randInt(0, 2),
            entered_stage_at: enteredAt,
            created_at: createdAt,
            updated_at: enteredAt,
          });
          cardId = card.id as string;
        }

        leads.push({
          id: lead.id as string,
          name: fullName,
          cityId,
          cityName,
          agent,
          status: p.status,
          stageId: p.stageId,
          cardId,
          createdAt,
        });
      }
    }

    // -- Simulações ---------------------------------------------------------
    console.log('[seed-demo] Simulações...');
    const simByLead = new Map<
      string,
      { id: string; amount: number; term: number; pmt: number; productId: string }
    >();

    const leadsNeedingSim = leads.filter((l) =>
      [stageSim, stageAna, stageDone].includes(l.stageId),
    );
    for (const l of leadsNeedingSim) {
      const prod = pick(products);
      const amount = randInt(prod.min / 1000, prod.max / 1000) * 1000;
      const term = pick(
        [6, 12, 12, 18, 24, 24, 36].filter((t) => t >= prod.minTerm && t <= prod.maxTerm),
      );
      const sched = priceSchedule(amount, prod.rate, term);
      const createdAt = new Date(l.createdAt.getTime() + 2 * 86400000);
      const sim = await insert('credit_simulations', {
        organization_id: orgId,
        lead_id: l.id,
        product_id: prod.productId,
        rule_version_id: prod.ruleId,
        amount_requested: money(amount),
        term_months: term,
        monthly_payment: money(sched.monthlyPayment),
        total_amount: money(sched.totalPayment),
        total_interest: money(sched.totalInterest),
        rate_monthly_snapshot: prod.rate.toFixed(6),
        amortization_table: JSON.stringify(sched.table),
        origin: pick(['manual', 'manual', 'ai']),
        created_by_user_id: l.agent.userId,
        created_at: createdAt,
        sent_at: Math.random() < 0.7 ? new Date(createdAt.getTime() + 3600000) : null,
      });
      simByLead.set(l.id, {
        id: sim.id as string,
        amount,
        term,
        pmt: sched.monthlyPayment,
        productId: prod.productId,
      });
      await q(`update leads set last_simulation_id = $1 where id = $2`, [sim.id, l.id]);
      if (l.cardId) {
        await q(`update kanban_cards set last_simulation_id = $1, product_id = $2 where id = $3`, [
          sim.id,
          prod.productId,
          l.cardId,
        ]);
      }
    }

    // -- Análises de crédito + versões -------------------------------------
    console.log('[seed-demo] Análises de crédito...');
    const PENDENCIAS = [
      {
        tipo: 'Comprovante de renda',
        descricao: 'Solicitado holerite ou DECORE dos últimos 3 meses.',
      },
      {
        tipo: 'Comprovante de residência',
        descricao: 'Conta de luz/água em nome do titular (até 90 dias).',
      },
      { tipo: 'CNPJ ativo', descricao: 'Cartão CNPJ atualizado e sem pendências na Receita.' },
      { tipo: 'Referências comerciais', descricao: 'Duas referências de fornecedores do negócio.' },
    ];

    async function createAnalysis(
      l: LeadInfo,
      status: string,
      versions: { status: string; parecer: string; pendencias: object[] }[],
      approved?: { amount: number; term: number; rate: number; score: number },
    ): Promise<void> {
      const sim = simByLead.get(l.id);
      const analyst = Math.random() < 0.5 ? l.agent.userId : adminId;
      const createdAt = new Date(l.createdAt.getTime() + 4 * 86400000);
      const analysis = await insert('credit_analyses', {
        organization_id: orgId,
        lead_id: l.id,
        simulation_id: sim?.id ?? null,
        status,
        approved_amount: approved ? money(approved.amount) : null,
        approved_term_months: approved?.term ?? null,
        approved_rate_monthly: approved ? approved.rate.toFixed(6) : null,
        internal_score: approved
          ? approved.score.toFixed(2)
          : (Math.random() * 0.4 + 0.4).toFixed(2),
        analyst_user_id: analyst,
        origin: 'manual',
        created_at: createdAt,
        updated_at: createdAt,
      });
      let currentVersionId: string | null = null;
      let vNum = 0;
      for (const v of versions) {
        vNum += 1;
        const ver = await insert('credit_analysis_versions', {
          analysis_id: analysis.id,
          version: vNum,
          status: v.status,
          parecer_text: v.parecer,
          pendencias: JSON.stringify(v.pendencias),
          attachments: JSON.stringify([]),
          author_user_id: analyst,
          created_at: new Date(createdAt.getTime() + vNum * 86400000),
        });
        currentVersionId = ver.id as string;
      }
      await q(`update credit_analyses set current_version_id = $1 where id = $2`, [
        currentVersionId,
        analysis.id,
      ]);
      await q(`update leads set last_analysis_id = $1 where id = $2`, [analysis.id, l.id]);
    }

    // Análise (stage) — em curso
    const anaLeads = leads.filter((l) => l.stageId === stageAna);
    let ai = 0;
    for (const l of anaLeads) {
      const mode = ai % 4;
      ai += 1;
      if (mode === 0) {
        await createAnalysis(l, 'em_analise', [
          {
            status: 'em_analise',
            parecer:
              'Análise iniciada. Documentação básica recebida; aguardando validação de renda e capacidade de pagamento.',
            pendencias: [],
          },
        ]);
      } else if (mode === 1) {
        await createAnalysis(l, 'pendente', [
          {
            status: 'em_analise',
            parecer: 'Cadastro conferido. Score interno dentro da faixa.',
            pendencias: [],
          },
          {
            status: 'pendente',
            parecer: 'Pendências documentais identificadas. Aguardando envio para prosseguir.',
            pendencias: [
              { ...pick(PENDENCIAS), prazo: dateOnly(daysAhead(randInt(3, 10))) },
              { ...pick(PENDENCIAS), prazo: dateOnly(daysAhead(randInt(3, 10))) },
            ],
          },
        ]);
      } else if (mode === 2) {
        await createAnalysis(l, 'em_analise', [
          {
            status: 'em_analise',
            parecer: 'Reanálise solicitada pelo agente após envio de documentos complementares.',
            pendencias: [],
          },
        ]);
      } else {
        await createAnalysis(l, 'recusado', [
          { status: 'em_analise', parecer: 'Cadastro em conferência.', pendencias: [] },
          {
            status: 'recusado',
            parecer:
              'Comprometimento de renda acima do limite da política (>30%). Recomenda-se reapresentar com valor menor ou prazo maior.',
            pendencias: [],
          },
        ]);
      }
    }

    // Concluído — aprovadas
    const doneLeads = leads.filter((l) => l.stageId === stageDone);
    for (const l of doneLeads) {
      const sim = simByLead.get(l.id)!;
      const prod = products.find((p) => p.productId === sim.productId)!;
      const score = round2(Math.random() * 0.25 + 0.65);
      await createAnalysis(
        l,
        'aprovado',
        [
          {
            status: 'em_analise',
            parecer: 'Documentação completa. Renda e idoneidade confirmadas.',
            pendencias: [],
          },
          {
            status: 'aprovado',
            parecer: `Crédito aprovado no valor de R$ ${sim.amount.toLocaleString('pt-BR')} em ${sim.term}x. Score interno ${score.toFixed(2)}. Capacidade de pagamento compatível com a renda declarada.`,
            pendencias: [],
          },
        ],
        { amount: sim.amount, term: sim.term, rate: prod.rate, score },
      );
    }

    // -- Clientes (closed_won) ---------------------------------------------
    console.log('[seed-demo] Clientes...');
    interface CustInfo {
      id: string;
      lead: LeadInfo;
      amount: number;
      term: number;
      pmt: number;
      contract: string;
      convertedAt: Date;
    }
    const customers: CustInfo[] = [];
    for (const l of doneLeads) {
      const sim = simByLead.get(l.id)!;
      const { enc, hash } = await encCpf();
      const convertedAt = new Date(l.createdAt.getTime() + 10 * 86400000);
      const contract = `BDP-${new Date(convertedAt).getFullYear()}-${String(randInt(10000, 99999))}`;
      const cust = await insert('customers', {
        organization_id: orgId,
        primary_lead_id: l.id,
        converted_at: convertedAt,
        document_number: enc,
        document_hash: hash,
        metadata: JSON.stringify({
          seed: 'demo',
          contract_number: contract,
          loan_amount_brl: sim.amount,
          term_months: sim.term,
          monthly_payment_brl: round2(sim.pmt),
        }),
        created_at: convertedAt,
        updated_at: convertedAt,
      });
      customers.push({
        id: cust.id as string,
        lead: l,
        amount: sim.amount,
        term: sim.term,
        pmt: sim.pmt,
        contract,
        convertedAt,
      });
      // Vincula simulação/análise ao cliente.
      await q(`update credit_simulations set customer_id = $1 where lead_id = $2`, [cust.id, l.id]);
      await q(`update credit_analyses set customer_id = $1 where lead_id = $2`, [cust.id, l.id]);
    }

    // -- Templates WhatsApp -------------------------------------------------
    console.log('[seed-demo] Templates WhatsApp...');
    const tplBoleto = await insert('whatsapp_templates', {
      organization_id: orgId,
      meta_template_id: 'bdp_cobranca_boleto_v1',
      name: 'cobranca_boleto_lembrete',
      language: 'pt_BR',
      category: 'utility',
      body: 'Olá {{1}}! Sua parcela {{2}} do contrato {{3}} vence em {{4}}, no valor de R$ {{5}}. Segue o boleto em anexo. Banco do Povo de Rondônia.',
      variables: ['nome', 'parcela', 'contrato', 'vencimento', 'valor'],
      status: 'approved',
    });
    const tplFollowup = await insert('whatsapp_templates', {
      organization_id: orgId,
      meta_template_id: 'bdp_followup_doc_v1',
      name: 'followup_documentacao',
      language: 'pt_BR',
      category: 'utility',
      body: 'Oi {{1}}, tudo bem? Notamos que sua solicitação de crédito está aguardando o envio de documentos. Podemos te ajudar a concluir? Banco do Povo RO.',
      variables: ['nome'],
      status: 'approved',
    });
    await insert('whatsapp_templates', {
      organization_id: orgId,
      meta_template_id: 'bdp_boas_vindas_v1',
      name: 'boas_vindas',
      language: 'pt_BR',
      category: 'utility',
      body: 'Bem-vindo(a) ao Banco do Povo de Rondônia, {{1}}! Sou o assistente virtual e vou te ajudar com sua simulação de crédito. Em qual cidade você está?',
      variables: ['nome'],
      status: 'approved',
    });

    // -- Parcelas (cobrança) ------------------------------------------------
    console.log('[seed-demo] Parcelas / cobrança...');
    interface DueInfo {
      id: string;
      status: string;
    }
    const overdueDues: DueInfo[] = [];
    let custIdx = 0;
    for (const cust of customers) {
      const total = cust.term;
      const firstDue = new Date(cust.convertedAt);
      firstDue.setMonth(firstDue.getMonth() + 1);
      // Quantas parcelas já venceram (due < hoje).
      let pastCount = 0;
      for (let k = 1; k <= total; k++) {
        const d = new Date(firstDue);
        d.setMonth(d.getMonth() + (k - 1));
        if (d.getTime() < Date.now()) pastCount += 1;
      }
      // 1 a cada 4 clientes (com histórico) fica com a última parcela vencida em aberto.
      const inAtraso = custIdx % 4 === 0 && pastCount >= 1;
      custIdx += 1;
      const overdueInstallment = inAtraso ? pastCount : 0;
      const paidCount = inAtraso ? pastCount - 1 : pastCount;

      for (let k = 1; k <= total; k++) {
        const due = new Date(firstDue);
        due.setMonth(due.getMonth() + (k - 1));
        let status = 'pending';
        let paidAt: Date | null = null;
        if (k === overdueInstallment) {
          status = 'overdue';
        } else if (k <= paidCount) {
          status = 'paid';
          paidAt = new Date(due.getTime() - randInt(0, 5) * 86400000);
        }
        const row = await insert('payment_dues', {
          organization_id: orgId,
          customer_id: cust.id,
          contract_reference: cust.contract,
          installment_number: k,
          due_date: dateOnly(due),
          amount: money(round2(cust.pmt)),
          status,
          paid_at: paidAt,
          origin: 'import',
          created_by: adminId,
          created_at: cust.convertedAt,
          updated_at: cust.convertedAt,
        });
        if (status === 'overdue') overdueDues.push({ id: row.id as string, status });
      }
    }

    // -- Regras + jobs de cobrança -----------------------------------------
    console.log('[seed-demo] Regras e jobs de cobrança...');
    await insert('collection_rules', {
      organization_id: orgId,
      key: 'lembrete_3d_antes',
      name: 'Lembrete 3 dias antes do vencimento',
      trigger_type: 'days_before_due',
      wait_hours: 72,
      template_id: tplBoleto.id,
      applies_to_status: 'pending',
      is_active: true,
      max_attempts: 3,
    });
    const ruleAfter = await insert('collection_rules', {
      organization_id: orgId,
      key: 'cobranca_1d_apos',
      name: 'Cobrança 1 dia após vencimento',
      trigger_type: 'days_after_due',
      wait_hours: 24,
      template_id: tplBoleto.id,
      applies_to_status: 'overdue',
      is_active: true,
      max_attempts: 3,
    });
    let jobSeq = 0;
    for (const due of overdueDues) {
      jobSeq += 1;
      const st = pick(['sent', 'sent', 'scheduled', 'failed']);
      await insert('collection_jobs', {
        organization_id: orgId,
        payment_due_id: due.id,
        rule_id: ruleAfter.id,
        scheduled_at: daysAgo(randInt(0, 3)),
        status: st,
        attempt_count: st === 'failed' ? 2 : 1,
        last_error: st === 'failed' ? 'WhatsApp: número não encontrado (1006)' : null,
        sent_message_id: st === 'sent' ? `wamid.demo.${jobSeq}` : null,
        idempotency_key: `collect-${due.id}-${jobSeq}`,
      });
    }

    // -- Regras + jobs de follow-up ----------------------------------------
    console.log('[seed-demo] Regras e jobs de follow-up...');
    const followRule = await insert('followup_rules', {
      organization_id: orgId,
      key: 'reativacao_documentacao',
      name: 'Reativação — parado em Documentação',
      trigger_type: 'stage_inactivity',
      wait_hours: 48,
      template_id: tplFollowup.id,
      applies_to_stage: 'Documentação',
      is_active: true,
      max_attempts: 3,
    });
    await insert('followup_rules', {
      organization_id: orgId,
      key: 'reativacao_simulacao',
      name: 'Reativação — simulação enviada sem retorno',
      trigger_type: 'stage_inactivity',
      wait_hours: 72,
      template_id: tplFollowup.id,
      applies_to_stage: 'Simulação',
      is_active: false,
      max_attempts: 2,
    });
    const docLeads = leads.filter((l) => l.stageId === stageDoc);
    let fjobSeq = 0;
    for (const l of docLeads.slice(0, 6)) {
      fjobSeq += 1;
      const st = pick(['sent', 'sent', 'scheduled', 'customer_replied']);
      await insert('followup_jobs', {
        organization_id: orgId,
        lead_id: l.id,
        rule_id: followRule.id,
        scheduled_at: daysAgo(randInt(0, 2)),
        status: st,
        attempt_count: 1,
        sent_message_id: st === 'sent' || st === 'customer_replied' ? `wamid.fup.${fjobSeq}` : null,
        idempotency_key: `followup-${l.id}-${fjobSeq}`,
      });
    }

    // -- Interações (timeline de conversa) ---------------------------------
    console.log('[seed-demo] Interações (timeline)...');
    const convoLeads = leads
      .filter((l) => [stageSim, stageDoc, stageAna, stageDone].includes(l.stageId))
      .slice(0, 20);
    for (const l of convoLeads) {
      const first = l.name.split(' ')[0];
      const sim = simByLead.get(l.id);
      const script: { dir: 'inbound' | 'outbound'; content: string }[] = [
        { dir: 'inbound', content: 'Oi, queria saber sobre o microcrédito de vocês' },
        {
          dir: 'outbound',
          content: `Olá ${first}! Que bom te receber no Banco do Povo de Rondônia 😊 Em qual cidade você está?`,
        },
        { dir: 'inbound', content: l.cityName },
        {
          dir: 'outbound',
          content:
            'Perfeito! Atendemos sua região. Quanto você gostaria de simular e para qual finalidade?',
        },
      ];
      if (sim) {
        script.push({
          dir: 'inbound',
          content: `Uns R$ ${sim.amount.toLocaleString('pt-BR')}, é pro meu negócio`,
        });
        script.push({
          dir: 'outbound',
          content: `Simulei R$ ${sim.amount.toLocaleString('pt-BR')} em ${sim.term}x de R$ ${round2(sim.pmt).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}. Posso te enviar os detalhes?`,
        });
        script.push({ dir: 'inbound', content: 'Pode sim, obrigado!' });
      }
      let t = l.createdAt.getTime();
      for (const m of script) {
        t += randInt(2, 40) * 60000;
        await insert(
          'interactions',
          {
            organization_id: orgId,
            lead_id: l.id,
            channel: 'whatsapp',
            direction: m.dir,
            content: m.content,
            metadata: JSON.stringify({ seed: 'demo' }),
            created_at: new Date(t),
          },
          'id',
        );
      }
      // histórico do lead
      await insert(
        'lead_history',
        {
          lead_id: l.id,
          action: 'lead_created',
          after: JSON.stringify({ status: 'new', source: 'whatsapp' }),
          actor_user_id: l.agent.userId,
          metadata: JSON.stringify({ seed: 'demo' }),
          created_at: l.createdAt,
        },
        'id',
      );
    }

    // -- Decisões da IA -----------------------------------------------------
    console.log('[seed-demo] Decisões da IA...');
    const NODES = [
      { node: 'identify_city', intent: 'informar_cidade', prompt: 'identify_city' },
      { node: 'qualify_lead', intent: 'qualificacao', prompt: 'qualify_lead' },
      { node: 'simulate_credit', intent: 'simulacao', prompt: 'simulate_credit' },
      { node: 'collect_documents', intent: 'duvida_documentos', prompt: 'collect_documents' },
      { node: 'handoff_human', intent: 'falar_atendente', prompt: 'router' },
    ];
    const aiLeads = convoLeads;
    for (const l of aiLeads) {
      const n = randInt(2, 4);
      for (let z = 0; z < n; z++) {
        const spec = NODES[Math.min(z, NODES.length - 1)]!;
        const sim = simByLead.get(l.id);
        let decision: object = {
          matched_city: l.cityName,
          confidence: round2(Math.random() * 0.2 + 0.8),
        };
        if (spec.node === 'simulate_credit' && sim) {
          decision = {
            amount: sim.amount,
            term_months: sim.term,
            monthly_payment: round2(sim.pmt),
          };
        } else if (spec.node === 'qualify_lead') {
          decision = { qualified: true, score: round2(Math.random() * 0.3 + 0.6) };
        } else if (spec.node === 'handoff_human') {
          decision = { handoff: true, reason: 'solicitação explícita do cliente' };
        }
        await insert(
          'ai_decision_logs',
          {
            organization_id: orgId,
            conversation_id: crypto.randomUUID(),
            lead_id: l.id,
            node_name: spec.node,
            intent: spec.intent,
            prompt_key: spec.prompt,
            prompt_version: 'v3',
            model: 'moonshotai/kimi-k2',
            tokens_in: randInt(400, 1800),
            tokens_out: randInt(80, 600),
            latency_ms: randInt(420, 2600),
            decision: JSON.stringify(decision),
            correlation_id: crypto.randomUUID(),
            created_at: new Date(l.createdAt.getTime() + z * 60000 + randInt(1, 50) * 60000),
          },
          'id',
        );
      }
    }

    await client.query('commit');

    // -- Resumo -------------------------------------------------------------
    const counts = await q<{ t: string; n: string }>(`
      select 'leads' t, count(*)::text n from leads
      union all select 'kanban_cards', count(*)::text from kanban_cards
      union all select 'simulacoes', count(*)::text from credit_simulations
      union all select 'analises', count(*)::text from credit_analyses
      union all select 'clientes', count(*)::text from customers
      union all select 'parcelas', count(*)::text from payment_dues
      union all select 'cobranca_jobs', count(*)::text from collection_jobs
      union all select 'followup_jobs', count(*)::text from followup_jobs
      union all select 'interacoes', count(*)::text from interactions
      union all select 'ai_logs', count(*)::text from ai_decision_logs
      union all select 'agentes', count(*)::text from agents
      union all select 'cidades', count(*)::text from cities
    `);
    console.log('\n[seed-demo] ✅ Concluído. Resumo:');
    for (const c of counts) console.log(`  ${c.t.padEnd(16)}: ${c.n}`);
    console.log('\n[seed-demo] LOGIN DE DEMONSTRAÇÃO:');
    console.log(`  Admin   : ${ADMIN_EMAIL}  /  ${DEMO_PASSWORD}`);
    console.log(`  Agentes : <ver lista de usuários>  /  ${DEMO_PASSWORD}`);
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error('[seed-demo] ERRO:', err);
  process.exit(1);
});
