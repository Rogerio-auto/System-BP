# Planejamento de Evolução — Junho/2026 (CRM, Contratos, Cobrança & SPC)

> **Status:** PROPOSTA para avaliação do Rogério. Não é doc canônico ainda.
> **Autor:** Claude (levantamento sobre o código real em `2026-06-10`).
> **Como ler:** cada item traz (a) o que o Rogério pediu, (b) o que **já existe** no
> código hoje, (c) a proposta, (d) impacto em schema/RBAC/LGPD, (e) esforço e
> dependências. No fim: sequenciamento recomendado e **decisões que preciso de você**.
>
> Nada aqui foi implementado. Quando você aprovar, cada épico vira slots via
> `/hm-tasks` seguindo `tasks/PROTOCOL.md`.

---

## Sumário executivo

| #   | Item                                                                                                | Épico              | Esforço                                            | Tipo                              | O que já existe                                                                                                                                      |
| --- | --------------------------------------------------------------------------------------------------- | ------------------ | -------------------------------------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Cidade do lead visível no CRM/Kanban                                                                | A — CRM & Cadastro | **P** (quick win)                                  | Frontend                          | Form e schema já coletam `city_id`; falta **exibir**                                                                                                 |
| 4   | Lead PJ (CNPJ/razão social) + email obrigatório só no manual + unicidade + bloquear email do agente | A — CRM & Cadastro | **M**                                              | Schema + back + front             | `email` existe (opcional, sem unicidade); sem CNPJ/razão; agentes têm `users.email`                                                                  |
| 2   | Botão de disparo de simulação (WhatsApp)                                                            | B — Simulação      | **M**                                              | Back + front                      | `metaClient.sendTemplate` existe; **não** há endpoint "enviar simulação"                                                                             |
| 3   | Bug de formatação de Real (10000 → R$ 100.000,00)                                                   | C — Correção       | **P** (bug)                                        | Frontend                          | Sem componente único de moeda; máscara ad-hoc                                                                                                        |
| 6   | Marcar qual versão do produto usar                                                                  | D — Produtos       | **P/M**                                            | Back + front                      | `credit_product_rules.version` + `is_active` existem; falta UI de seleção explícita                                                                  |
| 8   | Follow-up por estágio/segmentação                                                                   | G — Follow-up      | **P** (back pronto) / **M** (segmentação profunda) | Frontend (+back)                  | `followup_rules.applies_to_stage`/`applies_to_outcome` **já existem**; front não expõe                                                               |
| 7   | Importar relatório de baixa (concilia por CPF + nº da parcela; telefone/nome como reforço)          | F — Cobrança       | **M/G**                                            | Back + front                      | Módulo `imports` genérico existe; `payment_dues.status='paid'` + `installment_number` existem                                                        |
| 5   | Contratos: assinatura, gestão de boletos, saúde, renovação, drill-down no CRM                       | E — Contratos      | **G** (épico)                                      | Schema + back + front             | **Não há** tabela de contrato; hoje é só `contract_reference` (string) + `customers.metadata`                                                        |
| 9   | SPC + role de cobrança + dashboard + tarefas + notificações                                         | F — Cobrança       | **G** (épico)                                      | Schema + back + front             | `roles` existe (sem `cobranca`); sem tarefas, sem notificações, sem status SPC                                                                       |
| 10  | Escritório de advocacia + envio de contato (humano **e** agente IA autônomo)                        | F — Cobrança       | **G** (épico)                                      | Schema + back + front + LangGraph | Nada existe; agente IA acessa só via `/internal/*`                                                                                                   |
| 11  | Estágio de Kanban (gestão interna) visível no Dashboard e controlável no CRM                        | H — Gestão interna | **P/M**                                            | Frontend (+back leve)             | Dashboard **já** agrega `cardsByStage` (`KanbanBars` montado); `avgDaysInStage` existe e **não é exibido**; CRM muda só `lead.status`, não o estágio |

**Legenda de esforço:** P = pequeno (1–2 slots), M = médio (3–6 slots), G = grande/épico (7+ slots).

**Quick wins recomendados (fazer primeiro, alto valor / baixo custo):** #1, #3, #8 (frontend), #6.

---

## Épico A — CRM & Cadastro de Leads

### A.1 — Cidade do lead visível no CRM e no Kanban (item 1)

**Você pediu:** mostrar de qual cidade o lead veio, no CRM e no cadastro manual; o agente precisa preencher.

**Estado real:**

- O **cadastro já coleta a cidade** e ela é **obrigatória**: `NewLeadModal.tsx` tem o `Select` de cidade `required`, e `LeadCreateSchema` (`packages/shared-schemas/src/leads.ts`) tem `city_id` obrigatório (UUID). ✅
- O **gap é de exibição**: confirmei que `CrmListPage.tsx`, `CrmDetailPage.tsx` e `KanbanCard.tsx` **não mostram a cidade** hoje.

**Proposta:**

- Adicionar a cidade na **lista do CRM** (coluna), na **ficha do lead** (`CrmDetailPage`) e no **card do Kanban** (chip discreto, ex: "Porto Velho").
- A API de listagem precisa devolver o `city_name` junto (hoje `LeadResponse` traz só `city_id`). Opções: (a) join na query de listagem e estender o response; (b) resolver pelo cache de cidades no front (`useCitiesList`). Recomendo **(a)** para a lista (uma query) e **(b)** no card para evitar refetch.

**Impacto:** baixo. Sem migration. Estender `LeadResponseSchema`/`LeadListResponse` (drift front×API — ver `feedback_parallel_contract_drift`).

**Esforço:** P (1 slot front + ajuste de response).

---

### A.2 — Lead PJ, email obrigatório no manual, unicidade e bloqueio do email do agente (item 4)

**Você pediu (decomposto):**

