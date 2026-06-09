// =============================================================================
// __tests__/TutoriaisForm.test.ts — Testes de lógica pura do módulo de tutoriais.
//
// Estratégia: testa lógica pura isolada sem renderizar React
// (alinhado ao padrão UserDrawer.test.tsx e ProductDrawer.test.tsx).
//
// Cobertura:
//   1. Schema Zod do form (TutorialFormRawSchema)
//   2. Validação de provider (enum)
//   3. Validação de hash obrigatório para Vimeo
//   4. Validação de feature_key obrigatória
//   5. duration_seconds opcional
//   6. article_slug e video_hash opcionais
//   7. is_active com default true
//   8. Casos edge: título vazio, descrição vazia, video_ref vazio
// =============================================================================

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Replica do schema raw (mesma lógica do TutoriaisForm.tsx)
// ---------------------------------------------------------------------------

const TutorialFormRawSchema = z.object({
  feature_key: z.string().min(1, 'Selecione uma feature_key'),
  title: z.string().min(1, 'Título obrigatório').max(255),
  description: z.string().min(1, 'Descrição obrigatória').max(1000),
  provider: z.enum(['youtube', 'vimeo', 'mp4']),
  video_ref: z.string().min(1, 'ID/URL do vídeo obrigatório').max(500),
  video_hash: z.string().max(100).optional(),
  article_slug: z.string().max(255).optional(),
  duration_seconds: z.string().optional(),
  is_active: z.boolean().default(true),
});

