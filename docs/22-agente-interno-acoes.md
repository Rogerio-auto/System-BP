# 22 — Agente Interno de IA: Ações no Funil e Fronteira IA ↔ Humano

> **Status:** normativo. Este documento define o que o agente interno de IA (Ana Clara)
> pode e não pode executar sobre dados de clientes, e a arquitetura pela qual ele
> executa ações no funil (Kanban / status de lead).
>
> **Precedência:** herda e não substitui `06-langgraph-agentes.md` (arquitetura do agente),
> `17-lgpd-protecao-dados.md` (LGPD — vence em qualquer conflito), `10-seguranca-permissoes.md`
> (RBAC) e `09-feature-flags.md` (flags). Em conflito de UI, vale `18-design-system.md`.
>
> **Origem:** decisões travadas com o Rogério em 2026-07-06 (proatividade sem outbound;
> abandono automático reversível; consolidação da máquina de estados do lead).

---

## 1. Propósito

O agente hoje é **reativo e conversacional**: só age quando o cidadão manda mensagem no
WhatsApp, e suas escritas se limitam a criar/atualizar o lead e gerar simulação
(`docs/06-langgraph-agentes.md`). Este documento amplia o escopo do agente para que ele:

1. **Qualifique** leads no pré-atendimento de forma explícita e auditável.
2. **Mantenha o funil atualizado** de forma proativa/agendada (estagnação, abandono).
3. Faça tudo isso **dentro de uma fronteira dura** com a responsabilidade humana, sob LGPD.

### Duas superfícies do agente interno (não confundir)

Este documento governa **duas superfícies distintas** da IA interna, com modelos de
autorização diferentes:

| Superfície                                  | Público              | Natureza                                                    | Autorização                                                          |
| ------------------------------------------- | -------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------- |
| **A — Ana Clara / ações no funil** (§§3-11) | Cidadão (WhatsApp)   | **Escreve** no funil (qualifica, atualiza Kanban, abandona) | Ator de IA com allowlist própria (M2M); escopo = cidade do lead      |
| **B — Copiloto interno** (§12)              | Funcionário (in-app) | **Lê** e responde sobre métricas, análises, funil           | **Herda o RBAC do usuário** que pergunta; escopo = escopo do usuário |

A superfície B é o que o botão "Assistente" na Topbar já promete
(`apps/web/src/features/assistant/InternalAssistantButton.tsx`), atrás da flag
`ai.internal_assistant.enabled`. É a peça que responde ao time — e o coração dela é que
**só revela o que o RBAC daquele usuário permite ver**.

Não-meta: transformar a IA em decisor de crédito. Aprovação, recusa, análise de risco e
contratação **permanecem exclusivamente humanas** (LGPD Art. 20; `docs/06:301-310`).

---

## 2. Princípios (invioláveis)

Herdados de `docs/06` §1 e reafirmados aqui:

1. **A IA propõe, a regra de negócio decide.** A IA nunca manipula geometria do Kanban
   diretamente. Ela produz um **fato de negócio** (ex.: "lead qualificado"); um worker
   determinístico traduz o fato em movimento de card / mudança de status.
2. **Postgres é fonte de verdade.** LangGraph só escreve via `/internal/*` com `X-Internal-Token`.
3. **Outbox para todo fato.** Nenhuma ação da IA move estado sem emitir evento no outbox.
4. **Ator de IA auditável.** Toda ação da IA é registrada com `actor_type='ai'` (não como
   "sistema anônimo"), para rastreabilidade LGPD Art. 20.
5. **Permissão no backend, não no prompt.** O que a IA pode fazer é validado no `/internal`
   (allowlist de ação + escopo de cidade + org), nunca confiando na obediência do LLM.
6. **DLP antes do LLM.** Nenhuma PII bruta sai para o gateway (`docs/17`; `app/llm/dlp.py`).
7. **Idempotência.** Toda ação sensível é idempotente por chave determinística.
8. **Reversível por humano.** Toda ação autônoma da IA sobre o funil é reversível por um
   gestor em ≤1 clique, com histórico preservado.

---

## 3. Máquina de estados do lead (canônica)

> Pré-requisito de qualquer automação nova. Hoje existem **dois sistemas paralelos** de
> estado que precisam de mapa explícito, senão cada automação herda fragilidade.

