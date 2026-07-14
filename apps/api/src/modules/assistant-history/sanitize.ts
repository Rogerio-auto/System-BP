// =============================================================================
// modules/assistant-history/sanitize.ts — Higienização de texto antes de
// persistir no histórico do copiloto (F6-S25).
//
// DPIA (docs/anexos/lgpd/dpia-historico-copiloto.md §4.3, risco R3):
//   "Higienização da pergunta — DLP para identificadores estruturados +
//   mascaramento de nome." O DLP padrão do gateway (apps/api/src/lib/dlp.ts)
//   cobre CPF/CNPJ/e-mail/telefone/RG — identificadores ESTRUTURADOS. Nomes
//   próprios não têm um padrão estrutural fixo, então este módulo aplica uma
//   heurística adicional (Title Case) por cima do DLP padrão.
//
// Duas garantias distintas, deliberadamente combinadas:
//   1. `sanitizeForPersistence` — melhor esforço (heurística) sobre texto
//      livre (a pergunta do operador). Reduz o risco, não o elimina — por
//      isso o CHECK do banco (chk_assistant_turns_blocks_no_value) é a
//      defesa que garante o invariante mais crítico (blocks sem `value`).
//   2. `deriveConversationTitle` — garantia FORTE por construção: o título
//      nunca interpola texto livre no resultado. Escolhe entre um conjunto
//      fixo e curado de rótulos (ou o default) — portanto NUNCA pode conter
//      o nome de um titular, independentemente de a heurística de máscara
//      falhar.
//
// Trade-off documentado (heurística de nome, R3):
//   O padrão de 2+ palavras em Title Case (com conectores de/da/do/dos/das/e)
//   captura nomes próprios compostos ("João Silva", "Maria de Souza"), mas
//   também captura topônimos de dois nomes ("Porto Velho", "Nova Mamoré").
//   Escolha deliberada: sobre-mascarar um nome de cidade é um custo aceitável
//   perto do risco de vazar o nome de um titular (minimização, doc 17 §6).
// =============================================================================
import { redactPii } from '../../lib/dlp.js';

// ---------------------------------------------------------------------------
// Mascaramento de nome — heurística Title Case (PT-BR)
// ---------------------------------------------------------------------------

/** Token usado para substituir um nome próprio detectado. */
const NAME_TOKEN = '<NOME>';

/**
 * Conectores comuns em nomes próprios compostos e nomes de lugar em PT-BR
 * ("Maria DE Souza", "João DOS Santos"). Minúsculos de propósito — o match
 * exige que o conector apareça em minúsculo entre duas palavras Title Case.
 * Ordem importa: "das"/"dos" antes de "da"/"do" não é necessário aqui (a
 * alternação já é exata, sem prefixo ambíguo), mas mantida explícita para
 * clareza — cada alternativa é uma palavra completa.
 */
const NAME_CONNECTOR = '(?:de|da|do|das|dos|e)';

/** Uma "palavra" Title Case: inicial maiúscula, resto minúsculo (unicode PT-BR). */
const TITLE_CASE_WORD = "[A-ZÀ-Ý][a-zà-ÿ'-]+";

/**
 * Sequência de 2+ palavras Title Case, opcionalmente unidas por conectores
 * minúsculos ("de", "da", "do", "dos", "das", "e"). Exige pelo menos duas
 * palavras Title Case reais — reduz falso-positivo de uma única palavra
 * maiúscula no início de frase (que não é, por si só, um nome completo).
 */
const RE_FULL_NAME = new RegExp(
  `\\b${TITLE_CASE_WORD}(?:\\s+${NAME_CONNECTOR}\\s+${TITLE_CASE_WORD}|\\s+${TITLE_CASE_WORD})+\\b`,
  'g',
);

/**
 * Substitui sequências de 2+ palavras em Title Case (heurística de nome
 * próprio completo) por `<NOME>`. Não persiga precisão perfeita — é uma
 * camada adicional de segurança sobre o DLP estrutural (ver cabeçalho).
 */
export function maskNames(text: string): string {
  return text.replace(RE_FULL_NAME, NAME_TOKEN);
}

// ---------------------------------------------------------------------------
// Pipeline de higienização — DLP estrutural + mascaramento de nome
// ---------------------------------------------------------------------------

/**
 * Higieniza um texto livre antes de persistir no histórico do copiloto:
 * DLP de CPF/CNPJ/e-mail/telefone/RG (lib/dlp.ts) + mascaramento de nome
 * (heurística Title Case acima). Independente de o caller já ter aplicado
 * DLP anteriormente — auto-contido, seguro para reaplicar (idempotente na
 * prática: tokens já substituídos não voltam a casar com os padrões de PII).
 */
export function sanitizeForPersistence(text: string): string {
  const { redactedText } = redactPii(text);
  return maskNames(redactedText);
}

// ---------------------------------------------------------------------------
// Título por intenção — NUNCA interpola texto livre (garantia por construção)
// ---------------------------------------------------------------------------

interface IntentRule {
  pattern: RegExp;
  title: string;
}

/**
 * Regras de intenção, avaliadas em ordem — a primeira que casar decide o
 * título. Cada `title` é um literal fixo: o texto da pergunta NUNCA é
 * interpolado no resultado, então o título não pode conter PII mesmo que a
 * heurística de mascaramento de nome falhe em algum caso.
 */
const INTENT_RULES: IntentRule[] = [
  { pattern: /funil/i, title: 'Análise do funil' },
  { pattern: /cobran[çc]/i, title: 'Cobranças em atraso' },
  { pattern: /an[aá]lises?\s+de\s+cr[eé]dito/i, title: 'Análises de crédito' },
  { pattern: /simula[çc][ãa]o/i, title: 'Simulações de crédito' },
  { pattern: /contrato/i, title: 'Contratos' },
  { pattern: /kanban|est[aá]gio/i, title: 'Kanban de atendimento' },
  { pattern: /follow.?up|acompanhamento/i, title: 'Follow-up' },
  { pattern: /lead/i, title: 'Leads' },
  { pattern: /agente|equipe|desempenho/i, title: 'Desempenho da equipe' },
];

/** Título padrão quando nenhuma regra de intenção casa. */
export const DEFAULT_CONVERSATION_TITLE = 'Nova consulta ao copiloto';

const MAX_TITLE_LENGTH = 200;

/**
 * Deriva o título da conversa a partir da INTENÇÃO da pergunta já
 * higienizada. Nunca o nome de um titular (DPIA §3 risco R4) — por
 * construção, já que o resultado só pode ser um dos rótulos fixos de
 * `INTENT_RULES` ou `DEFAULT_CONVERSATION_TITLE`, nunca um trecho do texto
 * de entrada.
 */
export function deriveConversationTitle(sanitizedQuestion: string): string {
  for (const rule of INTENT_RULES) {
    if (rule.pattern.test(sanitizedQuestion)) return rule.title;
  }
  return DEFAULT_CONVERSATION_TITLE;
}

/**
 * Higieniza um título fornecido explicitamente pelo usuário (POST/PATCH de
 * conversa) — mesma pipeline de `sanitizeForPersistence`, truncada ao limite
 * de coluna. String vazia após trim cai no título padrão.
 */
export function sanitizeUserProvidedTitle(rawTitle: string): string {
  const sanitized = sanitizeForPersistence(rawTitle).trim();
  if (sanitized.length === 0) return DEFAULT_CONVERSATION_TITLE;
  return sanitized.slice(0, MAX_TITLE_LENGTH);
}
