// =============================================================================
// ai-console/prompts/service.ts — Regras de negócio do módulo prompt_versions (F9-S01).
//
// Responsabilidades:
//   - Calcular content_hash (SHA-256 do body).
//   - Calcular próxima versão = max(version) + 1 por key.
//   - Validação defensiva de PII no body (regex CPF/e-mail/telefone).
//   - Idempotência por content_hash: se já existe versão com mesmo hash, retorna ela.
//   - Criação atômica: insert + audit + outbox na mesma transação.
//   - Ativação atômica: deactivate_old + activate_new + audit + outbox em uma transação.
//
// LGPD (doc 17 §3.4):
//   - body do prompt NUNCA deve conter PII. Service rejeita com ValidationError
//     se detectar pattern de CPF/e-mail/telefone.
//   - Logs: apenas key, version, content_hash — nunca o body completo.
//   - Audit before/after: usa key + version (snapshot mínimo, sem body).
//
// Eventos emitidos no outbox (na mesma transação da mutação):
//   - ai_prompts.version_created  — ao criar nova versão
//   - ai_prompts.version_activated — ao ativar versão
//
// Nota: os eventos acima não estão em AppEventDataMap (events/types.ts não é
// arquivo permitido deste slot). A inserção é feita diretamente via eventOutbox
// usando tipagem local — sem `any`, justificada abaixo.
// =============================================================================
import { createHash, randomUUID } from 'node:crypto';

import type { Database } from '../../../db/client.js';
import { eventOutbox } from '../../../db/schema/events.js';
import type { promptVersions } from '../../../db/schema/promptVersions.js';
import { auditLog } from '../../../lib/audit.js';
import type { AuditActor } from '../../../lib/audit.js';
import { ConflictError, NotFoundError, ValidationError } from '../../../shared/errors.js';

import {
  activateVersion,
  deactivateActiveVersion,
  findActiveVersionByKeyForUpdate,
  findVersionByKeyAndHashInTx,
  findVersionByKeyAndNum,
  findVersionByKeyAndNumForUpdate,
  getMaxVersionForKeyForUpdate,
  insertPromptVersion,
  listPromptKeys,
  listVersionsByKey,
} from './repository.js';
import type { CreatePromptVersionBody, PromptVersionResponse } from './schemas.js';

// ---------------------------------------------------------------------------
// Interface de transação mínima para operações do módulo
// Justificativa: Drizzle não exporta o tipo interno da transação.
// Esta interface estrutural cobre exatamente os métodos necessários:
//   insert em promptVersions, eventOutbox, auditLogs.
// ---------------------------------------------------------------------------

interface PromptServiceTx {
  update(table: typeof promptVersions): {
    set(values: Partial<typeof promptVersions.$inferInsert>): {
      where(condition: unknown): Promise<unknown>;
    };
  };
  insert(table: typeof promptVersions): {
    values(row: typeof promptVersions.$inferInsert): {
      returning(): Promise<Array<typeof promptVersions.$inferSelect>>;
    };
  };
  insert(table: typeof eventOutbox): {
    values(row: typeof eventOutbox.$inferInsert): Promise<unknown>;
  };
}

// ---------------------------------------------------------------------------
// Payload tipado dos eventos locais (sem PII — apenas IDs e metadados)
// Justificativa: events/types.ts não está em files_allowed deste slot.
// Definimos tipos locais em vez de usar `any`.
// ---------------------------------------------------------------------------

interface PromptVersionCreatedPayload {
  event_id: string;
  event_name: 'ai_prompts.version_created';
  event_version: 1;
  occurred_at: string;
  actor: { kind: string; id: string | null; ip: string | null };
  correlation_id: null;
  aggregate: { type: 'prompt_version'; id: string };
  data: {
    prompt_key: string;
    version: number;
    content_hash: string;
    model_recommended: string | null;
    /** F9-S08: parâmetros LLM incluídos no evento para rastreabilidade. */
    temperature: string | null;
    max_tokens: number | null;
    top_p: string | null;
  };
}

