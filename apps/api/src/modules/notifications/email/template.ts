// =============================================================================
// notifications/email/template.ts — Template HTML de email org-aware (F24-S03).
//
// Responsabilidades:
//   1. Resolver a marca (nome + cor) da organização a partir da tabela
//      `organizations` para personalização white-label.
//   2. Renderizar o HTML do email com cabeçalho de marca, corpo e CTA opcional.
//
// Design:
//   Layout single-column, max-width 600px, compatível com os principais clientes
//   de email (Outlook, Gmail, Apple Mail). CSS inline — sem classes externas.
//   Sem imagens externas (evita rastreamento + evita falhas de carregamento).
//
// LGPD §8.5:
//   - O corpo (body) pode conter PII indireta — nunca logar.
//   - O HTML renderizado nunca é persistido no banco.
//   - A função de resolução de marca usa apenas o id opaco da organização.
// =============================================================================
import { eq } from 'drizzle-orm';

import type { Database } from '../../../db/client.js';
import { organizations } from '../../../db/schema/index.js';

// ---------------------------------------------------------------------------
// Tipos públicos
// ---------------------------------------------------------------------------

/** Dados de marca resolvidos da organização. */
export interface OrgBrand {
  /** Nome da organização para exibição no cabeçalho do email. */
  name: string;
  /**
   * Cor primária da marca em hex (#RRGGBB).
   * Extraída de organizations.settings.brand_color, se presente.
   * Default: azul institucional do Banco do Povo.
   */
  primaryColor: string;
}

/** Opções de renderização do template. */
export interface EmailTemplateOptions {
  orgBrand: OrgBrand;
  /** Assunto do email — usado apenas para referência; não aparece no HTML. */
  subject: string;
  /** Corpo principal em HTML simples (parágrafos, <b>, <br> — sem tags complexas). */
  body: string;
  /** Texto do botão CTA (opcional). */
  ctaLabel?: string;
  /** URL do botão CTA (opcional). */
  ctaUrl?: string;
}

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

/** Cor primária padrão (azul Banco do Povo / SEDEC-RO). */
const DEFAULT_PRIMARY_COLOR = '#1D4ED8';

// ---------------------------------------------------------------------------
// Resolução de marca
// ---------------------------------------------------------------------------

/**
 * Resolve a marca da organização a partir do banco.
 *
 * Extrai `settings.brand_color` (string hex) quando presente.
 * Usa defaults seguros em caso de ausência.
 *
 * @param db             Instância Drizzle.
 * @param organizationId UUID da organização.
 * @returns OrgBrand com nome e cor primária.
 */
export async function resolveOrgBrand(db: Database, organizationId: string): Promise<OrgBrand> {
  const rows = await db
    .select({ name: organizations.name, settings: organizations.settings })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);

  const row = rows[0];

  if (row === undefined) {
    // Organização não encontrada — usa defaults (edge case improvável em prod)
    return { name: 'Elemento', primaryColor: DEFAULT_PRIMARY_COLOR };
  }

  // settings é jsonb aberto — extraímos brand_color com type guard conservador
  const settings: unknown = row.settings;
  let primaryColor = DEFAULT_PRIMARY_COLOR;

  if (settings !== null && typeof settings === 'object' && !Array.isArray(settings)) {
    const rawColor: unknown = (settings as Record<string, unknown>)['brand_color'];
    // Aceita apenas cores hex válidas (#RGB ou #RRGGBB) para evitar injeção CSS
    if (typeof rawColor === 'string' && /^#[0-9A-Fa-f]{3}(?:[0-9A-Fa-f]{3})?$/.test(rawColor)) {
      primaryColor = rawColor;
    }
  }

  return { name: row.name, primaryColor };
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

/**
 * Renderiza o HTML do email a partir das opções fornecidas.
 *
 * Layout single-column responsivo (max 600px), CSS inline,
 * compatível com Outlook 2016+, Gmail e Apple Mail.
 *
 * LGPD: nunca logar o resultado desta função — o HTML pode conter PII indireta.
 *
 * @param options Opções de template.
 * @returns String HTML completa do email.
 */
export function renderEmailTemplate(options: EmailTemplateOptions): string {
  const { orgBrand, body, ctaLabel, ctaUrl } = options;

  const ctaBlock =
    ctaLabel && ctaUrl
      ? `
      <tr>
        <td align="center" style="padding: 24px 32px 0 32px;">
          <a
            href="${escapeHtml(ctaUrl)}"
            target="_blank"
            rel="noopener noreferrer"
            style="
              display: inline-block;
              background-color: ${escapeHtml(orgBrand.primaryColor)};
              color: #ffffff;
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              font-size: 15px;
              font-weight: 600;
              text-decoration: none;
              padding: 12px 28px;
              border-radius: 6px;
              letter-spacing: 0.01em;
            "
          >${escapeHtml(ctaLabel)}</a>
        </td>
      </tr>`
      : '';

  return `<!DOCTYPE html>
<html lang="pt-BR" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <title>${escapeHtml(orgBrand.name)}</title>
  <!--[if mso]>
  <noscript>
    <xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml>
  </noscript>
  <![endif]-->
</head>
<body style="margin: 0; padding: 0; background-color: #f4f4f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%"
    style="background-color: #f4f4f5; padding: 32px 16px;">
    <tr>
      <td align="center">
        <!-- Wrapper -->
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600"
          style="max-width: 600px; width: 100%; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.08);">

          <!-- Cabeçalho de marca -->
          <tr>
            <td style="background-color: ${escapeHtml(orgBrand.primaryColor)}; padding: 24px 32px;">
              <p style="
                margin: 0;
                color: #ffffff;
                font-size: 18px;
                font-weight: 700;
                letter-spacing: -0.01em;
              ">${escapeHtml(orgBrand.name)}</p>
            </td>
          </tr>

          <!-- Corpo -->
          <tr>
            <td style="padding: 32px 32px 8px 32px; color: #18181b; font-size: 15px; line-height: 1.6;">
              ${body}
            </td>
          </tr>

          <!-- CTA (condicional) -->
          ${ctaBlock}

          <!-- Rodapé -->
          <tr>
            <td style="padding: 32px 32px 28px 32px; border-top: 1px solid #e4e4e7; margin-top: 24px;">
              <p style="margin: 0; color: #71717a; font-size: 12px; line-height: 1.5;">
                Esta mensagem foi enviada automaticamente pelo sistema ${escapeHtml(orgBrand.name)}.
                Por favor, não responda diretamente a este email.
              </p>
            </td>
          </tr>

        </table>
        <!-- /Wrapper -->
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Utilitário
// ---------------------------------------------------------------------------

/**
 * Escapa caracteres HTML especiais para evitar XSS no template.
 * Usado para valores vindos do banco ou da configuração.
 */
function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
