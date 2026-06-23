// =============================================================================
// features/conversations/hooks/useUploadMedia.ts — Hook de upload de mídia.
//
// Fluxo:
//   1. POST /api/conversations/:id/uploads/signed-url  → { uploadUrl, publicMediaUrl }
//   2. PUT uploadUrl via XMLHttpRequest (para progresso real via onprogress)
//   3. Sem Authorization no PUT (URL pré-assinada R2)
//
// Limite: 16 MB (WhatsApp) — validado ANTES de chamar a API.
//
// LGPD (doc 17):
//   - Não logar fileName nem uploadUrl nem publicMediaUrl em console.
//   - Não armazenar em localStorage.
// =============================================================================

import {
  MEDIA_MAX_BYTES_ANY,
  formatMaxBytes,
  maxUploadBytesForMime,
  mediaKindFromMime,
} from '@elemento/shared-schemas';
import * as React from 'react';

import { api } from '../../../lib/api';

// ─── Constantes ───────────────────────────────────────────────────────────────

/**
 * Teto absoluto de upload (= FILE_SIZE_LIMIT do storage na VPS).
 * Os limites efetivos são POR TIPO (via maxUploadBytesForMime — fonte única em
 * @elemento/shared-schemas): imagem 5MB · áudio/vídeo 16MB · documento 50MB.
 */
export const MAX_UPLOAD_BYTES = MEDIA_MAX_BYTES_ANY;

// ─── Tipos públicos ───────────────────────────────────────────────────────────

export type MediaKind = 'image' | 'video' | 'audio' | 'document';

export interface UploadProgress {
  phase: 'idle' | 'signing' | 'uploading' | 'done' | 'error';
  /** 0–100 durante 'uploading'; 100 em 'done'. */
  percent: number;
  /** Mensagem de erro (somente em phase === 'error'). */
  error?: string | undefined;
}

export interface UploadResult {
  publicMediaUrl: string;
  mime: string;
  fileName: string;
  mediaKind: MediaKind;
}

export interface UseUploadMediaReturn {
  /**
   * Inicia o fluxo de upload para o arquivo fornecido.
   * Rejeita com Error se o arquivo exceder 16 MB.
   * Rejeita com Error se a assinatura ou o upload falharem.
   */
  upload: (file: File) => Promise<UploadResult>;
  progress: UploadProgress;
  /** Aborta o upload em andamento (se houver) e reseta o progresso. */
  abort: () => void;
}

// ─── Resposta da API de signed-url ───────────────────────────────────────────

interface SignedUrlResponse {
  uploadUrl: string;
  publicMediaUrl: string;
  expiresAt: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Detecta o `mediaKind` a partir do MIME type do arquivo.
 * image/* → image | video/* → video | audio/* → audio | resto → document
 * Delega à fonte única em @elemento/shared-schemas (sem duplicar a lógica).
 */
export function detectMediaKind(mime: string): MediaKind {
  return mediaKindFromMime(mime);
}

/**
 * Formata bytes em string legível (KB / MB).
 * Usado pelo componente de preview — não envolve PII.
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * useUploadMedia — encapsula o fluxo de upload de mídia em dois passos:
 *   1. Obtém signed-url do backend.
 *   2. Faz PUT direto para R2 com progresso real via XHR.
 *
 * O resultado é usado pelo MessageComposer para chamar sendMutation com
 * `type: 'media'` após o upload concluir.
 */
export function useUploadMedia(conversationId: string): UseUploadMediaReturn {
  const [progress, setProgress] = React.useState<UploadProgress>({
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

  const upload = React.useCallback(
    async (file: File): Promise<UploadResult> => {
      const mime = file.type || 'application/octet-stream';
      const fileName = file.name;
      const mediaKind = detectMediaKind(mime);

      // ── Validação de tamanho (limite POR TIPO de mídia) ──────────────────
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
        const res = await api.post<SignedUrlResponse>(
          `/api/conversations/${encodeURIComponent(conversationId)}/uploads/signed-url`,
          // LGPD: não logar — apenas passamos os metadados necessários para assinatura.
          // sizeBytes é obrigatório no schema do backend (validação por tipo).
          { fileName, mime, sizeBytes: file.size },
        );
        uploadUrl = res.uploadUrl;
        publicMediaUrl = res.publicMediaUrl;
      } catch {
        const err = new Error('Não foi possível iniciar o upload. Tente novamente.');
        setProgress({ phase: 'error', percent: 0, error: err.message });
        throw err;
      }

      // ── Fase 2: PUT para R2 via XHR (progresso real) ─────────────────────
      setProgress({ phase: 'uploading', percent: 0 });

      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhrRef.current = xhr;

        xhr.open('PUT', uploadUrl, true);
        // R2 pre-signed URL: Content-Type deve casar com o que foi assinado.
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

      return { publicMediaUrl, mime, fileName, mediaKind };
    },
    [conversationId],
  );

  return { upload, progress, abort };
}