### 3.1 Os dois sistemas hoje

- **`leads.status`** — enum de negócio, transição livre via `PATCH /api/leads/:id`
  (`apps/api/src/db/schema/leads.ts:155-159`):
  `new · qualifying · simulation · closed_won · closed_lost · archived`.
- **Kanban stage** — configurável por org (nome + `orderIndex` + `isTerminalWon`/`isTerminalLost`),
  transição validada por matriz (`apps/api/src/modules/kanban/service.ts:99-155`).

Os workers de automação hoje dependem de `orderIndex` hardcoded
(`workers/kanban-on-simulation.ts:85-88`, `workers/kanban-on-analysis.ts:101`) e de
heurística de nome — frágil a renomeações e a orgs futuras (multi-tenant).

### 3.2 Pipeline canônico do Banco do Povo

| orderIndex | Stage                           | `leads.status` correlato     | Dono                            |
| ---------- | ------------------------------- | ---------------------------- | ------------------------------- |
| 0          | Pré-atendimento                 | `new` → `qualifying`         | 🟢 IA                           |
| 1          | Simulação                       | `simulation`                 | 🟢 IA (via evento de simulação) |
| 2          | Documentação                    | —                            | 🔴 Humano (pós-handoff)         |
| 3          | Análise de Crédito              | —                            | 🔴 Humano                       |
| 4+         | Concluído (terminal won / lost) | `closed_won` / `closed_lost` | 🔴 Humano¹                      |

> ¹ Exceção: `closed_lost` por **abandono automático** (§7.2) é o único terminal que a IA
> pode atingir, e é reversível.

### 3.3 Regra de consolidação (slot de pré-requisito)

Antes de escalar automações: introduzir um **mapa de estágios canônico explícito** (por
`slug`/`role` do stage, não `orderIndex` mágico) resolvido no backend, e documentar o
mapeamento `leads.status ↔ kanban stage` como contrato único. Os workers passam a resolver
stages por papel canônico, com fallback logado.

---

## 4. Fronteira IA ↔ humano (normativo)

**Corte:** a IA é dona do **topo do funil** (pré-atendimento, simulação, qualificação) e de
**housekeeping reversível de baixo risco**. Todo ato com efeito de crédito, jurídico ou
financeiro é **exclusivamente humano**. Quando o lead vira responsabilidade de um humano
(handoff / Documentação em diante), **a IA para de agir sobre aquele lead**, exceto auditoria.

| Zona                              | Ação                                                                                  | Quem                                  |
| --------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------- |
| 🟢 **IA autônoma**                | Criar/deduplicar lead; coletar e gravar perfil (nome, cidade, atividade, valor/prazo) | IA                                    |
| 🟢                                | Identificar cidade; recusar cordialmente cidade fora de escopo                        | IA                                    |
| 🟢                                | Gerar simulação **ilustrativa** ("sujeita à análise") e mover Pré-atend. → Simulação  | IA (evento — já existe)               |
| 🟢                                | **Qualificar** lead (`new → qualifying`) com dossiê mínimo completo                   | IA (evento — **novo**)                |
| 🟢                                | Marcar **estagnado** / **abandonado** após silêncio; anotar motivo                    | IA (evento, reversível — **novo**)    |
| 🟢                                | Solicitar handoff e montar resumo estruturado pro humano                              | IA                                    |
| 🟡 **IA propõe, humano confirma** | Sugerir produto / enquadramento de perfil                                             | IA sugere / humano decide             |
| 🟡                                | Capturar autorização de SCR/SPC (texto legal)                                         | IA captura / consulta é ato governado |
| 🔴 **Humano exclusivo**           | Aprovar/recusar crédito; alterar valor aprovado; parecer de risco                     | Humano (LGPD Art. 20)                 |
| 🔴                                | Mover card para Documentação / Análise / Concluído-ganho; contratar                   | Humano                                |
| 🔴                                | Atribuir/transferir agente; reverter stage; editar análise                            | Humano                                |
| 🔴                                | Ver CPF/documentos sensíveis; enviar contrato; cobrança com efeito financeiro         | Humano (IA nunca vê PII bruta)        |
| 🔴                                | **Enviar mensagem proativa (outbound) ao cidadão**                                    | Humano — ver §7.1                     |

---

## 5. Os dois modos do agente

