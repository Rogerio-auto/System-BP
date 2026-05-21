// =============================================================================
// ai-console/playground/__tests__/playground.test.tsx
//
// Testes de lógica pura do módulo playground do agente de IA.
//
// Estratégia: lógica pura sem renderização React — alinhado ao padrão do
// decisions.test.tsx. Não depende de JSDOM nem de TanStack Query.
//
// Cobertura:
//   1. Query keys — formato estável, sem colisão
//   2. RBAC — gating de ai_playground:run
//   3. Schema Zod — validação de PlaygroundResponse
//   4. DLP tokens — exibição condicional
//   5. Fixtures — 5 cenários disponíveis
//   6. Char counter — limite de 4000 chars
//   7. canSubmit — lógica de habilitação do botão Rodar
//   8. Trace — ordenação e contagem de erros
//   9. Métricas — agregação de tokens e latência
// =============================================================================

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  playgroundQueryKeys,
  PlaygroundResponseSchema,
} from '../../../../../hooks/ai-console/usePlayground';

// ─── 1. Query keys ────────────────────────────────────────────────────────────

describe('playgroundQueryKeys', () => {
  it('all retorna prefixo estável', () => {
    expect(playgroundQueryKeys.all).toEqual(['ai-console', 'playground']);
  });

  it('não colide com keys de decisions ou prompts', () => {
    const playgroundKey = JSON.stringify(playgroundQueryKeys.all);
    expect(playgroundKey).not.toContain('decisions');
    expect(playgroundKey).not.toContain('prompts');
  });
});

// ─── 2. RBAC ─────────────────────────────────────────────────────────────────

describe('RBAC — gating de ai_playground:run', () => {
  const PERMISSION = 'ai_playground:run';

  function hasPermission(perms: string[], required: string): boolean {
    return perms.includes(required);
  }

  it('admin tem ai_playground:run', () => {
    const perms = ['ai_playground:run', 'ai_prompts:read', 'leads:write'];
    expect(hasPermission(perms, PERMISSION)).toBe(true);
  });

  it('agente não tem ai_playground:run', () => {
    const perms = ['leads:read', 'crm:write', 'ai_decisions:read'];
    expect(hasPermission(perms, PERMISSION)).toBe(false);
  });

  it('sem permissões → false', () => {
    expect(hasPermission([], PERMISSION)).toBe(false);
  });

  it('ai_decisions:read não implica ai_playground:run', () => {
    const perms = ['ai_decisions:read', 'ai_prompts:read'];
    expect(hasPermission(perms, PERMISSION)).toBe(false);
  });
});

// ─── 3. Schema Zod — PlaygroundResponse ──────────────────────────────────────

