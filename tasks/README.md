# Tasks — Sistema de slots para agentes IA

Este projeto é desenvolvido por agentes IA em paralelo. Cada unidade de trabalho é um **slot**: uma cápsula com escopo fechado, dependências explícitas, contratos de entrada/saída e Definition of Done verificável.

## Como funciona

```
   ┌─────────────┐  pega slot   ┌─────────────┐  abre PR    ┌─────────────┐
   │  available  │─────────────▶│ in-progress │────────────▶│   review    │
   └─────────────┘              └─────────────┘             └──────┬──────┘
                                                                   │ aprovado
                                                                   ▼
                                                            ┌─────────────┐
                                                            │    done     │
                                                            └─────────────┘
```

1. Agente lê [PROTOCOL.md](PROTOCOL.md) na primeira vez (sempre).
2. Agente lê [STATUS.md](STATUS.md) para ver o board.
3. Escolhe um slot com status `available` cujas `depends_on` estejam `done`.
4. Atualiza o frontmatter do slot para `claimed` com seu `agent_id` e `claimed_at`.
5. Cria branch `feat/<slot-id>-<slug>`.
6. Executa **somente** o que está no escopo do slot.
7. Roda os comandos de validação listados.
8. Abre PR com checklist de DoD preenchido.
9. Após merge, atualiza status para `done` e marca dependentes como possivelmente desbloqueados.

## Estrutura

```
tasks/
├── PROTOCOL.md           # regras invioláveis. Leia sempre.
├── README.md             # este arquivo
├── STATUS.md             # board com todos os slots e estados
├── _TEMPLATE.md          # template para criar novos slots
└── slots/
    ├── F0/               # Fundação (monorepo, DB, CI)
    ├── F1/               # Base operacional
    ├── F2/               # Crédito e simulação
    ├── F3/               # LangGraph + agente externo
    ├── F4/               # Análise de crédito
    ├── F5/               # Automações
    ├── F6/               # Assistente interno + dashboards
    └── F7/               # Migração + go-live
```

## Granularidade

Cada slot é dimensionado para ser executável por **um agente em uma única sessão de trabalho**, sem precisar tocar em arquivos de outros slots em paralelo. Quando uma task técnica de [docs/12-tasks-tecnicas.md](../docs/12-tasks-tecnicas.md) é grande demais, ela vira múltiplos slots ligados por `depends_on`.

## Convenções de ID

`<FASE>-S<NN>-<slug>` — ex: `F1-S03-auth-jwt-tokens`.

- `<FASE>` = `F0` … `F7`
- `<NN>` = ordem dentro da fase (sequencial, com lacunas reservadas)
- `<slug>` = kebab-case, descritivo

## Estados

| Estado        | Significado                                    |
| ------------- | ---------------------------------------------- |
| `available`   | Pronto para ser pego (dependências resolvidas) |
| `blocked`     | Aguardando dependência                         |
| `claimed`     | Reservado por um agente                        |
| `in-progress` | Agente trabalhando                             |
| `review`      | PR aberto, aguardando revisão                  |
| `done`        | Mergeado em main                               |
| `cancelled`   | Descartado (com justificativa)                 |

## Documentação fonte

Cada slot referencia explicitamente o trecho da documentação que o origina, em `source_docs`. Em caso de conflito entre slot e doc, **a doc vence** — abrir issue para corrigir o slot.
