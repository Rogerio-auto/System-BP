# Planejamento — Live Chat Próprio (Inbox Omnichannel)

> **Status:** PROPOSTA para avaliação do Rogério. Não é doc canônico ainda.
> **Autor:** Claude (levantamento sobre o repo privado `Rogerio-auto/tagix` em `2026-06-14`).
> **Objetivo:** substituir a dependência do **Chatwoot** por um live chat **próprio**
> dentro do Manager, multicanal (WhatsApp + Instagram oficiais), reaproveitando o
> máximo do projeto `tagix` sem arrastar o que não serve.
> **Como ler:** este doc mapeia (a) de onde o reuso vem, (b) o que reusa / porta /
> constrói, (c) as decisões já travadas, (d) a decomposição em fase futura.
>
> Nada aqui foi implementado. Quando aprovado, vira slots via `/hm-tasks` seguindo
> `tasks/PROTOCOL.md`. **Feature futura** — fora do escopo da demo atual.

---

## 0. Decisões travadas (2026-06-14)

| #   | Decisão                      | Escolha do Rogério                                                                                      | Consequência                                                                                                                                                                                                                              |
| --- | ---------------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Infra de realtime/fila       | **Adotar Redis + RabbitMQ + Socket.io** (como o tagix)                                                  | **Override consciente da regra inviolável nº2** ("Outbox, sem Redis no MVP") — _para o domínio do live chat_. Permite porte ~1:1 do tagix. Ver §6 (ADR).                                                                                  |
| D2  | Store canônico das conversas | **Adotar o schema multicanal do tagix** (`channels` + `channel_secrets` + `conversations` + `messages`) | Tabelas atuais (`whatsapp_messages` + `chatwoot_conversations`) viram **bridge/legado** durante a migração. Ver §4.                                                                                                                       |
| D3  | Onboarding                   | **Suportar OS DOIS** — BSP/Tech-Provider **e** app-por-cliente, ambos com coexistência                  | Rogério vai aprovar um app próprio como **Tech Provider** na Meta (modo BSP) **e** criar app-por-cliente para clientes gov/donos do ativo. Sem default rígido — os dois caminhos existem. Trabalho **inédito** (tagix não cobre). Ver §5. |
| D4  | Escopo agora                 | **Planejamento completo** + **vitrine somente-leitura** na demo                                         | Plano inteiro documentado; vitrine read-only (ver conversas em tempo real, sem envio) como primeiro entregável visível. Ver §8.                                                                                                           |
| D5  | WAHA (canal não-oficial)     | **Manter como fallback de último caso**                                                                 | Disponível internamente como alternativa, **sem destaque/exposição ao cliente**. Não aparece como opção de primeira linha na UI. Ver §3/§5.4.                                                                                             |
| D6  | Storage de mídia             | **Cloudflare R2**                                                                                       | Igual ao tagix — porta direto. Ver §6.                                                                                                                                                                                                    |

---

## 1. Contexto — por que estamos bem posicionados

O `docs/07-integracoes-whatsapp-chatwoot.md` já consagrou o princípio:

> **"Chatwoot é interface, não estado."**

