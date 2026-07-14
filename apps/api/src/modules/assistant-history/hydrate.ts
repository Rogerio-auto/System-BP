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
import { ForbiddenError, NotFoundError } from '../../shared/errors.js';
import type { Principal } from '../internal/assistant/schemas.js';
import { getAnalysisStatus, getLeadConversation } from '../internal/assistant/service.js';
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
  if (block.ref.kind !== 'lead' || block.ref.lead_id === null) {
    // Agregado (sem entidade referenciada) — nunca teve um `value`
    // reconstituível a partir só de `{ type, ref }` (sem range/cityIds
    // persistidos). Nunca lança.
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
