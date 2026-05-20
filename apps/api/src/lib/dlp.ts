// =============================================================================
// lib/dlp.ts — Data Loss Prevention (DLP) para o pipeline do playground.
//
// LGPD §8.4: Nenhum dado pessoal bruto deve sair do backend para o LangGraph
// sem passar por este módulo. Espelha a lógica de apps/langgraph-service/app/llm/dlp.py.
//
// Padrões cobertos (em ordem de aplicação):
//   - CPF:        \d{3}\.?\d{3}\.?\d{3}-?\d{2}  (com ou sem máscara)
//   - CNPJ:       \d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}
//   - Email:      RFC simplificado — suficiente para DLP
//   - Telefone BR:
//       E.164: +55\d{10,11}
//       Nacional: (\d{2}) \d{4,5}-\d{4} e variações
//   - RG (heurística): \d{1,2}\.\d{3}\.\d{3}-?[\dXx]  — alta taxa de falso positivo
//
// Tokens:
//   Dentro de uma chamada, o mesmo valor → mesmo token (<CPF_1>, <EMAIL_1>, etc.).
//   A função retorna os tokens gerados para que a UI possa exibir aviso visível.
//   O reverse_map (token → original) NUNCA deve ser logado, persistido ou
//   retornado em respostas HTTP.
//
// Segurança de logs (LGPD §8.4):
//   - Nenhuma função deste módulo loga valores originais de PII.
//   - Logs contêm apenas contagens por tipo e o texto já mascarado.
//   - O app.ts inclui '*.dlp_tokens' e '*.message' na lista de pino.redact.
//
// Uso:
//   const { redactedText, dlpTokens, dlpApplied } = redactPii(operatorMessage);
// =============================================================================

// ---------------------------------------------------------------------------
// Expressões regulares
// ---------------------------------------------------------------------------

/** CNPJ: deve vir ANTES do CPF (14 dígitos vs 11 — evitar sub-matches) */
const RE_CNPJ = /\b\d{2}[.\s]?\d{3}[.\s]?\d{3}[/\s]?\d{4}[- ]?\d{2}\b/g;

/** CPF: com ou sem pontuação */
const RE_CPF = /\b\d{3}[.\s]?\d{3}[.\s]?\d{3}[- ]?\d{2}\b/g;

/** Email: RFC simplificado */
const RE_EMAIL = /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g;

/**
 * Telefone BR — E.164 primeiro (mais específico), depois formatos nacionais.
 *
 * Variantes cobertas:
 *   +55 69 99999-9999  |  +5569999999999
 *   (69) 99999-9999    |  69 99999-9999
 *   9999-9999 (curto — sem DDD, aceito pelo padrão BR)
 */
const RE_PHONE =
  /(?:\+55[\s-]?\d{2}[\s-]?\d{4,5}[\s-]?\d{4})|(?:\(?\d{2}\)?[\s-]?\d{4,5}[\s-]\d{4})|(?:\b\d{4,5}[\s-]\d{4}\b)/g;

/**
 * RG — heurística de alta taxa de falso positivo.
 * Formato: 00.000.000-X (1-2 dígitos + 3 grupos + dígito/X verificador).
 */
const RE_RG = /\b\d{1,2}\.\d{3}\.\d{3}[- ]?[\dXx]\b/g;

// ---------------------------------------------------------------------------
// Resultado público
// ---------------------------------------------------------------------------

/**
 * Resultado da redação de PII de um texto.
 */
