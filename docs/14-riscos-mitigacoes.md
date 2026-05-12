# 14 — Riscos e Mitigações

## 1. Riscos de prazo

### R1.1 — 45 dias é apertado para o escopo total

**Probabilidade:** alta. **Impacto:** alto.
**Sinal:** Fase 3 (LangGraph) atrasa, empurrando 4 e 7.
**Mitigação:**

- Entregar Fases 0–4 + Fase 5 com flags desligadas + Fase 7.
- Fase 6 (assistente interno + dashboards completos) entra em onda 2 pós go-live, com features visíveis-mas-desabilitadas.
- Cliente alinhado sobre o que é "go-live MVP" vs "evolução pós-MVP".

### R1.2 — Migração Notion/Trello consome mais que o planejado

**Probabilidade:** média-alta. **Impacto:** alto.
**Mitigação:**

- Começar export e mapeamento na Fase 1 em paralelo.
- Usar pipeline de importação genérico desde a Fase 1; migração aproveita ele.
- Aceitar que parte dos dados antigos pode ficar como "histórico arquivado" sem amarração perfeita.

## 2. Riscos técnicos críticos

### R2.1 — IA alterar dados incorretamente

**Probabilidade:** baixa-média. **Impacto:** crítico.
**Mitigação:**

- IA não escreve direto no banco. Tudo via tool → API backend → validação Zod + RBAC + idempotency.
- Tools mutantes restritas ao escopo da própria conversa.
- Ações críticas (aprovar/recusar crédito, alterar análise, alterar produto) **não são tools**. Apenas humanos podem.
- `ai_decision_logs` registra cada chamada para auditoria.

### R2.2 — Duplicidade de leads por telefone

**Probabilidade:** alta sem mitigação. **Impacto:** médio.
**Mitigação:**

- Normalização E.164 + libphonenumber-js antes de qualquer escrita.
- Índice único parcial: `unique (organization_id, primary_phone) where status != 'merged'`.
- Tool `get_or_create_lead` faz upsert idempotente.
- Tela de merge sugerido para casos de conflito de identidade.

### R2.3 — Webhook duplicado (WhatsApp/Chatwoot)

**Probabilidade:** alta. **Impacto:** alto se sem mitigação.
**Mitigação:**

- Idempotency key obrigatória por `wa_message.id` e por `chatwoot.message_id + updated_at`.
- Tabela `idempotency_keys` retém resposta para 24h.
- Tabela `whatsapp_messages` com unique em `wa_message_id`.

### R2.4 — Importação corromper dados

**Probabilidade:** média. **Impacto:** crítico.
**Mitigação:**

- Pipeline obrigatório com preview antes de persistir.
- Validação por linha + erros granulares.
- Confirmação irreversível processa apenas o aprovado.
- Audit log registra quem/quando/com qual mapping.
- Backup do banco antes de toda importação massiva via tela admin.

### R2.5 — Follow-up/cobrança duplicada

**Probabilidade:** média. **Impacto:** alto (penalização Meta).
**Mitigação:**

- Idempotency `(lead_id, rule_id, day_bucket)`.
- Lock no worker via `SELECT ... FOR UPDATE SKIP LOCKED`.
- Cancelamento automático ao receber resposta do cliente.
- Janela WhatsApp respeitada antes de qualquer envio.
- Flag desligada por padrão no MVP.

### R2.6 — Vazamento de dados entre cidades

**Probabilidade:** média. **Impacto:** crítico.
**Mitigação:**

- Repository injeta filtro de cidade automaticamente; controllers não tocam SQL.
- Testes automatizados positivo + negativo para cada role × cidade.
- 404 (não 403) em recursos fora de escopo para não vazar existência.
- Audit log de acessos.

### R2.7 — LangGraph indisponível

**Probabilidade:** média. **Impacto:** médio.
**Mitigação:**

- Backend tem fallback de handoff humano com mensagem segura.
- Health check + monitoramento + alerta.
- Retry 1x com backoff. Não acumula filas dentro do LangGraph.
- LangGraph stateless: pode escalar horizontalmente.

### R2.8 — Mudança de regra de simulação afetar histórico

**Probabilidade:** alta sem mitigação. **Impacto:** crítico (juridicamente).
**Mitigação:**

- Versionamento explícito (`credit_product_rules.version`).
- Simulação imutável após criação, com FK para versão usada.
- Atualização de regra cria nova versão; antiga é desativada, nunca apagada nem editada.
- UI deixa visível qual versão foi usada em cada simulação.

### R2.9 — Custo de LLM descontrolado

**Probabilidade:** média. **Impacto:** médio.
**Mitigação:**

- Modelo otimizado (Claude Sonnet/Haiku) com fallback.
- Limite de tokens por turno.
- Cache de prompt onde aplicável.
- Métrica de custo por conversa + alerta de spike.
- Rate limit por conversa.

### R2.10 — Prompt injection

**Probabilidade:** alta (cliente real testa). **Impacto:** médio-alto.
**Mitigação:**