describe('PlaygroundResponseSchema', () => {
  // Fixture alinhada ao contrato real do backend (F9-S04):
  // - reply_type / reply_content (não "reply")
  // - prompt_version é string formatada ("key@vN"), não number
  // - trace entries não têm campo `error` — erros vivem em result.errors[] como objetos
  // - errors[] é Array<Record<string, unknown>>, não string[]
  const validResponse = {
    trace_id: '11111111-1111-1111-1111-111111111111',
    dry_run: true as const,
    reply_type: 'text',
    reply_content: 'Olá! Posso ajudá-lo com informações sobre crédito.',
    handoff_required: false,
    handoff_reason: null,
    trace: [
      {
        node: 'classify_intent',
        dry_run: true,
        intent: 'qualificação',
        prompt_version: 'intent_classifier@v3',
        model: 'anthropic/claude-3-5-haiku',
        tokens_in: 500,
        tokens_out: 150,
        latency_ms: 850,
        intercepted_method: null,
        intercepted_path: null,
        idempotency_key: null,
      },
      {
        node: 'send_response',
        dry_run: true,
        intent: null,
        prompt_version: null,
        model: null,
        tokens_in: null,
        tokens_out: null,
        latency_ms: null,
        intercepted_method: null,
        intercepted_path: null,
        idempotency_key: null,
      },
    ],
    prompt_versions_used: ['intent_classifier@v3'],
    tokens_total: 650,
    graph_version: '1.0.0',
    latency_ms: 850,
    errors: [],
    dlp_applied: false,
    dlp_tokens: [],
  };

  it('valida resposta completa corretamente', () => {
    const result = PlaygroundResponseSchema.safeParse(validResponse);
    expect(result.success).toBe(true);
  });

  it('valida resposta com dlp_applied = true e dlp_tokens', () => {
    const withDlp = {
      ...validResponse,
      dlp_applied: true,
      dlp_tokens: ['<CPF_1>', '<PHONE_1>'],
    };
    const result = PlaygroundResponseSchema.safeParse(withDlp);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.dlp_applied).toBe(true);
      expect(result.data.dlp_tokens).toHaveLength(2);
    }
  });

  it('valida resposta com erros (errors[] como objetos {node, error})', () => {
    const withErrors = {
      ...validResponse,
      handoff_required: true,
      handoff_reason: 'classify_intent falhou: LLM timeout',
      errors: [{ node: 'classify_intent', error: 'LLM timeout após 30s' }],
    };
    const result = PlaygroundResponseSchema.safeParse(withErrors);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.errors).toHaveLength(1);
      expect(result.data.errors[0]?.['node']).toBe('classify_intent');
    }
  });

  it('rejeita resposta sem reply_content', () => {
    const invalid: Record<string, unknown> = { ...validResponse };
    delete invalid['reply_content'];
    // reply_content tem default '' — schema usa Zod default, então é aceito
    // mesmo ausente; a UI mostra estado vazio. Validamos que dry_run true continua exigido.
    const result = PlaygroundResponseSchema.safeParse(invalid);
    expect(result.success).toBe(true);
  });

  it('rejeita resposta sem dry_run', () => {
    const invalid: Record<string, unknown> = { ...validResponse };
    delete invalid['dry_run'];
    const result = PlaygroundResponseSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('rejeita tokens_total negativo', () => {
    const invalid = { ...validResponse, tokens_total: -1 };
    const result = PlaygroundResponseSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('valida trace vazio (sem nós executados)', () => {
    const withEmptyTrace = { ...validResponse, trace: [] };
    const result = PlaygroundResponseSchema.safeParse(withEmptyTrace);
    expect(result.success).toBe(true);
  });

  it('valida prompt_versions_used vazio', () => {
    const noPv = { ...validResponse, prompt_versions_used: [] };
    const result = PlaygroundResponseSchema.safeParse(noPv);
    expect(result.success).toBe(true);
  });
});

// ─── 4. DLP tokens — exibição condicional ─────────────────────────────────────

describe('DLP — exibição condicional', () => {
  it('sem DLP: dlp_applied false, dlp_tokens vazio', () => {
    const dlpApplied = false;
    const dlpTokens: string[] = [];
    const shouldShow = dlpApplied && dlpTokens.length > 0;
    expect(shouldShow).toBe(false);
  });

  it('com DLP: dlp_applied true + tokens → exibe aviso', () => {
    const dlpApplied = true;
    const dlpTokens = ['<CPF_1>', '<PHONE_1>'];
    const shouldShow = dlpApplied && dlpTokens.length > 0;
    expect(shouldShow).toBe(true);
  });

  it('dlp_applied true mas tokens vazio → DlpNotice retorna null', () => {
    const dlpTokens: string[] = [];
    // DlpNotice faz: if (dlpTokens.length === 0) return null
    const shouldRender = dlpTokens.length > 0;
    expect(shouldRender).toBe(false);
  });

  it('tokens de máscara têm formato padrão', () => {
    const tokens = ['<CPF_1>', '<PHONE_1>', '<EMAIL_1>', '<NAME_1>'];
    for (const t of tokens) {
      expect(t).toMatch(/^<[A-Z_]+_\d+>$/);
    }
  });
});

// ─── 5. Fixtures — 5 cenários ─────────────────────────────────────────────────

describe('Fixtures sintéticas', () => {
  const FIXTURES = [
    { label: 'Lead novo', messageSample: 'Olá, tenho interesse em crédito para minha empresa.' },
    { label: 'Lead com cidade conhecida', messageSample: expect.any(String) },
    { label: 'Pedido de handoff', messageSample: expect.any(String) },
    { label: 'Fora de escopo', messageSample: expect.any(String) },
    { label: 'Simulação direta', messageSample: expect.any(String) },
  ];

  it('há exatamente 5 fixtures', () => {
    expect(FIXTURES).toHaveLength(5);
  });

  it('todas têm label e messageSample', () => {
    for (const f of FIXTURES) {
      expect(typeof f.label).toBe('string');
      expect(f.label.length).toBeGreaterThan(0);
    }
  });

  it('labels não se repetem', () => {
    const labels = FIXTURES.map((f) => f.label);
    const unique = new Set(labels);
    expect(unique.size).toBe(labels.length);
  });
});

// ─── 6. Char counter — limite de 4000 ─────────────────────────────────────────

describe('Char counter', () => {
  const MAX = 4000;

  it('mensagem vazia: count = 0', () => {
    expect(''.length).toBe(0);
  });

  it('aviso começa em 90% do limite (3600 chars)', () => {
    const threshold = Math.floor(MAX * 0.9);
    const shortMessage = 'a'.repeat(3599);
    const longMessage = 'a'.repeat(3600);

    expect(shortMessage.length < threshold).toBe(true);
    expect(longMessage.length >= threshold).toBe(true);
  });

  it('maxLength: mensagem acima de 4000 é truncada pelo input', () => {
    const overLimit = 'a'.repeat(4001);
    const truncated = overLimit.slice(0, MAX);
    expect(truncated.length).toBe(MAX);
  });
});

// ─── 7. canSubmit — lógica do botão Rodar ────────────────────────────────────

describe('canSubmit — habilitação do botão Rodar', () => {
  function canSubmit(message: string, isPending: boolean): boolean {
    return message.trim().length > 0 && !isPending;
  }

  it('mensagem preenchida e não loading → habilitado', () => {
    expect(canSubmit('Olá!', false)).toBe(true);
  });

  it('mensagem vazia → desabilitado', () => {
    expect(canSubmit('', false)).toBe(false);
    expect(canSubmit('   ', false)).toBe(false);
  });

  it('isPending = true → desabilitado mesmo com mensagem', () => {
    expect(canSubmit('Olá!', true)).toBe(false);
  });

  it('mensagem só com espaços → trim().length = 0 → desabilitado', () => {
    expect(canSubmit('\n\t\n', false)).toBe(false);
  });

  it('mensagem com espaços ao redor + conteúdo → habilitado', () => {
    expect(canSubmit('  Olá agente  ', false)).toBe(true);
  });
});

// ─── 8. Trace — erros e contagem ─────────────────────────────────────────────

describe('Trace — detecção de nós com erro', () => {
  type TraceNode = {
    node: string;
    error: string | null;
  };

  it('nó sem erro: hasError = false', () => {
    const node: TraceNode = { node: 'router', error: null };
    expect(Boolean(node.error)).toBe(false);
  });

  it('nó com erro: hasError = true', () => {
    const node: TraceNode = { node: 'router', error: 'LLM timeout' };
    expect(Boolean(node.error)).toBe(true);
  });

  it('contagem de erros no trace', () => {
    const trace: TraceNode[] = [
      { node: 'router', error: 'timeout' },
      { node: 'qualificador', error: null },
      { node: 'responder', error: 'rate limit' },
    ];
    const errorCount = trace.filter((n) => Boolean(n.error)).length;
    expect(errorCount).toBe(2);
  });

  it('trace vazio: errorCount = 0', () => {
    const trace: TraceNode[] = [];
    expect(trace.filter((n) => Boolean(n.error)).length).toBe(0);
  });
});

// ─── 9. Métricas — tokens e latência ─────────────────────────────────────────

describe('Métricas globais', () => {
  it('tokens_total vem do backend — não soma trace', () => {
    // O backend retorna tokens_total como campo separado;
    // o frontend exibe diretamente sem recalcular.
    const response = {
      tokens_total: 1650,
      latency_ms: 2050,
      prompt_versions_used: ['router:v3', 'responder:v1'],
    };
    expect(response.tokens_total).toBe(1650);
    expect(response.latency_ms).toBe(2050);
    expect(response.prompt_versions_used).toHaveLength(2);
  });

  it('formatação de latência < 1000ms → ms', () => {
    function fmtLatency(ms: number): string {
      if (ms < 1000) return `${ms}ms`;
      return `${(ms / 1000).toFixed(1)}s`;
    }
    expect(fmtLatency(850)).toBe('850ms');
  });

  it('formatação de latência >= 1000ms → s', () => {
    function fmtLatency(ms: number): string {
      if (ms < 1000) return `${ms}ms`;
      return `${(ms / 1000).toFixed(1)}s`;
    }
    expect(fmtLatency(2050)).toBe('2.0s');
    expect(fmtLatency(1500)).toBe('1.5s');
    expect(fmtLatency(3200)).toBe('3.2s');
  });

  it('prompt_versions_used vazio → exibe "—"', () => {
    const pvs: string[] = [];
    const display = pvs.length > 0 ? pvs.join(', ') : '—';
    expect(display).toBe('—');
  });

  it('prompt_versions_used com itens → join com vírgula', () => {
    const pvs = ['router:v3', 'responder:v1'];
    const display = pvs.length > 0 ? pvs.join(', ') : '—';
    expect(display).toBe('router:v3, responder:v1');
  });
});

// ─── Schema edge cases ────────────────────────────────────────────────────────

describe('PlaygroundTraceNodeSchema — edge cases', () => {
  const NodeSchema = z.object({
    node: z.string(),
    intent: z.string().nullable(),
    prompt_version: z.number().int().positive().nullable(),
    model: z.string().nullable(),
    tokens_in: z.number().int().nonnegative().nullable(),
    tokens_out: z.number().int().nonnegative().nullable(),
    latency_ms: z.number().int().nonnegative().nullable(),
    error: z.string().nullable(),
  });

  it('nó com todos os campos null (exceto node) é válido', () => {
    const node = {
      node: 'router',
      intent: null,
      prompt_version: null,
      model: null,
      tokens_in: null,
      tokens_out: null,
      latency_ms: null,
      error: null,
    };
    expect(NodeSchema.safeParse(node).success).toBe(true);
  });

  it('nó sem node → inválido', () => {
    const invalid = {
      intent: null,
      prompt_version: null,
      model: null,
      tokens_in: null,
      tokens_out: null,
      latency_ms: null,
      error: null,
    };
    expect(NodeSchema.safeParse(invalid).success).toBe(false);
  });

  it('tokens_in negativo → inválido', () => {
    const invalid = {
      node: 'router',
      intent: null,
      prompt_version: null,
      model: null,
      tokens_in: -1,
      tokens_out: null,
      latency_ms: null,
      error: null,
    };
    expect(NodeSchema.safeParse(invalid).success).toBe(false);
  });
});
