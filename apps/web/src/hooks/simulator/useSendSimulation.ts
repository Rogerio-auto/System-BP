// =============================================================================
// hooks/simulator/useSendSimulation.ts — Mutation de envio de simulação por
// WhatsApp (F14-S06).
//
// POST /api/simulations/:id/send
//   Header obrigatório: Idempotency-Key (UUID v4)
//   Response: { status: 'sent' | 'already_sent', sent_message_id: string | null }
//
// Idempotência: a cada chamada send() geramos um UUID novo. O botão fica
// desabilitado (isPending=true) enquanto a requisição está em voo — isso
// evita duplo clique sem precisar de lógica adicional no componente.
//
// Erros mapeados (espelham os erros tipados do backend — F14-S05):
//   403 FEATURE_DISABLED → FLAG_DISABLED (flag simulations.send.enabled desligada)
//   403 FORBIDDEN        → FORBIDDEN (sem permissão simulations:send)
//   422                  → NO_PHONE (lead sem telefone E.164)
//   502                  → META_UNAVAILABLE (Meta não configurada / fora do ar)
//   outro                → UNKNOWN
//
// LGPD (doc 17): o payload não contém PII — apenas UUID da simulação
//   e Idempotency-Key (IDs opacos).
// =============================================================================

import { useMutation } from '@tanstack/react-query';

import { ApiError, api } from '../../lib/api';

// ─── Tipos de resposta (espelho de SendSimulationResponseSchema do backend) ───

export interface SendSimulationResponse {
  /** 'sent' = enviado nesta requisição; 'already_sent' = Idempotency-Key reutilizada */
  status: 'sent' | 'already_sent';
  /** wamid retornado pela Meta, ou null se already_sent */
  sent_message_id: string | null;
}

// ─── Erros tipados ────────────────────────────────────────────────────────────

export type SendSimulationErrorCode =
  | 'FLAG_DISABLED' // 403 FEATURE_DISABLED — feature flag desligada
  | 'FORBIDDEN' // 403 FORBIDDEN — sem permissão (simulations:send)
  | 'NO_PHONE' // 422 — lead sem telefone E.164
  | 'META_UNAVAILABLE' // 502 — integração Meta não configurada / fora do ar
  | 'UNKNOWN';

export interface SendSimulationError {
  code: SendSimulationErrorCode;
  message: string;
}

function classifySendError(err: unknown): SendSimulationError {
  if (err instanceof ApiError) {
    if (err.status === 403) {
      if (err.code === 'FEATURE_DISABLED' || err.code === 'FLAG_DISABLED') {
        return {
          code: 'FLAG_DISABLED',
          message: 'Envio de simulações está desativado no momento.',
        };
      }
      return { code: 'FORBIDDEN', message: 'Sem permissão para enviar simulações.' };
    }
    if (err.status === 422) {
      return {
        code: 'NO_PHONE',
        message: 'Este lead não possui telefone cadastrado. Adicione um número para continuar.',
      };
    }
    if (err.status === 502) {
      return {
        code: 'META_UNAVAILABLE',
        message:
          'Integração WhatsApp (Meta) indisponível no momento. Verifique a configuração ou tente novamente mais tarde.',
      };
    }
  }
  return {
    code: 'UNKNOWN',
    message: err instanceof Error ? err.message : 'Erro desconhecido ao enviar simulação.',
  };
}

// ─── Fetcher ──────────────────────────────────────────────────────────────────

async function postSendSimulation(simulationId: string): Promise<SendSimulationResponse> {
  const idempotencyKey = crypto.randomUUID();
  return api.post<SendSimulationResponse>(
    `/api/simulations/${encodeURIComponent(simulationId)}/send`,
    {},
    { headers: { 'idempotency-key': idempotencyKey } },
  );
}

// ─── Callbacks ────────────────────────────────────────────────────────────────

interface UseSendSimulationCallbacks {
  onSuccess?: (data: SendSimulationResponse) => void;
  onError?: (error: SendSimulationError) => void;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Mutation de envio de simulação por WhatsApp (F14-S06).
 *
 * Uso:
 *   const { send, isPending, sendError, reset } = useSendSimulation({
 *     onSuccess: (data) => toast('Simulação enviada!'),
 *     onError: (err) => toast(err.message, 'danger'),
 *   });
 *   send(simulationId);
 *
 * - Gera Idempotency-Key (UUID v4) automaticamente a cada chamada.
 * - isPending: true enquanto a requisição está em voo (use para desabilitar botão).
 * - sendError: erro tipado para UX específica por código (null quando sem erro).
 * - reset: limpa o estado de erro (use após fechar banner de erro).
 */
export function useSendSimulation(callbacks?: UseSendSimulationCallbacks): {
  send: (simulationId: string) => void;
  isPending: boolean;
  sendError: SendSimulationError | null;
  reset: () => void;
} {
  const { mutate, isPending, error, reset } = useMutation<SendSimulationResponse, unknown, string>({
    mutationFn: postSendSimulation,
    onSuccess: (data) => {
      callbacks?.onSuccess?.(data);
    },
    onError: (err) => {
      callbacks?.onError?.(classifySendError(err));
    },
  });

  const sendError: SendSimulationError | null = error ? classifySendError(error) : null;

  return {
    send: (simulationId: string) => mutate(simulationId),
    isPending,
    sendError,
    reset,
  };
}
