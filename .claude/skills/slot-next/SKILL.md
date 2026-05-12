---
name: slot-next
description: Lista slots prontos para trabalho — status=available com depends_on todos done. Use no início de uma sessão de implementação ou quando o orchestrator precisa escolher próximo slot.
---

# /slot-next

Executa `python scripts/slot.py list-available` e mostra slots que podem ser iniciados agora.

```bash
python scripts/slot.py list-available
```

Para output JSON:

```bash
python scripts/slot.py list-available --json
```

## Output esperado

```
  F1-S03  [critical]  Auth — login, refresh, logout
  F1-S05  [high]      Schema cities + agents + seed
  F1-S10  [high]      Helper de normalização de telefone (E.164 BR)
  ...
```

Ordene mentalmente por prioridade (critical > high > medium) e por menor `depends_on` para começar.
