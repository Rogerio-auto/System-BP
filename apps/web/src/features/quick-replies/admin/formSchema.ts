// =============================================================================
// features/quick-replies/admin/formSchema.ts — Schema LOCAL do formulário de
// resposta rápida (F28-S07) — ergonomia RHF, não o contrato de rede.
//
// A validação de contrato "de verdade" (variáveis, mídia tudo-ou-nada, PII)
// roda no backend com quickReplyCreateSchema/UpdateSchema (@elemento/shared-schemas).
// Aqui replicamos só o suficiente para feedback client-side imediato de
// título/atalho/categoria — o corpo é validado à parte (computeQuickReplyVariableHint).
// =============================================================================
import { z } from 'zod';

import { QUICK_REPLY_SHORTCUT_REGEX } from '../types';

export const QuickReplyFormSchema = z.object({
  title: z
    .string()
    .min(1, 'Título é obrigatório')
    .max(120, 'Título deve ter no máximo 120 caracteres'),
  shortcut: z
    .string()
    .min(1, 'Atalho é obrigatório')
    .regex(
      QUICK_REPLY_SHORTCUT_REGEX,
      'Atalho deve ter 1-32 caracteres minúsculos (letras, dígitos, "_" ou "-"), começando por letra ou dígito.',
    ),
  category: z.string().max(60, 'Categoria deve ter no máximo 60 caracteres').optional(),
  isActive: z.boolean(),
  visibility: z.enum(['organization', 'personal']),
});

export type QuickReplyFormValues = z.infer<typeof QuickReplyFormSchema>;
