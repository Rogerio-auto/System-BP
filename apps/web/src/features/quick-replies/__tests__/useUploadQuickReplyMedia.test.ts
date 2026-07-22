// =============================================================================
// features/quick-replies/__tests__/useUploadQuickReplyMedia.test.ts — Testes
// do hook de upload de mídia (F28-S05, doc 25 §7).
//
// Sem @testing-library/react instalado, um hook com useState/useCallback não
// pode ser invocado fora de um componente ("Invalid hook call"). Este
// arquivo cobre o que é testável sem renderizar:
//   1. Contrato de exportação e constantes (MAX_UPLOAD_BYTES = teto do deploy).
//   2. Estrutural: as 2 fases (signed-url → PUT via XHR) e `abort()` existem
//      no código-fonte, espelhando features/conversations/hooks/useUploadMedia.ts
//      (molde indicado pelo slot).
// =============================================================================
import * as fs from 'node:fs';
import * as path from 'node:path';

import { MEDIA_MAX_BYTES_ANY } from '@elemento/shared-schemas';
import { describe, expect, it } from 'vitest';

import { MAX_UPLOAD_BYTES } from '../useUploadQuickReplyMedia';

describe('useUploadQuickReplyMedia — contrato de exportação', () => {
  it('MAX_UPLOAD_BYTES é o teto absoluto do deploy (mesma fonte do live chat)', () => {
    expect(MAX_UPLOAD_BYTES).toBe(MEDIA_MAX_BYTES_ANY);
  });

  it('exporta useUploadQuickReplyMedia como named export', async () => {
    const mod = await import('../useUploadQuickReplyMedia');
    expect(typeof mod.useUploadQuickReplyMedia).toBe('function');
  });
});

describe('useUploadQuickReplyMedia — estrutura de 2 fases + abort() (doc 25 §7.1)', () => {
  function readSource(): string {
    return fs.readFileSync(path.resolve(__dirname, '../useUploadQuickReplyMedia.ts'), 'utf-8');
  }

  it('fase 1: chama requestQuickReplyUploadSignedUrl (assinatura) antes do upload', () => {
    const src = readSource();
    expect(src).toContain('requestQuickReplyUploadSignedUrl(');
    expect(src).toMatch(/phase: 'signing'/);
  });

  it('fase 2: usa XMLHttpRequest com PUT e progresso real (onprogress)', () => {
    const src = readSource();
    expect(src).toContain('new XMLHttpRequest()');
    expect(src).toContain("xhr.open('PUT', uploadUrl, true)");
    expect(src).toContain('xhr.upload.onprogress');
    expect(src).toMatch(/phase: 'uploading'/);
  });

  it('expõe abort() que aborta o XHR ativo e reseta o progresso para idle', () => {
    const src = readSource();
    expect(src).toContain('xhrRef.current.abort()');
    expect(src).toMatch(/setProgress\(\{ phase: 'idle', percent: 0 \}\)/);
  });

  it('valida o tamanho por tipo de MIME (maxUploadBytesForMime) antes de assinar', () => {
    const src = readSource();
    expect(src).toContain('maxUploadBytesForMime(mime)');
    expect(src).toMatch(/file\.size > maxBytes/);
  });

  it('não envia Authorization no PUT — a URL já é pré-assinada', () => {
    const src = readSource();
    expect(src).toContain('Sem Authorization — URL já é pré-assinada.');
  });
});
