# F7-S09 — Registro de Incidentes

> Diretório para RCAs (Root Cause Analysis) de incidentes ocorridos durante D0 e a semana de operação paralela (D0+1 → D0+7).

## Como usar

1. Para cada incidente P1 ou P2, criar um arquivo neste diretório: `INC-<número>-<título-curto>.md`
2. Usar o template abaixo como base
3. Linkar o arquivo no `F7-S09-postmortem.md` seção 4.4
4. P1: postmortem do incidente em ≤ 48h após resolução
5. P2: postmortem em ≤ 1 semana após resolução

## Exemplo de nome de arquivo

```
INC-001-langgraph-oom-d1.md
INC-002-outbox-lag-spike-d3.md
INC-003-template-meta-paused-d5.md
```

---

## Template de RCA

> Copiar para novo arquivo ao declarar incidente.

```markdown
# INC-NNN — [Título descritivo]

## Metadados

| Campo                               | Valor        |
| ----------------------------------- | ------------ |
| Número                              | INC-NNN      |
| Severidade                          | P1 / P2 / P3 |
| Data/hora de início                 | \_\_\_       |
| Data/hora de resolução              | \_\_\_       |
| Duração total                       | \_\_\_       |
| Tempo de resposta (detecção → ação) | \_\_\_ min   |
| Usuários/agentes afetados           | \_\_\_       |
| Responsável pelo RCA                | \_\_\_       |

## Timeline

| Hora  | Evento                                   |
| ----- | ---------------------------------------- |
| HH:MM | Alerta disparado / observação manual     |
| HH:MM | Incidente declarado no canal de incident |
| HH:MM | Contenção aplicada                       |
| HH:MM | Root cause identificado                  |
| HH:MM | Remediação aplicada                      |
| HH:MM | Incidente resolvido / encerrado          |

## Descrição

O que aconteceu, do ponto de vista do usuário final.

## Root Cause (5 Whys)

1. Por que X aconteceu? → Porque Y
2. Por que Y? → Porque Z
3. Por que Z? → Porque W
4. Por que W? → Porque V
5. Por que V? → Root cause: \_\_\_

## Impacto

- N mensagens WhatsApp não respondidas pela IA
- N leads em espera
- N handoffs automáticos disparados por fallback
- Custo estimado de downtime: \_\_\_

## Ações imediatas (contenção)

- ***

## Remediação aplicada

- ***

## Ações corretivas (evitar recorrência)

| Ação | Responsável | Prazo | Slot |
| ---- | ----------- | ----- | ---- |
|      |             |       |      |

## Lições aprendidas

- ***

## Aprovação

| Papel               | Nome          | Data   |
| ------------------- | ------------- | ------ |
| On-call responsável | \_\_\_        | \_\_\_ |
| CTO (Rogério)       | Rogério Viana | \_\_\_ |
```
