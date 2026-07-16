// =============================================================================
// modules/assistant-history/hydrate.ts — hidratação viva dos blocos do
// histórico do copiloto interno (F6-S27).
//
// Coração do DPIA "nível A" (docs/anexos/lgpd/dpia-historico-copiloto.md
// §1.1/§4): o histórico persiste só `{ type, ref }` (ver schemas.ts/
// service.ts). Ao abrir uma conversa, o `value` de cada bloco é RE-BUSCADO
// AQUI com a permissão e o escopo de cidade do usuário ATUAL — nunca confia
// que o dado era visível quando o turno foi gravado (DPIA risco R2).
//
// Reuso, não reimplementação: a hidratação chama as MESMAS funções de
// serviço RBAC-bound que os endpoints /internal/assistant/* expõem ao
// LangGraph (internal/assistant/service.ts) — mesmo código, mesma
// autorização, sem HTTP self-call (mesmo processo Node, mesma regra de ouro
// do doc 22 §12.2: o copiloto/histórico nunca lê com privilégio próprio).
// `getAnalysisStatus`/`getLeadConversation` já aplicam city-scope
// internamente (leads/repository.ts, internal/assistant/repository.ts) —
// esta camada NUNCA escreve query crua sem escopo.
//
// Sem acesso (ForbiddenError) OU entidade fora de escopo/apagada
// (NotFoundError) -> `value: null`. O frontend (F6-S22, BlockCardUnavailable)
// já trata qualquer `value` que não bate com a forma esperada do card como
// "dado indisponível" — nenhuma mudança de frontend é necessária para este
// slot (F6-S28 é quem liga a sidebar ao histórico).
//
// Blocos sem referência de entidade (`ref.kind === 'none'` — agregados como
// funnel_metrics/lead_count/billing) e blocos com `type` desconhecido/sem
// hidratador mapeado NUNCA fabricam um valor: ficam `value: null` sem
// nenhuma chamada adicional — não há parâmetros persistidos (range, cityIds)
// para reconstruir o resultado original de um agregado, e um `type` novo não
// tem hidratador determinístico (mesma postura non-closed-enum de
// internal-assistant/schemas.ts:BlockSchema).
//
// Nunca loga `value`/PII — apenas re-lança erros de infraestrutura (não
// Forbidden/NotFound) para o caller tratar, sem envolver dado de cliente.
// =============================================================================
import type { Database } from '../../db/client.js';
import { AppError, ForbiddenError, NotFoundError } from '../../shared/errors.js';
import type { Principal } from '../internal/assistant/schemas.js';
import {
  getAnalysisStatus,
  getBillingUpcoming,
  getFunnelMetrics,
  getLeadConversation,
  getLeadCount,
} from '../internal/assistant/service.js';
import type { Block } from '../internal-assistant/schemas.js';

import type { StoredBlock } from './schemas.js';

/**
 * Actor mínimo necessário para re-checar RBAC + escopo de cidade na
 * hidratação — estruturalmente compatível com `AssistantHistoryActorContext`
 * (service.ts), sem depender dele (evita acoplar os dois módulos em ambas as
 * direções).
 */
export interface HydrationActor {
  userId: string;
  organizationId: string;
  /** Permissões efetivas do usuário NO MOMENTO da leitura (não as de quando o turno foi gravado). */
  permissions: string[];
  /** Escopo de cidade do usuário NO MOMENTO da leitura — idem acima. */
  cityScopeIds: string[] | null;
}

function toPrincipal(actor: HydrationActor): Principal {
  return {
    user_id: actor.userId,
    organization_id: actor.organizationId,
    permissions: actor.permissions,
    city_scope_ids: actor.cityScopeIds,
  };
}

/**
 * Busca o valor ao vivo de um bloco referenciando um lead, delegando à
 * função de serviço RBAC-bound correspondente ao `type` do bloco.
 * `type` sem hidratador mapeado (forward-compat) -> `null`, nunca fabrica
 * uma forma incompatível com os cards do frontend.
 */
async function fetchLeadScopedValue(
  db: Database,
  principal: Principal,
  type: string,
  leadId: string,
): Promise<unknown> {
  switch (type) {
    case 'analysis_status':
      return getAnalysisStatus(db, principal, leadId);
    case 'lead_summary':
      return getLeadConversation(db, principal, leadId);
    default:
      return null;
  }
}

