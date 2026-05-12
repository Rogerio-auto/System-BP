// =============================================================================
// seed-fake.ts — Seed de dados sintéticos para dev/staging (LGPD doc 17 §9.3).
//
// ATENÇÃO: este script gera APENAS dados fictícios.
// - CPFs são gerados com DV matematicamente correto, mas são explicitamente
//   fictícios (não correspondem a cidadãos reais).
// - É PROIBIDO clonar dados de produção para dev/staging (doc 17 §9.3).
// - Este script é a alternativa aprovada — dados realistas sem PII real.
//
// Volumes:
//   - 5  organizações
//   - 10 cidades (2 por organização)
//   - 20 usuários (4 por organização)
//   - 100 leads (20 por organização)
//   - 50  customers (apenas leads com status 'closed_won')
//
// Para rodar: pnpm --filter @elemento/api db:seed-fake
//
// ESLint: console.log é permitido em scripts de seed.
// =============================================================================
/* eslint-disable no-console */

import crypto from 'node:crypto';

import { faker } from '@faker-js/faker/locale/pt_BR';
import bcrypt from 'bcryptjs';
import { sql } from 'drizzle-orm';

import { encryptPii, hashDocument } from '../lib/crypto/pii.js';

import { db, pool } from './client.js';
import { cities, customers, leads, organizations, users } from './schema/index.js';

// =============================================================================
// Geração de CPF sintético com DV válido
// =============================================================================

/**
 * Gera um CPF com dígitos verificadores matematicamente corretos,
 * mas explicitamente fictício (não pertence a nenhum cidadão real).
 *
 * Formato retornado: '000.000.000-00' (com máscara).
 * Os 9 primeiros dígitos são aleatórios — a probabilidade de colisão
 * com um CPF real é < 1 em 1 bilhão.
 */
function generateFakeCpf(): string {
  // Gera 9 dígitos aleatórios
  const digits: number[] = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));

  // Calcula 1º dígito verificador
  const sum1 = digits.reduce((acc, d, i) => acc + d * (10 - i), 0);
  const d1 = (sum1 * 10) % 11;
  const dv1 = d1 >= 10 ? 0 : d1;
  digits.push(dv1);

  // Calcula 2º dígito verificador
  const sum2 = digits.reduce((acc, d, i) => acc + d * (11 - i), 0);
  const d2 = (sum2 * 10) % 11;
  const dv2 = d2 >= 10 ? 0 : d2;
  digits.push(dv2);

  // Formata com máscara
  const [a, b, c, d, e, f, g, h, i, j, k] = digits;
  return `${a}${b}${c}.${d}${e}${f}.${g}${h}${i}-${j}${k}`;
}

/**
 * Remove formatação do CPF → apenas dígitos.
 * Ex: '123.456.789-09' → '12345678909'
 */
function normalizeCpf(cpf: string): string {
  return cpf.replace(/\D/g, '');
}

// =============================================================================
// Seed principal
// =============================================================================

