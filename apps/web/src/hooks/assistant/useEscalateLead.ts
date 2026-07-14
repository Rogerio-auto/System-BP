// =============================================================================
// hooks/assistant/useEscalateLead.ts — Mutation de escalação humana ao
// Departamento de Crédito (F6-S31), a partir do card `lead_summary` do
// copiloto interno (F6-S22/F6-S30).
//
// POST /api/assistant/escalate — contrato real (fonte de verdade):
//   apps/api/src/modules/assistant-escalation/schemas.ts
//   request:  { lead_id: uuid, note?: string (1..1000) }
//   response: { escalation_id, lead_id, recipient_count, already_escalated,
//               escalated_at }
//
// Human-in-the-loop (doc 22 §12): esta chamada só acontece após confirmação
// explícita de um operador humano no modal — a IA nunca invoca este hook. O
// backend também nunca é chamado pela IA diretamente (defesa em profundidade
// é irrelevante aqui: não existe caminho automático).
//
// Erros tratados pelo caller via classifyEscalateError (função pura,
// testável sem montar React — mesmo padrão de useAssistantQuery.ts):
//   404 → lead fora do escopo de cidade do usuário (tratado como "não
//         encontrado", sem insinuar que o lead existe fora do escopo).
//   409 → nenhum destinatário configurado (Departamento de Crédito).
//
// LGPD: `note` é texto livre do operador — nunca persistido em
// localStorage/sessionStorage nem logado no client; vive apenas em memória
// do estado do modal enquanto ele está aberto.
// =============================================================================

import { useMutation, type UseMutationResult } from '@tanstack/react-query';

import { api, ApiError } from '../../lib/api';

// ---------------------------------------------------------------------------
// Contrato (espelha EscalateLeadRequestSchema/EscalateLeadResponseSchema)
// ---------------------------------------------------------------------------

/** Espelha EscalateLeadRequestSchema.note (backend: 1..1000 chars). */
export const ESCALATE_NOTE_MAX_LENGTH = 1000;

export interface EscalateLeadRequest {
  lead_id: string;
  note?: string;
}

export interface EscalateLeadResponse {
  escalation_id: string;
  lead_id: string;
  recipient_count: number;
  already_escalated: boolean;
  escalated_at: string;
}

// ---------------------------------------------------------------------------
// Classificação de erro — função pura, testável sem montar o hook
// ---------------------------------------------------------------------------

export type EscalateErrorKind =
  | 'not_found'
  | 'no_recipients'
  | 'unauthorized'
  | 'forbidden'
  | 'invalid'
  | 'rate_limited'
  | 'server'
  | 'network';

export interface EscalateError {
  kind: EscalateErrorKind;
  message: string;
}

/**
 * Traduz um erro de rede/API em uma mensagem graciosa para o operador.
 * 404 (lead fora do escopo) e 409 (sem destinatário configurado) são os
 * casos de negócio explícitos do slot F6-S31 — as demais faixas seguem o
 * mesmo tratamento de classifyAssistantError (useAssistantQuery.ts).
 */
export function classifyEscalateError(error: unknown): EscalateError {
  if (error instanceof ApiError) {
    switch (error.status) {
      case 401:
        return { kind: 'unauthorized', message: 'Sua sessão expirou. Faça login novamente.' };
      case 403:
        return {
          kind: 'forbidden',
          message: 'Você não tem permissão para escalar leads ao Crédito.',
        };
      case 404:
        return { kind: 'not_found', message: 'Lead não encontrado.' };
      case 409:
        return {
          kind: 'no_recipients',
          message:
            'Departamento de Crédito não configurado. Fale com um administrador para configurar os destinatários.',
        };
      case 400:
        return { kind: 'invalid', message: 'Não foi possível escalar este lead. Revise a nota.' };
      case 429:
        return {
          kind: 'rate_limited',
          message: 'Muitas tentativas em pouco tempo. Aguarde 1 minuto e tente novamente.',
        };
      default:
        return {
          kind: 'server',
          message: 'Não foi possível notificar o Crédito agora. Tente novamente em instantes.',
        };
    }
  }

  return {
    kind: 'network',
    message: 'Falha de conexão. Verifique sua internet e tente novamente.',
  };
}

// ---------------------------------------------------------------------------
// Fetcher
// ---------------------------------------------------------------------------

async function postEscalateLead(body: EscalateLeadRequest): Promise<EscalateLeadResponse> {
  return api.post<EscalateLeadResponse>('/api/assistant/escalate', body);
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface UseEscalateLeadResult {
  /** Dispara POST /api/assistant/escalate; resolve com a resposta ou rejeita
   * (classifique com classifyEscalateError). */
  escalate: (input: EscalateLeadRequest) => Promise<EscalateLeadResponse>;
  isPending: boolean;
  reset: () => void;
}

/**
 * Mutation TanStack Query da escalação humana ao Crédito.
 * Só deve ser chamada após confirmação explícita no modal (EscalateToCreditModal).
 */
export function useEscalateLead(): UseEscalateLeadResult {
  const mutation: UseMutationResult<EscalateLeadResponse, unknown, EscalateLeadRequest> =
    useMutation({
      mutationFn: (input: EscalateLeadRequest) => postEscalateLead(input),
    });

  return {
    escalate: (input: EscalateLeadRequest) => mutation.mutateAsync(input),
    isPending: mutation.isPending,
    reset: mutation.reset,
  };
}