/**
 * Buckets temporais reconstruíveis de um agregado. `custom` fica de fora de
 * propósito: a tool do copiloto nunca persiste `dateFrom`/`dateTo` (o schema da
 * tool só expõe `range` como enum), então um `custom` não teria como ser
 * reconstruído — hidrata `null` em vez de estourar `getFunnelMetrics` (400).
 */
const REHYDRATABLE_RANGES = new Set([
  'today',
  'last7d',
  'last30d',
  'last90d',
  'thisMonth',
  'lastMonth',
]);

/**
 * Reconstrói o valor de um bloco AGREGADO re-executando a mesma função de
 * serviço RBAC-bound (city-scope + permissão revalidados AGORA), a partir dos
 * parâmetros não-pessoais persistidos no `ref` (range + city_ids). Nunca
 * fabrica uma forma: `type` sem agregador mapeado, ou `range` não
 * reconstruível, -> `null`.
 */
async function fetchAggregateValue(
  db: Database,
  principal: Principal,
  type: string,
  range: string | null | undefined,
  cityIds: string[] | null | undefined,
): Promise<unknown> {
  const cityArg = cityIds ?? undefined;
  switch (type) {
    case 'billing':
      // billing-upcoming é snapshot atual — não aceita range (contrato F6-S06 M-1).
      return getBillingUpcoming(db, principal, cityArg ? { cityIds: cityArg } : undefined);
    case 'funnel_metrics':
      if (!range || !REHYDRATABLE_RANGES.has(range)) return null;
      return getFunnelMetrics(db, principal, { range, cityIds: cityArg });
    case 'lead_count':
      if (!range || !REHYDRATABLE_RANGES.has(range)) return null;
      return getLeadCount(db, principal, { range, cityIds: cityArg });
    default:
      return null;
  }
}

/**
 * Re-hidrata um único bloco a partir da referência persistida.
 *
 * Nunca lança para o caller por falta de acesso: `ForbiddenError`
 * (permissão insuficiente hoje) e `NotFoundError` (lead fora do escopo de
 * cidade atual, ou apagado/anonimizado — findLeadById filtra deleted_at)
 * ambos viram `value: null`, sem vazar o dado nem a razão exata da negativa
 * ao chamador. Qualquer outro erro (infraestrutura) propaga — nunca é
 * mascarado como "sem acesso".
 */
async function hydrateOne(db: Database, principal: Principal, block: StoredBlock): Promise<Block> {
  if (block.ref.kind === 'aggregate') {
    // Agregado: reconstruível a partir dos parâmetros não-pessoais do ref
    // (range + city_ids), re-executando a consulta com o RBAC atual. Sem
    // acesso (Forbidden) / cidade fora do escopo hoje (Forbidden via
    // assertCityInScope) / range inválido (AppError 400 de computeRange) ->
    // value:null, nunca vaza nem estoura. Erro de infra propaga.
    try {
      const value = await fetchAggregateValue(
        db,
        principal,
        block.type,
        block.ref.range,
        block.ref.city_ids,
      );
      return { type: block.type, ref: block.ref, value };
    } catch (err) {
      if (
        err instanceof ForbiddenError ||
        err instanceof NotFoundError ||
        (err instanceof AppError && err.statusCode === 400)
      ) {
        return { type: block.type, ref: block.ref, value: null };
      }
      throw err;
    }
  }

  if (block.ref.kind !== 'lead' || block.ref.lead_id === null) {
    // Bloco legado sem entidade nem parâmetros de agregado (kind='none', ou
    // agregado gravado antes de range/city_ids existirem no ref) — não há como
    // reconstituir um `value`. Nunca lança.
    return { type: block.type, ref: block.ref, value: null };
  }

  try {
    const value = await fetchLeadScopedValue(db, principal, block.type, block.ref.lead_id);
    return { type: block.type, ref: block.ref, value };
  } catch (err) {
    if (err instanceof ForbiddenError || err instanceof NotFoundError) {
      return { type: block.type, ref: block.ref, value: null };
    }
    throw err;
  }
}

/**
 * Re-hidrata todos os blocos de um turno, em paralelo, com a permissão e o
 * escopo de cidade ATUAIS do ator — nunca os do momento em que o turno foi
 * gravado. Coração do DPIA (§4.2): "controle de acesso sempre atual".
 */
export async function hydrateBlocks(
  db: Database,
  actor: HydrationActor,
  blocks: StoredBlock[],
): Promise<Block[]> {
  const principal = toPrincipal(actor);
  return Promise.all(blocks.map((block) => hydrateOne(db, principal, block)));
}
