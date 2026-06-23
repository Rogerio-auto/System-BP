# Migração Chatwoot → Elemento (import único no cutover)

> **Status:** plano (estudo concluído em 2026-06-23). **Nada foi migrado.** > **Executar quando:** o Elemento estiver em produção na VPS (domínio `api.bancodopovoderondonia.org.br`, hoje ocioso em `localhost:8181`).
> **Princípio:** trazer os dados existentes do chat para dentro do Elemento **sem remodelar o banco**. Import único, idempotente, reexecutável.

---

## 1. Objetivo e escopo

Importar para o Elemento o histórico de atendimento que hoje vive no **Chatwoot** da VPS:

- **Migra (texto/metadados):** contatos, conversas e **todas** as mensagens.
- **Migra (binário):** **somente áudios** (voz / `ogg` / `mp3` / etc.) → vão para o **Cloudflare R2**.
- **Não migra binário:** imagens, vídeos, documentos, stickers, localização, contato — mantém-se apenas o texto / referência (`content` + `content_attributes`), sem subir o arquivo.

Fora de escopo: agentes/usuários do Chatwoot (o Elemento tem RBAC próprio), labels, automações, SLAs.

---

## 2. Fonte — Chatwoot (VPS `manager1`, 31.97.160.223)

- **Acesso:** `ssh bdp-vps` (chave) → `docker exec` no container `postgres_chatwoot_postgres` (Postgres 14, DB `chatwoot`, user `postgres`, trust local). **Não** depende de porta exposta (5452 está bloqueada no firewall; ver `docs/19-runbook-go-live.md` / memória de deploy).
- **Conta a migrar:** `accounts.id = 1` ("Banco do Povo de Rondônia"). Ignorar `id = 2` ("Teste").

### Inventário (2026-06-23)

| Tabela          | Volume  | Observação                                                     |
| --------------- | ------- | -------------------------------------------------------------- |
| `contacts`      | 3.753   | contatos WhatsApp                                              |
| `conversations` | 4.119   |                                                                |
| `messages`      | 118.383 | período 02/07/2025 → 23/06/2026                                |
| `inboxes`       | 2       | ambos `Channel::Whatsapp` (id 1 "Banco do Povo", id 2 "Teste") |
| `attachments`   | 1.212   | audio **446**, imagem 316, file 427, vídeo 15, outros 8        |
| `users`         | 3       | agentes (não migrados)                                         |

`attachments.external_url` está **vazio** nos áudios → arquivos no **ActiveStorage** do Chatwoot (`active_storage_blobs` + `active_storage_attachments`; arquivo no storage do container ou bucket S3 conforme config do Chatwoot). Confirmar storage backend na execução.

---

## 3. Destino — Elemento (Postgres do sistema)

Tabelas-alvo (Drizzle: `apps/api/src/db/schema/`):

- **`leads`** ← contatos. Chaves: `organization_id` (notNull), `name`, `phone_e164`, `phone_normalized` (dedupe), `email` (citext), `cpf_*` (NULL — sem CPF no Chatwoot), `source`, `status`, `metadata`, `city_id`. Índice único parcial `(organization_id, phone_normalized) WHERE deleted_at IS NULL`.
- **`conversations`** ← conversas. Chaves: `organization_id`, `channel_id`, `contact_remote_id` (notNull), `contact_name`, `lead_id`, `status` (default `open`), `kind` (`dm`), `last_inbound_at`, `last_message_at`, `metadata`, `city_id`.
- **`messages`** ← mensagens. Chaves: `conversation_id`, `channel_id`, `direction` (notNull), `external_id`, `type` (notNull), `content`, `media_url`/`media_mime`/`media_size_bytes`/`media_sha256` (só áudio), `metadata`, `created_at`.
- **`channels`** ← os 2 inboxes WhatsApp (provider `meta_whatsapp` ou `waha`). Precisam **existir** no Elemento antes do load.

---

## 4. Mapeamento campo a campo

### 4.1 `contacts` → `leads`

