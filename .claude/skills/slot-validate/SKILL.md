---
name: slot-validate
description: Parseia o bloco "Validação" do slot e roda cada comando, retornando pass/fail JSON. Use antes de fechar slot.
---

# /slot-validate <SLOT-ID>

Lê a seção `## Validação` do markdown do slot, extrai os comandos do bloco de código, e roda cada um sequencialmente. Resultado em JSON.

```bash
python scripts/slot.py validate F1-S03
```

## Output esperado (JSON)

```json
{
  "slot": "F1-S03",
  "commands": 3,
  "passed": true,
  "results": [
    {
      "command": "pnpm --filter @elemento/api typecheck",
      "returncode": 0,
      "passed": true,
      "stdout_tail": ["..."],
      "stderr_tail": []
    },
    ...
  ]
}
```

Exit code 0 se todos passaram, 1 se algum falhou.

## Vantagens

- Replica fielmente o que está documentado no slot — sem você ter que copiar os comandos
- Garante que ninguém esqueceu de rodar um dos comandos da Validação
- Resultado parseable — pode ser usado em CI ou em outros scripts
