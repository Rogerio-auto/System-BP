// =============================================================================
// seed-cities.ts — Seed das cidades de Rondônia atendidas pelo Banco do Povo.
//
// Idempotente: ON CONFLICT DO NOTHING em toda inserção.
// Fonte: IBGE — lista oficial dos 52 municípios de Rondônia (Res. 01/2013 e
// atualizações posteriores). Código IBGE de 7 dígitos (UF=11).
//
// name_normalized: unaccent + lower calculado aqui para consistência.
//   Ex: "Alta Floresta D'Oeste" → "alta floresta d oeste"
//
// aliases: variações de grafia comuns para o módulo identify_city (F3).
//   Sempre em lowercase para matching case-insensitive.
//
// Para rodar: pnpm --filter @elemento/api db:seed-cities
// =============================================================================
/* eslint-disable no-console */

import { sql } from 'drizzle-orm';

import { db, pool } from '../src/db/client.js';
import { cities, organizations } from '../src/db/schema/index.js';

// ---------------------------------------------------------------------------
// Normalização de nomes (replica o que a app fará em runtime)
// ---------------------------------------------------------------------------

/**
 * Converte um nome de cidade para nome_normalizado (sem acentos, lowercase).
 * Implementação JS pura — não usa unaccent do Postgres para manter o seed
 * independente de conexão de banco durante o build.
 *
 * Equivalente a: lower(unaccent(name)) no Postgres.
 */
