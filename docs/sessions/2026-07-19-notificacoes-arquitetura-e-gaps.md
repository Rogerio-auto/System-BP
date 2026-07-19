# Sessão 2026-07-19 — Notificações: centralização de arquitetura + análise de gaps de UX

> Varredura ponta-a-ponta do sistema de notificações contra o código-fonte, atualização da
> documentação canônica ao estado real, e mapeamento das lacunas de UX que reduzem a
> produtividade do operador no dia a dia.
>
> Referência visual (artefato único): publicado como Artifact "Arquitetura de Notificações"
> (fluxo + tabelas + análise). Doc canônico: [`docs/23-notificacoes.md`](../23-notificacoes.md).

## 1. O que foi atualizado na documentação

- **doc 23 (notificações)** — reescrita da §12 ("Estado atual e débito remanescente"), novas
  §13 (modelo de dado + deep-link) e §14 (experiência no frontend / lacunas de UX). §5.3 e §9
  atualizadas (realtime agora existe). Corrigidas refs internas órfãs (§5.1 não dizia mais
  "não publica em socket"; §4 sem ref §12.4 quebrada).
- **doc 09 (feature-flags)** — nota das 4 flags de F24: as quatro agora gateiam código real
  (F24 concluída).
- **doc 19 (go-live §14)** — removidos os bloqueadores que já não valem (bug `kanban_stage:*`
  corrigido em F24-S16; realtime entregue em F24-S08/S13); débito reclassificado como UX de
  frontend; checklist e ordem de flip atualizados; linha de histórico 1.4.

## 2. Estado real confirmado (código à frente do doc de 2026-07-10)

| Antes o doc dizia                 | Realidade em 2026-07-19    | Evidência                                                             |
| --------------------------------- | -------------------------- | --------------------------------------------------------------------- |
| Realtime "inexistente"            | Implementado (F24-S08/S13) | `notifications/realtime.ts` → `notification.new` sala `user:{userId}` |
| SLA "só 1 de 7 eixos"             | 7 eixos com fonte de dados | `notification-rules/sla-sources.ts` (7 finders)                       |
| Bug `kanban_stage:*` bloqueia SLA | Corrigido (F24-S16)        | strip do prefixo + `eq(kanbanCards.stageId, …)`                       |

**Débito novo descoberto (não estava no doc):** templates de SLA anunciam placeholders ricos
(`{{lead_id}}`, `{{chatwoot_conversation_id}}`, `{{hours_stalled}}`, `{{stage_name}}`) que o
worker **não injeta** (contexto = `{entity_id, entity_type, city_id}`) → renderizam literais.

## 3. Inventário — tudo que gera notificação (18 gatilhos)

- **9 eventos** (`trigger_kind='event'` → `handleFanoutNotification`): `simulations.generated`,
  `credit_analysis.status_changed`, `chatwoot.handoff_requested`, `contract.signed`,
  `contract.near_end`, `payment_due.overdue_15d`, `billing.collection_sent`, `task.created`,
  `customer.law_firm_referred`.
- **7 eixos de estagnação** (`trigger_kind='stage_inactivity'` → `notification-sla-scan`):
  `kanban_stage:*`, `handoff:requested`, `simulation:sent_no_reply`, `analysis:pendente`,
  `contract:draft_unsigned`, `payment_due:overdue`, `conversation:no_reply`.
- **2 ad-hoc** (chamam senders direto): `livechat.handoff` (in-app), `assistant.escalation`
  (in-app + email).

Tabela completa com `file:line` de cada emissor: ver Artifact §02–04 e doc 23 §2/§3.

## 4. Análise de gaps de UX (prioridade por impacto no operador)

A arquitetura de **entrega** é sólida (idempotência, RBAC, city_scope, dedup, LGPD). O que trava
produtividade é a **experiência** do sino: a notificação chega, mas não leva a lugar nenhum, não
diz o quê, e some do controle do usuário.

### P0 — crítico (frontend reusa máquina que já existe)

- **G1 — Clicar no item só marca lida.** `NotificationItem` só chama `markRead.mutate(id)`; sem
  navegação/expansão/ação. `entity_type`/`entity_id` chegam no payload e são ignorados.
- **G2 — Deep-link só no toast efêmero.** `resolveNotificationHref` navega apenas em
  `handleToastOpen`; depois que o toast some (5–10s) ou recarrega, a lista persistente não
  navega. Reusar o resolvedor na lista.
- **G3 — Marca-lida involuntária.** Desacoplar: clicar **abre** a entidade; a leitura acontece
  **ao abrir** (ou por check explícito), preservando o "ainda preciso ver".
- **G5 — Sem botões de ação / resumo ao expandir.** Item expansível + 1–2 CTAs por
  `entity_type` (handoff → "Abrir conversa" + "Assumir"; escalação → "Abrir lead").

### P1 — alto (backend)

- **G4 — Textos genéricos.** Handoff = _"Uma conversa no WhatsApp (cidade) precisa de atendimento
  humano"_ — sem lead, motivo ou tempo. Enriquecer com contexto operacional não-sensível
  (respeitar LGPD; resumo bruto da IA permanece fora do outbox).
- **G8 — Placeholders de SLA literais.** Enriquecer o contexto do worker por eixo (mesmo dado do
  G4) ou podar os placeholders do catálogo até lá.

### P2 — médio

- **G6 — Sem severidade/ícone/categoria na lista** (severity nem existe no schema REST — só no
  socket). Persistir `severity` na linha + faixa visual por categoria.
- **G7 — Sem página "ver todas"** (rodapé estático "Mostrando 10 de N"). Rota `/notificacoes`
  com paginação/filtros/ações em lote.

## 5. Cenário-âncora — "atendimento esperando"

O caso mais frequente e de maior custo de latência. Hoje: aviso genérico que some e só marca
lida. Alvo: card com quem/há-quanto-tempo/motivo + "Abrir conversa"/"Assumir", leitura ao abrir.
Resolver G1–G5 aqui já muda o dia do gestor. Ver mock no Artifact §07.

## 6. Slots propostos (a autorar — decisão do Rogério)

Nenhum slot foi autorado nesta sessão (escopo = documentar + analisar). Proposta de decomposição:

| Slot (sugerido) | Escopo                                                                                                        | Camada                | Gaps           |
| --------------- | ------------------------------------------------------------------------------------------------------------- | --------------------- | -------------- |
| F26-S01         | Lista do sino: navegação por item (reusar `resolveNotificationHref`) + botão de ação; ler ao abrir a entidade | frontend              | G1, G2, G3, G5 |
| F26-S02         | Enriquecer body de handoff/escalação (lead, motivo, tempo) + contexto do worker de SLA                        | backend               | G4, G8         |
| F26-S03         | Persistir `severity` na linha + expor no REST + faixa/ícone na lista                                          | schema + back + front | G6             |
| F26-S04         | Central de notificações `/notificacoes` (paginação, filtros, lote)                                            | frontend + rota       | G7             |

**Nota de deep-link (P0):** corrigir o carimbo `entity_type='lead'` do fan-out de
`chatwoot.handoff_requested` (ou tratar no resolvedor) para abrir a **conversa** certa, não o
lead. Evoluir `conversation`/`contract` do resolvedor para o registro exato (hoje caem em lista).