interface PromptVersionActivatedPayload {
  event_id: string;
  event_name: 'ai_prompts.version_activated';
  event_version: 1;
  occurred_at: string;
  actor: { kind: string; id: string | null; ip: string | null };
  correlation_id: null;
  aggregate: { type: 'prompt_version'; id: string };
  data: {
    prompt_key: string;
    version: number;
    content_hash: string;
    previous_version: number | null;
  };
}

// ---------------------------------------------------------------------------
// Regex de detecção de PII no body do prompt (doc 17 §3.4 + LGPD art. 5 I)
// ---------------------------------------------------------------------------

/** CPF numérico com ou sem máscara (ex: 12345678901 ou 123.456.789-01) */
const CPF_REGEX = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/;

/** E-mail — padrão conservador para texto livre */
const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;

/** Telefone brasileiro (fixo ou celular, com ou sem DDD, com ou sem máscara) */
const PHONE_REGEX = /\b(?:\+?55\s?)?(?:\(?\d{2}\)?\s?)?9?\d{4}[-.\s]?\d{4}\b/;

/**
 * Valida que o body do prompt não contém PII detectável.
 * Lança ValidationError se algum padrão for encontrado.
 *
 * Nota: regex defensiva — pode ter falsos positivos em exemplos sintéticos
 * que se pareçam com CPF/telefone. Nesse caso, o operador deve reformular
 * o exemplo para evitar o pattern.
 */
