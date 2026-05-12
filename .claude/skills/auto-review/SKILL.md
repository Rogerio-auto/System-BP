---
name: auto-review
description: Pré-relatório determinístico de segurança via grep no diff. Saída JSON com findings categorizados (high/medium/low). Use ANTES do security-reviewer humano — economiza ~25k tokens por slot.
---

# /auto-review

```powershell
python scripts/slot.py auto-review <SLOT-ID> --against origin/main --json
```

## Quando usar

- Logo após o especialista terminar e commitar.
- Antes de invocar `security-reviewer` agent.
- Exit code 2 se há findings `high` → bloqueio automático.

## O que checa

| Check                             | Severity    | Onde             |
| --------------------------------- | ----------- | ---------------- |
| `as any` / `: any` / `@ts-ignore` | high/medium | `*.ts`           |
| `console.log/warn/error`          | low         | `*.ts`           |
| `process.env[`                    | low         | `*.ts`           |
| Hex hardcoded (`#aabbcc`)         | medium      | `*.tsx`, `*.css` |
| `localStorage` de token           | high        | `*.ts`           |
| `document.cookie =`               | medium      | `*.ts`           |
| Compare não-timing-safe           | high        | `*.ts` (auth)    |
| Colisão número de migration       | high        | `*.sql`          |
| `--no-verify` em scripts          | high        | `*`              |

## Output

```json
{
  "slot_id": "F1-S16",
  "files_changed": 5,
  "findings": [
    { "file": "...", "line": 42, "check": "ts:as-any", "severity": "high", "snippet": "..." }
  ],
  "high_count": 0,
  "summary_by_severity": { "low": 2, "medium": 1 }
}
```

## Por que isso ajuda o security-reviewer

O security-reviewer humano costuma gastar muito token rodando grep manualmente. Com auto-review:

1. **Confirma** os high findings (real vs falso positivo) — 1-2 reads
2. **Expande** com checks contextuais que grep não captura (race conditions, oracle, retenção LGPD)
3. **Ignora** o que já foi capturado

Economia: de ~30 calls para ~10 calls.