// Schema com refinement para hash Vimeo (cópia do TutorialFormSchema)
const TutorialFormSchema = TutorialFormRawSchema.refine(
  (d) => {
    if (d.provider === 'vimeo' && !d.video_hash) return false;
    return true;
  },
  { message: 'Hash é obrigatório para vídeos Vimeo', path: ['video_hash'] },
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_YOUTUBE = {
  feature_key: 'crm.lead.create',
  title: 'Como criar um lead',
  description: 'Tutorial de 2 minutos sobre criação de leads no CRM.',
  provider: 'youtube' as const,
  video_ref: 'dQw4w9WgXcQ',
  is_active: true,
};

// ---------------------------------------------------------------------------
// TutorialFormRawSchema — campos obrigatórios
// ---------------------------------------------------------------------------

describe('TutorialFormRawSchema — campos obrigatórios', () => {
  it('aceita dados válidos mínimos (YouTube)', () => {
    const result = TutorialFormRawSchema.safeParse(VALID_YOUTUBE);
    expect(result.success).toBe(true);
  });

  it('rejeita feature_key vazio', () => {
    const result = TutorialFormRawSchema.safeParse({ ...VALID_YOUTUBE, feature_key: '' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const err = result.error.issues.find((i) => i.path[0] === 'feature_key');
      expect(err).toBeDefined();
    }
  });

  it('rejeita title vazio', () => {
    const result = TutorialFormRawSchema.safeParse({ ...VALID_YOUTUBE, title: '' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const err = result.error.issues.find((i) => i.path[0] === 'title');
      expect(err).toBeDefined();
    }
  });

  it('rejeita description vazia', () => {
    const result = TutorialFormRawSchema.safeParse({ ...VALID_YOUTUBE, description: '' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const err = result.error.issues.find((i) => i.path[0] === 'description');
      expect(err).toBeDefined();
    }
  });

  it('rejeita video_ref vazio', () => {
    const result = TutorialFormRawSchema.safeParse({ ...VALID_YOUTUBE, video_ref: '' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const err = result.error.issues.find((i) => i.path[0] === 'video_ref');
      expect(err).toBeDefined();
    }
  });

  it('rejeita provider inválido', () => {
    const result = TutorialFormRawSchema.safeParse({
      ...VALID_YOUTUBE,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      provider: 'twitch' as any,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const err = result.error.issues.find((i) => i.path[0] === 'provider');
      expect(err).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// TutorialFormRawSchema — campos opcionais
// ---------------------------------------------------------------------------

describe('TutorialFormRawSchema — campos opcionais', () => {
  it('is_active tem default true quando omitido', () => {
    const result = TutorialFormRawSchema.safeParse({
      feature_key: 'crm.lead.create',
      title: 'Teste',
      description: 'Descrição de teste para validação.',
      provider: 'youtube',
      video_ref: 'abc123',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.is_active).toBe(true);
    }
  });

  it('aceita duration_seconds como string vazia (omissão)', () => {
    const result = TutorialFormRawSchema.safeParse({
      ...VALID_YOUTUBE,
      duration_seconds: '',
    });
    expect(result.success).toBe(true);
  });

  it('aceita duration_seconds como string numérica', () => {
    const result = TutorialFormRawSchema.safeParse({
      ...VALID_YOUTUBE,
      duration_seconds: '120',
    });
    expect(result.success).toBe(true);
  });

  it('article_slug é opcional e aceita slug válido', () => {
    const result = TutorialFormRawSchema.safeParse({
      ...VALID_YOUTUBE,
      article_slug: 'guias/crm/criar-lead',
    });
    expect(result.success).toBe(true);
  });

  it('video_hash é opcional para YouTube', () => {
    const result = TutorialFormRawSchema.safeParse(VALID_YOUTUBE);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.video_hash).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// TutorialFormSchema — refinement hash Vimeo
// ---------------------------------------------------------------------------

describe('TutorialFormSchema — refinement Vimeo hash', () => {
  it('Vimeo sem hash falha na validação', () => {
    const result = TutorialFormSchema.safeParse({
      ...VALID_YOUTUBE,
      provider: 'vimeo',
      video_ref: '987654321',
      video_hash: undefined,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const err = result.error.issues.find((i) => i.path[0] === 'video_hash');
      expect(err).toBeDefined();
      expect(err?.message).toContain('Vimeo');
    }
  });

  it('Vimeo com hash vazio falha na validação', () => {
    const result = TutorialFormSchema.safeParse({
      ...VALID_YOUTUBE,
      provider: 'vimeo',
      video_ref: '987654321',
      video_hash: '',
    });
    expect(result.success).toBe(false);
  });

  it('Vimeo com hash válido passa na validação', () => {
    const result = TutorialFormSchema.safeParse({
      ...VALID_YOUTUBE,
      provider: 'vimeo',
      video_ref: '987654321',
      video_hash: 'abc123xyz',
    });
    expect(result.success).toBe(true);
  });

  it('YouTube sem hash passa na validação', () => {
    const result = TutorialFormSchema.safeParse(VALID_YOUTUBE);
    expect(result.success).toBe(true);
  });

  it('MP4 sem hash passa na validação', () => {
    const result = TutorialFormSchema.safeParse({
      ...VALID_YOUTUBE,
      provider: 'mp4',
      video_ref: '/videos/criar-lead.mp4',
    });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Providers aceitos
// ---------------------------------------------------------------------------

describe('Providers válidos', () => {
  const providers = ['youtube', 'vimeo', 'mp4'] as const;

  for (const provider of providers) {
    it(`aceita provider "${provider}"`, () => {
      const result = TutorialFormRawSchema.safeParse({
        ...VALID_YOUTUBE,
        provider,
        video_hash: provider === 'vimeo' ? 'abc' : undefined,
      });
      expect(result.success).toBe(true);
    });
  }
});

// ---------------------------------------------------------------------------
// Limites de campo
// ---------------------------------------------------------------------------

describe('Limites de campo', () => {
  it('title máx 255 chars — rejeita 256', () => {
    const result = TutorialFormRawSchema.safeParse({
      ...VALID_YOUTUBE,
      title: 'a'.repeat(256),
    });
    expect(result.success).toBe(false);
  });

  it('title com 255 chars — aceita', () => {
    const result = TutorialFormRawSchema.safeParse({
      ...VALID_YOUTUBE,
      title: 'a'.repeat(255),
    });
    expect(result.success).toBe(true);
  });

  it('description máx 1000 chars — rejeita 1001', () => {
    const result = TutorialFormRawSchema.safeParse({
      ...VALID_YOUTUBE,
      description: 'a'.repeat(1001),
    });
    expect(result.success).toBe(false);
  });

  it('video_ref máx 500 chars — rejeita 501', () => {
    const result = TutorialFormRawSchema.safeParse({
      ...VALID_YOUTUBE,
      video_ref: 'a'.repeat(501),
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Lógica de conversão de duration_seconds (simula parseFloat no submit)
// ---------------------------------------------------------------------------

describe('Conversão de duration_seconds', () => {
  it('string "120" converte para número 120', () => {
    const raw: string = '120';
    const result = raw.trim() !== '' ? parseInt(raw, 10) : undefined;
    expect(result).toBe(120);
  });

  it('string "" converte para undefined', () => {
    const raw: string = '';
    const result = raw.trim() !== '' ? parseInt(raw, 10) : undefined;
    expect(result).toBeUndefined();
  });

  it('string de espaços converte para undefined', () => {
    const raw: string = '  ';
    const result = raw.trim() !== '' ? parseInt(raw, 10) : undefined;
    expect(result).toBeUndefined();
  });
});