export interface RedactResult {
  /** Texto com PII substituída por tokens estáveis (ex: <CPF_1>). */
  redactedText: string;
  /** Lista de tokens gerados nesta chamada (para exibição na UI como aviso). */
  dlpTokens: string[];
  /** True se ao menos um padrão foi detectado e mascarado. */
  dlpApplied: boolean;
  /**
   * Contagem de ocorrências por tipo detectado.
   * Usado em logs de resumo (sem valores originais).
   */
  counts: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Implementação principal
// ---------------------------------------------------------------------------

/**
 * Substitui PII no texto por tokens estáveis (<CPF_1>, <EMAIL_1>, etc.).
 *
 * Tokens são estáveis dentro de uma chamada:
 *   - O mesmo valor → mesmo token, independente de posição no texto.
 *   - Múltiplos valores distintos → tokens incrementais (<CPF_1>, <CPF_2>...).
 *
 * LGPD §8.4:
 *   - Nunca logue o texto original ou o reverseMap.
 *   - O reverseMap retornado NUNCA deve ser persistido ou incluído em respostas HTTP.
 *   - Use dlpTokens (lista de tokens gerados) para o campo dlp_tokens da resposta.
 *
 * @param text Texto que pode conter PII (mensagem digitada pelo operador).
 * @returns RedactResult com texto mascarado, tokens gerados e flag dlpApplied.
 */
export function redactPii(text: string): RedactResult {
  // Mapa interno: valor_original → token (para estabilidade de tokens na mesma chamada)
  const valueToToken = new Map<string, string>();
  // Mapa reverso: token → valor_original (NUNCA persistir ou logar)
  const reverseMap = new Map<string, string>();
  const counts: Record<string, number> = {};

  /**
   * Cria o próximo token sequencial para o tipo dado.
   * Conta quantos tokens do tipo já existem no reverseMap.
   */
  function makeToken(piiType: string): string {
    const n = Array.from(reverseMap.keys()).filter((k) => k.startsWith(`<${piiType}_`)).length;
    return `<${piiType}_${n + 1}>`;
  }

  /**
   * Substitui um match por token estável.
   * Se o valor já foi visto nesta chamada, reutiliza o token existente.
   */
  function replaceMatch(original: string, piiType: string): string {
    const existing = valueToToken.get(original);
    if (existing !== undefined) {
      return existing;
    }
    const token = makeToken(piiType);
    valueToToken.set(original, token);
    reverseMap.set(token, original);
    counts[piiType] = (counts[piiType] ?? 0) + 1;
    return token;
  }

  // Aplicar substituições (ordem importa — CNPJ antes de CPF, e-mail antes de telefone)
  let result = text;

  // CNPJ (14 dígitos — deve preceder CPF para evitar sub-matches)
  result = result.replace(RE_CNPJ, (match) => replaceMatch(match, 'CNPJ'));
  // Resetar lastIndex após cada uso de regex global
  RE_CNPJ.lastIndex = 0;

  // CPF (11 dígitos)
  result = result.replace(RE_CPF, (match) => replaceMatch(match, 'CPF'));
  RE_CPF.lastIndex = 0;

  // Email
  result = result.replace(RE_EMAIL, (match) => replaceMatch(match, 'EMAIL'));
  RE_EMAIL.lastIndex = 0;

  // Telefone
  result = result.replace(RE_PHONE, (match) => replaceMatch(match, 'PHONE'));
  RE_PHONE.lastIndex = 0;

  // RG (heurística)
  result = result.replace(RE_RG, (match) => replaceMatch(match, 'RG'));
  RE_RG.lastIndex = 0;

  const dlpTokens = Array.from(reverseMap.keys());
  const dlpApplied = dlpTokens.length > 0;

  return { redactedText: result, dlpTokens, dlpApplied, counts };
}

/**
 * Aplica masking defensivo de PII em uma string de resposta do LangGraph.
 *
 * Substitui matches por '<masked>' (sem tokens estáveis — apenas sanitização
 * defensiva antes de retornar ao cliente).
 *
 * Usado no masking do trace retornado pelo LangGraph antes de devolver à UI.
 * A distinção com redactPii: aqui não geramos tokens estáveis — apenas '<masked>'.
 *
 * @param text Texto que pode conter PII residual no trace do LangGraph.
 * @returns Texto com PII substituída por '<masked>'.
 */
export function maskPii(text: string): string {
  let result = text;

  result = result.replace(RE_CNPJ, '<masked>');
  RE_CNPJ.lastIndex = 0;

  result = result.replace(RE_CPF, '<masked>');
  RE_CPF.lastIndex = 0;

  result = result.replace(RE_EMAIL, '<masked>');
  RE_EMAIL.lastIndex = 0;

  result = result.replace(RE_PHONE, '<masked>');
  RE_PHONE.lastIndex = 0;

  result = result.replace(RE_RG, '<masked>');
  RE_RG.lastIndex = 0;

  return result;
}

/**
 * Aplica maskPii recursivamente em qualquer valor JSON.
 * Usado para sanitizar o trace devolvido pelo LangGraph antes de retornar à UI.
 *
 * @param value Valor JSON de estrutura arbitrária.
 * @returns Valor com strings mascaradas de PII.
 */
export function maskPiiInValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return maskPii(value);
  }
  if (Array.isArray(value)) {
    return value.map(maskPiiInValue);
  }
  if (value !== null && typeof value === 'object') {
    const masked: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      masked[k] = maskPiiInValue(v);
    }
    return masked;
  }
  return value;
}

// ---------------------------------------------------------------------------
// Verificação utilitária (para testes e asserções)
// ---------------------------------------------------------------------------

/**
 * Retorna true se o texto não contém PII detectável pelos padrões ativos.
 * Usado em testes e asserções de segurança. Não deve ser usado em hot-path.
 */
export function isPiiFree(text: string): boolean {
  const { dlpApplied } = redactPii(text);
  return !dlpApplied;
}