### 5.1 Reativo (conversacional) — já existe, será ampliado

Dentro do loop de mensagem (`agent_turn.py`). Ampliação: nova tool `qualify_lead` (§6.1).

### 5.2 Proativo (agendado) — novo

Um **worker agendado** (não a conversa) roda periodicamente por org, sob flag, e aplica
**regras determinísticas** de housekeeping (com passo de LLM apenas para desambiguar casos
de fronteira, se necessário). Mesmo contrato: **produz fato → worker move**. Nunca envia
mensagem outbound (§7.1). Governado por `internal_assistant.actions.enabled`.

---

## 6. Arquitetura de execução de ações

O padrão já provado pelos workers de Kanban existentes
(`workers/kanban-on-simulation.ts`, `workers/kanban-on-analysis.ts`) é a **referência**.
Nenhuma ação nova foge dele:

```
IA (LLM + tools)
   → tool semântica de NEGÓCIO (ex.: qualify_lead)
   → POST /internal/...  (Zod + permissão do ator IA + escopo cidade/org)
   → grava domain state + emit(evento) no outbox   [1 transação]
   → worker determinístico consome o evento
   → move Kanban / status  +  kanban_stage_history (append-only)
   +  audit_logs (actor_type='ai')  +  idempotência por chave
```

### 6.1 Tool nova: `qualify_lead`

- **Quando:** a IA coletou o **dossiê mínimo** — nome completo + cidade válida no escopo +
  atividade/ocupação + intenção de crédito.
- **Contrato:** `qualify_lead(lead_id, reason)` → `POST /internal/leads/:id/qualify`.
- **Efeito:** `leads.status: new → qualifying`; append em `lead_history` (actor `ai`);
  emite `leads.qualified`; audit `actor_type='ai'`. Idempotente (`leads.qualified:<lead_id>`).
- **A IA não escolhe o stage.** Ela afirma "qualifiquei"; a geometria do Kanban continua
  event-driven. Um worker `kanban-on-qualification` (novo, opcional) reflete a qualificação
  (ex.: badge/prioridade no card de Pré-atendimento) sem pular etapa.

### 6.2 Ações proativas (worker agendado)

- `mark_lead_stagnant` — sem interação há `STAGNANT_AFTER_DAYS`: marca sinalização + cria
  alerta/tarefa para humano. **Não** muda terminal. Reversível automaticamente na próxima
  interação.
- `mark_lead_abandoned` — sem interação há `ABANDON_AFTER_DAYS`: `leads.status → closed_lost`
  (outcome `abandonado`), move card para terminal-lost via evento `leads.abandoned`.
  **Reversível** por gestor em 1 clique; histórico preservado. Ver §7.2.

---

## 7. Regras proativas (decisões travadas 2026-07-06)

### 7.1 Sem outbound autônomo

**A IA proativa NÃO envia mensagem ao cidadão por conta própria.** Ela apenas atualiza o
funil interno e **sinaliza** (alerta/tarefa) para um humano decidir o follow-up. Motivo:
custo de template WhatsApp, risco de marca e superfície LGPD de consentimento. Follow-up
outbound governado fica para uma fase futura, separada e explicitamente aprovada.

### 7.2 Abandono automático (reversível)

A IA **pode** marcar um lead como abandonado (`closed_lost`, outcome `abandonado`) após
`ABANDON_AFTER_DAYS` sem resposta. Requisitos:

- Reversível por gestor em ≤1 clique (reabre o card → stage não-terminal), com auditoria.
- `ABANDON_AFTER_DAYS` é **configurável por org** (parâmetro de negócio; valor final a
  definir pelo Rogério — sugestão inicial de trabalho: 30 dias, com `STAGNANT_AFTER_DAYS`
  em 7 dias).
- Nunca abandona lead que já passou para Documentação/Análise (dono humano).

---

## 8. Ator de IA, permissões e auditoria

Há **dois planos de permissão** que não devem ser confundidos:

- **8.A — Autorização da própria IA** (o que a IA-máquina pode escrever). É M2M via
  `/internal` com `X-Internal-Token`, **não passa por JWT/role de usuário**. É uma
  _allowlist de ação no backend_.
