// =============================================================================
// features/help/contextual/useTrackTutorialEvent.ts (F12-S07)
//
// Fire-and-forget para POST /api/help/tutorial-events.
//
// Padrão idêntico ao useTrackView (F10-S12): erros são silenciosos para não
// degradar a UX. Rate-limit no servidor retorna 204 — igualmente silencioso.
//
// LGPD: sem PII enviado — apenas UUID do tutorial e featureKey (não-identificador).
//   O servidor associa o user_id via sessão (cookie httpOnly + Bearer token).
// =============================================================================

import { useCallback } from 'react';

import { api } from '../../../lib/api';

// ─── Tipos ────────────────────────────────────────────────────────────────────

/** Tipos de evento de telemetria de tutorial (espelha o enum do backend). */
export type TutorialEventType = 'tutorial_opened' | 'tutorial_completed';

interface RecordTutorialEventBody {
  tutorialId: string;
  featureKey: string;
  eventType: TutorialEventType;
}

// ─── Post helper ──────────────────────────────────────────────────────────────

/**
 * Envia o evento para o backend.
 * Silencia erros de rede, rate-limit (204) e qualquer outra falha.
 * Não usar fora deste módulo — consumir via useTrackTutorialEvent().
 */
async function postTutorialEvent(body: RecordTutorialEventBody): Promise<void> {
  try {
    await api.post('/api/help/tutorial-events', body);
    // 201 = registrado, 204 = rate-limited (silencioso em ambos)
  } catch {
    // Sem rede, backend indisponível, flag desabilitada — silencioso.
    // Telemetria nunca deve quebrar a UX do usuário.
  }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Retorna uma função estável (useCallback) para disparar eventos de telemetria.
 *
 * @example
 * const trackEvent = useTrackTutorialEvent();
 * // Ao abrir o drawer:
 * trackEvent({ tutorialId, featureKey, eventType: 'tutorial_opened' });
 * // Ao terminar o vídeo:
 * trackEvent({ tutorialId, featureKey, eventType: 'tutorial_completed' });
 */
export function useTrackTutorialEvent(): (body: RecordTutorialEventBody) => void {
  return useCallback((body: RecordTutorialEventBody) => {
    // Fire-and-forget — não aguarda nem propaga erros.
    void postTutorialEvent(body);
  }, []);
}