O estado canônico das conversas **já mora no nosso Postgres**. O Chatwoot só desenha a
conversa pro atendente humano (linha 221 do doc 07: "Conversa visualizada pelo agente
humano" → hoje **só Chatwoot**). Construir o live chat próprio é **virar esse "não" em
"sim"**: a camada de atendimento humano em tempo real que faltava.

**Correção honesta a um veredito anterior:** contra o Chatwoot, nosso estado é canônico e
melhor. Mas comparado ao **tagix**, o schema multicanal dele (`channels`/`conversations`/
`messages`) é **mais bem desenhado para multicanal** do que nossas tabelas atuais (amarradas
ao formato WhatsApp+Chatwoot). Daí a decisão **D2**.

---

## 2. Origem do reuso — anatomia do `tagix`

Live chat **maduro e multicanal** (WhatsApp + Instagram + WAHA), mesma "alma" arquitetural
daqui (monorepo pnpm, `apps/` + `packages/`, TS + Python, Drizzle, Zod, RBAC com escopo).

**Diferenças de framework/infra que importam para o porte:**

| Camada           | tagix                  | Elemento (aqui)                                                                   | Impacto no porte                                                        |
| ---------------- | ---------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| HTTP API         | **Express**            | **Fastify 5**                                                                     | Cola de rota reescrita; lógica de domínio porta limpa                   |
| Frontend         | **Next.js app-router** | **Vite + React Router** (roteador vivo = `App.tsx`)                               | Componentes portam; estrutura de páginas/rotas reescrita; re-skin no DS |
| Realtime         | Socket.io              | (decisão D1: **Socket.io**)                                                       | Porta ~1:1                                                              |
| Fila             | RabbitMQ               | (decisão D1: **RabbitMQ**)                                                        | Porta ~1:1                                                              |
| Locks            | Redis (Redlock)        | (decisão D1: **Redis**)                                                           | Porta ~1:1                                                              |
| Storage de mídia | Cloudflare R2          | a definir (S3/R2/MinIO)                                                           | Driver isolado                                                          |
| Python AI        | `apps/agent-runtime`   | `apps/langgraph-service`                                                          | Conceitualmente equivalente                                             |
| Design System    | próprio                | **DS oficial (doc 18)** — light-first, bandeira de Rondônia, Bricolage/Geist/Mono | **Estilo NÃO reusa**; só estrutura/lógica                               |

---

## 3. Mapa de reuso — 3 baldes

### 🟢 Balde 1 — OURO (levantar quase 1:1; lógica de domínio agnóstica de infra)

- **`packages/channels/` (a joia da coroa).** Camada de transporte isolada:
  - `IChannelAdapter` (interface única para WA/IG/WAHA).
  - `meta/whatsapp/` e `meta/instagram/` — adapter, `webhook.parser.ts`, `serializer.ts`,
    `errors.ts` (códigos Meta: 130472, 131026, 131047, 131051, 132001…).
  - `meta/instagram/` extra: `stories.ts`, `comments.ts` (hide/delete/private_reply/public_reply).
  - `waha/` — adapter HTTP da API não-oficial. **Decisão D5:** manter como **fallback de último caso**, sem destaque na UI nem exposição ao cliente (provider escondido das opções de primeira linha).
  - `shared/graphClient.ts` (graph.facebook.com **v23.0**, retry + token refresh),
    `shared/hmac.ts` (`verifyMetaSignature`), `shared/errors.ts`.
  - ⚠️ **`verifyMetaSignature` precisa virar por-canal** — ver §5 (app-por-cliente).
- **Sistema de tipos / discriminated unions:** `InboundEvent`, `OutboundJob`,
  `InteractivePayload` (buttons/list/template, validado com Zod no boundary), taxonomia
  completa de tipos de mensagem (text, image, video, audio, voice/PTT, document, sticker,
  location, contact, interactive, template HSM, reaction, story_mention/reply, share,
  comment, postback, referral).
- **Matriz de janela 24h por provider:** WA (livre <24h → bloqueia/template), IG (livre <24h
  → 24h–7d com `HUMAN_AGENT` tag + banner de auditoria → >7d bloqueia), WAHA (sempre livre).
  `getComposerState(conversation, channel)`.
- **Contratos de socket:** `message:new`, `message:status_changed`, `message:media_ready`,
  `conversation:updated`, `conversation:assigned`, `conversation:routing_changed`,
  `typing:from_contact`, `agent_execution:*`, `flow_execution:*`. Rooms `conversation:{id}`,
  `workspace:{wsId}`, `member:{memberId}`.
- **Pipeline de mídia:** inbound (download → SHA-256 → dedup → upload → `message:media_ready`),
  outbound (signed-url upload direto), encoding (ffmpeg/sharp).
- **Schema (decisão D2):** `channels` + `channel_secrets` (cifrado) + `conversations` +
  `messages` + `webhook_events` (dedup, raw 30d).
- **Contrato de conexão:** `POST /api/channels/connect` discriminado por provider, segredos
  cifrados (`encryptSecret`), **nunca** retornados (`PUBLIC_CHANNEL_COLUMNS`).

### 🟡 Balde 2 — PORTAR (reescrever a cola de framework; lógica aproveitada)

- **Rotas HTTP:** `channels`, `conversations` (`messages`, `notes`, `routing`, `window`),
  `webhooks/meta`, `webhooks/meta-instagram`, `webhooks/waha`, `webhooks/signature|dedup|event-id`.
  Express → **Fastify 5** + Zod nas bordas + `applyCityScope`/RBAC nossos.
- **Workers:** `inbound`, `outbound`, `media`, `webhooks/dispatcher|fanout|scheduler`.
  RabbitMQ mantido (D1); adaptar à nossa estrutura de workers.
- **Frontend (estrutura + lógica; re-skin no DS):** `features/conversations/*`
  (`ChatList`, `MessageBubble` com todos os tipos, `MessageComposer` + `WindowNotice` +
  `useWindowState` + `useMediaUpload`, `Notes` com `@menções`, `RoutingMenu`,
  `ContactInfoPanel`, `TypingIndicator`, `useConversationSocket`), `shared/realtime/*`
  (`SocketProvider`, `useSocket`), `features/channels/*` (`ChannelsManager`,
  `ChannelListItem`, `ConnectWizard`). **Páginas** Next→Vite (rotas em `App.tsx`).
- **Socket server:** `apps/api/src/socket/{index,relay}.ts` → equivalente Fastify.

### 🔴 Balde 3 — CONSTRUIR (inédito; tagix não cobre)

- **Coexistência (Meta Coexistence).** Não existe no tagix. Ver §5.
- **Embedded Signup SDK real.** No tagix, `apps/web/features/channels/fb-login.ts` é um
  **STUB** que lança `"FB Login indisponível: SDK não instalado"` e cai em entrada manual de
  credenciais. O _seam_ está desenhado no lugar certo (`fb-login.ts` → `POST /channels/connect`),
  mas a integração com o **Facebook JS SDK** a gente constrói. Ver §5.
- **App-por-cliente.** O tagix é **Tech Provider único** (um Meta App para todos). O modelo
  app-por-cliente é aditivo e muda credenciais + verificação de assinatura. Ver §5.
- **Bridge do legado** `whatsapp_messages`/`chatwoot_conversations` → novo schema. Ver §4.
- **Re-skin completo no DS oficial** (doc 18).

---

## 4. Dados — schema multicanal (decisão D2)

Adotar o shape do tagix como **store canônico do live chat**:

- `channels` — um por número/conta conectada (provider, `phone_number_id`/`waba_id` para WA,
  `ig_user_id`/`fb_page_id` para IG, `waha_session_id` para WAHA; `is_active`, `is_default`).
  **+ campos novos para app-por-cliente** (ver §5): `meta_app_id`, e o `app_secret` cifrado
  por canal em `channel_secrets`.
- `channel_secrets` — tokens cifrados (`access_token_enc`, `app_secret_enc`, `api_key_enc`).
  Alinhar com nossa cripto LGPD (doc 17): cifra em coluna, nunca em log, nunca retornado.
- `conversations` — multicanal, com `status` (open/pending/resolved/snoozed), `assigned_*`,
  `last_inbound_at`/`last_message_at`, `kind` (dm/group/comment_thread).
- `messages` — polimórfica por `type`, `direction`, `view_status`, `media_*`, `interactive_payload`.
- `webhook_events` — dedup + `raw_payload` retido 30d para hotfix de parser.

**Multi-tenant (regra inviolável nº8):** `organization_id` em toda tabela; escopo de cidade
(`applyCityScope`) nas queries de conversa/inbox, como no resto do sistema.

**Bridge/migração:** o pipeline atual do WhatsApp (`docs/07`) escreve em `whatsapp_messages` +
`interactions`. Estratégia: (a) o novo webhook passa a ser fonte; (b) `interactions` continua
recebendo o espelho para CRM/follow-up/Kanban (que já dependem dele); (c) `chatwoot_*` é
desativado por flag. Detalhar numa migration de transição com backfill.

---

## 5. Onboarding & Coexistência (decisão D3 — o coração do pedido)

O Rogério quer **duas formas**: BSP/Tech-Provider **e**, principalmente, **app-por-cliente com
coexistência**. O tagix só prova a primeira.

### 5.1 Modo BSP / Tech-Provider (tagix já prova)

Um Meta App, multi-tenant no nível de `workspace`/`channel`. Webhook unificado, **um**
`app_secret`. Encaixa direto no que o tagix entrega.

### 5.2 Modo app-por-cliente + coexistência (inédito)

Para cada cliente: **um Meta App dedicado** (próprio `app_id`/`app_secret`/`verify_token`),
configuração inicial da Cloud API e onboarding via **Embedded Signup** com **coexistência**.

**Coexistência (Meta Coexistence):** o cliente **continua usando o WhatsApp Business no
celular** enquanto a Cloud API roda em paralelo; histórico (~6 meses) sincroniza e mensagens
fluem para ambos. Habilitada no Embedded Signup via `featureType:
'whatsapp_business_app_onboarding'` (validar versão atual da API/Graph na implementação).
Pré-requisito: número no app **WhatsApp Business** (não Enterprise).

**Embedded Signup SDK (substituir o stub `fb-login.ts`):**

1. Carregar o **Facebook JS SDK** (`connect.facebook.net/.../sdk.js`) com o `app_id` do cliente.
2. `FB.login({ config_id, response_type: 'code', extras: { setup, featureType } })`.
3. Trocar o `code` por **token de longa duração** + obter `phone_number_id`/`waba_id`
   **no backend** (nunca expor `app_secret` no browser).
4. Persistir via `POST /api/channels/connect` (contrato do tagix já aceita isso).

### 5.3 ⚠️ Consequências arquiteturais do app-por-cliente

1. **`verifyMetaSignature` por-canal.** O tagix valida HMAC com **um** `app_secret` global.
   Com app-por-cliente, o `app_secret` é **por canal/app** → a verificação precisa resolver o
   secret correto (por `waba_id`/`app_id` do envelope) **antes** de validar a assinatura. É a
   maior divergência do blueprint.
2. **`verify_token` por-app** no GET de verificação do webhook.
3. **Roteamento de webhook:** um endpoint recebendo N apps → resolver `channel`/`app` pelo
   conteúdo do envelope (`entry[].id` = WABA id) antes de despachar.
4. **Custo operacional:** App Review + Business Verification da Meta **se repetem por cliente**
   no modo app-por-cliente (cada app reinicia a burocracia, que pode travar dias na verificação).
   No modo BSP isso é feito **uma vez** no app Tech-Provider da Highermind. **Decisão D3:**
   suportar **os dois** — Rogério aprovará o app Tech-Provider (BSP) **e** usará app-por-cliente
   para clientes gov/donos do ativo (ex.: Banco do Povo, onde o ativo digital pode precisar
   pertencer ao órgão). Contrapartida do BSP: risco concentrado — app banido derruba todos os
   clientes (ver runbook `meta-waba-banned.md` do tagix); app-por-cliente isola esse risco.

### 5.4 Instagram oficial

Entra como mais um `channel` (`meta_instagram`) no mesmo modelo (Graph Messaging API + comments

- stories). Fundamentos prontos no tagix; adapter completo é a fase F1.5 deles (parser de DMs,
  stories, comments, postbacks, moderação). Portar conforme balde 2.

---

## 6. ADR — override da regra "sem Redis no MVP" (decisão D1)

A regra inviolável nº2 do `CLAUDE.md` diz _"Outbox pattern para todo evento. Sem Redis no MVP."_
O Rogério decidiu, para o **domínio do live chat**, adotar **Redis + RabbitMQ + Socket.io**.

- **Motivação:** porte ~1:1 do tagix (menor risco/custo de reescrita), realtime de baixa
  latência (P95 `message:new` < 1s), locks FIFO por conversa (Redlock), cache de inbox.
- **Escopo do override:** **apenas o live chat**. O resto do sistema (CRM, cobrança, eventos
  de negócio) **continua no outbox pattern**. Não é licença para Redis em todo lugar.
- **Custo:** +2 serviços para operar (Redis, RabbitMQ) + storage de mídia em **Cloudflare R2**
  (decisão D6 — igual ao tagix, porta direto). Refletir em `docker-compose`,
  `19-runbook-go-live.md` e observabilidade.
- **Ponte com o outbox existente:** eventos de negócio que o CRM/Kanban/follow-up consomem
  (`customer_interaction_recorded`, etc.) continuam saindo pelo **outbox** — o live chat
  publica neles, não os substitui.

> Este ADR deve ser refletido no `CLAUDE.md`/doc de arquitetura quando a fase for aprovada,
> para que agentes futuros não bloqueiem o trabalho citando a regra nº2.

---

## 7. LGPD (doc 17 é normativo)

- **Conteúdo de mensagem = PII.** `messages.content`/mídia tratados conforme inventário de PII;
  logs sem corpo em texto plano; telefone mascarado; sem CPF em log.
- **Tokens/segredos cifrados** em `channel_secrets` (coluna cifrada, nunca em log/retorno).
- **DLP antes do gateway LLM:** nada de PII bruta para suboperador internacional (regra do
  projeto). Mensagem que vai para o agente IA passa pelo DLP.
- **Mídia:** preferir referência/ID; URLs assinadas com allowlist de host.
- **Retenção:** `webhook_events.raw_payload` 30d; mídia e mensagens por política de retenção.
- **Checklist §14.2 do doc 17** obrigatório nos slots que tocam PII.

---

## 8. Decomposição em fase futura (proposta — vira slots via `/hm-tasks`)

Sequência sugerida (uma nova fase, ex. **F16 — Live Chat Próprio**):

| Bloco                                   | Slots (estimativa) | Conteúdo                                                                                                    |
| --------------------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------- |
| **B0 — Infra**                          | M                  | docker-compose (Redis, RabbitMQ, storage), bootstrap de filas, SocketProvider                               |
| **B1 — Schema**                         | M                  | `channels`, `channel_secrets`, `conversations`, `messages`, `webhook_events` + migration + bridge do legado |
| **B2 — packages/channels**              | M/G                | portar adapters Meta WA/IG + WAHA + graphClient + hmac **por-canal** + tipos/Zod                            |
| **B3 — Webhooks + workers**             | G                  | `/webhooks/meta` (multi-app), dedup, inbound/outbound/media workers                                         |
| **B4 — API conversas**                  | M/G                | `channels/connect`, `conversations` (messages/notes/routing/window) em Fastify + RBAC + city scope          |
| **B5 — Realtime**                       | M                  | socket server + relay + contratos de evento                                                                 |
| **B6 — Inbox UI**                       | G                  | ChatList / MessageBubble / Composer / Notes / Routing / ContactInfo — **re-skin DS**                        |
| **B7 — Onboarding BSP**                 | M                  | ConnectWizard + connect manual (paridade tagix)                                                             |
| **B8 — Embedded Signup + Coexistência** | G                  | FB JS SDK real, troca code→token no backend, coexistência, app-por-cliente                                  |
| **B9 — Instagram completo**             | G                  | adapter IG real (DMs, stories, comments, postbacks, moderação)                                              |
| **B10 — Migração/cutover**              | M                  | desativar Chatwoot por flag, backfill, runbook                                                              |

**Esforço total:** épico grande (G+). **Decisão D4:** primeiro entregável visível é uma
**vitrine somente-leitura** — **B0+B1+B5+B6** num modo read-only (ver conversas chegando em
tempo real, sem envio), antes do pipeline de envio completo. O planejamento das demais fases
fica completo neste doc para execução subsequente.

---

## 9. Não-objetivos no MVP do live chat

- Group chats (schema preparado, UI fase 2).
- Transcrição automática de voz (Whisper) — fase 2.
- Threads/replies infinitos (MVP: 1 nível).
- Forwarded messages com UX destacada.

---

## 10. Decisões — resolvidas (2026-06-14)

1. ✅ **Onboarding:** suportar **os dois** modos (BSP/Tech-Provider **e** app-por-cliente),
   ambos com coexistência. Rogério aprovará o app Tech-Provider próprio na Meta. (D3 / §5.3)
2. ✅ **WAHA:** manter como **fallback de último caso**, sem destaque nem exposição ao
   cliente. (D5 / §3, §5.4)
3. ✅ **Storage de mídia:** **Cloudflare R2**. (D6 / §6)
4. ✅ **Vitrine na demo:** **sim** — modo somente-leitura (B0+B1+B5+B6), com planejamento
   completo das demais fases. (D4 / §8)

**Pendente (não-bloqueante):**

5. **Atualizar `CLAUDE.md`** com o ADR do §6 (override do Redis no domínio do live chat)
   quando a fase F16 abrir — para não bloquear agentes futuros pela regra nº2.