- **8.B — Permissões humanas** (quem, no time, pode **supervisionar/configurar/reverter** as
  ações da IA). Essas **passam pelos roles** e são concedidas pela UI de papéis — é o que o
  Rogério pediu para deixar configurado.

### 8.A Autorização da IA (allowlist de máquina)

- **Ator de IA de primeira classe:** ações da IA usam `actor_type='ai'`, `actor_user_id=null`
  em `audit_logs`. Distinguir decisão de IA de decisão humana é requisito LGPD Art. 20.
  (Hoje o actor de sistema aparece como `worker:*`/`null` — insuficiente.)
- **Allowlist de ação no backend:** cada `/internal` de mutação valida que a ação está na
  lista permitida ao ator IA e que os parâmetros não vazam IDs de outro lead/cidade
  (`docs/10:109-110`). O validador pós-LLM é obrigatório.
- **Escopo de cidade/org:** toda ação respeita `applyCityScope` e `organization_id`
  (multi-tenant-ready).
- **`ai_decision_logs`:** toda decisão continua logada (retenção 5 anos — `docs/17:147`).

### 8.B Permissões humanas (RBAC — concedidas por role)

Introduzir três permissões novas no catálogo, no padrão canônico `recurso:ação`
(`apps/api/src/db/schema/permissions.ts`; formato `{ key, description }` em
`apps/api/scripts/seed.ts:129-205`):

| Permissão           | Descrição                                                      | Efeito                                                                                                  |
| ------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `ai_actions:read`   | Ver o registro e o painel de ações do agente de IA no funil    | Painel "IA nas últimas 24h" (§11)                                                                       |
| `ai_actions:revert` | Reverter uma ação autônoma do agente de IA                     | Reabrir lead abandonado / desfazer qualificação, com auditoria                                          |
| `ai_actions:manage` | Configurar o agente de IA no funil (habilitar ações, limiares) | Ligar `internal_assistant.actions.enabled`, editar `STAGNANT_AFTER_DAYS` / `ABANDON_AFTER_DAYS` por org |

**Pré-mapeamento por role** (dicionário `ROLE_PERMISSIONS` em `apps/api/scripts/seed.ts:211-360`;
`admin` recebe tudo automaticamente — linha 466):

| Role              | `ai_actions:read` | `ai_actions:revert` | `ai_actions:manage` |
| ----------------- | :---------------: | :-----------------: | :-----------------: |
| `admin`           |        ✅         |         ✅          |         ✅          |
| `gestor_geral`    |        ✅         |         ✅          |         ✅          |
| `gestor_regional` |        ✅         | ✅ (na sua cidade)  |          —          |
| `agente`          |        ✅         | ✅ (nos seus leads) |          —          |
| `operador`        |        ✅         |          —          |          —          |
| `leitura`         |        ✅         |          —          |          —          |

> `ai_actions:manage` fica só com quem já governa configuração global (admin/gestor_geral).
> `revert` desce até `agente`/`gestor_regional` porque reverter uma ação da IA é operação de
> chão de fábrica — e sempre respeita escopo de cidade.

**Como catalogar (processo canônico, seguindo `0017_seed_credit_products_permissions.sql`):**

1. **Migration SQL:** `INSERT INTO permissions (key, description) … ON CONFLICT DO NOTHING`
   - `INSERT INTO role_permissions` (SELECT por `roles.key`) para o pré-mapeamento acima.
2. **Seed:** registrar as três keys no array `PERMISSIONS` e no dicionário `ROLE_PERMISSIONS`
   (`apps/api/scripts/seed.ts`) para bancos criados do zero.
3. **Agrupamento na UI:** adicionar o prefixo `ai_actions:` ao `MODULE_PREFIX_MAP`
   (`apps/api/src/modules/roles/service.ts:52-95`) com label **"Agente de IA"**, para as três
   permissões aparecerem agrupadas na matriz.
4. **Guard nas rotas:** `authorize({ permissions: ['ai_actions:read'] })` etc.
   (`apps/api/src/modules/auth/middlewares/authorize.ts`).

**Onde o admin concede o acesso (UI já existente):**
`/admin/papeis` → `RolesPage` → `PermissionsMatrix`
(`apps/web/src/features/admin/roles/`), que chama
`PUT /api/admin/roles/:id/permissions` (`apps/api/src/modules/roles/routes.ts:84-106`;
exige `users:assign_privileged_roles`). Após o seed, as três permissões já vêm marcadas
para os roles do pré-mapeamento; o admin ajusta na matriz se quiser. Atribuição de role a
usuário continua em `/admin/usuarios` (`UserDrawer` → `UserRoleSelect`).