function assertNoPiiInBody(body: string): void {
  const issues: { field: string; message: string }[] = [];

  if (CPF_REGEX.test(body)) {
    issues.push({ field: 'body', message: 'Body contém pattern de CPF — remova dados pessoais' });
  }
  if (EMAIL_REGEX.test(body)) {
    issues.push({
      field: 'body',
      message: 'Body contém pattern de e-mail — remova dados pessoais',
    });
  }
  if (PHONE_REGEX.test(body)) {
    issues.push({
      field: 'body',
      message: 'Body contém pattern de telefone — remova dados pessoais',
    });
  }

  if (issues.length > 0) {
    // Zod issue format para compatibilidade com ValidationError
    const zodIssues = issues.map((issue) => ({
      code: 'custom' as const,
      path: [issue.field],
      message: issue.message,
    }));
    throw new ValidationError(zodIssues, 'Body do prompt contém PII detectada — operação negada');
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Calcula SHA-256 hex do body do prompt. */
function hashBody(body: string): string {
  return createHash('sha256').update(body, 'utf8').digest('hex');
}

/** Converte valor numérico vindo do Drizzle (numeric → string) para number ou null.
 *
 * Drizzle representa colunas NUMERIC como string para preservar precisão arbitrária.
 * parseFloat pode retornar NaN para strings corrompidas — Number.isFinite garante
 * que NaN/Infinity nunca chegam ao DTO (retorna null como fallback seguro).
 */
function parseNumericColumn(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const parsed = parseFloat(String(raw));
  return Number.isFinite(parsed) ? parsed : null;
}

/** Mapeia PromptVersion do banco para o DTO de resposta. */
function toVersionResponse(row: typeof promptVersions.$inferSelect): PromptVersionResponse {
  return {
    id: row.id,
    key: row.key,
    version: row.version,
    model_recommended: row.modelRecommended ?? null,
    content_hash: row.contentHash,
    active: row.active,
    body: row.body,
    notes: row.notes ?? null,
    created_by: row.createdBy ?? null,
    created_at: row.createdAt.toISOString(),
    temperature: parseNumericColumn(row.temperature),
    max_tokens: row.maxTokens ?? null,
    top_p: parseNumericColumn(row.topP),
  };
}

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

/** Lista todos os keys com suas versões ativas. */
export async function listPromptKeysSvc(db: Database) {
  const rows = await listPromptKeys(db);
  return rows.map((r) => ({
    key: r.key,
    active_version: r.activeVersion ?? null,
    active_version_id: r.activeVersionId ?? null,
    model_recommended: r.modelRecommended ?? null,
    content_hash: r.contentHash ?? null,
    created_at: r.createdAt?.toISOString() ?? null,
  }));
}

/** Lista versões históricas de um key. */
export async function listVersionsSvc(db: Database, key: string): Promise<PromptVersionResponse[]> {
  const rows = await listVersionsByKey(db, key);
  return rows.map(toVersionResponse);
}

/** Busca versão específica por key + número. Lança NotFoundError se não existir. */
export async function findVersionSvc(
  db: Database,
  key: string,
  version: number,
): Promise<PromptVersionResponse> {
  const row = await findVersionByKeyAndNum(db, key, version);
  if (!row) {
    throw new NotFoundError(`Versão ${version} do prompt '${key}' não encontrada`);
  }
  return toVersionResponse(row);
}

// ---------------------------------------------------------------------------
// Criação
// ---------------------------------------------------------------------------

export interface CreateVersionContext {
  actor: AuditActor;
  organizationId: string;
  ip?: string | null;
}

/**
 * Cria nova versão de prompt de forma atômica e livre de race condition.
 *
 * Fluxo:
 *   1. Valida PII no body.
 *   2. Calcula content_hash.
 *   3. Abre transação — todo o estado crítico é lido/escrito dentro dela:
 *      a. SELECT MAX(version) FOR UPDATE → lock exclusivo na key.
 *      b. Verifica idempotência (mesmo key + hash → retorna versão existente).
 *      c. Incrementa version e faz INSERT.
 *      d. Audit log + outbox na mesma transação.
 *
 * Nota: o check de idempotência (hash) acontece DENTRO da transação após o
 * lock FOR UPDATE, garantindo que duas requests concorrentes com o mesmo body
 * não criem versões duplicadas.
 *
 * @param idempotencyKey Header Idempotency-Key opcional do caller.
 */
export async function createVersionSvc(
  db: Database,
  key: string,
  body: CreatePromptVersionBody,
  ctx: CreateVersionContext,
  idempotencyKey?: string | null,
): Promise<PromptVersionResponse> {
  // 1. Validação defensiva de PII no body (antes de abrir tx — falha rápida)
  assertNoPiiInBody(body.body);

  // 2. Calcular content_hash
  const contentHash = hashBody(body.body);

  // 3. Transação com lock exclusivo para eliminar race condition
  const result = await db.transaction(async (tx) => {
    // Justificativa dos casts `as unknown as Database`: o callback de db.transaction
    // recebe NodePgTransaction que não é exportado de forma estável. É estruturalmente
    // compatível com Database para todas as operações — o cast é seguro.
    const txDb = tx as unknown as Database;

    // 3a. Adquire lock exclusivo na key (SELECT MAX FOR UPDATE).
    // Bloqueia transações concorrentes para o mesmo key até o commit desta tx.
    // Elimina a race condition entre getMax e INSERT.
    const maxVersion = await getMaxVersionForKeyForUpdate(txDb, key);

    // 3b. Idempotência dentro da tx: se já existe versão com mesmo hash, retorna ela.
    // Feito APÓS o lock para garantir visibilidade de commits concorrentes recentes.
    const existing = await findVersionByKeyAndHashInTx(txDb, key, contentHash);
    if (existing) {
      return existing;
    }

    const nextVersion = maxVersion + 1;

    // 3c. Inserir nova versão
    // Justificativa do cast `as PromptServiceTx`: Drizzle não exporta tipo de tx.
    // A interface estrutural cobre exatamente insert(promptVersions).values().returning().
    //
    // temperature/top_p: armazenados como string no Drizzle (numeric() → string).
    // Convertemos number → string ou null para satisfazer o tipo NewPromptVersion.
    const newRow = await insertPromptVersion(tx as unknown as PromptServiceTx, {
      key,
      version: nextVersion,
      body: body.body,
      contentHash,
      modelRecommended: body.model_recommended ?? null,
      notes: body.notes ?? null,
      active: false, // Nova versão inicia inativa. Ativar via endpoint dedicado.
      createdBy: ctx.actor?.userId ?? null,
      // F9-S08: parâmetros LLM opcionais por versão.
      // null = usar default do gateway (não força nenhum valor).
      temperature:
        body.temperature !== null && body.temperature !== undefined
          ? String(body.temperature)
          : null,
      maxTokens: body.max_tokens ?? null,
      topP: body.top_p !== null && body.top_p !== undefined ? String(body.top_p) : null,
    });

    // 3d. Audit log — sem body (LGPD: apenas key, version, content_hash + params)
    await auditLog(tx, {
      organizationId: ctx.organizationId,
      actor: ctx.actor,
      action: 'ai_prompts.created',
      resource: { type: 'prompt_version', id: newRow.id },
      after: {
        key: newRow.key,
        version: newRow.version,
        content_hash: newRow.contentHash,
        model_recommended: newRow.modelRecommended,
        active: newRow.active,
        // F9-S08: inclui params LLM no audit trail (sem body — LGPD)
        temperature: newRow.temperature ?? null,
        max_tokens: newRow.maxTokens ?? null,
        top_p: newRow.topP ?? null,
      },
    });

    // 3e. Outbox — evento local (não registrado em AppEventDataMap — tipos definidos localmente)
    // Justificativa: events/types.ts não está em files_allowed do slot F9-S01.
    // Usamos inserção direta com tipagem local em vez de emit() tipado globalmente.
    const eventId = randomUUID();
    const eventPayload: PromptVersionCreatedPayload = {
      event_id: eventId,
      event_name: 'ai_prompts.version_created',
      event_version: 1,
      occurred_at: new Date().toISOString(),
      actor: {
        kind: ctx.actor ? 'user' : 'system',
        id: ctx.actor?.userId ?? null,
        ip: ctx.actor?.ip ?? null,
      },
      correlation_id: null,
      aggregate: { type: 'prompt_version', id: newRow.id },
      data: {
        prompt_key: newRow.key,
        version: newRow.version,
        content_hash: newRow.contentHash,
        model_recommended: newRow.modelRecommended,
        // F9-S08: parâmetros LLM incluídos no evento (rastreabilidade, sem PII)
        temperature: newRow.temperature ?? null,
        max_tokens: newRow.maxTokens ?? null,
        top_p: newRow.topP ?? null,
      },
    };

    // Justificativa do cast: eventPayload satisfaz a estrutura jsonb esperada pelo schema.
    // O tipo inferido de payload em eventOutbox é `unknown` (jsonb) — cast para Record<string,unknown>.
    await (tx as unknown as PromptServiceTx).insert(eventOutbox).values({
      id: eventId,
      organizationId: ctx.organizationId,
      eventName: 'ai_prompts.version_created',
      eventVersion: 1,
      aggregateType: 'prompt_version',
      aggregateId: newRow.id,
      payload: eventPayload as unknown as Record<string, unknown>,
      correlationId: null,
      // Idempotência determinística: usa newRow.id (UUID único gerado pelo Postgres).
      // Não usa Date.now() — idempotency keys devem ser determinísticos para retry seguro.
      idempotencyKey: idempotencyKey ?? `ai_prompts.version_created:${newRow.id}`,
      attempts: 0,
      lastError: null,
      processedAt: null,
      failedAt: null,
    });

    return newRow;
  });

  return toVersionResponse(result);
}

// ---------------------------------------------------------------------------
// Ativação transacional
// ---------------------------------------------------------------------------

export interface ActivateVersionContext {
  actor: AuditActor;
  organizationId: string;
  ip?: string | null;
}

/**
 * Ativa uma versão de prompt de forma atômica e livre de race condition.
 *
 * Fluxo dentro de uma única transação (tudo lido e escrito com lock):
 *   1. SELECT versão alvo FOR UPDATE → garante lock exclusivo.
 *   2. Se não existe → NotFoundError.
 *   3. Se já está ativa → retorna sem modificar (idempotente).
 *   4. SELECT versão ativa anterior FOR UPDATE → snapshot consistente.
 *   5. UPDATE SET active = false WHERE key AND active = true.
 *   6. UPDATE SET active = true WHERE id = $id.
 *   7. Audit log com before/after (sem body — LGPD).
 *   8. Outbox ai_prompts.version_activated com idempotency key determinístico.
 *
 * Race condition eliminada: reads de target e previousActive acontecem DENTRO
 * da transação com FOR UPDATE, garantindo que nenhuma outra transação modifique
 * o estado entre o check e os UPDATEs.
 */
export async function activateVersionSvc(
  db: Database,
  key: string,
  version: number,
  ctx: ActivateVersionContext,
): Promise<{ ok: boolean; id: string; key: string; version: number; contentHash: string }> {
  const activationResult = await db.transaction(async (tx) => {
    // Justificativa dos casts `as unknown as Database / PromptServiceTx`:
    // NodePgTransaction não é exportado de forma estável pelo Drizzle.
    // É estruturalmente compatível com Database (todas as queries) e
    // PromptServiceTx (insert/update nas tabelas necessárias) — casts seguros.
    const txDb = tx as unknown as Database;
    const promiseTx = tx as unknown as PromptServiceTx;

    // Passo 1: lock exclusivo na versão alvo — elimina race condition entre
    // check de existência e UPDATE de ativação.
    const target = await findVersionByKeyAndNumForUpdate(txDb, key, version);
    if (!target) {
      throw new NotFoundError(`Versão ${version} do prompt '${key}' não encontrada`);
    }

    // Passo 2: idempotência — já ativa → retorna sem modificar estado
    if (target.active) {
      return {
        ok: true as const,
        id: target.id,
        key: target.key,
        version: target.version,
        contentHash: target.contentHash,
        skipped: true as const,
      };
    }

    // Passo 3: snapshot da versão ativa anterior (FOR UPDATE — snapshot consistente)
    const previousActive = await findActiveVersionByKeyForUpdate(txDb, key);

    // Passo 4: desativar versão atualmente ativa (se houver)
    await deactivateActiveVersion(promiseTx, key);

    // Passo 5: ativar a versão alvo
    await activateVersion(promiseTx, target.id);

    // Passo 6: audit log — before = versão que saiu, after = versão que entrou
    // Sem body no audit (LGPD: apenas key, version, content_hash)
    await auditLog(tx, {
      organizationId: ctx.organizationId,
      actor: ctx.actor,
      action: 'ai_prompts.activated',
      resource: { type: 'prompt_version', id: target.id },
      before: previousActive
        ? {
            key: previousActive.key,
            version: previousActive.version,
            content_hash: previousActive.contentHash,
          }
        : null,
      after: {
        key: target.key,
        version: target.version,
        content_hash: target.contentHash,
      },
    });

    // Passo 7: outbox event — tipos locais (ver justificativa no createVersionSvc)
    const eventId = randomUUID();
    const eventPayload: PromptVersionActivatedPayload = {
      event_id: eventId,
      event_name: 'ai_prompts.version_activated',
      event_version: 1,
      occurred_at: new Date().toISOString(),
      actor: {
        kind: ctx.actor ? 'user' : 'system',
        id: ctx.actor?.userId ?? null,
        ip: ctx.actor?.ip ?? null,
      },
      correlation_id: null,
      aggregate: { type: 'prompt_version', id: target.id },
      data: {
        prompt_key: target.key,
        version: target.version,
        content_hash: target.contentHash,
        previous_version: previousActive?.version ?? null,
      },
    };

    await promiseTx.insert(eventOutbox).values({
      id: eventId,
      organizationId: ctx.organizationId,
      eventName: 'ai_prompts.version_activated',
      eventVersion: 1,
      aggregateType: 'prompt_version',
      aggregateId: target.id,
      payload: eventPayload as unknown as Record<string, unknown>,
      correlationId: null,
      // Idempotência determinística: target.id é único por versão — garantido pela
      // UNIQUE (key, version) do schema. Não usa Date.now() para retry seguro.
      idempotencyKey: `ai_prompts.version_activated:${target.id}`,
      attempts: 0,
      lastError: null,
      processedAt: null,
      failedAt: null,
    });

    return {
      ok: true as const,
      id: target.id,
      key: target.key,
      version: target.version,
      contentHash: target.contentHash,
      skipped: false as const,
    };
  });

  return {
    ok: activationResult.ok,
    id: activationResult.id,
    key: activationResult.key,
    version: activationResult.version,
    contentHash: activationResult.contentHash,
  };
}

// ---------------------------------------------------------------------------
// Re-export de tipos utilitários para o controller
// ---------------------------------------------------------------------------

export { ConflictError, NotFoundError };
