// =============================================================================
// internal/handoffs/service.ts — Lógica de negócio para POST /internal/handoffs
// (F3-S07 + F3-S37).
//
// Pipeline (doc 06 §7.4), executado em uma única transação DB + chamadas
// externas ao Chatwoot (fora da transação — não transacional por natureza):
//
//   1. Verificar idempotência via chatwoot_handoffs.idempotency_key.
//      Reenvio retorna o handoff existente sem reprocessar.
//   2. Em transação DB:
//      a. INSERT em chatwoot_handoffs — handoff_id é o id da linha persistida.
//      b. Resolver a ref de agregado do outbox (lead vs. conversation nativa
//         vinculada ao leadId — deep-link, F26-S02, doc 23 §13).
//      c. Emitir 'chatwoot.handoff_requested' via outbox com essa ref.
//      d. Se card do lead estiver em stage 'pré-atendimento' ou 'simulação',
//         mover para o próximo stage (doc 05 §kanban).
//      e. Inserir na idempotency_keys (cache rápido de resposta para reenvios).
//   3. Chamar Chatwoot via ChatwootClient:
//      a. Atualizar custom_attributes (lead_id, reason, handoff_id).
//      b. Criar nota interna com summary (isPrivate=true).
//      c. Chatwoot não suporta rollback — falha Chatwoot é logada mas
//         não reverte o handoff (already committed in step 2).
//
// Nota arquitetural sobre atomicidade:
//   Chatwoot é um serviço externo — não participa da transação Postgres.
//   A ordem garante que o estado interno (DB) é consistente antes de chamar
//   o Chatwoot. Se o Chatwoot falhar, o handoff está registrado no outbox
//   e o worker de eventos notificará a falha. Esta é a abordagem padrão do
//   Outbox Pattern para integrações externas (docs/04-eventos.md).
//
// LGPD (doc 17 §8.1, §8.5):
//   - summary é dado interno de atendimento (campo sensível — label lgpd-impact).
//     Pode conter contexto do cliente resumido pela IA.
//     Regras: pino.redact DEVE incluir 'summary'; NUNCA no outbox (§8.5);
//     NUNCA em log sem redact; DLP aplicado pelo caller antes de enviar (doc 06 §8.4).
//   - leadId é UUID opaco — não é PII no outbox.
//   - idempotency_keys.response_body armazena apenas { handoff_id, status } —
//     sem PII (LGPD: response_body nunca deve conter PII per schema comment).
// =============================================================================
import { and, desc, eq, isNull } from 'drizzle-orm';

import type { Database } from '../../../db/client.js';
import {
  chatwootHandoffs,
  conversations,
  idempotencyKeys,
  kanbanCards,
  kanbanStages,
} from '../../../db/schema/index.js';
import { emit } from '../../../events/emit.js';
import type { DrizzleTx } from '../../../events/emit.js';

import type { InternalHandoffBody, InternalHandoffResponse } from './schemas.js';

// ---------------------------------------------------------------------------
// Tipo local para transação Drizzle compatível com este service
// ---------------------------------------------------------------------------

// Justificativa do tipo estrutural: Drizzle não exporta NodePgTransaction diretamente.
// Este tipo cobre as operações necessárias neste service (select, insert, update).
interface HandoffTx {
  select: Database['select'];
  insert: Database['insert'];
  update: Database['update'];
}

// ---------------------------------------------------------------------------
// Slugs de stage que qualificam para mover no handoff
// ---------------------------------------------------------------------------

// Stages que devem ser movidos para o próximo stage quando um handoff ocorre.
// O slug é derivado do nome do stage (lowercase, sem acentos, espaços → hífen).
// Implementação de slug compatível com listKanbanStages em kanban/service.ts.
// Doc 05: "chatwoot.handoff_requested → move para documentacao se ainda em pre/sim"
// Doc 06: "Move card no Kanban se ainda em `pre_atendimento`/`simulacao`"
const MOVABLE_STAGE_SLUGS = new Set(['pre-atendimento', 'simulacao']);

/**
 * Deriva o slug de um stage a partir do nome.
 * Compatível com a implementação em kanban/service.ts:
 *   lowercase → normalize NFD → remove diacríticos → espaços → hífen → remove não-alfanuméricos
 */
function stageSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
}

// ---------------------------------------------------------------------------
// requestHandoff — função principal
// ---------------------------------------------------------------------------