---

## 9. LGPD / DLP

- **DLP obrigatório** antes de qualquer chamada ao gateway LLM — inclui o modo proativo
  (`docs/17`; `app/llm/dlp.py`). Nada de PII bruta para suboperador internacional.
- **Outbox sem PII bruta:** eventos novos (`leads.qualified`, `leads.abandoned`, etc.)
  carregam apenas IDs opacos + status (`docs/17 §8.5`; `apps/api/src/db/schema/events.ts:81-96`).
- **Retenção e direitos do titular:** inalterados (`docs/17` §6, §7). Abandono automático não
  apaga dados; apenas muda status.
- **Checklist §14.2 do doc 17** obrigatório em qualquer PR que toque PII.

---

## 10. Feature flags (4 camadas)

- `internal_assistant.actions.enabled` (default `disabled`) — habilita as ações de escrita
  da IA no funil (qualify, housekeeping). Nasce **OFF**.
- `ai.internal_assistant.enabled` (default `disabled`) — guarda-chuva do assistente interno.
- Comportamento por camada (UI / API / worker / tool) conforme `docs/09` §4. Tool desligada
  retorna `FEATURE_DISABLED` estruturado; o grafo lida graciosamente.
- **Rollout:** flag OFF em produção até validação. Nada em prod antes de aprovação explícita.

---

## 11. Observabilidade e kill-switch

- **Painel por org:** "o que a IA fez no funil nas últimas 24h" (qualificações, abandonos,
  estagnações), com reversão em 1 clique.
- **Kill-switch por org:** desligar `internal_assistant.actions.enabled` congela toda ação de
  escrita da IA no funil imediatamente (worker checa flag no início de cada job — `docs/09` §4.3).
- **Métricas:** volume de ações IA/dia, taxa de reversão humana (sinal de qualidade da IA),
  leads qualificados → convertidos.

---

## 12. Copiloto interno de consulta (métricas, análises e dados — RBAC-bound)

Superfície B (§1). O funcionário conversa em linguagem natural e o copiloto responde sobre
**métricas, funil, análises, leads, cobrança, simulações** — **read-only**, e **somente
sobre os dados que aquele usuário já poderia ver na tela**. É agente separado da Ana Clara,
atrás da flag `ai.internal_assistant.enabled` (`db/seeds/featureFlags.ts` — hoje `disabled`,
Fase 6). A superfície visível já existe (`InternalAssistantButton.tsx`).

### 12.1 O que é / o que não é

- **É:** copiloto in-app de consulta. "Quantos leads entraram hoje?", "Qual a conversão da
  minha cidade este mês?", "Status da análise do cliente X?", "Quantas cobranças vencem
  esta semana?".
- **Não é:** não escreve no funil (isso é a Superfície A); não decide crédito; **nunca
  revela dado fora do escopo do usuário**.

### 12.2 Princípio de autorização — herda o principal do usuário (não escala)

Este é o núcleo do que o Rogério pediu. **O copiloto roda COMO o usuário autenticado**, não
como um ator de IA privilegiado:

1. **Herança de RBAC.** Cada tool de leitura re-aplica `authorize()` + `applyCityScope(user)`
   — os **mesmos guards da UI** (`apps/api/src/modules/auth/middlewares/authorize.ts`). O
   copiloto **não** usa `X-Internal-Token` nem o ator de IA da Superfície A para ler.
2. **Sem novas permissões de leitura.** Reutiliza as que o usuário já tem:
   `dashboard:read`, `dashboard:read_by_agent`, `reports:export`, `billing:read`,
   `audit:read`, `leads:read`, `customers:read`, `simulations:read`, `analyses:read`
   (`apps/api/scripts/seed.ts`). A resposta é a **interseção** "o que o usuário pode ver".
3. **Filtro no backend, nunca no LLM.** O escopo de cidade e a permissão são aplicados no
   endpoint/repository por principal — jamais confiando o filtro ao modelo.
4. **Regra de ouro:** _se o usuário não vê pela tela, o copiloto não pode dizer._

### 12.3 Nova permissão (só de acesso ao copiloto)

