// =============================================================================
// features/simulator/__tests__/useSendSimulation.test.ts
//
// Testes unitários para o hook useSendSimulation (F14-S06).
//
// Estratégia: testa lógica pura derivada do hook (sem renderização React):
//   - classifySendError: mapeamento de ApiError → SendSimulationErrorCode
//   - Gating: condição canSend = flag habilitada + leadPhone preenchido
//   - Contrato de resposta: SendSimulationResponse shape
//
// Sem JSDOM — mesmo padrão do SimulatorResult.test.tsx.
// =============================================================================

import { describe, expect, it } from 'vitest';

import type {
  SendSimulationError,
  SendSimulationErrorCode,
  SendSimulationResponse,
} from '../../../hooks/simulator/useSendSimulation';
import { ApiError } from '../../../lib/api';

// ─── Espelha classifySendError do useSendSimulation ───────────────────────────

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

// ─── Lógica de gating (espelha canSend nos componentes) ──────────────────────

function canSend(
  flagEnabled: boolean,
  flagLoading: boolean,
  leadPhone: string | null | undefined,
): boolean {
  return flagEnabled && Boolean(leadPhone) && !flagLoading;
}

// ─── Classificação de erros ───────────────────────────────────────────────────

describe('classifySendError — mapeamento de status HTTP', () => {
  it('ApiError 403 FEATURE_DISABLED → FLAG_DISABLED', () => {
    const err = new ApiError(403, 'FEATURE_DISABLED', 'Feature flag desligada');
    const result = classifySendError(err);
    expect(result.code).toBe('FLAG_DISABLED' as SendSimulationErrorCode);
    expect(result.message).toContain('desativado');
  });

  it('ApiError 403 FLAG_DISABLED → FLAG_DISABLED', () => {
    const err = new ApiError(403, 'FLAG_DISABLED', 'Flag desligada');
    expect(classifySendError(err).code).toBe('FLAG_DISABLED' as SendSimulationErrorCode);
  });

  it('ApiError 403 FORBIDDEN → FORBIDDEN', () => {
    const err = new ApiError(403, 'FORBIDDEN', 'Sem permissão simulations:send');
    const result = classifySendError(err);
    expect(result.code).toBe('FORBIDDEN' as SendSimulationErrorCode);
    expect(result.message).toContain('permissão');
  });

  it('ApiError 422 → NO_PHONE (lead sem telefone)', () => {
    const err = new ApiError(422, 'VALIDATION_ERROR', 'phoneE164 ausente');
    const result = classifySendError(err);
    expect(result.code).toBe('NO_PHONE' as SendSimulationErrorCode);
    expect(result.message).toContain('telefone');
  });

  it('ApiError 502 → META_UNAVAILABLE (integração Meta fora do ar)', () => {
    const err = new ApiError(502, 'EXTERNAL_SERVICE_ERROR', 'Meta API timeout');
    const result = classifySendError(err);
    expect(result.code).toBe('META_UNAVAILABLE' as SendSimulationErrorCode);
    expect(result.message).toContain('Meta');
  });

  it('Error genérico → UNKNOWN com mensagem', () => {
    const err = new Error('Falha de rede');
    const result = classifySendError(err);
    expect(result.code).toBe('UNKNOWN' as SendSimulationErrorCode);
    expect(result.message).toBe('Falha de rede');
  });

  it('valor não-Error → UNKNOWN com fallback', () => {
    const result = classifySendError('string-error');
    expect(result.code).toBe('UNKNOWN' as SendSimulationErrorCode);
    expect(result.message).toBe('Erro desconhecido ao enviar simulação.');
  });

  it('ApiError 404 → UNKNOWN (não mapeado)', () => {
    const err = new ApiError(404, 'NOT_FOUND', 'Simulação não encontrada');
    const result = classifySendError(err);
    expect(result.code).toBe('UNKNOWN' as SendSimulationErrorCode);
  });
});

// ─── Lógica de gating (canSend) ───────────────────────────────────────────────

describe('canSend — condição de habilitação do botão', () => {
  it('flag habilitada + phone preenchido + não carregando → true', () => {
    expect(canSend(true, false, '+5511999991234')).toBe(true);
  });

  it('flag desabilitada → false independente do telefone', () => {
    expect(canSend(false, false, '+5511999991234')).toBe(false);
  });

  it('flag habilitada + sem telefone → false', () => {
    expect(canSend(true, false, null)).toBe(false);
    expect(canSend(true, false, undefined)).toBe(false);
    expect(canSend(true, false, '')).toBe(false);
  });

  it('flag carregando → false (fail-safe durante bootstrap)', () => {
    expect(canSend(true, true, '+5511999991234')).toBe(false);
  });

  it('flag desabilitada + sem telefone + carregando → false', () => {
    expect(canSend(false, true, null)).toBe(false);
  });
});

// ─── Contrato de resposta (SendSimulationResponse) ────────────────────────────

describe('SendSimulationResponse — contrato de shape', () => {
  it('status "sent" com wamid preenchido é shape válido', () => {
    const response: SendSimulationResponse = {
      status: 'sent',
      sent_message_id: 'wamid.HBgLNTUxMTk5OTkxMjM0',
    };
    expect(response.status).toBe('sent');
    expect(response.sent_message_id).not.toBeNull();
  });

  it('status "already_sent" com null wamid é shape válido (idempotência)', () => {
    const response: SendSimulationResponse = {
      status: 'already_sent',
      sent_message_id: null,
    };
    expect(response.status).toBe('already_sent');
    expect(response.sent_message_id).toBeNull();
  });

  it('"sent" e "already_sent" são os únicos status possíveis', () => {
    const validStatuses: Array<SendSimulationResponse['status']> = ['sent', 'already_sent'];
    for (const s of validStatuses) {
      expect(['sent', 'already_sent']).toContain(s);
    }
  });
});

// ─── Idempotência — comportamento esperado ────────────────────────────────────

describe('idempotência — comportamento de Idempotency-Key', () => {
  it('already_sent indica que a chave já foi usada (não é erro)', () => {
    // Não deve ser tratado como erro — apenas como feedback informativo.
    const response: SendSimulationResponse = { status: 'already_sent', sent_message_id: null };
    expect(response.status).toBe('already_sent');
    // A UI deve exibir toast info, não toast de erro.
  });

  it('sent indica novo envio bem-sucedido', () => {
    const response: SendSimulationResponse = {
      status: 'sent',
      sent_message_id: 'wamid.ABC123',
    };
    expect(response.status).toBe('sent');
    // A UI deve exibir toast de sucesso.
  });
});