function normalizeCity(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // remove diacríticos
    .toLowerCase()
    .replace(/'/g, ' ') // apóstrofo → espaço
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Gera slug URL-safe a partir do nome normalizado.
 * Ex: "porto velho" → "porto-velho"
 */
function slugify(name: string): string {
  return normalizeCity(name).replace(/\s+/g, '-');
}

// ---------------------------------------------------------------------------
// Dados: 52 municípios de Rondônia (IBGE)
// ---------------------------------------------------------------------------

interface CityData {
  name: string;
  ibgeCode: string;
  aliases: string[];
}

/**
 * Lista completa dos 52 municípios de Rondônia.
 * Fonte: IBGE — Relação dos municípios e distritos do Brasil (2023).
 * Códigos IBGE verificados em ibge.gov.br/cidades-e-estados/ro.html
 */
const RO_CITIES: CityData[] = [
  {
    name: "Alta Floresta D'Oeste",
    ibgeCode: '1100015',
    aliases: ["alta floresta d'oeste", 'alta floresta', 'alta floresta do oeste'],
  },
  {
    name: 'Alto Alegre dos Parecis',
    ibgeCode: '1100379',
    aliases: ['alto alegre dos parecis', 'alto alegre', 'aap'],
  },
  {
    name: 'Alto Paraíso',
    ibgeCode: '1100403',
    aliases: ['alto paraiso', 'alto paraíso'],
  },
  {
    name: "Alvorada D'Oeste",
    ibgeCode: '1100346',
    aliases: ["alvorada d'oeste", 'alvorada do oeste', 'alvorada'],
  },
  {
    name: 'Ariquemes',
    ibgeCode: '1100023',
    aliases: ['ariquemes'],
  },
  {
    name: 'Buritis',
    ibgeCode: '1100452',
    aliases: ['buritis'],
  },
  {
    name: 'Cabixi',
    ibgeCode: '1100031',
    aliases: ['cabixi'],
  },
  {
    name: 'Cacaulândia',
    ibgeCode: '1100601',
    aliases: ['cacaulandia', 'cacaulândia'],
  },
  {
    name: 'Cacoal',
    ibgeCode: '1100049',
    aliases: ['cacoal'],
  },
  {
    name: 'Campo Novo de Rondônia',
    ibgeCode: '1100700',
    aliases: ['campo novo de rondonia', 'campo novo', 'campo novo de rondônia'],
  },
  {
    name: 'Candeias do Jamari',
    ibgeCode: '1100809',
    aliases: ['candeias do jamari', 'candeias'],
  },
  {
    name: 'Castanheiras',
    ibgeCode: '1100908',
    aliases: ['castanheiras'],
  },
  {
    name: 'Cerejeiras',
    ibgeCode: '1100056',
    aliases: ['cerejeiras'],
  },
  {
    name: 'Chupinguaia',
    ibgeCode: '1100924',
    aliases: ['chupinguaia'],
  },
  {
    name: 'Colorado do Oeste',
    ibgeCode: '1100064',
    aliases: ['colorado do oeste', 'colorado'],
  },
  {
    name: 'Corumbiara',
    ibgeCode: '1100072',
    aliases: ['corumbiara'],
  },
  {
    name: 'Costa Marques',
    ibgeCode: '1100080',
    aliases: ['costa marques'],
  },
  {
    name: 'Cujubim',
    ibgeCode: '1100940',
    aliases: ['cujubim'],
  },
  {
    name: "Espigão D'Oeste",
    ibgeCode: '1100098',
    aliases: ["espigao d'oeste", "espigão d'oeste", 'espigao do oeste', 'espigão do oeste'],
  },
  {
    name: 'Governador Jorge Teixeira',
    ibgeCode: '1101005',
    aliases: ['governador jorge teixeira', 'gov. jorge teixeira', 'jorge teixeira'],
  },
  {
    name: 'Guajará-Mirim',
    ibgeCode: '1100106',
    aliases: ['guajara-mirim', 'guajará mirim', 'guajará-mirim', 'guajara mirim'],
  },
  {
    name: 'Itapuã do Oeste',
    ibgeCode: '1101104',
    aliases: ['itapua do oeste', 'itapuã do oeste'],
  },
  {
    name: 'Jaru',
    ibgeCode: '1100114',
    aliases: ['jaru'],
  },
  {
    name: 'Ji-Paraná',
    ibgeCode: '1100122',
    aliases: ['ji-parana', 'ji paraná', 'ji-paraná', 'ji parana', 'jipa'],
  },
  {
    name: "Machadinho D'Oeste",
    ibgeCode: '1100130',
    aliases: ["machadinho d'oeste", 'machadinho do oeste', 'machadinho'],
  },
  {
    name: 'Ministro Andreazza',
    ibgeCode: '1101203',
    aliases: ['ministro andreazza', 'andreazza'],
  },
  {
    name: 'Mirante da Serra',
    ibgeCode: '1101302',
    aliases: ['mirante da serra', 'mirante'],
  },
  {
    name: 'Monte Negro',
    ibgeCode: '1101401',
    aliases: ['monte negro'],
  },
  {
    name: "Nova Brasilândia D'Oeste",
    ibgeCode: '1100148',
    aliases: ["nova brasilandia d'oeste", "nova brasilândia d'oeste", 'nova brasilandia'],
  },
  {
    name: 'Nova Mamoré',
    ibgeCode: '1100338',
    aliases: ['nova mamore', 'nova mamoré'],
  },
  {
    name: 'Nova União',
    ibgeCode: '1101435',
    aliases: ['nova uniao', 'nova união'],
  },
  {
    name: 'Novo Horizonte do Oeste',
    ibgeCode: '1100502',
    aliases: ['novo horizonte do oeste', 'novo horizonte'],
  },
  {
    name: 'Ouro Preto do Oeste',
    ibgeCode: '1100155',
    aliases: ['ouro preto do oeste', 'ouro preto'],
  },
  {
    name: 'Parecis',
    ibgeCode: '1101450',
    aliases: ['parecis'],
  },
  {
    name: 'Pimenta Bueno',
    ibgeCode: '1100189',
    aliases: ['pimenta bueno'],
  },
  {
    name: 'Pimenteiras do Oeste',
    ibgeCode: '1101468',
    aliases: ['pimenteiras do oeste', 'pimenteiras'],
  },
  {
    name: 'Porto Velho',
    ibgeCode: '1100205',
    aliases: ['porto velho', 'pvh', 'p. velho', 'portovelho'],
  },
  {
    name: 'Presidente Médici',
    ibgeCode: '1100254',
    aliases: ['presidente medici', 'presidente médici', 'pres. medici'],
  },
  {
    name: 'Primavera de Rondônia',
    ibgeCode: '1101476',
    aliases: ['primavera de rondonia', 'primavera de rondônia', 'primavera'],
  },
  {
    name: 'Rio Crespo',
    ibgeCode: '1100262',
    aliases: ['rio crespo'],
  },
  {
    name: 'Rolim de Moura',
    ibgeCode: '1100288',
    aliases: ['rolim de moura', 'rolim'],
  },
  {
    name: "Santa Luzia D'Oeste",
    ibgeCode: '1100296',
    aliases: ["santa luzia d'oeste", 'santa luzia do oeste', 'santa luzia'],
  },
  {
    name: "São Felipe D'Oeste",
    ibgeCode: '1101484',
    aliases: ["sao felipe d'oeste", "são felipe d'oeste", 'sao felipe do oeste', 'são felipe'],
  },
  {
    name: 'São Francisco do Guaporé',
    ibgeCode: '1101492',
    aliases: ['sao francisco do guapore', 'são francisco do guaporé', 'sao francisco'],
  },
  {
    name: 'São Miguel do Guaporé',
    ibgeCode: '1100320',
    aliases: ['sao miguel do guapore', 'são miguel do guaporé', 'sao miguel'],
  },
  {
    name: 'Seringueiras',
    ibgeCode: '1101500',
    aliases: ['seringueiras'],
  },
  {
    name: 'Teixeirópolis',
    ibgeCode: '1101559',
    aliases: ['teixeiropolis', 'teixeirópolis'],
  },
  {
    name: 'Theobroma',
    ibgeCode: '1101609',
    aliases: ['theobroma'],
  },
  {
    name: 'Urupá',
    ibgeCode: '1101708',
    aliases: ['urupa', 'urupá'],
  },
  {
    name: 'Vale do Anari',
    ibgeCode: '1101757',
    aliases: ['vale do anari'],
  },
  {
    name: 'Vale do Paraíso',
    ibgeCode: '1101807',
    aliases: ['vale do paraiso', 'vale do paraíso'],
  },
  {
    name: 'Vilhena',
    ibgeCode: '1100304',
    aliases: ['vilhena'],
  },
];

// ---------------------------------------------------------------------------
// Seed principal
// ---------------------------------------------------------------------------

async function seedCities(): Promise<void> {
  console.log('[seed-cities] Iniciando seed idempotente das cidades de Rondônia...');
  console.log(`[seed-cities] ${RO_CITIES.length} municípios na lista IBGE.`);

  // Buscar organização (deve ter sido criada pelo seed principal)
  const org = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(sql`${organizations.slug} = 'bdp-rondonia'`)
    .then((r) => r[0]);

  if (!org) {
    console.error(
      '[seed-cities] ERRO: Organização bdp-rondonia não encontrada.',
      'Execute o seed principal primeiro: pnpm --filter @elemento/api db:seed',
    );
    process.exit(1);
  }

  const orgId = org.id;

  // Inserir cidades em lote (ON CONFLICT DO NOTHING pela PK uuid)
  // Unique parcial (org, ibge_code) garante idempotência na re-execução.
  let inserted = 0;
  let skipped = 0;

  for (const city of RO_CITIES) {
    const nameNormalized = normalizeCity(city.name);
    const slug = slugify(city.name);

    const result = await db
      .insert(cities)
      .values({
        organizationId: orgId,
        name: city.name,
        nameNormalized,
        aliases: city.aliases,
        slug,
        ibgeCode: city.ibgeCode,
        stateUf: 'RO',
        isActive: true,
      })
      // Conflict na unique parcial (org, ibge_code) where deleted_at IS NULL
      .onConflictDoNothing()
      .returning({ id: cities.id });

    if (result.length > 0) {
      inserted++;
    } else {
      skipped++;
    }
  }

  console.log(`[seed-cities] Concluído: ${inserted} inseridas, ${skipped} já existiam.`);
  console.log(`[seed-cities] Total de cidades ativas: ${inserted + skipped}`);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

seedCities()
  .catch((err: unknown) => {
    console.error('[seed-cities] ERRO:', err);
    process.exit(1);
  })
  .finally(() => {
    void pool.end();
  });
