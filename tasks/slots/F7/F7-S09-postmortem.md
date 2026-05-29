# F7-S09 — Pós-mortem: Semana 1 de Produção

> Preencher após D0+7 (ou imediatamente em caso de rollback no D0).
> Campos com `___` devem ser preenchidos com dados reais.
> Seção 6 (Slots novos) deve ser preenchida antes do sign-off de operação estável.

---

## Metadados

| Campo                           | Valor                        |
| ------------------------------- | ---------------------------- |
| Data D0 (real)                  | \_\_\_                       |
| Data de conclusão do postmortem | \_\_\_                       |
| Autor                           | \_\_\_                       |
| Cutover executado?              | [ ] Sim / [ ] Não (rollback) |
| Operação estável assinada?      | [ ] Sim / [ ] Não            |

---

## 1. Resumo executivo

> 3–5 linhas. O que foi o evento, o resultado final, e o que muda a seguir.

---

---

## 2. O que rolou bem

> Listar evidências concretas de coisas que funcionaram conforme planejado.
> Não genérico — citar números, horários, nomes.

- ***
- ***
- ***

---

## 3. O que rolou mal

> Listar problemas encontrados, mesmo os P3/P4. Sem filtro — a honestidade aqui evita problemas futuros.
> Para cada problema, indicar: o que foi, quando ocorreu, impacto.

| #   | Problema | Hora | Severidade | Impacto | Resolvido? |
| --- | -------- | ---- | ---------- | ------- | ---------- |
| 1   |          |      |            |         |            |
| 2   |          |      |            |         |            |
| 3   |          |      |            |         |            |

---

## 4. Métricas dos 7 dias

### 4.1 Volumes operacionais

| Métrica                | D+1 | D+2 | D+3 | D+4 | D+5 | D+6 | D+7 | Total |
| ---------------------- | --- | --- | --- | --- | --- | --- | --- | ----- |
| Mensagens WA recebidas |     |     |     |     |     |     |     |       |
| Leads criados          |     |     |     |     |     |     |     |       |
| Leads com resposta IA  |     |     |     |     |     |     |     |       |
| Handoffs IA → humano   |     |     |     |     |     |     |     |       |
| Análises de crédito    |     |     |     |     |     |     |     |       |

### 4.2 Performance

| Métrica                     | Melhor dia | Pior dia | Média 7 dias | Meta     |
| --------------------------- | ---------- | -------- | ------------ | -------- |
| Latência p95 API (ms)       |            |          |              | < 2000ms |
| Latência p95 LangGraph (ms) |            |          |              | < 5000ms |
| Taxa de erro 5xx (%)        |            |          |              | < 1%     |
| Outbox lag máximo (s)       |            |          |              | < 600s   |

### 4.3 Custo LLM

| Modelo                        | Chamadas | Custo (USD) | % do budget diário médio |
| ----------------------------- | -------- | ----------- | ------------------------ |
| kimi-k2 (reasoner)            |          |             |                          |
| claude-3.5-haiku (classifier) |          |             |                          |
| claude-sonnet-4 (fallback)    |          |             |                          |
| **Total**                     |          |             |                          |

### 4.4 Incidentes

| #   | Data | Severidade | Título | Tempo de resposta | Tempo de resolução | RCA em 1 linha |
| --- | ---- | ---------- | ------ | ----------------- | ------------------ | -------------- |
| 1   |      |            |        |                   |                    |                |
| 2   |      |            |        |                   |                    |                |

> Incidentes P1 tiveram RCA detalhado em `tasks/slots/F7/F7-S09-incidentes/`?
> [ ] Sim — todos linkados abaixo / [ ] Não — pendente (prazo: 48h após encerramento)
>
> Links: \_\_\_

---

## 5. Ajustes feitos em runtime

> Mudanças feitas durante a operação paralela (D0–D0+7) fora do planejamento.
> Para cada ajuste: o que mudou, por que, e se precisa de slot formal para normalizar.

| #   | Ajuste | Motivo | Precisa de slot? | Slot aberto? |
| --- | ------ | ------ | ---------------- | ------------ |
| 1   |        |        |                  |              |
| 2   |        |        |                  |              |

---

## 6. Slots novos abertos (pós-launch)

> Listar todos os slots abertos como resultado desta semana de operação.
> Obrigatório: pelo menos um slot de follow-up se houve qualquer P1 ou P2.
> Slots de feature flags (onda 2 e 3) são obrigatórios aqui.

| Slot ID | Título                        | Motivação                                              | Prioridade | Status    |
| ------- | ----------------------------- | ------------------------------------------------------ | ---------- | --------- |
| \_\_\_  | followup.enabled — Onda 2     | Habilitação progressiva pós sign-off                   | high       | available |
| \_\_\_  | billing.enabled — Onda 3      | Após onda 2 estável por ≥ 14 dias                      | medium     | blocked   |
| \_\_\_  | Provedor de logs centralizado | MVP usa docker logs; slot de infra define Loki/Datadog | medium     | available |
| \_\_\_  | Endpoint /metrics Prometheus  | Integração com provedor de métricas pós-D0+7           | medium     | available |

---

## 7. Decisão de decommissioning Notion

| Item                               | Status | Data | Responsável |
| ---------------------------------- | ------ | ---- | ----------- |
| Snapshot final Notion exportado    | [ ]    |      |             |
| Workspace arquivado (não deletado) | [ ]    |      |             |
| Integração Notion desativada       | [ ]    |      |             |
| Comunicação ao cliente enviada     | [ ]    |      |             |
| Backup retido por 12 meses (cofre) | [ ]    |      |             |

---

## 8. Próximos passos (D0+8 em diante)

- [ ] Todos os slots da seção 6 criados formalmente no sistema de tasks
- [ ] Acessos Elemento ao cofre do cliente revogados (D0+30, ≤ 24h após)
- [ ] Postmortem revisado pelo CTO e aprovado como lição aprendida
- [ ] Runbook `docs/19-runbook-go-live.md` atualizado com aprendizados desta execução

---

## Aprovações

| Papel                | Nome          | Assinatura / Data |
| -------------------- | ------------- | ----------------- |
| Autor do postmortem  | \_\_\_        | \_\_\_            |
| CTO (Rogério)        | Rogério Viana | \_\_\_            |
| Gestor Banco do Povo | \_\_\_        | \_\_\_            |