| Chatwoot                                      | Elemento                     | Transformação                                                              |
| --------------------------------------------- | ---------------------------- | -------------------------------------------------------------------------- |
| `phone_number`                                | `phone_e164`                 | normalizar para E.164 (`+55…`); descartar contato sem telefone válido      |
| `phone_number`                                | `phone_normalized`           | só dígitos — **chave de dedupe**                                           |
| `name`                                        | `name`                       | fallback: push name / `+phone` se vazio                                    |
| `email`                                       | `email`                      | citext; null se vazio/ inválido                                            |
| —                                             | `organization_id`            | org "Banco do Povo" no Elemento (constante)                                |
| —                                             | `city_id`                    | **decisão pendente** (ver §8): null ou derivar                             |
| —                                             | `source`                     | valor de enum permitido p/ import (ex.: `whatsapp`/`import`; validar enum) |
| —                                             | `status`                     | `status` inicial neutro (ex.: `novo`/ativo; validar enum)                  |
| `custom_attributes` + `additional_attributes` | `metadata`                   | jsonb; incluir `{ chatwoot_contact_id, identifier }`                       |
| —                                             | `cpf_encrypted` / `cpf_hash` | **NULL** (Chatwoot não tem CPF)                                            |

**Dedupe:** `INSERT … ON CONFLICT (organization_id, phone_normalized) WHERE deleted_at IS NULL DO NOTHING/UPDATE` — não duplicar leads já criados pelo funil do Elemento. Guardar de-para `chatwoot_contact_id → lead_uuid`.

### 4.2 `conversations` → `conversations`

| Chatwoot                   | Elemento                      | Transformação                                                                           |
| -------------------------- | ----------------------------- | --------------------------------------------------------------------------------------- |
| `contact_id`               | `lead_id`                     | via de-para de contatos                                                                 |
| `inbox_id`                 | `channel_id`                  | via de-para de inboxes→channels                                                         |
| (telefone do contato)      | `contact_remote_id`           | `phone_normalized` (remote id WhatsApp)                                                 |
| `contacts.name`            | `contact_name`                |                                                                                         |
| `status` (int)             | `status` (text)               | 0→`open`, 1→`resolved`/`closed`, 2→`pending`, 3→`snoozed` (validar valores do Elemento) |
| `created_at`               | `created_at`                  |                                                                                         |
| `last_activity_at`         | `last_message_at`             |                                                                                         |
| —                          | `organization_id` / `city_id` | constante / §8                                                                          |
| —                          | `kind`                        | `dm`                                                                                    |
| `id`, `uuid`, `display_id` | `metadata`                    | `{ chatwoot_conversation_id, chatwoot_uuid, display_id }`                               |

De-para `chatwoot_conversation_id → conversation_uuid`.

### 4.3 `messages` → `messages`

| Chatwoot               | Elemento                                                   | Transformação                                                                                   |
| ---------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `conversation_id`      | `conversation_id`                                          | via de-para                                                                                     |
| `message_type` (int)   | `direction`                                                | 0→`inbound`, 1→`outbound`, 3(template)→`outbound`; **2 (activity) → descartar** (ou `metadata`) |
| `content`              | `content`                                                  | texto                                                                                           |
| `content_type` / anexo | `type`                                                     | `text`/`image`/`audio`/`document`/… (validar enum); áudio quando `attachments.file_type=1`      |
| `source_id`            | `external_id`                                              | wamid do WhatsApp                                                                               |
| `created_at`           | `created_at`                                               | preservar timestamp original                                                                    |
| áudio (file_type=1)    | `media_url`,`media_mime`,`media_size_bytes`,`media_sha256` | ver §5                                                                                          |
| outras mídias          | —                                                          | **não** sobe binário; manter texto/`content_attributes` em `metadata`                           |
| —                      | `channel_id`                                               | herdado da conversa                                                                             |
| `id`                   | `metadata`                                                 | `{ chatwoot_message_id }` (idempotência)                                                        |

---

## 5. Áudios → Cloudflare R2 (446 arquivos)

1. Selecionar `attachments WHERE file_type = 1` (audio) e juntar com `active_storage_attachments`/`active_storage_blobs` para achar a `key` e o `content_type`/`filename` do blob.
2. Ler o binário do storage do Chatwoot (disco do container em `/app/storage/<xx>/<yy>/<key>`, ou bucket S3 se configurado — confirmar na execução).
3. Subir para o **R2** (bucket `bancodopovo`, credenciais já no `.env` local: `R2_*`), com chave determinística (ex.: `chat-import/audio/<message_uuid>.<ext>`).
4. Preencher na message: `media_url` (URL/key R2), `media_mime` (ex.: `audio/ogg`), `media_size_bytes`, `media_sha256`.

Idempotência: se a `key` R2 já existe (mesmo `chatwoot_message_id`), não re-subir.

---

## 6. Arquitetura do ETL

**Extract → Transform → Load**, em script dedicado (TS no `apps/api`, reusando o client Drizzle e o gateway R2), executado contra o Elemento **já em produção**:

1. **Extract:** `pg_dump`/`COPY` da conta 1 do Chatwoot via `docker exec` (ou query direta por túnel SSH) para um staging local — tabelas `contacts`, `conversations`, `messages`, `inboxes`, `attachments` + `active_storage_*`.
2. **Transform:**
   - Tabela de-para em memória/staging: `chatwoot_id (int) → elemento_uuid`. **Crítico** porque o Elemento usa UUID.
   - Normalização de telefone (E.164 + dígitos), dedupe de lead, mapeamento de enums (status/direction/type), filtragem de mensagens `activity`.
   - Para áudios: resolver blob → baixar.
3. **Load (idempotente, em lotes):**
   - Ordem: `leads` → `conversations` → `messages` (FKs). Lotes de ~1–5k mensagens.
   - **Idempotência por `metadata.chatwoot_*_id`**: antes de inserir, checar se já existe (reexecução não duplica). Permite rodar o import várias vezes (ensaio + cutover real).
   - Áudios subidos sob demanda durante o load das messages.

**Reexecutável:** o de-para + as chaves `chatwoot_*_id` em `metadata` garantem que rodar de novo só preenche o que faltou.

---

## 7. Pré-requisitos (antes de executar)

- [ ] Elemento em **produção na VPS** com Postgres de produção acessível ao script.
- [ ] **Org** "Banco do Povo" criada no Elemento (`organization_id` alvo).
- [ ] **Channels** criados no Elemento para os 2 inboxes WhatsApp (de-para `inbox_id → channel_id`).
- [ ] Definição de `city_id` (§8).
- [ ] Credenciais R2 válidas no ambiente do script (`R2_*`).
- [ ] Confirmar storage backend do ActiveStorage do Chatwoot (disco vs S3).
- [ ] Validar valores de enum reais do Elemento: `leads.source`, `leads.status`, `conversations.status`, `messages.direction`, `messages.type`.

---

## 8. Decisões pendentes

1. **`city_id`** dos leads/conversas: os contatos do Chatwoot não têm cidade. Opções: (a) `null`; (b) cidade fixa da org; (c) derivar de algum atributo. **→ definir com o Rogério.**
2. **Dedupe lead existente:** ao casar telefone com lead já existente no Elemento, `DO NOTHING` (preserva o lead do funil) ou `UPDATE` (enriquece com dados do Chatwoot)? **→ definir.**
3. **Mensagens `activity` (type 2):** descartar de vez ou guardar em `metadata`/`content`? (recomendo descartar).
4. **`source`/`status` iniciais** do lead importado (valor exato do enum).
5. **Conversas da conta "Teste"** (account 2): confirmar que ficam de fora.

---

## 9. Validação pós-import

- Contagens: `leads` novos ≈ contatos únicos por telefone; `conversations` = 4.119 (menos descartes); `messages` = 118.383 − (activity descartadas).
- Amostragem: abrir N conversas no Elemento e conferir ordem cronológica, direção (in/out) e áudios tocando do R2.
- Reexecução: rodar o ETL 2× e confirmar **zero duplicatas** (idempotência).
- LGPD: confirmar que telefones não vazaram em logs (`pino.redact`) e que `metadata` não carrega PII bruta indevida.

## 10. Rollback

- O import só **insere** (não altera dados existentes do Elemento, exceto possível enrich de lead se a decisão §8.2 for UPDATE).
- Rollback = deletar por marca: `DELETE … WHERE metadata->>'chatwoot_message_id' IS NOT NULL` (idem conversations/leads criados pelo import), dentro de transação por lote. Manter uma tag de import (`metadata.import_batch`) para rollback cirúrgico.

## 11. Checklist LGPD (doc 17)

- [ ] Telefone tratado como PII (E.164/normalizado), nunca em log (`pino.redact`).
- [ ] `metadata` sem PII bruta além do necessário (ids técnicos do Chatwoot).
- [ ] Áudios no R2 sob chave não-enumerável previsível só pelo sistema; acesso via URL assinada/gateway.
- [ ] `cpf_*` permanecem NULL (Chatwoot não fornece CPF).
- [ ] Checklist §14.2 do doc 17 no PR do slot de execução (toca PII + escopo de org/cidade).

---

## 12. Próximos passos

1. Aprovar este plano + resolver as decisões da §8.
2. Autorar slot de execução (ex.: `F<n>-S<x>` — ETL Chatwoot→Elemento) quando o Elemento estiver em prod na VPS.
3. Ensaio (dry-run) contra um Postgres de staging; depois cutover real.