Uma única permissão nova, no padrão de §8.B:

| Permissão          | Descrição                             |
| ------------------ | ------------------------------------- |
| `ai_assistant:use` | Pode conversar com o copiloto interno |

`ai_assistant:use` **não concede leitura de nada** — cada consulta ainda exige a permissão do
domínio (§12.2). Pré-mapeamento: **todos os roles operacionais** recebem (`admin`,
`gestor_geral`, `gestor_regional`, `agente`, `operador`, `leitura`), porque o poder real de
cada um já vem das suas permissões de leitura. Catalogar/conceder conforme §8.B (seed +
`MODULE_PREFIX_MAP` label "Agente de IA" + UI `/admin/papeis`).

### 12.4 Arquitetura

- **Grafo `internal_assistant`** no `apps/langgraph-service` (separado do
  `pre_attendance_agent`), com **tools de leitura**.
- **Threading do principal do usuário** (`userId` + `permissions` + `cityScopeIds`) do front
  → API → grafo → tools, análogo ao threading de `organization_id` que já foi pegadinha em
  produção (ver `docs/06`; a IA nunca deve inferir escopo — recebe-o do principal).
- As tools chamam endpoints de consulta que **re-autorizam com o principal recebido** e usam
  os mesmos repositories de `reports`/`leads`/`credit-analyses` com `applyCityScope(user)`.
  Postgres continua fonte de verdade; **sem SQL cru** (`docs/06` §1.5).
- Resposta **estruturada e com citação da fonte** (qual métrica/endpoint originou o número),
  para auditabilidade e para evitar alucinação de valores.

### 12.5 LGPD / DLP no copiloto

- **DLP antes do LLM vale mesmo para usuário autorizado.** Agregados e números são seguros;
  **registros individuais vão mascarados** (reusar `phoneMasked`, sem CPF bruto — o usuário
  pode ver o telefone na tela, mas **não mandamos o telefone bruto ao OpenRouter**). `docs/17`.
- **Auditoria:** toda consulta é logada (quem perguntou o quê, sem PII bruta). O `actor` do
  audit é **o usuário** (a leitura é dele), diferente da Superfície A (`actor_type='ai'`).

### 12.6 Comportamento esperado por role (exemplos)

| Pergunta                         | `leitura` (Ariquemes)                          | `gestor_geral`   | `agente`               |
| -------------------------------- | ---------------------------------------------- | ---------------- | ---------------------- |
| "Quantos leads hoje?"            | Só Ariquemes                                   | Todas as cidades | Só a(s) cidade(s) dele |
| "Status da análise do cliente X" | Só se X na sua cidade                          | Qualquer         | Só se X no seu escopo  |
| "Exporta o relatório em CSV"     | Negado (sem `reports:export`)                  | Permitido        | Depende do role        |
| "Aprova o crédito do fulano"     | Recusado — decisão humana, fora de escopo (§4) | Recusado         | Recusado               |

Fora de escopo do usuário → negação padrão, **sem vazar a existência** de dados de outra
cidade/tenant.

### 12.7 Faseamento

Nasce **read-only**. Ações de escrita disparadas pelo copiloto (ex.: "qualifica esse lead")
só depois, e sempre passando pela allowlist da IA-máquina (§8.A) + confirmação humana —
nunca herdando escrita silenciosa do RBAC de leitura.

### 12.8 Primeira ação de escrita: escalar lead ao Crédito (human-in-the-loop)

A primeira ação de escrita exposta pelo copiloto (§12.7) é **notificar o Departamento de
Crédito sobre um lead**. Ela segue o mesmo eixo de segurança do resto deste documento: **a
IA nunca escala sozinha** — ela apenas oferece o botão; quem decide e dispara é sempre o
operador humano.

- **Gatilho:** no card `lead_summary` do copiloto (§12, F6-S22), o operador clica **"Escalar
  ao Crédito"**. Um modal de confirmação mostra o lead, o destinatário e um campo opcional
  de **nota** — só o **confirmar** dispara a chamada. Sem confirmação explícita, nada
  acontece.
- **Ator do audit:** o **humano** que confirmou (`actor_type='user'`), nunca `'ai'` — esta
  ação não usa o ator de IA da Superfície A (§8.A), porque quem decide escalar é o operador,
  não o modelo.
