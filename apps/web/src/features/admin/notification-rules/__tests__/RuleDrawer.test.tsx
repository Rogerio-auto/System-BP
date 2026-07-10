// =============================================================================
// __tests__/RuleDrawer.test.tsx — Testes de lógica pura do seletor de stage
// no editor de regra de estagnação (F24-S17).
//
// Estratégia: testa lógica pura isolada sem renderizar React
// (JSDOM não configurado no vitest deste projeto — alinhado ao padrão
// ProductDrawer.test.tsx / AgentDrawer.test.tsx / UserDrawer.test.tsx).
//
// Cobertura:
//   1. isKanbanStageTriggerKey — detecção do eixo kanban_stage (para exibir
//      o seletor só nesse eixo, sem regressão de layout nos outros gatilhos)
//   2. parseKanbanStageSelector — pré-seleção do stage ao editar regra
//      existente, a partir do trigger_key persistido
//   3. buildKanbanStageTriggerKey — montagem da string no submit ('*' e
//      <stageId>)
//   4. Round-trip build→parse e catálogo (lookupTrigger resolve o eixo
//      parametrizado para a mesma entrada — F24-S16)
// =============================================================================

import { lookupTrigger, TRIGGER_CATALOG } from '@elemento/shared-schemas';
import { describe, expect, it } from 'vitest';

import {
  buildKanbanStageTriggerKey,
  isKanbanStageTriggerKey,
  parseKanbanStageSelector,
} from '../RuleDrawer';

const STAGE_UUID_1 = '123e4567-e89b-12d3-a456-426614174000';
const STAGE_UUID_2 = '223e4567-e89b-12d3-a456-426614174001';

// ---------------------------------------------------------------------------
// isKanbanStageTriggerKey — o seletor só aparece para este eixo
// ---------------------------------------------------------------------------

describe('isKanbanStageTriggerKey', () => {
  it('reconhece a chave genérica do catálogo', () => {
    expect(isKanbanStageTriggerKey('kanban_stage:*')).toBe(true);
  });

  it('reconhece uma chave com stage específico (UUID)', () => {
    expect(isKanbanStageTriggerKey(`kanban_stage:${STAGE_UUID_1}`)).toBe(true);
  });

  it('rejeita gatilhos de outros eixos — evento simples', () => {
    expect(isKanbanStageTriggerKey('simulations.generated')).toBe(false);
  });

  it('rejeita outros eixos de inatividade parametrizados diferentemente', () => {
    expect(isKanbanStageTriggerKey('handoff:requested')).toBe(false);
    expect(isKanbanStageTriggerKey('conversation:no_reply')).toBe(false);
  });

  it('rejeita string vazia (form ainda não preenchido)', () => {
    expect(isKanbanStageTriggerKey('')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// parseKanbanStageSelector — pré-seleção ao editar regra existente
// ---------------------------------------------------------------------------

describe('parseKanbanStageSelector', () => {
  it('extrai "*" da chave genérica', () => {
    expect(parseKanbanStageSelector('kanban_stage:*')).toBe('*');
  });

  it('extrai o UUID do stage específico', () => {
    expect(parseKanbanStageSelector(`kanban_stage:${STAGE_UUID_1}`)).toBe(STAGE_UUID_1);
  });

  it('retorna "*" (default seguro) para trigger_key de outro eixo', () => {
    expect(parseKanbanStageSelector('simulations.generated')).toBe('*');
  });

  it('retorna "*" para string vazia', () => {
    expect(parseKanbanStageSelector('')).toBe('*');
  });
});

// ---------------------------------------------------------------------------
// buildKanbanStageTriggerKey — montagem da string no submit
// ---------------------------------------------------------------------------

describe('buildKanbanStageTriggerKey', () => {
  it('monta a chave genérica para o seletor "*" (Qualquer stage — default)', () => {
    expect(buildKanbanStageTriggerKey('*')).toBe('kanban_stage:*');
  });

  it('monta a chave com o UUID do stage escolhido', () => {
    expect(buildKanbanStageTriggerKey(STAGE_UUID_1)).toBe(`kanban_stage:${STAGE_UUID_1}`);
  });

  it('produz chaves diferentes para stages diferentes', () => {
    expect(buildKanbanStageTriggerKey(STAGE_UUID_1)).not.toBe(
      buildKanbanStageTriggerKey(STAGE_UUID_2),
    );
  });
});

// ---------------------------------------------------------------------------
// Round-trip: build → parse deve ser a identidade do seletor
// ---------------------------------------------------------------------------

describe('build/parse — round-trip', () => {
  it('round-trip do seletor genérico', () => {
    const key = buildKanbanStageTriggerKey('*');
    expect(parseKanbanStageSelector(key)).toBe('*');
  });

  it('round-trip do seletor de stage específico', () => {
    const key = buildKanbanStageTriggerKey(STAGE_UUID_2);
    expect(parseKanbanStageSelector(key)).toBe(STAGE_UUID_2);
  });
});

// ---------------------------------------------------------------------------
// Integração com o catálogo real (F24-S16) — lookupTrigger resolve o eixo
// parametrizado para a mesma entrada de catálogo, garantindo que threshold
// e placeholders continuam funcionando com um stage específico selecionado.
// ---------------------------------------------------------------------------

describe('lookupTrigger — resolução do eixo kanban_stage parametrizado', () => {
  it('resolve a chave genérica para a entrada stage_inactivity do catálogo', () => {
    const entry = lookupTrigger('kanban_stage:*');
    expect(entry?.kind).toBe('stage_inactivity');
    expect(entry?.key).toBe('kanban_stage:*');
  });

  it('resolve uma chave com stage específico para a MESMA entrada de catálogo', () => {
    const generic = lookupTrigger('kanban_stage:*');
    const specific = lookupTrigger(`kanban_stage:${STAGE_UUID_1}`);
    expect(specific).toEqual(generic);
    expect(specific?.kind).toBe('stage_inactivity');
  });

  it('não resolve sufixo inválido (nem "*" nem UUID)', () => {
    expect(lookupTrigger('kanban_stage:nao-e-uuid')).toBeUndefined();
  });

  it('kanban_stage:* está presente no TRIGGER_CATALOG (fonte do dropdown de Gatilho)', () => {
    expect(TRIGGER_CATALOG.some((e) => e.key === 'kanban_stage:*')).toBe(true);
  });
});
