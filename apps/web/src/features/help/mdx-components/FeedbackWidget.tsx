import * as React from 'react';
import { useLocation } from 'react-router-dom';

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

const BACKOFF = [500, 1500] as const;

async function submitFeedback(slug: string, helpful: boolean, comment: string): Promise<void> {
  const res = await fetch('/api/help/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug, helpful, comment: comment.trim() || undefined }),
  });
  if (!res.ok) {
    throw new Error('feedback: ' + String(res.status));
  }
}

function slugFromPathname(pathname: string): string {
  return pathname
    .replace(/^\/ajuda\/?$/, '')
    .replace(/^\/ajuda\//, '')
    .replace(/\/+$/, '');
}

interface ThumbButtonProps {
  label: string;
  emoji: string;
  pressed: boolean;
  disabled: boolean;
  onClick: () => void;
}

function ThumbButton({ label, emoji, pressed, disabled, onClick }: ThumbButtonProps) {
  const [hovered, setHovered] = React.useState(false);

  const bg = pressed
    ? 'var(--brand-azul)'
    : hovered && !disabled
      ? 'var(--bg-elev-2)'
      : 'var(--bg-elev-1)';

  return (
    <button
      type="button"
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      onMouseEnter={() => {
        setHovered(true);
      }}
      onMouseLeave={() => {
        setHovered(false);
      }}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.4rem',
        padding: '0.5rem 1.25rem',
        border: '1px solid ' + (pressed ? 'var(--brand-azul)' : 'var(--border)'),
        borderRadius: 'var(--radius-md)',
        background: bg,
        color: pressed ? '#fff' : 'var(--text-2)',
        fontSize: 'var(--text-sm)',
        fontFamily: 'var(--font-sans)',
        fontWeight: 500,
        cursor: disabled ? 'not-allowed' : 'pointer',
        transition: 'background 120ms ease, border-color 120ms ease, color 120ms ease',
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <span aria-hidden="true" style={{ fontSize: '1.1em' }}>
        {emoji}
      </span>
      {label}
    </button>
  );
}

export function FeedbackWidget(): React.JSX.Element {
  const location = useLocation();
  const slug = slugFromPathname(location.pathname);

  const [widgetState, dispatch] = React.useReducer(reducer, { kind: 'idle' });
  const [comment, setComment] = React.useState('');
  const retryTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Submete quando estado e 'submitting'.
  React.useEffect(() => {
    if (widgetState.kind !== 'submitting') return;
    const { helpful, comment: c } = widgetState;
    let cancelled = false;

    void (async () => {
      try {
        await submitFeedback(slug, helpful, c);
        if (!cancelled) dispatch({ type: 'SUCCESS' });
      } catch {
        if (!cancelled) dispatch({ type: 'FAIL' });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [widgetState.kind, slug]);

  // Retry automatica: attempt 0 -> 500ms.
  React.useEffect(() => {
    if (widgetState.kind !== 'error') return;
    if (widgetState.attempt >= 1) return;

    const delay = BACKOFF[widgetState.attempt] ?? BACKOFF[BACKOFF.length - 1];
    retryTimerRef.current = setTimeout(() => {
      dispatch({ type: 'RETRY' });
    }, delay);

    return () => {
      if (retryTimerRef.current !== null) clearTimeout(retryTimerRef.current);
    };
  }, [widgetState]);

  const isSubmitting = widgetState.kind === 'submitting';
  const showError = widgetState.kind === 'error' && widgetState.attempt >= 1;

  const currentHelpful =
    widgetState.kind === 'asking' ||
    widgetState.kind === 'submitting' ||
    widgetState.kind === 'error'
      ? widgetState.helpful
      : null;

  function handleThumbClick(helpful: boolean) {
    setComment('');
    dispatch({ type: 'CLICK', helpful });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    dispatch({ type: 'SUBMIT', comment });
  }

  return (
    <section
      role="group"
      aria-label="Avaliacao da pagina"
      style={{
        marginTop: '2.5rem',
        paddingTop: '1.5rem',
        borderTop: '1px solid var(--border-subtle)',
      }}
    >
      <p
        style={{
          fontSize: 'var(--text-sm)',
          fontFamily: 'var(--font-sans)',
          fontWeight: 600,
          color: 'var(--text-3)',
          margin: '0 0 0.75rem 0',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
        }}
      >
        Esta pagina ajudou?
      </p>

      {widgetState.kind === 'sent' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <p
            style={{
              fontSize: 'var(--text-base)',
              color: 'var(--text-2)',
              fontFamily: 'var(--font-sans)',
              margin: 0,
            }}
          >
            {widgetState.helpful ? '👍 Obrigado pelo feedback!' : '👎 Obrigado — vamos melhorar.'}
          </p>
          <button
            type="button"
            onClick={() => {
              dispatch({ type: 'CHANGE_ANSWER' });
            }}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--brand-azul)',
              fontSize: 'var(--text-sm)',
              fontFamily: 'var(--font-sans)',
              padding: 0,
              textDecoration: 'underline',
              alignSelf: 'flex-start',
            }}
          >
            Mudar resposta
          </button>
        </div>
      )}

      {widgetState.kind !== 'sent' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <ThumbButton
              label="Sim"
              emoji="👍"
              pressed={currentHelpful === true}
              disabled={isSubmitting}
              onClick={() => {
                handleThumbClick(true);
              }}
            />
            <ThumbButton
              label="Não"
              emoji="👎"
              pressed={currentHelpful === false}
              disabled={isSubmitting}
              onClick={() => {
                handleThumbClick(false);
              }}
            />
          </div>

          {(widgetState.kind === 'asking' || showError) && (
            <form
              onSubmit={handleSubmit}
              style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}
            >
              <textarea
                value={comment}
                onChange={(e) => {
                  setComment(e.target.value);
                }}
                placeholder="Evite escrever CPF, telefone ou nome de pessoas reais — o feedback é lido pelo time. (opcional)"
                rows={3}
                style={{
                  width: '100%',
                  resize: 'vertical',
                  padding: '0.5rem 0.75rem',
                  background: 'var(--surface-muted)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-md)',
                  fontSize: 'var(--text-sm)',
                  fontFamily: 'var(--font-sans)',
                  color: 'var(--text-2)',
                  outline: 'none',
                  boxSizing: 'border-box',
                  transition: 'border-color 120ms ease, box-shadow 120ms ease',
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = 'var(--brand-azul)';
                  e.currentTarget.style.boxShadow = '0 0 0 3px rgba(27,58,140,0.12)';
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = 'var(--border-subtle)';
                  e.currentTarget.style.boxShadow = 'none';
                }}
              />
              <button
                type="submit"
                disabled={isSubmitting}
                style={{
                  alignSelf: 'flex-start',
                  padding: '0.4rem 1rem',
                  background: 'var(--brand-azul)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 'var(--radius-md)',
                  fontSize: 'var(--text-sm)',
                  fontFamily: 'var(--font-sans)',
                  fontWeight: 600,
                  cursor: isSubmitting ? 'not-allowed' : 'pointer',
                  opacity: isSubmitting ? 0.7 : 1,
                  transition: 'opacity 120ms ease',
                }}
              >
                {isSubmitting ? 'Enviando…' : 'Enviar'}
              </button>
            </form>
          )}

          {showError && (
            <p
              role="alert"
              style={{
                fontSize: 'var(--text-sm)',
                color: 'var(--text-2)',
                fontFamily: 'var(--font-sans)',
                margin: 0,
              }}
            >
              Não conseguimos enviar — tente novamente mais tarde.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
