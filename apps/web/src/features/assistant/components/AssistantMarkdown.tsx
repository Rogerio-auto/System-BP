// =============================================================================
// features/assistant/components/AssistantMarkdown.tsx — Renderização markdown
// da resposta do copiloto interno (F6-S12).
//
// Reusa exatamente o padrão de
// features/configuracoes/ai-console/prompts/PromptEditor.tsx: marked (parser
// MD) + dompurify (sanitização) — sem CDN externo, tudo bundlado pelo Vite.
// Não reinventa a sanitização.
//
// Estilização com tokens do DS (doc 18 §4 tipografia, §9.7 tabela): como o
// HTML sanitizado é injetado via dangerouslySetInnerHTML (não dá pra
// estilizar elemento a elemento em JSX), usamos seletores de descendente do
// Tailwind ([&_tag]:classe) no wrapper — todas as classes mapeiam pra tokens
// (cores ink/surface/azul, boxShadow eN, radius, spacing), nunca valor
// ad-hoc. Nenhum fontSize abaixo de --text-xs (12px).
//
// LGPD: a resposta nunca é persistida (mesma garantia de useAssistantQuery) —
// este componente só renderiza o que já está em memória.
// =============================================================================

import DOMPurify from 'dompurify';
import { marked } from 'marked';
import * as React from 'react';

import { cn } from '../../../lib/cn';

interface AssistantMarkdownProps {
  source: string;
  className?: string;
}

const ALLOWED_TAGS = [
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'br',
  'hr',
  'strong',
  'em',
  'code',
  'pre',
  'ul',
  'ol',
  'li',
  'blockquote',
  'a',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
];

function renderMarkdown(source: string): string {
  // marked.parse retorna string (sync) — cast justificado: async:false garante string,
  // mas a tipagem genérica do marked v18 retorna string|Promise<string>. Mesma
  // justificativa de PromptEditor.tsx.
  const rawHtml = marked.parse(source, { async: false }) as string;
  return DOMPurify.sanitize(rawHtml, {
    ALLOWED_TAGS,
    ALLOWED_ATTR: ['href', 'title'],
    // DOMPurify v3 já bloqueia javascript:/data: por default; restrição explícita
    // é defense-in-depth contra regressão em upgrade da lib.
    ALLOWED_URI_REGEXP: /^https?:/i,
  });
}

/**
 * Renderiza a resposta do copiloto em markdown, sanitizado e estilizado com
 * tokens do DS: títulos, listas, código, tabelas (com hover de linha — DS
 * §9.7) e negrito.
 */
export function AssistantMarkdown({
  source,
  className,
}: AssistantMarkdownProps): React.JSX.Element | null {
  const html = React.useMemo(() => (source.trim() ? renderMarkdown(source) : ''), [source]);

  if (!html) return null;

  return (
    <div
      className={cn(
        'font-sans text-sm text-ink leading-relaxed break-words',
        // Zera a margem superior do primeiro elemento (a bolha já tem padding)
        '[&>*:first-child]:mt-0',
        '[&>*:last-child]:mb-0',
        // Títulos — Geist (interface), nunca abaixo de --text-xs
        '[&_h1]:font-display [&_h1]:font-bold [&_h1]:text-base [&_h1]:tracking-tight [&_h1]:text-ink [&_h1]:mt-3 [&_h1]:mb-1.5',
        '[&_h2]:font-display [&_h2]:font-bold [&_h2]:text-base [&_h2]:tracking-tight [&_h2]:text-ink [&_h2]:mt-3 [&_h2]:mb-1.5',
        '[&_h3]:font-sans [&_h3]:font-bold [&_h3]:text-sm [&_h3]:text-ink [&_h3]:mt-2.5 [&_h3]:mb-1',
        '[&_h4]:font-sans [&_h4]:font-bold [&_h4]:text-sm [&_h4]:text-ink [&_h4]:mt-2 [&_h4]:mb-1',
        '[&_h5]:font-sans [&_h5]:font-bold [&_h5]:text-xs [&_h5]:uppercase [&_h5]:tracking-wide [&_h5]:text-ink-3 [&_h5]:mt-2 [&_h5]:mb-1',
        '[&_h6]:font-sans [&_h6]:font-bold [&_h6]:text-xs [&_h6]:uppercase [&_h6]:tracking-wide [&_h6]:text-ink-3 [&_h6]:mt-2 [&_h6]:mb-1',
        // Parágrafos
        '[&_p]:mb-2',
        // Negrito / ênfase
        '[&_strong]:font-semibold [&_strong]:text-ink',
        '[&_em]:italic',
        // Listas
        '[&_ul]:list-disc [&_ul]:pl-5 [&_ul]:my-2 [&_ul]:space-y-1',
        '[&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:my-2 [&_ol]:space-y-1',
        '[&_li]:text-sm [&_li]:text-ink-2',
        // Código — JetBrains Mono (dados/código, DS §4.2)
        '[&_code]:font-mono [&_code]:text-xs [&_code]:text-ink [&_code]:bg-surface-2 [&_code]:rounded-xs [&_code]:px-1 [&_code]:py-0.5',
        '[&_pre]:font-mono [&_pre]:text-xs [&_pre]:text-ink [&_pre]:bg-surface-2 [&_pre]:rounded-sm [&_pre]:p-3 [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:border [&_pre]:border-border-subtle [&_pre]:shadow-e1',
        '[&_pre_code]:bg-transparent [&_pre_code]:p-0',
        // Citação
        '[&_blockquote]:border-l-2 [&_blockquote]:border-azul/30 [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:text-ink-2 [&_blockquote]:my-2',
        // Link
        '[&_a]:text-azul [&_a]:underline [&_a]:underline-offset-2',
        '[&_a:hover]:text-azul-deep',
        // Separador
        '[&_hr]:border-border-subtle [&_hr]:my-3',
        // Tabela (DS §9.7): wrapper elev-1, th caption-style, hover de linha
        '[&_table]:w-full [&_table]:my-2 [&_table]:text-xs [&_table]:border-collapse [&_table]:rounded-sm [&_table]:overflow-hidden [&_table]:border [&_table]:border-border-subtle [&_table]:shadow-e1',
        '[&_thead]:bg-surface-2',
        '[&_th]:text-left [&_th]:font-bold [&_th]:uppercase [&_th]:tracking-wide [&_th]:text-ink-3 [&_th]:px-2.5 [&_th]:py-1.5 [&_th]:border-b [&_th]:border-border-subtle',
        '[&_td]:px-2.5 [&_td]:py-1.5 [&_td]:border-b [&_td]:border-border-subtle [&_td]:text-ink-2 [&_td]:font-medium',
        '[&_tbody_tr]:transition-colors [&_tbody_tr]:duration-fast',
        '[&_tbody_tr:hover]:bg-surface-hover',
        '[&_tbody_tr:last-child_td]:border-b-0',
        className,
      )}
      // dangerouslySetInnerHTML é seguro aqui — conteúdo sanitizado pelo DOMPurify
      // (mesma estratégia de PromptEditor.tsx).
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