- Prompt do sistema com restrições explícitas.
- Validador pós-LLM verifica tools chamadas e parâmetros.
- Tools mutantes só na conversa do próprio lead.
- Mensagens com padrões suspeitos logadas.
- Suite de testes específica.

## 3. Riscos de negócio

### R3.1 — Cliente esperar features visíveis-mas-desabilitadas como funcionais

**Probabilidade:** alta. **Impacto:** médio.
**Mitigação:**

- Badge "Em desenvolvimento" claríssimo.
- Tooltip explicativo.
- Documento de cutover lista o que está e o que não está habilitado.
- Sessão de treinamento aborda explicitamente o que está em desenvolvimento.

### R3.2 — Conformidade Meta/WhatsApp

**Probabilidade:** média. **Impacto:** crítico (banimento).
**Mitigação:**

- Templates aprovados antes de uso em produção.
- Janela de 24h respeitada.
- Opt-out registrado e respeitado.
- Política de qualidade do número monitorada.

### R3.3 — LGPD

**Probabilidade:** baixa-média. **Impacto:** crítico.
**Mitigação:**

- Base legal documentada por finalidade.
- Consentimento via WhatsApp registrado.
- Direitos do titular implementados (acesso, correção, apagamento).
- DPO/responsável cadastrado.

### R3.4 — Dependência da operação atual durante migração

**Probabilidade:** alta. **Impacto:** alto.
**Mitigação:**

- Operação paralela 7 dias.
- Notion/Trello ficam em modo leitura durante esse período.
- Rollback documentado e testado em staging.

## 4. Riscos operacionais

### R4.1 — Adoção pelos agentes humanos

**Probabilidade:** média. **Impacto:** alto.
**Mitigação:**

- UX limpa e familiar.
- Sessões de treinamento.
- Material de referência rápida.
- Canal de suporte direto durante primeira semana.

### R4.2 — Inconsistência entre Manager e Chatwoot

**Probabilidade:** média. **Impacto:** médio.
**Mitigação:**

- Sync forte via eventos.
- Tela de status de integrações com reprocessamento.
- Worker `chatwoot-sync` para retry.

### R4.3 — Banco fora de capacidade

**Probabilidade:** baixa no MVP. **Impacto:** alto.
**Mitigação:**

- Índices apropriados desde o início.
- Monitoramento de slow queries.
- Connection pooling.
- Plano de escala vertical antes de horizontal.

## 5. Riscos de qualidade

### R5.1 — Débito técnico gerado por agentes IA

**Probabilidade:** alta. **Impacto:** médio-alto.
**Mitigação:**

- Padrões em [15-estrategia-desenvolvimento-ia.md](15-estrategia-desenvolvimento-ia.md).
- Definition of Done estrita.
- Revisão obrigatória por humano em PRs sensíveis.
- Suite de testes que catch regressões.
- ESLint estrito + TypeScript estrito.

### R5.2 — Migrations sem revisão

**Probabilidade:** média. **Impacto:** crítico.
**Mitigação:**

- Migrations sempre revisadas manualmente.
- Drop column/table exige aprovação dupla.
- Backup automático antes de migration em prod.

### R5.3 — Testes só em ambiente perfeito

**Probabilidade:** média. **Impacto:** alto.
**Mitigação:**

- Testes incluem cenários de falha (rede, timeout, dados malformados).
- Chaos light: matar LangGraph durante conversa em staging para validar fallback.
- Importação testada com arquivos reais sujos.

## 6. Matriz consolidada (top 10 críticos)

| #   | Risco                            | P × I | Status mitigação                   |
| --- | -------------------------------- | ----- | ---------------------------------- |
| 1   | 45 dias para tudo                | A × A | Fasear: MVP + onda 2               |
| 2   | IA alterar dados                 | B × C | Tools controladas, sem DB direto   |
| 3   | Vazamento entre cidades          | M × C | RBAC forçado em repository         |
| 4   | Migração Notion/Trello           | M × A | Pipeline genérico + paralelo       |
| 5   | Webhook duplicado                | A × A | Idempotency obrigatório            |
| 6   | Regra simulação afetar histórico | A × C | Versionamento imutável             |
| 7   | Conformidade Meta                | M × C | Templates + janela + monitoramento |
| 8   | LGPD                             | M × C | Base legal + direitos + audit      |
| 9   | Adoção pelos agentes             | M × A | Treinamento + UX                   |
| 10  | LangGraph cair                   | M × M | Fallback handoff humano            |

## 7. Plano de resposta a incidentes (resumo)

- Canal único de incidente (Slack/Discord/Telegram).
- Runbooks por cenário em `docs/runbooks/`.
- Severidade:
  - SEV1: serviço indisponível para clientes (resposta < 15min).
  - SEV2: feature crítica degradada (resposta < 1h).
  - SEV3: feature secundária (resposta < 4h).
- Postmortem obrigatório para SEV1 e SEV2 em 48h.

## 8. Checkpoint de risco no roadmap

Final de cada fase tem revisão de risco:

- Riscos resolvidos? Marcar.
- Riscos novos? Adicionar.
- Riscos próximos? Mitigação preparada.
- Comunicar status ao cliente.
