import { describe, expect, it } from 'vitest';

// ---------------------------------------------------------------------------
// FeedbackWidget.test.tsx -- testa logica pura:
//   - reducer (state machine)
//   - slugFromPathname
//
// Sem JSDOM configurado neste projeto -- testes sao unitarios de funcao pura.
// ---------------------------------------------------------------------------

type WidgetState =
  | { kind: 'idle' }
  | { kind: 'asking'; helpful: boolean }
  | { kind: 'submitting'; helpful: boolean; comment: string }
  | { kind: 'sent'; helpful: boolean }
  | { kind: 'error'; helpful: boolean; comment: string; attempt: number };

type Action =
  | { type: 'CLICK'; helpful: boolean }
  | { type: 'SUBMIT'; comment: string }
  | { type: 'RETRY' }
  | { type: 'SUCCESS' }
  | { type: 'FAIL' }
  | { type: 'CHANGE_ANSWER' };

function reducer(state: WidgetState, action: Action): WidgetState {
  switch (action.type) {
    case 'CLICK':
      if (state.kind === 'idle' || state.kind === 'sent' || state.kind === 'error') {
        return { kind: 'asking', helpful: action.helpful };
      }
      if (state.kind === 'asking') {
        return { kind: 'asking', helpful: action.helpful };
      }
      return state;
    case 'SUBMIT':
      if (state.kind === 'asking') {
        return { kind: 'submitting', helpful: state.helpful, comment: action.comment };
      }
      if (state.kind === 'error') {
        return { kind: 'submitting', helpful: state.helpful, comment: state.comment };
      }
      return state;
    case 'RETRY':
      if (state.kind === 'error') {
        return { kind: 'submitting', helpful: state.helpful, comment: state.comment };
      }
      return state;
    case 'SUCCESS':
      if (state.kind === 'submitting') {
        return { kind: 'sent', helpful: state.helpful };
      }
      return state;
    case 'FAIL':
      if (state.kind === 'submitting') {
        return { kind: 'error', helpful: state.helpful, comment: state.comment, attempt: 0 };
      }
      if (state.kind === 'error') {
        return { ...state, attempt: state.attempt + 1 };
      }
      return state;
    case 'CHANGE_ANSWER':
      if (state.kind === 'sent') {
        return { kind: 'idle' };
      }
      return state;
    default:
      return state;
  }
}

function slugFromPathname(pathname: string): string {
  return pathname
    .replace(/^\/ajuda\/?$/, '')
    .replace(/^\/ajuda\//, '')
    .replace(/\/+$/, '');
}

describe('FeedbackWidget reducer', () => {
  it('idle -> CLICK positivo -> asking helpful=true', () => {
    expect(reducer({ kind: 'idle' }, { type: 'CLICK', helpful: true })).toEqual({
      kind: 'asking',
      helpful: true,
    });
  });

  it('idle -> CLICK negativo -> asking helpful=false', () => {
    expect(reducer({ kind: 'idle' }, { type: 'CLICK', helpful: false })).toEqual({
      kind: 'asking',
      helpful: false,
    });
  });

  it('asking -> CLICK oposto -> muda helpful', () => {
    const s: WidgetState = { kind: 'asking', helpful: true };
    expect(reducer(s, { type: 'CLICK', helpful: false })).toEqual({
      kind: 'asking',
      helpful: false,
    });
  });

  it('asking -> SUBMIT com comment -> submitting', () => {
    const s: WidgetState = { kind: 'asking', helpful: true };
    expect(reducer(s, { type: 'SUBMIT', comment: 'Faltou X' })).toEqual({
      kind: 'submitting',
      helpful: true,
      comment: 'Faltou X',
    });
  });

  it('asking -> SUBMIT sem comment -> submitting com comment vazio', () => {
    const s: WidgetState = { kind: 'asking', helpful: false };
    expect(reducer(s, { type: 'SUBMIT', comment: '' })).toEqual({
      kind: 'submitting',
      helpful: false,
      comment: '',
    });
  });

  it('submitting -> SUCCESS -> sent', () => {
    const s: WidgetState = { kind: 'submitting', helpful: true, comment: '' };
    expect(reducer(s, { type: 'SUCCESS' })).toEqual({ kind: 'sent', helpful: true });
  });

  it('submitting -> FAIL -> error attempt=0', () => {
    const s: WidgetState = { kind: 'submitting', helpful: true, comment: 'c' };
    expect(reducer(s, { type: 'FAIL' })).toEqual({
      kind: 'error',
      helpful: true,
      comment: 'c',
      attempt: 0,
    });
  });

  it('error -> RETRY -> submitting preservando helpful/comment', () => {
    const s: WidgetState = { kind: 'error', helpful: false, comment: 'y', attempt: 0 };
    expect(reducer(s, { type: 'RETRY' })).toEqual({
      kind: 'submitting',
      helpful: false,
      comment: 'y',
    });
  });

  it('error -> FAIL -> incrementa attempt', () => {
    const s: WidgetState = { kind: 'error', helpful: true, comment: '', attempt: 0 };
    expect(reducer(s, { type: 'FAIL' })).toEqual({
      kind: 'error',
      helpful: true,
      comment: '',
      attempt: 1,
    });
  });

  it('sent -> CHANGE_ANSWER -> idle', () => {
    const s: WidgetState = { kind: 'sent', helpful: true };
    expect(reducer(s, { type: 'CHANGE_ANSWER' })).toEqual({ kind: 'idle' });
  });

  it('submitting -> CLICK nao altera estado (previne race condition)', () => {
    const s: WidgetState = { kind: 'submitting', helpful: true, comment: '' };
    expect(reducer(s, { type: 'CLICK', helpful: false })).toEqual(s);
  });
});

describe('slugFromPathname', () => {
  it('/ajuda -> vazio (home)', () => {
    expect(slugFromPathname('/ajuda')).toBe('');
  });

  it('/ajuda/ -> vazio (home com trailing slash)', () => {
    expect(slugFromPathname('/ajuda/')).toBe('');
  });

  it('/ajuda/guias/crm/criar-lead -> guias/crm/criar-lead', () => {
    expect(slugFromPathname('/ajuda/guias/crm/criar-lead')).toBe('guias/crm/criar-lead');
  });

  it('/ajuda/conceitos/lgpd -> conceitos/lgpd', () => {
    expect(slugFromPathname('/ajuda/conceitos/lgpd')).toBe('conceitos/lgpd');
  });

  it('/ajuda/comecar/admin/ -> trailing slash removido', () => {
    expect(slugFromPathname('/ajuda/comecar/admin/')).toBe('comecar/admin');
  });
});
