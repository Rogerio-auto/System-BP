// =============================================================================
// features/quick-replies/useUploadQuickReplyMedia.ts — Upload de mídia da
// biblioteca de respostas rápidas (F28-S05, doc 25 §7).
//
// Fluxo em 2 fases, espelhando features/conversations/hooks/useUploadMedia.ts
// (mesmo molde, prefixo de storage diferente — doc 25 §7.2):
//   1. POST /api/quick-replies/uploads/signed-url → { uploadUrl, publicMediaUrl }
//   2. PUT uploadUrl via XMLHttpRequest (progresso real via onprogress)
//   3. Sem Authorization no PUT (URL pré-assinada)
//
// Limites por MIME: reusa `maxUploadBytesForMime`/`formatMaxBytes` de
// @elemento/shared-schemas — mesmos tetos do live chat (doc 25 §7.3):
// imagem 5MB, áudio/vídeo 16MB, documento 50MB.
//
// LGPD (doc 17 + doc 25 §7.2): a mídia da biblioteca é ativo institucional
// (prefixo próprio no storage, fora da rotina de retenção de conversa) — mas
// segue a mesma disciplina de não logar fileName/uploadUrl/publicMediaUrl.
// =============================================================================
import {
  formatMaxBytes,
  maxUploadBytesForMime,
  mediaKindFromMime,
  MEDIA_MAX_BYTES_ANY,
} from '@elemento/shared-schemas';
import * as React from 'react';

import { requestQuickReplyUploadSignedUrl } from './api';
import type { QuickReplyUploadResult } from './types';

// ─── Constantes ───────────────────────────────────────────────────────────────

/** Teto absoluto de upload deste deploy — o limite efetivo é por tipo (ver acima). */
export const MAX_UPLOAD_BYTES = MEDIA_MAX_BYTES_ANY;

// ─── Tipos públicos ───────────────────────────────────────────────────────────

export interface QuickReplyUploadProgress {
  phase: 'idle' | 'signing' | 'uploading' | 'done' | 'error';
  /** 0–100 durante 'uploading'; 100 em 'done'. */
  percent: number;
  /** Mensagem de erro (somente em phase === 'error'). */
  error?: string | undefined;
}

export interface UseUploadQuickReplyMediaReturn {
  /**
   * Inicia o fluxo de upload para o arquivo fornecido.
   * Rejeita com Error se o arquivo exceder o limite do seu tipo de mídia.
   * Rejeita com Error se a assinatura ou o upload falharem.
   */
  upload: (file: File) => Promise<QuickReplyUploadResult>;
  progress: QuickReplyUploadProgress;
  /** Aborta o upload em andamento (se houver) e reseta o progresso. */
  abort: () => void;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * useUploadQuickReplyMedia — upload de mídia para o cadastro de resposta
 * rápida (tela admin, F28-S07). Mesmo mecanismo de 2 fases do live chat, por
 * rota própria (`/api/quick-replies/uploads/signed-url`).
 */
export function useUploadQuickReplyMedia(): UseUploadQuickReplyMediaReturn {
  const [progress, setProgress] = React.useState<QuickReplyUploadProgress>({
    phase: 'idle',
    percent: 0,
  });

  // Ref para o XHR ativo — permite abortar de fora.
  const xhrRef = React.useRef<XMLHttpRequest | null>(null);

  const abort = React.useCallback((): void => {
    if (xhrRef.current) {
      xhrRef.current.abort();
      xhrRef.current = null;
    }
    setProgress({ phase: 'idle', percent: 0 });
  }, []);

  const upload = React.useCallback(async (file: File): Promise<QuickReplyUploadResult> => {
    const mime = file.type || 'application/octet-stream';
    const fileName = file.name;
    const mediaKind = mediaKindFromMime(mime);

    // ── Validação de tamanho (limite POR TIPO de mídia) ────────────────────
    const maxBytes = maxUploadBytesForMime(mime);
    if (file.size > maxBytes) {
      const err = new Error(
        `Arquivo excede o limite de ${formatMaxBytes(maxBytes)} para este tipo de mídia.`,
      );
      setProgress({ phase: 'error', percent: 0, error: err.message });
      throw err;
    }

    // ── Fase 1: Obter signed-url ─────────────────────────────────────────
    setProgress({ phase: 'signing', percent: 0 });

    let uploadUrl: string;
    let publicMediaUrl: string;

    try {
      const res = await requestQuickReplyUploadSignedUrl({ fileName, mime, sizeBytes: file.size });
      uploadUrl = res.uploadUrl;
      publicMediaUrl = res.publicMediaUrl;
    } catch {
      const err = new Error('Não foi possível iniciar o upload. Tente novamente.');
      setProgress({ phase: 'error', percent: 0, error: err.message });
      throw err;
    }

    // ── Fase 2: PUT direto ao storage via XHR (progresso real) ─────────────
    setProgress({ phase: 'uploading', percent: 0 });

    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhrRef.current = xhr;

      xhr.open('PUT', uploadUrl, true);
      // URL pré-assinada: Content-Type deve casar com o que foi assinado.
      xhr.setRequestHeader('Content-Type', mime);
      // Sem Authorization — URL já é pré-assinada.

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          const percent = Math.round((event.loaded / event.total) * 100);
          setProgress({ phase: 'uploading', percent });
        }
      };

      xhr.onload = () => {
        xhrRef.current = null;
        if (xhr.status >= 200 && xhr.status < 300) {
          setProgress({ phase: 'done', percent: 100 });
          resolve();
        } else {
          const err = new Error(`Upload falhou (HTTP ${xhr.status}).`);
          setProgress({ phase: 'error', percent: 0, error: err.message });
          reject(err);
        }
      };

      xhr.onerror = () => {
        xhrRef.current = null;
        const err = new Error('Erro de rede durante o upload. Verifique sua conexão.');
        setProgress({ phase: 'error', percent: 0, error: err.message });
        reject(err);
      };

      xhr.onabort = () => {
        xhrRef.current = null;
        // abort() já reseta o estado — apenas rejeita a promise.
        reject(new Error('Upload cancelado.'));
      };

      xhr.send(file);
    });

    return {
      mediaUrl: publicMediaUrl,
      mediaMime: mime,
      mediaKind,
      mediaSizeBytes: file.size,
      mediaFileName: fileName,
    };
  }, []);

  return { upload, progress, abort };
}
