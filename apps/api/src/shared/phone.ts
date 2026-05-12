import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js';

export interface PhoneResult {
  e164: string | null;
  normalized: string | null;
  isValid: boolean;
}

/**
 * Normaliza um número de telefone para E.164 e formato local legível.
 *
 * @param input - String do número de telefone (qualquer formato).
 * @param defaultCountry - País padrão usado quando o número não tem código internacional. Default: 'BR'.
 * @returns `{ e164, normalized, isValid }` — função pura, sem side effects.
 *
 * Exemplos:
 *   normalizePhone('(11) 91234-5678')  → { e164: '+5511912345678', normalized: '+55 11 91234-5678', isValid: true }
 *   normalizePhone('')                 → { e164: null, normalized: null, isValid: false }
 *   normalizePhone('abc')              → { e164: null, normalized: null, isValid: false }
 */
export function normalizePhone(input: string, defaultCountry: CountryCode = 'BR'): PhoneResult {
  const trimmed = input.trim();

  if (trimmed.length === 0) {
    return { e164: null, normalized: null, isValid: false };
  }

  const phone = parsePhoneNumberFromString(trimmed, defaultCountry);

  if (phone === undefined || !phone.isValid()) {
    return { e164: null, normalized: null, isValid: false };
  }

  return {
    e164: phone.format('E.164'),
    normalized: phone.formatInternational(),
    isValid: true,
  };
}