1. Campos de **empresa** no lead: **CNPJ** e **razão social**.
2. **Email obrigatório só no cadastro manual** feito pelo agente — em outras origens (WhatsApp, import, API) continua **opcional**.
3. **Email único** no banco — não pode o mesmo email repetido.
4. O agente **não pode usar o email dele** — tem que ser o email do cliente. Para isso, **cadastrar o email pessoal de cada agente** e bloquear.

**Estado real:**

- `leads.email` é `citext` **opcional**, **sem índice único** (só telefone tem dedupe: `uq_leads_org_phone_active`).
- **Não há** colunas de CNPJ/razão social. Hoje caberia em `metadata` (jsonb), mas dado estruturado de PJ merece coluna.
- Agentes **já têm email**: `agents.user_id → users.email`. Ou seja, a "lista de emails de agentes a bloquear" já existe no banco — é `users.email` da org.

**Proposta:**

_Schema (db-schema-engineer):_

- Adicionar a `leads`: `cnpj_encrypted` (bytea, cifrado — CNPJ é dado de PJ; seguir o mesmo padrão LGPD de CPF, doc 17 §8.1), `cnpj_hash` (HMAC para dedupe), e `legal_name` (razão social, text). _Decisão aberta D1: tratamos CNPJ como PII cifrada (recomendo sim, consistência) ou texto claro?_
- Índice **único parcial** em `(organization_id, lower(email))` `WHERE email IS NOT NULL AND deleted_at IS NULL` para unicidade de email entre leads.

_Validação condicional por origem (backend + shared-schema):_

- Hoje `LeadCreateSchema` é único para todas as origens. Proposta: **email obrigatório quando `source = 'manual'`** via `superRefine` (mantém opcional para `whatsapp`/`import`/`api`).
- **Bloqueio do email do agente:** no service de criação, rejeitar (`422`/`409`) se o email informado **bater com qualquer `users.email` da org** (não só o do agente logado — evita ele usar o email de um colega também). Mensagem clara: "Use o email do cliente, não um email interno."
- **Unicidade entre leads:** tratar violação do índice único como `409 LEAD_EMAIL_DUPLICATE` (espelha o padrão atual de `LEAD_PHONE_DUPLICATE`).

_Frontend:_

- `NewLeadModal`: tornar email **required** (já que o modal é o cadastro manual); adicionar seção **"Pessoa Jurídica (opcional)"** com CNPJ (máscara) e razão social. Tratar os dois novos erros inline (email duplicado / email interno).

**Impacto LGPD:** CNPJ entra na lista de PII se cifrarmos; atualizar `pino.redact` e checklist §14.2 do doc 17. CNPJ de PJ é menos sensível que CPF, mas como pode haver CPF de sócio, recomendo cifrar.

**Impacto RBAC:** nenhum novo; criação de lead já é escopada por cidade.

**Esforço:** M (1 slot schema + 1 back + 1 front). Dependência: nada.

**Decisões abertas:**

- **D1:** CNPJ cifrado (recomendado) vs texto claro. R= Pode ser texto claro, não tem importancia
- **D2:** unicidade de email é **por organização** (recomendado, multi-tenant) ou global? Recomendo por org. R= Por organização mesmo
- **D3:** o bloqueio considera **todos os emails internos da org** (recomendado) ou só o do agente logado? R= De todos agentes da organização. Os email logado é disponibilizado pela empresa, então pode acontecer do agente querer colocar o pessoal dele, mas tem que ser cobrado dele no primeiro login, o email pessoal dele e ja travar tambem. assim ele é obrigado a por o email real disponibilizado pelo cliente

---

## Épico B — Disparo de Simulação por WhatsApp (item 2)

**Você pediu:** quando uma simulação for criada manualmente, um botão para **enviar ao cliente uma mensagem com as informações da simulação**.

**Estado real:**

- Existe simulação manual: `POST /api/simulations` (`simulations/routes.ts`).
- Existe envio de template Meta: `templates/metaClient.ts` (`sendTemplate`) e o motor de envio usado por cobrança/follow-up.
- **Não há** endpoint que envie a simulação ao lead.

**Proposta:**

