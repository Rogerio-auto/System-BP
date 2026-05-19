// =============================================================================
// internal/cities/schemas.ts — Schemas Zod para POST /internal/cities/identify.
//
// Canal M2M: consumido pela tool `identify_city` (F3-S14, LangGraph).
// Não usa JWT — autenticação via X-Internal-Token.
//
// Regras de negócio (doc 06 §7.2):
//   - confidence >= 0.85 → matched: true.
//   - confidence <  0.85 → matched: false + alternatives (top 3).
//   - Cidade fora da lista atendida → matched: false, out_of_service: true.
//
// LGPD:
//   - cityText é texto livre do usuário — pode conter dados quasi-identificadores
//     (nomes de bairros, apelidos). Não é armazenado como PII; é usado apenas
//     como input de matching e aparece em source_text do evento outbox.
//     O doc 17 §8.5 permite IDs e textos não-identificadores em payloads de evento.
//   - Resposta retorna apenas IDs opacos e metadados de cidade (dado público).
// =============================================================================
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Body do request
// ---------------------------------------------------------------------------

export const InternalIdentifyCityBodySchema = z.object({
  /**
   * UUID do lead cujo campo city_id será associado quando matched: true.
   * Opcional — quando ausente, o endpoint ainda resolve a cidade mas não
   * emite o evento cities.identified (sem lead para atualizar).
   * LGPD: UUID opaco — não é PII.
   */
  lead_id: z.string().uuid('lead_id deve ser UUID').optional(),

  /**
   * UUID da organização. Obrigatório — sem JWT para derivar.
   * Necessário para que o fuzzy match filtre apenas cidades da org.
   * LGPD: UUID opaco — não é PII.
   */
  organization_id: z
    .string({ required_error: 'organization_id é obrigatório' })
    .uuid('organization_id deve ser UUID'),

  /**
   * Texto livre digitado pelo usuário identificando a cidade.
   * Ex: "porto velho", "PVH", "Vilhena - RO", "Ji-Paraná".
   * LGPD: texto livre pode conter dados de localização — não armazenar como PII;
   * usado apenas como input de matching e em source_text do evento (dado não-sensível).
   */
  city_text: z
    .string({ required_error: 'city_text é obrigatório' })
    .min(1, 'city_text não pode ser vazio')
    .max(200, 'city_text deve ter no máximo 200 caracteres'),
});

export type InternalIdentifyCityBody = z.infer<typeof InternalIdentifyCityBodySchema>;

// ---------------------------------------------------------------------------
// Response
// ---------------------------------------------------------------------------

/**
 * Candidato alternativo retornado quando confidence < 0.85.
 * Exposto ao LangGraph para perguntar confirmação ao cliente.
 */
export const CityAlternativeSchema = z.object({
  /** UUID da cidade candidata. */
  city_id: z.string().uuid(),
  /** Nome oficial da cidade. */
  city_name: z.string(),
  /** Score de similaridade 0.0–1.0. */
  confidence: z.number().min(0).max(1),
});

export type CityAlternative = z.infer<typeof CityAlternativeSchema>;

/**
 * Resposta de POST /internal/cities/identify (doc 06 §7.2).
 *
 * Cenários:
 *   1. matched: true  → city_id + city_name + confidence >= 0.85. alternatives vazio.
 *   2. matched: false → alternatives top-3. city_id null. out_of_service false.
 *   3. matched: false, out_of_service: true → cidade não atendida pela org.
 *
 * LGPD: retorna apenas dados públicos de cidade (nome de município, UUID opaco).
 */
export const InternalIdentifyCityResponseSchema = z.object({
  /**
   * UUID da cidade identificada com confiança.
   * Null quando matched: false (não há resultado único confiável).
   */
  city_id: z.string().uuid().nullable(),

  /**
   * Nome oficial da cidade identificada.
   * Null quando matched: false.
   */
  city_name: z.string().nullable(),

  /**
   * true  = correspondência única com confidence >= 0.85.
   * false = nenhuma correspondência confiável (ver alternatives ou out_of_service).
   */
  matched: z.boolean(),

  /**
   * Score de similaridade do melhor candidato (0.0–1.0).
   * Presente mesmo quando matched: false — útil para debug/analytics.
   */
  confidence: z.number().min(0).max(1),

  /**
   * true = o texto corresponde a cidade não atendida pela organização
   *        (is_active: false ou deleted_at IS NOT NULL).
   * false (padrão) = cidade simplesmente não identificada com confiança suficiente.
   */
  out_of_service: z.boolean(),

  /**
   * Top-3 candidatos quando matched: false e out_of_service: false.
   * Vazio quando matched: true ou out_of_service: true.
   */
  alternatives: z.array(CityAlternativeSchema),
});

export type InternalIdentifyCityResponse = z.infer<typeof InternalIdentifyCityResponseSchema>;