async function main() {
  console.log('[seed-fake] Iniciando seed de dados sintéticos...');
  console.log('[seed-fake] AVISO: apenas dados fictícios — proibido usar dados reais.');

  // Seed determinístico para reprodutibilidade em CI.
  faker.seed(42);

  try {
    // -------------------------------------------------------------------------
    // 1. Organizações (5)
    // -------------------------------------------------------------------------
    console.log('[seed-fake] Criando organizações...');

    const orgIds: string[] = [];
    for (let i = 0; i < 5; i++) {
      const cityName = faker.location.city();
      const slug = `fake-org-${i + 1}-${cityName
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '')}`;
      const name = `Banco do Povo Rondônia — ${cityName} (FAKE)`;

      const [org] = await db
        .insert(organizations)
        .values({ slug, name, settings: {} })
        .onConflictDoUpdate({
          target: organizations.slug,
          set: { name },
        })
        .returning({ id: organizations.id });

      if (org) {
        orgIds.push(org.id);
        console.log(`  [org] ${name}`);
      }
    }

    if (orgIds.length === 0) {
      throw new Error('[seed-fake] Nenhuma organização criada.');
    }

    // -------------------------------------------------------------------------
    // 2. Cidades (10 — 2 por organização)
    // -------------------------------------------------------------------------
    console.log('[seed-fake] Criando cidades...');

    const cityIds: string[] = [];
    for (const orgId of orgIds) {
      for (let j = 0; j < 2; j++) {
        const rawName = faker.location.city();
        const name = `${rawName} (FAKE)`;
        // Slug: lowercase + apenas letras/dígitos/hífen
        const slug = `fake-${rawName
          .toLowerCase()
          .replace(/\s+/g, '-')
          .replace(/[^a-z0-9-]/g, '')}-${crypto.randomUUID().substring(0, 8)}`;
        const nameNormalized = rawName.toLowerCase().replace(/[^a-z0-9\s]/g, '');
        const ibgeCode = String(faker.number.int({ min: 1100000, max: 1199999 }));

        const [city] = await db
          .insert(cities)
          .values({
            organizationId: orgId,
            name,
            nameNormalized,
            slug,
            stateUf: 'RO',
            ibgeCode,
            isActive: true,
          })
          .onConflictDoNothing()
          .returning({ id: cities.id });

        if (city) {
          cityIds.push(city.id);
          console.log(`  [city] ${name}`);
        }
      }
    }

    // -------------------------------------------------------------------------
    // 3. Usuários (20 — 4 por organização)
    // -------------------------------------------------------------------------
    console.log('[seed-fake] Criando usuários...');

    const userIds: string[] = [];
    const passwordHash = await bcrypt.hash('fake-password-seed', 10);

    for (const orgId of orgIds) {
      for (let k = 0; k < 4; k++) {
        const firstName = faker.person.firstName();
        const lastName = faker.person.lastName();
        const email = faker.internet
          .email({ firstName, lastName, provider: 'fake.elemento.dev' })
          .toLowerCase();

        const [user] = await db
          .insert(users)
          .values({
            organizationId: orgId,
            email,
            passwordHash,
            fullName: `${firstName} ${lastName}`,
            status: 'active',
            totpSecret: null,
          })
          .onConflictDoNothing()
          .returning({ id: users.id });

        if (user) {
          userIds.push(user.id);
          console.log(`  [user] ${email}`);
        }
      }
    }

    // -------------------------------------------------------------------------
    // 4. Leads (100 — 20 por organização)
    // -------------------------------------------------------------------------
    console.log('[seed-fake] Criando leads...');

    const leadIds: string[] = [];
    const wonLeadIds: string[] = []; // leads para converter em customers

    const orgCityMap: Record<string, string[]> = {};
    // Reconstrói mapa org → cities
    for (let i = 0; i < orgIds.length; i++) {
      const orgId = orgIds[i];
      if (!orgId) continue;
      orgCityMap[orgId] = [cityIds[i * 2] ?? '', cityIds[i * 2 + 1] ?? ''].filter(Boolean);
    }

    const LEAD_STATUSES = [
      'new',
      'qualifying',
      'simulation',
      'closed_won',
      'closed_lost',
      'archived',
    ] as const;
    const SOURCES = ['whatsapp', 'manual', 'import', 'chatwoot', 'api'] as const;

    for (const orgId of orgIds) {
      const orgCities = orgCityMap[orgId] ?? [];
      if (orgCities.length === 0) continue;

      for (let l = 0; l < 20; l++) {
        const firstName = faker.person.firstName();
        const lastName = faker.person.lastName();
        const name = `${firstName} ${lastName}`;

        // Telefone E.164 no padrão brasileiro
        const areaCode = faker.number.int({ min: 11, max: 99 });
        const phoneDigits = faker.number.int({ min: 900000000, max: 999999999 });
        const phoneE164 = `+55${areaCode}${phoneDigits}`;
        const phoneNormalized = `55${areaCode}${phoneDigits}`;

        const fakeCpf = generateFakeCpf();
        const cpfNormalized = normalizeCpf(fakeCpf);

        // Cifra CPF com AES-256-GCM
        const cpfEncryptedBytes = await encryptPii(cpfNormalized);
        const cpfEncrypted = Buffer.from(cpfEncryptedBytes);
        const cpfHash = hashDocument(cpfNormalized);

        const status = LEAD_STATUSES[l % LEAD_STATUSES.length] ?? 'new';
        const source = SOURCES[l % SOURCES.length] ?? 'manual';
        const cityId = orgCities[l % orgCities.length] ?? '';

        const [lead] = await db
          .insert(leads)
          .values({
            organizationId: orgId,
            cityId,
            name,
            phoneE164,
            phoneNormalized,
            email: faker.internet.email({ firstName, lastName }).toLowerCase(),
            cpfEncrypted,
            cpfHash,
            source,
            status,
            notes: faker.lorem.sentence(),
            metadata: { seed: true, fake: true },
          })
          .onConflictDoNothing()
          .returning({ id: leads.id, status: leads.status });

        if (lead) {
          leadIds.push(lead.id);
          if (lead.status === 'closed_won') {
            wonLeadIds.push(lead.id);
          }
        }
      }
    }

    console.log(`  [leads] ${leadIds.length} leads criados`);

    // -------------------------------------------------------------------------
    // 5. Customers (máx 50 — apenas de leads 'closed_won')
    // -------------------------------------------------------------------------
    console.log('[seed-fake] Criando customers...');

    // Busca org de cada lead won para criar customer com orgId correto
    const wonLeadsData = await db
      .select({ id: leads.id, organizationId: leads.organizationId })
      .from(leads)
      .where(sql`${leads.id} = ANY(${wonLeadIds}::uuid[])`);

    let customerCount = 0;
    for (const wonLead of wonLeadsData.slice(0, 50)) {
      const fakeCpf = generateFakeCpf();
      const cpfNormalized = normalizeCpf(fakeCpf);
      const documentEncryptedBytes = await encryptPii(cpfNormalized);
      const documentNumber = Buffer.from(documentEncryptedBytes);
      const documentHash = hashDocument(cpfNormalized);

      await db
        .insert(customers)
        .values({
          organizationId: wonLead.organizationId,
          primaryLeadId: wonLead.id,
          documentNumber,
          documentHash,
          metadata: {
            seed: true,
            fake: true,
            contract_number: `FAKE-${faker.string.alphanumeric(8).toUpperCase()}`,
            loan_amount_brl: faker.number.int({ min: 1000, max: 50000 }),
          },
        })
        .onConflictDoNothing();

      customerCount++;
    }

    console.log(`  [customers] ${customerCount} customers criados`);

    console.log('\n[seed-fake] Seed concluído com sucesso.');
    console.log('[seed-fake] Resumo:');
    console.log(`  Organizações : ${orgIds.length}`);
    console.log(`  Cidades      : ${cityIds.length}`);
    console.log(`  Usuários     : ${userIds.length}`);
    console.log(`  Leads        : ${leadIds.length}`);
    console.log(`  Customers    : ${customerCount}`);
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error('[seed-fake] ERRO:', err);
  process.exit(1);
});
