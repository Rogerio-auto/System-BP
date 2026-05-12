// =============================================================================
// lib/format/pii.ts — Utilitários de mascaramento de PII para UI.
//
// LGPD §14 (doc 17): dados pessoais como CPF, e-mail e telefone nao devem ser
// exibidos em claro em telas de preview/listagem. Aplicar sempre que exibir
// dados vindos de arquivos importados pelo usuario.
// =============================================================================

/**
 * Mascara CPF mantendo apenas os 2 ultimos digitos visiveis.
 *
 * Aceita CPF com ou sem formatacao (pontos e traco).
 * Entrada: "123.456.789-09" ou "12345678909"
 * Saida:   "***.***.***.09"
 *
 * Se a string nao for um CPF reconhecivel, retorna o valor original.
 */
export function maskCpf(value: string): string {
  // Remove formatacao para validar
  const digits = value.replace(/\D/g, '');
  if (digits.length !== 11) return value;

  const last2 = digits.slice(9, 11);
  return `***.***.***-${last2}`;
}

/**
 * Retorna true quando a string parece um CPF (com ou sem formatacao).
 */
export function looksLikeCpf(value: string): boolean {
  return /^\d{3}\.?\d{3}\.?\d{3}-?\d{2}$/.test(value.trim());
}

/**
 * Mascara e-mail parcialmente, mantendo o dominio visivel.
 * Entrada: "joao.silva@example.com"
 * Saida:   "j***@example.com"
 */
export function maskEmail(value: string): string {
  const at = value.indexOf('@');
  if (at < 1) return value;
  const local = value.slice(0, at);
  const domain = value.slice(at);
  if (local.length <= 1) return `${local[0] ?? ''}***${domain}`;
  return `${local[0]}***${domain}`;
}

/**
 * Mascara telefone brasileiro, mantendo DDD e ultimos 4 digitos visiveis.
 * Entrada: "(69) 99999-1234" ou "69999991234"
 * Saida:   "(69) 9****-1234"
 */
export function maskPhone(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.length < 10) return value;

  const ddd = digits.slice(0, 2);
  const last4 = digits.slice(-4);
  const middle = digits.slice(2, digits.length - 4);
  const masked = middle.slice(0, 1) + '*'.repeat(Math.max(0, middle.length - 1));

  if (digits.length === 11) {
    // Celular: (DDD) 9XXXX-XXXX
    return `(${ddd}) ${masked.slice(0, 1)}****-${last4}`;
  }
  // Fixo: (DDD) XXXX-XXXX
  return `(${ddd}) ****-${last4}`;
}

/**
 * Heuristica: dado o nome da coluna de destino mapeada, decide se o valor
 * deve ser mascarado como CPF.
 */
export function columnIsCpf(destField: string): boolean {
  return /cpf/i.test(destField);
}

/**
 * Heuristica: dado o nome da coluna de destino mapeada, decide se o valor
 * deve ser mascarado como e-mail.
 */
export function columnIsEmail(destField: string): boolean {
  return /email|mail/i.test(destField);
}

/**
 * Heuristica: dado o nome da coluna de destino mapeada, decide se o valor
 * deve ser mascarado como telefone.
 */
export function columnIsPhone(destField: string): boolean {
  return /phone|telefone|celular|fone/i.test(destField);
}

/**
 * Aplica mascara de PII ao valor de acordo com o nome da coluna de destino
 * e/ou deteccao de padrao no proprio valor.
 *
 * Prioridade: deteccao por destField > deteccao por pattern no valor.
 */
export function maskPiiValue(value: string, destField?: string): string {
  if (value === '—' || value === '') return value;

  if (destField) {
    if (columnIsCpf(destField)) return maskCpf(value);
    if (columnIsEmail(destField)) return maskEmail(value);
    if (columnIsPhone(destField)) return maskPhone(value);
  }

  // Fallback: detecta pelo padrao do valor mesmo sem destField
  if (looksLikeCpf(value)) return maskCpf(value);

  return value;
}