- **Endpoint:** `POST /api/assistant/escalate { lead_id, note? }`.
  - **RBAC:** permissão `assistant:escalate`, concedida a **todos os roles de operador**
    (qualquer operador com acesso ao lead pode escalar) + o lead precisa estar no **escopo
    de cidade** do usuário — fora do escopo responde `404` (sem confirmar/negar a
    existência do lead a quem não deveria vê-lo).
  - **Destinatário — config-driven, não derivado de permissão:** resolvido a partir de
    `organizations.settings.credit_escalation`, um objeto jsonb no formato
    `{ "city_id": "<uuid da cidade>", "role_keys": ["<role>", ...] }`. Na implantação do
    Banco do Povo, o Departamento de Crédito fica na **matriz (Ariquemes)** e o
    `role_keys` aponta para o role `agente` lotado lá — a config guarda **cidade e
    papéis juntos**, porque não existe um role "analista de crédito" dedicado no
    catálogo (`admin`, `agente`, `cobranca`, `gestor_geral`, `gestor_regional`, `leitura`,
    `operador`) nem uma forma segura de derivar o destinatário só pela permissão
    `credit_analyses:decide` — essa permissão hoje é detida também por administradores de
    escopo global, e usá-la diretamente viraria broadcast.
  - **Resolução:** `resolveByRoleCity(role_keys, city_id)` (reuso do resolvedor de
    destinatários do F24, `notification-rules/recipients.ts`). Se
    `credit_escalation` **não estiver configurado**, cai no **fallback**: roles que detêm
    `credit_analyses:decide` em escopo global (hoje, efetivamente `gestor_geral`/`admin`).
    Se mesmo assim **não houver destinatário**, o endpoint responde `409` ("Departamento de
    Crédito não configurado") — a escalação **nunca** vira broadcast silencioso.
  - **Onde setar:** `organizations.settings.credit_escalation` (coluna jsonb de
    `organizations`), editável por quem já governa configuração organizacional
    (equivalente a `ai_actions:manage`, §8.B). Ausência de configuração é um estado válido
    — o sistema cai no fallback acima antes de falhar.
  - **Canais:** `sendInApp` (in-app, sempre) + email — o email fica atrás do **gate de 2
    camadas** do F24 (env `NOTIFICATIONS_EMAIL_ENABLED` **e** flag
    `notifications.email.enabled`; ver `docs/23-notificacoes.md` §9). Sem as duas camadas
    ligadas, a notificação permanece só in-app.
  - **Idempotência:** dedup por `lead_id` numa janela curta (ex.: 1h) — o mesmo lead não
    gera nova notificação a cada clique repetido dentro da janela.
  - **Auditoria e evento:** `audit_logs` com `actor_type='user'`, ação
    `assistant.lead_escalated`; evento `assistant.escalation.created` no outbox, **na mesma
    transação**. O payload do evento carrega apenas **referência ao lead (`lead_id`) e a
    nota do operador** — **sem PII bruta** (nada de CPF/telefone/nome bruto de cidadão no
    outbox; consistente com `docs/17` §8.5/§3.4). O destinatário hidrata o lead pelo próprio
    escopo ao abrir a notificação.
- **Reversibilidade:** a escalação é **puramente informativa**. Ela não move o lead no
  Kanban, não altera `leads.status` e não decide crédito — não há estado de negócio a
  desfazer; uma nova escalação só é possível depois que a janela de dedup expira.

---

## 13. Central de Ajuda (atualização in-app)

A ajuda no ar é servida de `docs/help/**/*.mdx` (source of truth) via manifest Vite
(`apps/web/src/features/help/manifest.ts`) e renderizada em `/ajuda`
(`docs/20-central-de-ajuda.md` é a norma). **Toda entrega desta fase atualiza a ajuda como
parte do Definition of Done** (doc 20 §10). Regras: frontmatter obrigatório
(`title` ≤60, `description`, `order` múltiplo de 10, `keywords`, `audience`), slug
kebab-case ASCII, e **MDX válido** — sintaxe inválida quebra o `manifest.test.ts` do web
(rodar `pnpm --filter @elemento/web test` antes do push).

### 12.1 Artigos a criar / atualizar

| Ação          | Arquivo                                                       | Conteúdo                                                                                                                                                                                                                                                 |
| ------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Atualizar** | `docs/help/guias/livechat/agente-ia.mdx`                      | A Ana Clara agora **qualifica** o lead e **atualiza o Kanban**. Acrescentar o que ela passou a fazer no funil e o limite (não decide crédito).                                                                                                           |
| **Criar**     | `docs/help/guias/livechat/acoes-do-agente-no-funil.mdx`       | Página nova (audience `[operador, gestor]`): "O que a IA faz no funil e o que é você". Tabela simplificada da fronteira (§4), como a qualificação e o abandono automático aparecem no card, e o aviso de que a IA **não manda mensagem sozinha** (§7.1). |
| **Criar**     | `docs/help/guias/livechat/revisar-e-reverter-acoes-da-ia.mdx` | Página nova (audience `[gestor, admin]`): painel "IA nas últimas 24h", como reverter um abandono/qualificação em 1 clique. Usar `<Permission name="ai_actions:read" />` e `<Permission name="ai_actions:revert" />`.                                     |
| **Atualizar** | `docs/help/conceitos/modulos-liberados.mdx`                   | Explicar a flag `internal_assistant.actions.enabled` (o que muda quando ligada).                                                                                                                                                                         |
| **Atualizar** | `docs/help/conceitos/papeis-e-cidades.mdx`                    | Acrescentar as permissões `ai_actions:*` e `ai_assistant:use` e quais roles as recebem por padrão (espelha §8.B e §12.3).                                                                                                                                |
| **Criar**     | `docs/help/guias/assistente/perguntar-sobre-seus-dados.mdx`   | Página nova (audience `[operador, gestor, admin]`): como usar o **copiloto interno** (§12), com o aviso central de que ele **respeita suas permissões e escopo de cidade** — você só recebe o que já pode ver. `<Permission name="ai_assistant:use" />`. |
| **Criar**     | `docs/help/guias/assistente/o-que-o-copiloto-ve.mdx`          | Página nova (audience `[gestor, admin]`): explicar o modelo de RBAC do copiloto (§12.2/§12.6) e por que respostas variam por role/cidade; e que ele não decide crédito nem escreve no funil.                                                             |

### 12.2 Componentes e convenções

- Usar `<Callout type="warn">` para o limite duro (IA não aprova crédito; não envia outbound).
- Usar `<Permission name="ai_actions:manage" />` na página de configuração dos limiares.
- Fechar cada artigo novo com `<RelatedArticles>` linkando `agente-ia` e `handoff-ia-humano`.
- Ordenar os novos artigos de livechat após os existentes (`agente-ia` order 50,
  `handoff-ia-humano` order 60 → novos em 70, 80).

---

## 14. Fora de escopo (não-metas)

- Decisão de crédito automatizada (aprovar/recusar/valor) — humano, sempre.
- Mensagem outbound autônoma ao cidadão (§7.1) — fase futura separada.
- Movimento de card para Documentação/Análise/Concluído-ganho — humano.
- Acesso a CPF/documentos sensíveis pela IA — proibido por DLP.

---

## 15. Referências

- `docs/06-langgraph-agentes.md` — arquitetura do agente, tools, estado.
- `docs/17-lgpd-protecao-dados.md` — LGPD (normativo, vence conflitos).
- `docs/10-seguranca-permissoes.md` — RBAC, escopo de cidade, validador pós-LLM.
- `docs/09-feature-flags.md` — flags em 4 camadas.
- `docs/05-modulos-funcionais.md` — Kanban, stages, transições automáticas.
- `docs/20-central-de-ajuda.md` — norma da Central de Ajuda in-app (§12).
- `docs/23-notificacoes.md` — engine de notificações (in-app/email), gate de 2 camadas do
  email, retenção (§12.8).
- Código de referência do padrão: `apps/api/src/workers/kanban-on-simulation.ts`,
  `apps/api/src/workers/kanban-on-analysis.ts`.
- RBAC: `apps/api/scripts/seed.ts` (catálogo `PERMISSIONS` + `ROLE_PERMISSIONS`),
  `apps/api/src/modules/roles/` (rotas/serviço), `apps/web/src/features/admin/roles/`
  (UI `/admin/papeis`).
- Flags: `apps/api/src/db/seeds/featureFlags.ts` (catálogo `FLAGS`).