/**
 * Executa o pipeline de handoff para um lead.
 *
 * @param db      Instância Drizzle (não transacionada — esta função cria a tx).
 * @param body    Body validado pelo schema Zod.
 * @param idempotencyKey  Valor do header Idempotency-Key.
 * @param logger  Logger do request (Fastify) para registrar avisos Chatwoot.
 *                Deve ter redact de 'summary' aplicado em app.ts.
 *
 * @returns InternalHandoffResponse com handoff_id, conversa, agente, status.
 *
 * @throws AppError em qualquer falha não-recuperável (DB, validação).
 *         Falha do Chatwoot é logada mas não lança — estado DB já está commitado.
 */
export async function requestHandoff(
  db: Database,
  body: InternalHandoffBody,
  idempotencyKey: string,
  logger: { warn: (msg: object | string) => void },
): Promise<InternalHandoffResponse> {
  // -------------------------------------------------------------------------
  // 1. Verificar idempotência — reenvio retorna handoff existente da tabela
  //    chatwoot_handoffs (F3-S37: persistência durável).
  // -------------------------------------------------------------------------
  const existingHandoff = await db
    .select({
      id: chatwootHandoffs.id,
      chatwootConversationId: chatwootHandoffs.chatwootConversationId,
      assignedAgentId: chatwootHandoffs.assignedAgentId,
      status: chatwootHandoffs.status,
    })
    .from(chatwootHandoffs)
    .where(
      and(
        eq(chatwootHandoffs.idempotencyKey, idempotencyKey),
        eq(chatwootHandoffs.organizationId, body.organizationId),
      ),
    )
    .limit(1);

  if (existingHandoff.length > 0 && existingHandoff[0] !== undefined) {
    // Reenvio detectado — retornar handoff existente sem reprocessar
    const h = existingHandoff[0];
    return {
      handoff_id: h.id,
      chatwoot_conversation_id: h.chatwootConversationId,
      assigned_agent_id: h.assignedAgentId,
      // Justificativa do `as`: status é text no Drizzle, mas a constraint CHECK
      // garante que só conterá valores do enum. Cast documentado e seguro.
      status: h.status as InternalHandoffResponse['status'],
    };
  }

  // -------------------------------------------------------------------------
  // 2. Executar mutações DB em transação
  //    a. INSERT em chatwoot_handoffs — handoff_id é o id da linha
  //    b. Resolver a ref de agregado do outbox (deep-link, F26-S02)
  //    c. Emitir evento no outbox
  //    d. Mover card do kanban se aplicável
  //    e. Inserir na idempotency_keys (cache rápido)
  // -------------------------------------------------------------------------
  // handoffId será sempre preenchido pela transação (INSERT ... RETURNING).
  // Inicializado como string vazia para satisfazer strictPropertyInitialization;
  // o valor real é atribuído dentro da transação antes de qualquer uso externo.
  let handoffId = '';

  await db.transaction(async (tx) => {
    // Tipo dual para drizzleTx (emit usa DrizzleTx, kanban usa HandoffTx)
    const txEmit = tx as unknown as DrizzleTx;
    const txRepo = tx as unknown as HandoffTx;

    // 2a. INSERT em chatwoot_handoffs
    //     O id gerado pelo Postgres (gen_random_uuid()) é o handoff_id real.
    //     LGPD: summary é persistido aqui — DLP já aplicado pelo caller (doc 06 §8.4).
    //     conversationId (AI UUID) não está disponível no body atual (F3-S07 usa
    //     Chatwoot numeric ID). Armazenado como null — campo nullable no schema.
    const insertedRows = await (txRepo as Database)
      .insert(chatwootHandoffs)
      .values({
        organizationId: body.organizationId,
        leadId: body.leadId,
        conversationId: null,
        chatwootConversationId: String(body.conversationId),
        reason: body.reason,
        // LGPD: summary persistido apenas na tabela interna.
        // NUNCA incluir no outbox payload (violação §8.5).
        summary: body.summary,
        simulationId: body.simulationId ?? null,
        assignedAgentId: null,
        status: 'requested',
        idempotencyKey,
      })
      .returning({ id: chatwootHandoffs.id });

    // Justificativa do non-null assertion: insert().returning() sempre retorna
    // exatamente 1 linha quando não há erro — garantido pelo Drizzle + Postgres.
    handoffId = insertedRows[0]!.id;

    // 2b. Resolver a ref de agregado do outbox — deep-link (F26-S02, doc 23 §13).
    //
    //     Bug histórico: aggregateType='lead'/aggregateId=leadId, mesmo o
    //     TRIGGER_CATALOG rotulando este gatilho como entityType='conversation'
    //     (a notificação carrega entity_type='lead' e o resolvedor do frontend
    //     não tem rota para 'lead' — o link fica morto).
    //
    //     Fix: este endpoint só recebe o ID numérico da conversa no Chatwoot
    //     (body.conversationId) — não o UUID da nossa tabela `conversations`
    //     nativa (F16), que não tem relação 1:1 com o Chatwoot. Buscamos a
    //     conversa nativa mais recente vinculada ao mesmo leadId: se existir,
    //     apontamos o deep-link para ela (aggregateType='conversation',
    //     aggregateId=conversations.id) — mesmo tipo declarado pelo catálogo.
    //     Sem conversa nativa correspondente (fluxo Chatwoot legado sem
    //     equivalente em livechat nativo), preserva o fallback anterior
    //     (aggregateType='lead') — nunca aponta para um UUID de tipo errado.
    const nativeConversationRows = await (txRepo as Database)
      .select({ id: conversations.id })
      .from(conversations)
      .where(
        and(
          eq(conversations.leadId, body.leadId),
          eq(conversations.organizationId, body.organizationId),
          isNull(conversations.deletedAt),
        ),
      )
      .orderBy(desc(conversations.lastMessageAt))
      .limit(1);

    const nativeConversation = nativeConversationRows[0];
    const aggregateType = nativeConversation !== undefined ? 'conversation' : 'lead';
    const aggregateId = nativeConversation !== undefined ? nativeConversation.id : body.leadId;

    // 2c. Emitir 'chatwoot.handoff_requested' no outbox
    //     LGPD §8.5: payload contém apenas IDs opacos. summary NÃO vai no outbox.
    await emit(txEmit, {
      eventName: 'chatwoot.handoff_requested',
      aggregateType,
      aggregateId,
      organizationId: body.organizationId,
      actor: { kind: 'ai', id: null, ip: null },
      // Chave determinística baseada no idempotency key do caller — garante
      // que reenvios não emitem múltiplos eventos mesmo se a tx do item 1
      // sofreu rollback e foi re-executada.
      idempotencyKey: `chatwoot.handoff_requested:${idempotencyKey}`,
      data: {
        lead_id: body.leadId,
        chatwoot_conversation_id: body.conversationId,
        reason: body.reason,
        // LGPD §8.5: summary vai APENAS para nota interna Chatwoot e tabela interna.
        // O outbox inclui uma string vazia como placeholder estrutural.
        summary: '',
        simulation_id: body.simulationId ?? null,
      },
    });

    // 2d. Mover card do kanban se ainda em stage movível
    //     Doc 05: "chatwoot.handoff_requested → move para documentacao se ainda em pre/sim"
    //     Doc 06: "Move card no Kanban se ainda em pre_atendimento/simulacao"
    //     Estratégia: lookup do card pelo leadId, verificar slug do stage atual,
    //     se movível → buscar stage de menor order_index maior que o atual e mover.
    //     Falha silenciosa: se card não existe ou já está em stage avançado, ignorar.
    const cardRows = await (txRepo as Database)
      .select({
        id: kanbanCards.id,
        stageId: kanbanCards.stageId,
        organizationId: kanbanCards.organizationId,
      })
      .from(kanbanCards)
      .where(
        and(
          eq(kanbanCards.leadId, body.leadId),
          eq(kanbanCards.organizationId, body.organizationId),
        ),
      )
      .limit(1);

    const card = cardRows[0];

    if (card !== undefined) {
      // Buscar stage atual para verificar slug
      const currentStageRows = await (txRepo as Database)
        .select({
          id: kanbanStages.id,
          name: kanbanStages.name,
          orderIndex: kanbanStages.orderIndex,
        })
        .from(kanbanStages)
        .where(
          and(
            eq(kanbanStages.id, card.stageId),
            eq(kanbanStages.organizationId, body.organizationId),
          ),
        )
        .limit(1);

      const currentStage = currentStageRows[0];

      if (currentStage !== undefined && MOVABLE_STAGE_SLUGS.has(stageSlug(currentStage.name))) {
        // Buscar o próximo stage na ordem (order_index > atual)
        // Filtrar stages terminais para não mover direto para won/lost
        const allStageRows = await (txRepo as Database)
          .select({
            id: kanbanStages.id,
            name: kanbanStages.name,
            orderIndex: kanbanStages.orderIndex,
            isTerminalWon: kanbanStages.isTerminalWon,
            isTerminalLost: kanbanStages.isTerminalLost,
          })
          .from(kanbanStages)
          .where(eq(kanbanStages.organizationId, body.organizationId));

        // Ordenar em memória: próximo stage não-terminal após o atual
        const nextStage = allStageRows
          .filter(
            (s) => s.orderIndex > currentStage.orderIndex && !s.isTerminalWon && !s.isTerminalLost,
          )
          .sort((a, b) => a.orderIndex - b.orderIndex)[0];

        if (nextStage !== undefined) {
          const now = new Date();
          await (txRepo as Database)
            .update(kanbanCards)
            .set({
              stageId: nextStage.id,
              enteredStageAt: now,
              updatedAt: now,
            })
            .where(
              and(eq(kanbanCards.id, card.id), eq(kanbanCards.organizationId, body.organizationId)),
            );
        }
      }
    }

    // 2e. Inserir na idempotency_keys para reenvios rápidos via cache
    //     LGPD: response_body armazena apenas handoff_id + status — sem PII.
    const responseBody: InternalHandoffResponse = {
      handoff_id: handoffId,
      chatwoot_conversation_id: String(body.conversationId),
      assigned_agent_id: null,
      status: 'requested',
    };

    await (txRepo as Database).insert(idempotencyKeys).values({
      key: idempotencyKey,
      endpoint: 'POST /internal/handoffs',
      // SHA-256 placeholder — campo obrigatório no schema. Não fazemos hash do body
      // aqui porque o body já foi validado e não há verificação de body-mismatch
      // neste endpoint (o token + idempotency key são suficientes para autenticação).
      requestHash: idempotencyKey,
      responseStatus: 200,
      responseBody: responseBody as unknown as Record<string, unknown>,
    });
  });

  // -------------------------------------------------------------------------
  // 3. Chamar Chatwoot (fora da transação — not transacional)
  //    Falha do Chatwoot NÃO reverte o handoff já commitado.
  //    O outbox worker garantirá consistência eventual.
  // -------------------------------------------------------------------------
  try {
    // Import lazy para permitir mock em testes sem instanciar o cliente real
    const { ChatwootClient } = await import('../../../integrations/chatwoot/client.js');
    const chatwoot = new ChatwootClient();

    // 3a. Atualizar custom_attributes da conversa no Chatwoot
    //     Expõe o handoff_id e reason para o agente humano visualizar na UI.
    await chatwoot.updateAttributes(body.conversationId, {
      // Justificativa do `as string`: ChatwootAttributes é Record<string, string | number | boolean | null>.
      // handoff_id é string — cast é seguro e documentado.
      lead_id: body.leadId as string,
      handoff_id: handoffId as string,
      handoff_reason: body.reason as string,
      simulation_id: (body.simulationId ?? null) as string | null,
    });

    // 3b. Criar nota interna com o summary para o agente humano
    //     LGPD: summary é dado interno — nota interna (isPrivate=true) não é visível ao cliente.
    //     Caller já garantiu que summary passou por DLP se veio de LLM (doc 06 §8.4).
    await chatwoot.createNote(body.conversationId, body.summary);
  } catch (chatwootErr) {
    // Chatwoot falhou — logar aviso e continuar
    // O handoff já está registrado no outbox e será processado pelo worker.
    // LGPD: não logar body.summary (pode conter PII) — apenas erro técnico.
    logger.warn({
      msg: 'Chatwoot update falhou após handoff commitado no DB',
      handoff_id: handoffId,
      lead_id: body.leadId,
      reason: body.reason,
      error: chatwootErr instanceof Error ? chatwootErr.message : 'unknown',
    });
  }

  // -------------------------------------------------------------------------
  // 4. Retornar resposta
  //    handoff_id é o id real da linha em chatwoot_handoffs (F3-S37).
  // -------------------------------------------------------------------------
  return {
    handoff_id: handoffId,
    chatwoot_conversation_id: String(body.conversationId),
    assigned_agent_id: null,
    status: 'requested',
  };
}