- **Template Meta** "resultado de simulação" (variáveis: nome, valor, parcelas, valor da parcela, taxa). Precisa ser aprovado na Meta — mesma esteira de `whatsapp_templates`.
- Endpoint `POST /api/simulations/:id/send` (RBAC: `simulations:send` ou reaproveitar permissão de simulação): monta as variáveis a partir da simulação + lead, chama `metaClient.sendTemplate`, registra a interação na timeline (`interactions`) e idempotência (header `Idempotency-Key`, regra inviolável #7).
- **Botão "Enviar ao cliente"** na tela de resultado da simulação manual (`SimulatorResult.tsx` / detalhe da simulação no CRM) — só habilitado quando o lead tem telefone e o template está aprovado.
- **Gating** por feature flag (4 camadas, regra #6) — coerente com como cobrança/follow-up já fazem o triple-gate.

**Impacto LGPD:** mensagem ao titular = tratamento; sem PII no outbox bruto; valores financeiros ok. DLP não se aplica (não vai a LLM).

**Esforço:** M (1 template + 1 back + 1 front). Dependência: template aprovado na Meta (processo externo, pode usar mock em dev).

**Decisão aberta D4:** o envio usa **template aprovado** (obrigatório fora da janela de 24h da Meta) — confirmo que criaremos um template dedicado de simulação, certo? R= Sim, criaremos um template que ficara pra uso dessa função no sistema, porem precisa ter onde vincular esse template dentro do sistema tambem.

---

## Épico C — Correção do formato de Real (item 3) 🐞

**Você pediu:** ao digitar `10000` e salvar, aparece `R$ 100.000,00` (×10). Corrigir na **hora de inserir** e nos demais lugares onde o valor é exibido após salvar.

**Estado real / diagnóstico:**

- **Não existe** um componente único de input de moeda (`CurrencyInput`/`MoneyInput`) no projeto — a busca não achou nenhum. A formatação é **ad-hoc** por tela.
- O `DecideModal` (aprovação da análise) usa `type="number"` puro com `parseFloat` — esse está **correto**. O bug ×10 vem de **outra** tela com máscara manual (provável: campo de valor da simulação/parcela que trata o input como centavos e ainda re-renderiza formatado, gerando o deslocamento de casa).
- Preciso **reproduzir** para cravar a linha exata (qual tela você viu o `10000 → 100.000,00`? Simulação manual? Cadastro de parcela? Valor aprovado?). R= Foi na simulação manual onde não formata o valor na hora do input e na hora de criar a analise, acontece a mesma coisa.

**Proposta (corrige a causa-raiz, não só o sintoma):**

- Criar **um componente canônico** `CurrencyInput` (em `components/ui/`) e um par de helpers em `lib/format/money.ts`:
  - `formatBRL(valueInReais)` → `"R$ 1.234,56"` (via `Intl.NumberFormat('pt-BR')`).
  - `parseBRLInput(masked)` → número em **reais** (decisão de representação: internamente trabalhar com **centavos inteiros** para nunca ter erro de float, convertendo na borda).
- **Migrar todas as telas de valor** para esse componente (simulação, parcela/boleto, valor aprovado na análise, etc.) e **auditar os pontos de exibição** que usam `toLocaleString` solto (a busca achou ~15 arquivos com `toLocaleString`).
- Adicionar **teste** que digita `10000` e garante que persiste/exibe `R$ 10.000,00` (regressão travada — `regression-guard`).

**Impacto:** frontend; sem schema. A API já usa `numeric(14,2)` corretamente (`payment_dues.amount`, `min/max_amount`), então o problema é **só de máscara/exibição** no front.

**Esforço:** P (bug) — mas vira M se formos migrar todas as telas para o componente único (recomendado para não repetir o bug).

**Decisão aberta D5:** representação interna em **centavos inteiros** (recomendado) vs `number` em reais.

---

## Épico D — Versão do produto de crédito a usar (item 6)

**Você pediu:** ao configurar o produto/tipo de crédito, poder **marcar qual versão usar**. Hoje não tem.

**Estado real:**

- `credit_product_rules` já é **versionado**: coluna `version` (sequencial por produto) + `is_active` (bool) + `effective_from/effective_to`. A regra "qual versão vale" hoje é **implícita** (`is_active = true`, validado na service layer, comentário no schema: "apenas 1 versão `is_active` por produto+cidade").
- Frontend já tem `ProductList.tsx`, `RuleTimeline.tsx`, `PublishRuleDrawer.tsx` — ou seja, publica nova versão, mas **não há controle explícito de "ativar esta versão"** (reativar uma anterior, por ex.).

**Proposta:**

- Endpoint `POST /api/products/:id/rules/:version/activate` (RBAC admin): transação que seta a versão escolhida como `is_active=true` e desativa as demais (respeitando `city_scope`). Auditoria + idempotência.
- UI: na `RuleTimeline`, botão **"Usar esta versão"** em cada versão histórica, com badge de "versão vigente". Confirmar com modal (mudança sensível — afeta novas simulações).

**Impacto:** simulações antigas **não** mudam (capturam `rule_version_id` imutável — já é assim). Só novas simulações passam a usar a versão marcada. Sem migration (campos já existem).

**Esforço:** P/M (1 back + 1 front).

**Decisão aberta D6:** ao "usar uma versão antiga", criamos **uma cópia como nova versão** (mantém histórico linear, recomendado para auditoria de crédito) ou **reativamos a linha antiga** (mais simples, mas quebra a linearidade de versões)? Recomendo **cópia** — coerente com a imutabilidade documentada no schema.

---

## Épico E — Contratos, Boletos e Renovação (item 5) — **ÉPICO**

**Você pediu (decomposto):**

1. Quando o cliente **assina o contrato**, o agente **aciona no sistema** que foi assinado → aparece na aba de contratos.
2. **Verificação de fim de contrato** → o sistema sugere **vender um novo crédito** ao cliente antigo (Everton: "mais fácil vender para cliente antigo").
3. Na tela de contrato: **gestão dos boletos** + **saúde do boleto** do cliente.
4. Tudo isso **visível no CRM**: clicar na linha do cliente e ver dados, histórico, registros e **os boletos** daquele cliente depois da análise fechada.
5. **Cadastro de boletos** na tela de contratos quando o contrato fecha, refletido no CRM.

**Estado real:**

- **Não existe entidade "contrato"**. Hoje o "contrato" é apenas:
  - `payment_dues.contract_reference` (string, ex: "BDP-2026-12345") +
  - `customers.metadata` (`contract_number`, `loan_amount_brl`, `term_months`...).
- `customers` é só um "marcador de conversão" apontando para o lead (decisão documentada no schema). Não tem valor, prazo, datas de contrato como colunas.
- **Boletos já têm suporte** em `payment_dues` (campos `boleto_url`, `boleto_media_id`, `boleto_digitable_line`, `pix_copia_cola`, `boleto_filename`, `boleto_attached_at`) — F5-S10. Mas o "cadastro/anexo de boleto" e a "saúde" precisam de UI.

**Proposta (faseável):**

_E.1 — Entidade Contrato (schema + back):_

- Nova tabela `contracts`: `customer_id`, `contract_reference` (única por org), `product_id`/`rule_version_id` (qual produto/versão originou), `principal_amount`, `term_months`, `monthly_rate_snapshot`, `status` (`draft` → `signed` → `active` → `settled`/`defaulted`/`cancelled`), `signed_at`, `first_due_date`, `last_due_date`, datas de auditoria. `payment_dues.contract_id` passa a referenciar essa tabela (hoje é só string solta).
- Migrar `contract_reference` (string) → FK `contract_id` (backfill a partir das parcelas existentes).

_E.2 — Assinatura (back + front):_

- Ação **"Marcar como assinado"** (RBAC: agente/gestor): `status: signed`, `signed_at`, auditoria. Aba **Contratos** lista por status.

_E.3 — Gestão e saúde de boletos:_

- Na ficha do contrato: lista de `payment_dues` com anexar/editar boleto (reaproveita campos F5-S10) e um **indicador de saúde** derivado: em dia / a vencer / vencido / inadimplente (n parcelas vencidas), % pago. Isso é um cálculo de agregação sobre `payment_dues.status` + `due_date`.

_E.4 — CRM drill-down do cliente:_

- Na linha do cliente no CRM, abrir ficha com: dados, histórico (`lead_history`, `interactions`), contrato(s) e **boletos**. Conecta `customers` ↔ `contracts` ↔ `payment_dues`. Hoje o CRM é centrado em **lead**; precisa de uma visão **cliente** (pós-conversão).

_E.5 — Renovação / re-venda (win-back):_

- Job/visão que detecta contratos perto do fim (`last_due_date` próxima ou % pago alto) e gera uma **oportunidade**: card no Kanban / tarefa para o agente / sugestão de nova simulação pré-preenchida. Casa com o Épico B (disparo de simulação) e com o sistema de **tarefas** do Épico F.9.

**Impacto LGPD:** contrato e boletos contêm PII financeira; retenção 5 anos (já documentado em `payment_dues`); `pino.redact`; outbox só com IDs.

**Impacto RBAC:** novas permissões `contracts:read/write/sign`. Escopo de cidade via `customer → lead → city_id`.

**Esforço:** **G** (épico, ~8–12 slots): schema + migração de `contract_reference`, back (CRUD + assinatura + saúde), front (aba contratos + ficha cliente no CRM + win-back). Recomendo quebrar em sub-fases E.1→E.5.

**Decisões abertas:**

- **D7:** contrato é **1:1** com customer (um empréstimo por cliente por vez) ou **1:N** (cliente pode ter vários contratos ao longo do tempo)? O win-back ("vender de novo") sugere **1:N** — recomendo 1:N.
- **D8:** o "fim de contrato" que dispara win-back é por **data** (`last_due_date`), por **% quitado**, ou **N parcelas restantes**? (Provavelmente "última parcela paga" ou "faltam X parcelas".)

---

## Épico F — Cobrança Avançada: Baixa, SPC, Role, Tarefas, Advocacia

Este é o bloco mais denso. Agrupa itens 7, 9 e 10 porque compartilham domínio (cobrança), o **role de cobrança** e o **sistema de tarefas/notificações**.

### F.1 — Importar relatório de baixa (item 7)

**Você pediu:** o relatório de baixas de boletos é subido **semanalmente**; ao importar, o sistema **desmarca automaticamente** os boletos cobrados (dá baixa). Mapear colunas conforme o relatório.

**Campos do relatório que batem com nosso banco (confirmado pelo Rogério):**

- **Nome** do cliente.
- **Telefone** no formato `(69) 9.9999-9999` (DDD + celular, **sem** o DDI 55).
- **CPF** (em formato diferente do nosso — provavelmente com máscara `000.000.000-00`).
- **Número da parcela em atraso** — o relatório informa **qual parcela** está sendo baixada. ⭐ Isso muda a estratégia: não precisamos adivinhar "qual parcela dar baixa" quando o cliente tem várias em aberto — o relatório diz.

**Estado real:**

- Módulo `imports` genérico já existe (`controller/service/repository/schemas/routes` + `importBatches`/`importRows` + UI com **mapeamento de colunas** em `features/imports/StepConfirm.tsx`).
- `payment_dues.status = 'paid'` + `paid_at` já modelam a baixa; `payment_dues.installment_number` é exatamente o "número da parcela" que o relatório traz.
- Conciliação por **CPF**: temos `cpf_hash` no lead e `document_hash` no customer (HMAC). `hashDocument(cpf normalizado)` → casa com `customers.document_hash` (chave forte).
- Telefone: `leads.phone_normalized` guarda **só dígitos com DDI** (`5569999999999`). O relatório vem **sem** o 55 (`69999999999`) — a normalização precisa **prefixar o DDI 55** (ou casar por sufixo) antes de comparar.

**Proposta:**

_Normalização das chaves (borda de importação):_

- **CPF:** strip de tudo que não é dígito → `hashDocument(cpf)` → `customers.document_hash`.
- **Telefone:** strip de não-dígitos → se vier com 10–11 dígitos (DDD + número, sem DDI), **prefixar `55`** → comparar com `leads.phone_normalized`. Tratar o `9` extra de celular com tolerância (alguns cadastros legados podem não ter o nono dígito).
- **Nome:** normalizado (sem acento, caixa baixa) só para **desempate/validação**, nunca como chave primária.

_Estratégia de conciliação em camadas (chave forte → reforço):_

1. **CPF (hash)** identifica o **customer**. Chave primária.
2. **Número da parcela** do relatório + customer → identifica a **parcela exata** (`payment_dues` por `customer_id` + `installment_number`). Marca `paid` + `paid_at`.
3. **Telefone e nome** servem de **reforço/validação** (confirmam que o CPF casou com a pessoa certa) e de **fallback** quando o CPF vier ilegível/ausente na linha.
4. **Cancela `collection_jobs` pendentes** daquela parcela (é o "desmarcar o que está para ser cobrado").
5. **Idempotência por batch** — re-subir o mesmo relatório não dá baixa duplicada nem reabre parcela já paga.

_Fluxo (reaproveita `imports`):_ upload → mapear colunas (nome, telefone, CPF, nº da parcela) → preview com PII mascarada (`lib/format/pii.ts` já mascara CPF/telefone/email) → confirmar → **relatório de resultado**: quantas linhas casaram, quantas não encontradas (CPF/telefone divergente, parcela inexistente ou já paga) — para o time tratar manualmente.

**Risco e mitigação:** o CPF como chave forte (hash) + número da parcela explícito do relatório reduz muito a ambiguidade (resolve o caso "cliente com 2 contratos / várias parcelas"). Riscos restantes: CPF mal formatado na origem, telefone sem nono dígito, e **colisão de `installment_number` entre contratos diferentes do mesmo cliente** (se um cliente tiver 2 contratos, ambos têm "parcela 3"). Mitigação para esse caso: usar também `contract_reference`/valor se vierem no relatório; senão, logar como ambíguo para revisão manual. **A regra exata fica travada quando o Rogério trouxer o exemplo real (D10).**

**Esforço:** M/G (1 schema leve + 1–2 back de conciliação + 1 front). Dependência: o Épico E (contrato) ajuda a desambiguar múltiplos contratos, mas a baixa funciona direto sobre `payment_dues`.

**Decisões abertas:**

- **D9 (atualizada):** o relatório **traz o número da parcela em atraso**, então a baixa é feita na **parcela exata informada** (não mais "a mais antiga"). Caso restante: **cliente com >1 contrato** e mesma numeração de parcela — aí precisamos de `contract_reference`/valor para desambiguar. **Decisão do Rogério: por enquanto fazer "como der" (casar pela parcela informada; ambíguo → logar para revisão manual), e travar a regra definitiva com base no exemplo real.** ✅ autorizado seguir assim por ora.
- **D10:** o Rogério vai trazer **um exemplo real (anonimizado) do relatório de baixa** (cabeçalhos das colunas) — define o mapeamento definitivo e fecha o caso de múltiplos contratos. ⏳ pendente.

---

### F.2 — Role de Cobrança + Dashboard + Status SPC (item 9)

**Você pediu:**

- Um **role específico** do departamento de cobrança, com **métricas próprias no dashboard**: clientes pendentes de pagamento, quais vencendo, quais cobrados, quais ainda não cobrados; ver a **régua de cobrança** do cliente; ver se o cliente está **no SPC**.
- **Status/Tag de SPC** no cliente (avaliar tag vs status). A cobrança insere o cliente no SPC **após 15 dias** de vencimento; o sistema deve **auxiliar/notificar**.
- **Notificação explícita** + possivelmente **sistema de tarefas** para o agente de cobrança executar (ex: "inserir fulano no SPC") — e a tarefa **não some** enquanto não for marcada como cumprida.

**Estado real:**

- `roles` existe com keys canônicas (`admin`, `gestor_geral`, `gestor_regional`, `agente`, `operador`, `leitura`) — **sem** `cobranca`. Adicionar role é precedente conhecido (doc 10 §3.1).
- Dashboard existe (`features/dashboard`, `useDashboardMetrics`) — mas com métricas gerais, não de cobrança.
- **Não há** status/tag de SPC, **não há** sistema de tarefas, **não há** notificações in-app.

**Proposta:**

_F.2a — Role + permissões:_

- Novo role `cobranca` com **escopo global** (visão centralizada da carteira inteira — D11 ✅; cobrança não é city-scoped). Permissões `billing:read`, `billing:reconcile`, `spc:manage`, `tasks:*`. Seguir o padrão de seed de permissions + migration.

_F.2b — Status SPC no cliente:_

- Recomendo **status dedicado** em vez de tag livre: coluna `spc_status` em `customers` (`none` → `pending_inclusion` → `included` → `removed`) + `spc_changed_at` + auditoria. Motivo: SPC tem ciclo de vida e datas (incluído em / removido em) que uma tag não modela bem. Uma "tag" visual no CRM pode ser **derivada** desse status.
- Regra "15 dias": quando uma parcela passa de 15 dias vencida e o cliente está `none`, o sistema **cria uma tarefa** (F.2d) + **notifica** o time de cobrança para incluir no SPC. Não automatizamos a inclusão real (é ação externa no Serasa/SPC) — o sistema **auxilia e rastreia**.

_F.2c — Dashboard de cobrança:_

- Visão dedicada ao role `cobranca`: cards/listas de "vencendo (D-3..D0)", "vencidos não cobrados", "cobrados (jobs enviados)", "inadimplentes 15+ dias", "no SPC". Tudo derivável de `payment_dues` + `collection_jobs` + `customers.spc_status`. Mostrar a **régua de cobrança** do cliente (já temos `collection_rules`/`collection_jobs`).

_F.2d — Sistema de Tarefas (novo, transversal) — atribuição por role + escopo regional:_

- **Modelo de atribuição (decisão D14):** a tarefa é atribuída a um **role** (ex: `cobranca`/`agente`) **dentro de uma cidade** — não a um usuário específico, e não à org inteira. Numa cidade com 2 atendentes, **ambos** veem e podem assumir a mesma tarefa daquele cliente. Reaproveita exatamente o modelo de `user_city_scopes` que já existe (regional).
- Nova tabela `tasks`: `organization_id`, **`assignee_role`** (quem é responsável), **`city_id`** (escopo regional — quem daquele role + cidade enxerga; NULL = global, para tarefas centralizadas), `type` (`spc_inclusion`, `spc_removal`, `winback`, `lawyer_handoff`, `custom`...), `entity_type`/`entity_id` (cliente/contrato/parcela), `title`, `due_at`, `status` (`open` → `done`/`cancelled`), **`claimed_by`** (quem assumiu, opcional — para evitar dois atendentes fazendo a mesma coisa), `completed_by`/`completed_at`.
- **Resolução de "minhas tarefas":** um usuário vê uma tarefa quando tem o `assignee_role` **e** (a tarefa é global **ou** a `city_id` da tarefa está no seu `user_city_scopes`). Mesma lógica de city-scope já aplicada nas rotas (regra #3).
- Tarefa **persiste e fica visível** até ser concluída (seu requisito: "enquanto não foi executada, não some").
- UI: painel de tarefas (badge de pendências bem visível, conforme você pediu — "bem aparente"). Quando alguém **assume** (`claimed_by`), os colegas da cidade veem "em andamento por Fulano" mas a tarefa continua compartilhada. Reaproveitável por outros roles/épicos (win-back do Épico E, advocacia da F.3).

_F.2e — Notificações (novo, transversal) — in-app + e-mail + WhatsApp (decisão D12):_

- Nova tabela `notifications` (in-app) + endpoint de "minhas notificações" + badge no header.
- **Canais (decisão D12):** além do in-app, a notificação também sai por **e-mail e WhatsApp** para o time interno. Modelar como **fan-out por canal** a partir do mesmo evento de outbox: cada canal vira um sender (in-app grava a linha; e-mail via provedor de e-mail; WhatsApp via `metaClient`/template aprovado para time interno). Preferências de canal por usuário/role (quem quer e-mail, quem quer WhatsApp) — começar com default "todos os canais" e refinar depois.
- Disparadas via **outbox** (regra #2) a partir de eventos (`payment_due.overdue_15d`, `task.created`, `task.assigned`...), respeitando o escopo regional da tarefa (só notifica quem é do role + cidade).
- **LGPD:** WhatsApp/e-mail para o time interno carrega referência ao cliente — sem PII bruta no payload do outbox; o conteúdo final é montado no sender com `pino.redact` aplicado aos logs.

**Impacto:** alto — toca RBAC, dashboard, e cria 2 subsistemas reutilizáveis (tarefas + notificações). Por isso recomendo tratá-los como **fundação** que os Épicos E (win-back) e F.3 (advocacia) consomem.

**Esforço:** **G** (épico, ~10–14 slots).

**Decisões abertas:**

- **D11:** role `cobranca` enxerga **todas as cidades** (cobrança costuma ser centralizada — recomendo `global`) ou é city-scoped?
- **D12:** notificações MVP só in-app vs in-app + WhatsApp/email. **R= in-app + e-mail + WhatsApp.** ✅ (fan-out por canal — ver F.2e)
- **D13:** SPC como **status dedicado** vs tag livre. **R= status dedicado** (`customers.spc_status`). ✅
- **D14:** tarefas atribuídas a role e/ou a usuário específico. **R= atribuída a role, mas com escopo regional (cidade).** Os responsáveis daquele role **naquela cidade** ficam donos da tarefa juntos (ex: 2 atendentes da mesma cidade compartilham a tarefa de um cliente local). ✅ (ver F.2d — `assignee_role` + `city_id` via `user_city_scopes`)

---

### F.3 — Escritório de advocacia + envio de contato ao inadimplente (item 10)

**Você pediu:** quando o cliente fica **muito tempo sem pagar**, manda-se o **contato do advogado** (do escritório vinculado) para o cliente conversar. Cadastrar escritórios de advocacia + o número do advogado. **Dois mecanismos de envio:**

1. **Agente humano** cria o vínculo escritório↔cliente quando o **sistema notifica** que o cliente está vencido (ex: +15 dias) e dispara o contato.
2. **Agente de IA (LangGraph)** assume isso sozinho: quando o cliente **vinculado e inadimplente voltar a entrar em contato** (WhatsApp), o agente de IA **já manda o contato do advogado automaticamente** — o agente humano **não precisa** intervir nem conversar com esse cliente.

**Estado real:** nada existe. O agente IA (LangGraph) já tem nós/tools e acessa o backend só via `/internal/*` (regra inviolável #1) — é onde a nova capacidade entra.

**Proposta:**

_F.3a — Cadastro e vínculo (schema + back + front):_

- Schema: `law_firms` (escritório: nome, contato, cidade/comarca de abrangência) e opcionalmente `lawyers` (advogado: nome, telefone, escritório).
- **Vínculo escritório↔cliente:** `law_firm_id` no cliente/contrato (ou tabela de vínculo `customer_law_firm` com data, quem vinculou, motivo). O vínculo é criado de duas formas:
  - **Manual** pelo agente humano, a partir da **notificação/tarefa** de "cliente vencido +15d" (gerada pela fundação F.2 — SPC/tarefas). Reaproveita o sistema de tarefas regional (F.2d).
  - **Sugestão automática por cidade/comarca:** quando há um escritório padrão para a cidade, o sistema pré-seleciona (o humano só confirma). **D15 ✅: padrão por cidade + ajuste manual** (o agente pode trocar o escritório caso a caso).

_F.3b — Envio pelo agente humano:_

- Ação **"Encaminhar para advocacia"** na ficha do inadimplente: registra o encaminhamento (auditoria: quem, quando, qual escritório) e **envia ao cliente** (WhatsApp via `metaClient`, template aprovado) o contato do advogado. Reaproveita a esteira de envio do Épico B.

_F.3c — Envio autônomo pelo agente de IA (LangGraph):_ ⭐ o ponto novo

- Novo endpoint `/internal/*` que, dado um lead/cliente, responde: **"este contato está inadimplente E tem escritório de advocacia vinculado para repasse?"** (e qual o contato do advogado). Sem PII bruta além do necessário; respeita DLP.
- Novo **nó/tool no grafo LangGraph** (ex: `lawyer_handoff`): quando um lead que é cliente **inadimplente vinculado** envia mensagem, o roteador do agente detecta a situação e responde **enviando o contato do advogado** em vez de seguir o fluxo normal de atendimento/simulação. Sem handoff humano.
- **Guard-rails (D17 ✅):** o agente IA **cumprimenta e confirma que é a pessoa certa antes** de enviar o contato do advogado (não dispara cru na 1ª mensagem). Só dispara se (a) há vínculo ativo, (b) inadimplência confirmada, (c) feature flag ligada (regra #6, 4 camadas). **Cooldown de 7 dias** + registro de "já encaminhado" para não reenviar a cada mensagem (idempotência).
- Registrar a ação em `ai_decision_logs` (auditoria de decisão automatizada — coerente com o que já existe) e na timeline `interactions`.

**Gatilho de elegibilidade:** inadimplência > X dias (provavelmente já no SPC — liga com F.2b). Pode gerar **tarefa** (F.2d) para o humano quando o vínculo ainda não existir.

**Impacto LGPD:** dois pontos sensíveis — (1) compartilhar dado do titular com escritório (terceiro) = nova base/finalidade; (2) **decisão/comunicação automatizada pelo agente IA** ao titular sobre cobrança. Ambos precisam de base legal (execução de contrato/cobrança), registro, e o agente IA respeitar DLP (nada de PII bruta ao gateway LLM) e direito à revisão humana (Art. 20). **Avaliar com o doc 17 §12 antes de implementar.**

**Impacto arquitetura:** toca o serviço **LangGraph** (apps/langgraph-service) + endpoint `/internal/*` no backend — não é só CRUD. Por isso o esforço sobe.

**Esforço:** **G** (1 schema + back vínculo/envio + endpoint `/internal` + nó LangGraph + front de cadastro/vínculo). Depende de B (envio), F.2 (tarefas/SPC) e do agente IA.

**D15 ✅ Respondida:** vínculo por **cidade/comarca (padrão sugerido) + ajuste manual** caso a caso.
**D17 ✅ Respondida:** o agente IA dispara **após cumprimentar/confirmar** que é a pessoa (não na 1ª mensagem crua), com **cooldown de 7 dias** para não reenviar.

---

## Épico G — Follow-up por estágio e segmentação (item 8)

**Você pediu:** poder cobrar/contatar via follow-up **de acordo com o estágio** do Kanban (e estados específicos). Hoje o frontend não deixa marcar isso. Quer **segmentação mais profunda** — escolher o momento/estágio exato.

**Estado real:**

- O **backend já suporta**: `followup_rules.applies_to_stage` e `applies_to_outcome` existem no schema e o scheduler os respeita. ✅
- O **gap é no frontend**: o form de regra de follow-up não expõe esses filtros (e o seed cria regras `applies_to_stage='Documentação'`/`'Simulação'`, então o conceito já roda).

**Proposta:**

- **Quick win:** expor `applies_to_stage` (dropdown com os `kanban_stages`) e `applies_to_outcome` no form de regras de follow-up (`features/followup`). Isso já entrega "follow-up por estágio".
- **Segmentação profunda (fase 2):** evoluir de filtros simples (stage + outcome) para um **construtor de segmento** com múltiplos critérios (cidade, status do lead, faixa de valor, tempo no estágio, origem). Isso é maior — provavelmente um campo `segment` (jsonb) na regra + um avaliador no scheduler. Mesmo conceito serviria à cobrança.

**Esforço:** P para o quick win (1 front); M/G para o construtor de segmento.

**D16 ✅ Respondida:** começamos expondo **stage + outcome** (valor imediato, backend pronto) e deixamos o **construtor de segmento** para a fase 2.

---

## Épico H — Estágio de Kanban (gestão interna) no Dashboard e CRM (item 11)

**Você notou:** no dashboard você só viu métricas dos **status de atendimento**, não dos **estágios de Kanban** (quantos clientes em cada estágio). E no CRM você só muda os "estágios de atendimento", não o estágio de Kanban (gestão interna). Quer essa visão de gestão interna em mais lugares.

**Conceito (importante — são duas coisas distintas):**

- **Status de atendimento** = `lead.status` (`new` → `qualifying` → `simulation` → `closed_won`/`closed_lost`/`archived`). É o estado comercial do lead.
- **Estágio de Kanban** = `kanban_stages` (Pré-atendimento → Simulação → Documentação → Análise de crédito → Concluído). É a **gestão interna** do fluxo de trabalho da equipe. Cada lead tem um `kanban_card` num estágio.
- Hoje os dois andam meio em paralelo; você quer o **estágio de Kanban** mais visível e controlável fora do board.

**Estado real (verifiquei no código):**

- **Dashboard — já existe, provavelmente estava vazio quando você olhou:** o backend **já agrega** cards por estágio (`countKanbanCardsByStage` em `dashboard/repository.ts`) e o componente **`KanbanBars`** ("Cards no kanban por estágio") **está montado** na `DashboardPage` (grid de gráficos). Quando o Kanban está **sem cards**, ele renderiza "Sem cards no Kanban." — como você rodou o `seed-demo` só agora, é quase certo que o board estava vazio na hora e por isso "sumiu". ✅ existe.
- **Métrica não exibida:** o backend **também já calcula** `avgDaysInStage` (tempo médio por estágio) e o tipo está no response (`kanban.avgDaysInStage`), mas **nenhum componente exibe** isso. É uma métrica de gestão interna valiosa (gargalos do fluxo) que está pronta no back e desperdiçada.
- **CRM — confirmado:** `CrmListPage`/`CrmDetailPage` operam sobre `lead.status`; a mudança de **estágio de Kanban** só acontece no board (drag & drop em `KanbanPage`). No CRM não dá para ver nem mudar o estágio.

**Proposta:**

_H.1 — Dashboard (reforçar o que já existe):_

- Garantir destaque do `KanbanBars` (e melhorar o estado vazio para não parecer "inexistente").
- **Exibir o `avgDaysInStage`** (tempo médio por estágio) — novo componente, dados já vêm no response. Mostra gargalos ("leads param 8 dias em Documentação").
- Opcional: KPIs de gestão interna no `StatsRow` (ex: total de cards ativos no board, cards parados há +N dias).

_H.2 — CRM mostra e controla o estágio de Kanban:_

- Na **lista** e na **ficha** do CRM, exibir o **estágio de Kanban atual** do lead (chip), além do status de atendimento.
- Permitir **mudar o estágio** a partir do CRM (não só arrastando no board) — reaproveita a mutação que o `KanbanPage` já usa (`useKanbanCards`/move). Respeita RBAC: a **equipe interna humana** move o estágio (D18 ✅: **quem já edita o lead** pode mover); o agente IA controla "até certo ponto" (já existe `assignee`/automação no Kanban).
- **D18 ✅: status de atendimento e estágio de Kanban ficam INDEPENDENTES** — mover o estágio não altera o status automaticamente (evita efeito colateral; a equipe controla cada um). Deixar visualmente clara a diferença **status de atendimento × estágio de Kanban** para não confundir o operador.

**Estado real ajuda muito:** boa parte é **frontend + exibir dado que o backend já produz**. A mudança de estágio pelo CRM reusa a mutação existente do Kanban.

**Impacto:** baixo/médio. Pouco ou nenhum schema (kanban já existe). Possível ajuste leve de response (trazer `stage` do lead na listagem do CRM — drift front×API).

**Esforço:** P/M (1 front dashboard avgDays + 1 front CRM estágio + ajuste leve de response).

**D18 ✅ Respondida:** **quem já edita o lead** pode mover o estágio no CRM; status de atendimento e estágio de Kanban ficam **independentes** (sem sincronização automática).

---

## Temas transversais (valem para tudo)

- **LGPD (doc 17):** itens 4 (CNPJ), 5 (boletos/contrato), 7 (baixa com CPF), 9 (SPC), 10 (advocacia) tocam PII. Cada slot que toca PII passa pelo checklist §14.2. Advocacia (compartilhamento com terceiro) e SPC merecem revisão explícita de base legal.
- **RBAC + escopo de cidade (regra #3):** todo endpoint novo aplica `applyCityScope`. Cobrança provavelmente `global`.
- **Outbox (regra #2):** eventos novos (parcela vencida 15d, tarefa criada, contrato assinado, encaminhamento advocacia) saem por outbox, sem PII bruta.
- **Idempotência (regra #7):** envios (simulação, advocacia) e baixa de relatório precisam de chave de idempotência.
- **Drift front×API (`feedback_parallel_contract_drift`):** todo response estendido (cidade no lead, contrato, etc.) — o front lê o **schema Zod real** da API.
- **Feature flags (regra #6):** funcionalidades novas de disparo nascem atrás de flag.

---

## Sequenciamento recomendado

**Onda 1 — Quick wins (valor imediato, baixo risco):**

1. Item 3 — bug de moeda (com componente `CurrencyInput` canônico). 🐞
2. Item 1 — cidade visível no CRM/Kanban.
3. Item 8 — follow-up por estágio (expor stage/outcome — backend pronto).
4. Item 6 — marcar versão do produto.
5. Item 11 — estágio de Kanban no dashboard (`avgDaysInStage`) e no CRM (maioria é exibir dado que o back já produz).

**Onda 2 — Cadastro e simulação:** 5. Item 4 — lead PJ + email obrigatório no manual + unicidade + bloqueio email interno. 6. Item 2 — disparo de simulação por WhatsApp.

**Onda 3 — Fundação de cobrança (habilita o resto):** 7. Item 7 — importar relatório de baixa. 8. Item 9 (parte fundação) — role `cobranca` + **tarefas** + **notificações** + status SPC + dashboard de cobrança.

**Onda 4 — Contratos e advocacia (dependem da fundação):** 9. Item 5 — épico de contratos (E.1→E.5), incluindo win-back que consome tarefas. 10. Item 10 — escritório de advocacia (consome envio + tarefas).

> Racional: as ondas 1–2 são independentes e entregam valor rápido. A onda 3 cria os subsistemas (tarefas/notificações) que as ondas 4 reutilizam — construir contratos/advocacia antes da fundação geraria retrabalho.

---

## Decisões que preciso de você (resumo)

| ID  | Decisão                                                      | Minha recomendação                                                                                               |
| --- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| D1  | CNPJ cifrado ou texto claro                                  | ✅ **Respondida** — texto claro                                                                                  |
| D2  | Unicidade de email por org ou global                         | ✅ **Respondida** — por organização                                                                              |
| D3  | Bloquear email do agente logado ou de qualquer email interno | ✅ **Respondida** — qualquer email interno; **+ cobrar o email pessoal do agente no 1º login** e travá-lo também |
| D4  | Criar template Meta dedicado de simulação                    | Sim                                                                                                              |
| D5  | Moeda interna em centavos inteiros ou number                 | Centavos inteiros                                                                                                |
| D6  | "Usar versão" cria cópia ou reativa a antiga                 | Cria cópia (auditoria)                                                                                           |
| D7  | Contrato 1:1 ou 1:N por cliente                              | 1:N (permite win-back)                                                                                           |
| D8  | Gatilho de fim de contrato (data / % pago / N parcelas)      | Última parcela / N parcelas restantes                                                                            |
| D9  | Baixa: relatório traz nº da parcela → baixa na parcela exata | ✅ **Respondida** — "como der" por ora; ambíguo (cliente c/ 2 contratos) → revisão manual; trava com o exemplo   |
| D10 | Exemplo real do relatório de baixa (colunas)                 | ⏳ Rogério vai trazer o arquivo anonimizado                                                                      |
| D11 | Role cobrança global ou city-scoped                          | ✅ **Respondida** — global (visão centralizada)                                                                  |
| D12 | Notificações: canais                                         | ✅ **Respondida** — in-app + e-mail + WhatsApp                                                                   |
| D13 | SPC como status dedicado ou tag                              | ✅ **Respondida** — status dedicado                                                                              |
| D14 | Tarefas por role e/ou usuário                                | ✅ **Respondida** — por role **+ escopo regional (cidade)**                                                      |
| D15 | Vínculo advocacia por cidade ou manual                       | ✅ **Respondida** — padrão por cidade/comarca + ajuste manual                                                    |
| D16 | Follow-up: stage/outcome agora, construtor depois            | ✅ **Respondida** — sim: stage+outcome agora, construtor de segmento na fase 2                                   |
| D17 | Advocacia: quando o agente IA dispara o contato + cooldown   | ✅ **Respondida** — após cumprimentar/confirmar; cooldown 7d                                                     |
| D18 | CRM: status sincroniza com estágio de Kanban?                | ✅ **Respondida** — independentes; quem edita o lead move o estágio                                              |

> **Ainda pendente:** apenas D10 (exemplo do relatório de baixa). Todas as outras decisões (D1–D9, D11–D18) já respondidas.
>
> **Pendência de reprodução:** preciso que você me diga **em qual tela** viu o `10000 → R$ 100.000,00` (item 3) para eu cravar a linha exata.
> </content>
> </invoke>
