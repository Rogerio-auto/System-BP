# 25 — Respostas Rápidas (Live Chat)

> **Normativo.** Vence qualquer slot individual em conflito. Complementa
> [`18-design-system.md`](18-design-system.md) (lei visual), [`10-seguranca-permissoes.md`](10-seguranca-permissoes.md)
> (RBAC), [`17-lgpd-protecao-dados.md`](17-lgpd-protecao-dados.md) (PII) e
> [`09-feature-flags.md`](09-feature-flags.md) (flags).
>
> Fase de implementação: **F28**. Origem: pedido do cliente (Banco do Povo / SEDEC-RO) — operadores
> do live chat precisam de mensagens pré-definidas para responder o cidadão sem redigitar.

---

## 1. Objetivo

Dar ao operador do live chat uma **biblioteca de mensagens pré-definidas** (texto e mídia) que ele
dispara no atendimento com um clique ou com um atalho de teclado, e dar à gestão o controle
administrativo dessa biblioteca.

Não é um recurso da Meta. É um recurso **local do Elemento**: a resposta rápida é apenas um
_atalho de composição_ — no momento do envio ela vira uma mensagem `text` ou `media` comum,
percorrendo exatamente o mesmo caminho já existente até a API oficial do WhatsApp.

## 2. O que já existe (levantamento — não reimplementar)

| Capacidade                         | Onde                                                                                               | Consequência para F28                                                                                          |
| ---------------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Envio de mensagem pelo operador    | `POST /api/conversations/:id/messages` (`modules/conversations/routes.ts:361`)                     | **Reusar.** Nenhuma rota de envio nova.                                                                        |
| Tipos aceitos no envio             | `text`, `media`, `template`, `interactive` (`modules/conversations/send.schema.ts:84`)             | Resposta rápida vira `text` **ou** `media`. Zero mudança no contrato.                                          |
| Fila + worker de saída             | `hm.q.outbound.request` → `workers/livechat-outbound.ts:122`                                       | **Não tocar.**                                                                                                 |
| Serialização para a Meta           | `integrations/channels/meta/whatsapp/serializer.ts` (Graph v23.0)                                  | Mídia vai por **`link` (URL pública)**, não `media_id` — a mídia da biblioteca precisa de URL pública estável. |
| Upload de mídia (2 fases)          | `POST /:id/uploads/signed-url` → `PUT` direto no storage (`useUploadMedia.ts:105`)                 | **Reusar o mecanismo**, com prefixo de key próprio (§7).                                                       |
| Limites por MIME                   | `maxUploadBytesForMime` (`packages/shared-schemas/src/livechat.ts:135`)                            | Aplicar os mesmos limites.                                                                                     |
| Janela de 24h                      | `getComposerState` → `WindowClosedError` 422 (`send.service.ts:213`)                               | Resposta rápida **herda** a restrição (§8).                                                                    |
| Idempotência de envio              | Header `Idempotency-Key` obrigatório                                                               | O composer já gera `crypto.randomUUID()`.                                                                      |
| Realtime                           | Publish em `hm.q.socket.relay` → `workers/livechat-socket-relay.ts:211` → room `workspace:{orgId}` | Padrão para a sincronização de §9.                                                                             |
| Seletor flutuante sobre o composer | `MessageComposer/TemplateSelector.tsx:145` (`absolute bottom-full`)                                | Precedente visual e de acessibilidade a espelhar.                                                              |
| Padrão CRUD admin                  | `modules/credit-products/**` + `pages/admin/Products.tsx` + `ProductDrawer.tsx`                    | Molde do módulo e da tela.                                                                                     |

**Não existe hoje** nenhum recurso de resposta rápida / canned response / snippet no repositório.
`quick_reply` no código atual refere-se exclusivamente a **botões de template da Meta**
(`integrations/channels/adapter.types.ts:197`) — semântica diferente, não confundir.

## 3. Decisões de produto (fechadas)

| #   | Decisão                                                                                                               | Racional                                                                                                                                                                       |
| --- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D1  | Duas visibilidades: **`organization`** (curada por gestão, todos veem) e **`personal`** (do próprio operador).        | Padroniza o discurso institucional sem tirar a autonomia de quem atende.                                                                                                       |
| D2  | **Clique envia imediatamente.** Ação secundária (ícone de lápis / `Alt`+clique) insere no composer para editar antes. | Velocidade no atendimento. O risco de disparo indevido é mitigado por D3.                                                                                                      |
| D3  | Toda variável tem **fallback obrigatório** no cadastro. Nunca é possível enviar `{{...}}` cru.                        | Garante que D2 é seguro: a mensagem sempre resolve para texto final válido.                                                                                                    |
| D4  | Resposta rápida pode carregar **uma mídia** (imagem, vídeo, documento ou áudio) com legenda.                          | Pedido explícito do cliente. Mapeia 1:1 em `type: 'media'` + `caption`.                                                                                                        |
| D5  | Atalho digitável: `/` no **início** do composer abre o seletor e filtra por `shortcut`.                               | Convenção consolidada (Chatwoot, Slack, Intercom).                                                                                                                             |
| D6  | `city_ids` é **filtro de conveniência, não fronteira de segurança**.                                                  | O live chat é org-wide por design (`modules/livechat/repo.ts:165-179`). Fingir escopo de cidade aqui seria falsa sensação de isolamento. A fronteira real é `organization_id`. |
| D7  | Nasce atrás da flag `livechat.quick_replies.enabled` (**disabled**).                                                  | Doc 09 §1 — 4 camadas.                                                                                                                                                         |

## 4. Modelo de dados

Tabela `quick_replies` (migration **0094**). Segue o padrão canônico de tabela de domínio
(`db/schema/creditProducts.ts:33`).

| Coluna                      | Tipo                                                      | Regra                                                                                  |
| --------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `id`                        | `uuid` PK `gen_random_uuid()`                             |                                                                                        |
| `organization_id`           | `uuid NOT NULL` FK → `organizations` `ON DELETE RESTRICT` | Fronteira de tenant.                                                                   |
| `owner_user_id`             | `uuid NULL` FK → `users` `ON DELETE CASCADE`              | `NULL` ⇒ `visibility='organization'`. Preenchido ⇒ `'personal'`.                       |
| `visibility`                | `text NOT NULL DEFAULT 'organization'`                    | CHECK `in ('organization','personal')`. CHECK de coerência com `owner_user_id` (§4.1). |
| `shortcut`                  | `citext NOT NULL`                                         | Slug do atalho, sem a barra. CHECK `~ '^[a-z0-9][a-z0-9_-]{0,31}$'`.                   |
| `title`                     | `text NOT NULL`                                           | Rótulo humano na lista. ≤ 120.                                                         |
| `body`                      | `text NULL`                                               | Corpo com variáveis. ≤ 4096 (limite da Meta). Obrigatório se não houver mídia.         |
| `category`                  | `text NULL`                                               | Agrupador livre (ex.: "Documentos", "Saudações"). ≤ 60.                                |
| `media_url`                 | `text NULL`                                               | URL pública estável (§7).                                                              |
| `media_mime`                | `text NULL`                                               |                                                                                        |
| `media_kind`                | `text NULL`                                               | CHECK `in ('image','video','audio','document')`.                                       |
| `media_size_bytes`          | `integer NULL`                                            |                                                                                        |
| `media_file_name`           | `text NULL`                                               | Nome exibido em documento.                                                             |
| `city_ids`                  | `uuid[] NOT NULL DEFAULT '{}'`                            | Vazio = todas. Filtro de exibição (D6).                                                |
| `is_active`                 | `boolean NOT NULL DEFAULT true`                           |                                                                                        |
| `sort_order`                | `integer NOT NULL DEFAULT 0`                              | Fixação manual das principais.                                                         |
| `usage_count`               | `integer NOT NULL DEFAULT 0`                              | Telemetria (§10).                                                                      |
| `last_used_at`              | `timestamptz NULL`                                        |                                                                                        |
| `created_by`                | `uuid NULL` FK → `users` `ON DELETE SET NULL`             |                                                                                        |
| `created_at` / `updated_at` | `timestamptz NOT NULL DEFAULT now()`                      | Trigger de `updated_at`.                                                               |
| `deleted_at`                | `timestamptz NULL`                                        | Soft-delete. Toda query filtra `IS NULL`.                                              |

### 4.1 Constraints obrigatórias

- `CHECK ((visibility = 'personal') = (owner_user_id IS NOT NULL))` — impede estado incoerente.
- `CHECK (body IS NOT NULL OR media_url IS NOT NULL)` — resposta vazia é inválida.
- `CHECK ((media_url IS NULL) = (media_kind IS NULL))` — mídia é tudo-ou-nada.
- Único parcial de atalho por dono:
  - `UNIQUE (organization_id, shortcut) WHERE owner_user_id IS NULL AND deleted_at IS NULL`
  - `UNIQUE (organization_id, owner_user_id, shortcut) WHERE owner_user_id IS NOT NULL AND deleted_at IS NULL`
  - ⇒ o atalho pessoal de um operador **pode** sombrear um da organização. Na resolução, o **pessoal vence** (§6.2).
- Índices: `(organization_id, is_active)`, `(organization_id, owner_user_id)`, GIN `pg_trgm` em `title` para busca.

## 5. Permissões (RBAC)

Migration **0095** — seed de permissões + `role_permissions`, no molde de
`0069_seed_livechat_action_permissions.sql`.

| Permissão                     | O que libera                                                            | Papéis no seed                    |
| ----------------------------- | ----------------------------------------------------------------------- | --------------------------------- |
| `livechat:quick_reply:read`   | Listar e usar respostas rápidas (org + as próprias).                    | `admin`, `gestor_geral`, `agente` |
| `livechat:quick_reply:write`  | CRUD das **próprias** (`visibility='personal'`).                        | `admin`, `gestor_geral`, `agente` |
| `livechat:quick_reply:manage` | CRUD das da **organização** + reordenar + ver/editar as de qualquer um. | `admin`, `gestor_geral`           |

> **Correção (F28-S01).** A primeira versão desta tabela citava `gestor_cidade` e `agente_admin` —
> **nenhum dos dois existe** no catálogo real de papéis, que é
> `admin | gestor_geral | gestor_regional | agente | operador | leitura | cobranca`.
> O seed segue o precedente do próprio live chat (`0069_seed_livechat_action_permissions.sql`):
> quem pode usar resposta rápida é exatamente quem já tem `livechat:message:send`.
> Conceder a `gestor_regional` ou `operador` exige antes conceder-lhes o envio de mensagem — decisão
> de produto separada, fora de F28.

Regras de autorização no service (não só na rota):

1. Toda query filtra por `organization_id` do ator — sem exceção.
2. Leitura retorna: `visibility='organization'` **união** `owner_user_id = actor.userId`.
   Um operador **nunca** vê a resposta pessoal de outro — **nem com `manage`, em nenhuma rota**.
   O filtro de visibilidade é aplicado em SQL e o repositório sequer recebe a permissão do ator
   (fail-closed por construção). A resposta pessoal é privada do dono; `manage` administra apenas o
   acervo da **organização**. (Correção F28-S03: a primeira versão previa uma exceção "tela admin com
   `manage` vê pessoais de terceiros" — descartada por ser mais intrusiva e sem ganho operacional.
   A tela admin lista o acervo da organização + as próprias do gestor, nunca as pessoais alheias.)
3. Escrita em registro com `owner_user_id = actor.userId` exige `write`.
4. Escrita em registro com `visibility='organization'` (ou de outro dono) exige `manage`.
5. Criar com `visibility='organization'` exige `manage`. Criar `personal` exige `write` e força
   `owner_user_id = actor.userId` (**ignorar** qualquer `owner_user_id` vindo do body).
6. Enviar exige, além de `livechat:quick_reply:read`, a permissão de envio já existente
   `livechat:message:send`.

## 6. Variáveis

### 6.1 Catálogo fechado

Nenhuma variável fora desta lista é aceita. Validação na **criação/edição** (backend), não no envio.

| Variável                      | Origem                       | Observação                                                 |
| ----------------------------- | ---------------------------- | ---------------------------------------------------------- |
| `{{contato.nome}}`            | `conversations.contact_name` | PII — resolvida **no cliente**, nunca persistida no corpo. |
| `{{contato.primeiro_nome}}`   | idem, primeiro token         |                                                            |
| `{{atendente.nome}}`          | usuário autenticado          |                                                            |
| `{{atendente.primeiro_nome}}` | idem                         |                                                            |
| `{{saudacao}}`                | hora local                   | "Bom dia" / "Boa tarde" / "Boa noite"                      |
| `{{data}}`                    | hora local                   | `dd/MM/yyyy`                                               |
| `{{hora}}`                    | hora local                   | `HH:mm`                                                    |

Sintaxe: `{{chave|fallback}}`. O **fallback é obrigatório** para `contato.*` (D3) — o backend rejeita
`{{contato.nome}}` sem fallback com `422 QUICK_REPLY_MISSING_FALLBACK`.
Exemplo válido: `Olá {{contato.primeiro_nome|tudo bem}}, aqui é {{atendente.primeiro_nome|a equipe}}.`

> **`{{organizacao.nome}}` removida (F28-S06).** Estava no catálogo original, mas o frontend não tem
> a fonte do nome da organização (não vem no `/auth/me` nem no auth-store), então no **envio** —
> onde a interpolação é client-side — a variável não resolveria e o token cru chegaria ao cidadão.
> Além da remoção, o composer ganhou uma guarda que bloqueia o envio se sobrar qualquer `{{...}}`
> após interpolar (última linha de defesa de D3). Para reintroduzir a variável, um follow-up precisa
> threadar o nome da organização até o composer (via `/auth/me` + auth-store) e re-adicionar a
> entrada no catálogo.

### 6.2 Resolução

- Interpolação é **100% client-side**, no instante do uso, a partir de dados já em cache
  (`useConversation` traz `contactName`; `useAuth` traz o usuário). **Zero round-trip.**
- Consequência LGPD: o nome do cidadão **nunca** é gravado em `quick_replies.body`, nunca vai para o
  outbox e nunca chega ao gateway LLM. A tabela é isenta de PII do titular (§12).
- Colisão de atalho: pessoal vence organização.

## 7. Mídia — ciclo de vida

1. **Upload (no cadastro, tela admin).** Reusa o mecanismo de 2 fases já existente, por rota própria:
   `POST /api/quick-replies/uploads/signed-url` → `PUT` direto no storage pelo browser.
2. **Key do objeto:** `quick-replies/{organizationId}/{uuid}{ext}`.
   Prefixo distinto de `outbound/` **de propósito**: mídia de biblioteca é ativo institucional, não
   dado de conversa — não pode ser varrida por rotina de retenção de atendimento.
3. **Validação:** mesmos `maxUploadBytesForMime` do live chat (imagem 5 MB, áudio/vídeo 16 MB,
   documento 50 MB) e mesma allowlist de MIME.
4. **Envio:** o front manda `type: 'media'`, `publicMediaUrl = quick_replies.media_url`,
   `mime`, `mediaKind`, `caption = body interpolado`. A URL precisa ser **publicamente alcançável
   pela Meta** — o serializer usa `link` (`serializer.ts:152`).
5. **Exclusão:** soft-delete não remove o objeto do storage (mensagens já enviadas continuam
   referenciando a URL). Limpeza física é assunto de retenção, fora do escopo de F28.

## 8. Envio — caminho completo

```
[clique na resposta rápida]
  → interpola variáveis (client)
  → POST /api/conversations/:id/messages   { type:'text'|'media', ... }  + Idempotency-Key
  → send.service.ts: janela 24h → idempotência → persiste message(pending)
  → publish hm.q.outbound.request
  → workers/livechat-outbound.ts → serializer → POST graph.facebook.com/v23.0/{phoneNumberId}/messages
  → view_status 'sent' → socket message:new
  → POST /api/quick-replies/:id/used   (fire-and-forget, telemetria)
```

**Nenhuma alteração** em `send.service.ts`, no worker, no serializer ou no contrato de fila.

**Janela de 24h:** fora da janela, `text` e `media` são rejeitados com `422 WINDOW_CLOSED`. Portanto o
seletor de respostas rápidas fica **desabilitado** quando `composerState` indica janela fechada, com
o aviso já existente (`WindowNotice.tsx:30`) orientando a usar template aprovado. Não tentar burlar.

## 9. Tempo real das configurações

Quando um gestor cria, edita, ativa/desativa ou remove uma resposta rápida da **organização**, os
operadores com o chat aberto precisam refletir a mudança sem recarregar.

- O service publica, após commit, em `QUEUES.socketRelay` via `makeEnvelope`:
  `{ room: 'workspace:{organizationId}', event: 'quick_reply:changed', data: { quickReplyId, action, visibility } }`.
- Alterações em resposta **pessoal** vão para `room: 'user:{ownerUserId}'` — não vazam para a org.
- O payload **não** carrega `body`, `title` nem mídia (o relay nunca loga `data`, mas o princípio de
  mínimo privilégio vale igual): o cliente recebe o sinal e invalida a query.
- No front: `invalidateQueries(quickReplyKeys.all)`. Complemento defensivo: `staleTime` 60 s.

## 10. Telemetria de uso

- `POST /api/quick-replies/:id/used` — incrementa `usage_count` e grava `last_used_at`.
- Fire-and-forget: falha **nunca** bloqueia nem desfaz o envio já realizado. Sem `Idempotency-Key`
  (contador aproximado é aceitável; travar o envio por causa de métrica não é).
- Uso: ordenação padrão da lista = `sort_order ASC, usage_count DESC, title ASC`.

## 11. UX

### 11.1 No composer (operador)

- Novo botão na barra do composer, entre "anexar" e "emoji" (`MessageComposer.tsx:502`/`:583`).
  Ícone de raio/atalho. `aria-label="Respostas rápidas"`, `aria-haspopup="dialog"`.
- Abre painel flutuante **acima** do composer, espelhando `TemplateSelector.tsx:190-203`
  (`absolute bottom-full left-0 right-0 z-10`, `max-h-[420px]`, corpo rolável).
- Abertura: clique no botão, `/` como **primeiro caractere** do textarea, ou `Ctrl/Cmd+Shift+E`.
  Digitar após o `/` filtra por `shortcut`; qualquer outro texto no campo de busca filtra por
  `title` + `body` + `category`.
- Teclado obrigatório (copiar `ChatListFilters.tsx:194-269`): `↑`/`↓` navega, `Enter` usa,
  `Esc` fecha e devolve foco ao textarea, `Tab` sai. `aria-activedescendant` no item ativo.
- Cada item mostra: `title`, badge do `shortcut` (`/orientacao`), ícone de mídia se houver,
  preview de 2 linhas do corpo **já interpolado**, e chip "Pessoal" quando `visibility='personal'`.
- **Clique/Enter = envia** (D2). Ação secundária "Editar antes de enviar" (ícone de lápis no item,
  `Alt`+clique, ou `Alt`+`Enter`) insere no textarea e fecha o painel.
- Agrupamento por `category` com cabeçalhos sticky. Aba/segmented control `Organização | Minhas`.
- Estado vazio: se o operador tem `write`, CTA "Criar resposta rápida" levando ao admin.
- Desabilitado (com motivo visível) quando: janela 24h fechada, sem `livechat:message:send`,
  ou flag desligada (nesse caso o botão nem renderiza).

### 11.2 No admin (gestão)

- Rota `/admin/quick-replies`, registrada em `App.tsx` (roteador real) + `navigation.ts`.
- Card no hub `ConfiguracoesPage.tsx`, gated por permissão **e** flag (padrão das linhas 511-533).
- Listagem + drawer de criação/edição no molde `pages/admin/Products.tsx:73` +
  `ProductDrawer.tsx:354` (portal, backdrop `z-[150]`, painel `z-[160]`, Escape fecha, scroll lock).
- Formulário: `title`, `shortcut`, `category`, `body` (com inserção de variável por botão e
  contador de caracteres), upload de mídia com preview, `city_ids` (multi-select), `is_active`,
  `visibility` (só quem tem `manage` vê a opção "Organização").
- **Preview ao vivo** do corpo interpolado com dados de exemplo — o gestor vê exatamente o que o
  cidadão receberá.
- Reordenação por drag-and-drop (ou campo numérico) para quem tem `manage`.
- Tokens, tipografia e hovers: `docs/18-design-system.md` é lei. Nada de componente novo que
  duplique o que já existe.

## 12. LGPD

- `quick_replies` **não é tabela de dado pessoal do titular**: guarda texto institucional e
  referência de mídia. Nomes de cidadão entram apenas em tempo de renderização, no cliente (§6.2).
- `owner_user_id` / `created_by` são dados de **colaborador**, já cobertos pelo RoPA de usuários.
- O corpo cadastrado é conteúdo livre digitado pela gestão: o cadastro exibe aviso explícito de
  **não inserir dado pessoal de cidadão** no texto, e a validação rejeita corpo que case com os
  padrões de CPF/CNPJ/e-mail/telefone da lista canônica do doc 17 §8.4.
- Audit log em toda mutação (`quick_reply.created` / `.updated` / `.deleted`), sem o `body` no
  payload — só `quickReplyId`, `shortcut`, `visibility`.
- Outbox/socket sem PII (§9).
- Mídia da biblioteca fica em prefixo próprio do bucket; exclusão física fora do escopo (§7.5).

## 13. Fora de escopo (F28)

- Sugestão de resposta rápida por IA / ranking automático.
- Respostas rápidas usadas pelo agente LangGraph (Ana Clara) — a biblioteca é do **humano**.
- Envio de múltiplas mídias ou carrossel numa única resposta rápida.
- Compartilhamento entre organizações / marketplace de templates.
- Botões interativos (`type: 'interactive'`) — outro recurso, outro slot.
- Import/export em massa (CSV).
- Limpeza física de mídia órfã no storage.

## 14. Critérios de aceite

1. Operador com a flag ligada vê o botão de respostas rápidas no composer; com a flag desligada, não.
2. `/` no início do composer abre o seletor e filtra por atalho; `Esc` devolve o foco ao textarea.
3. Clique numa resposta de texto envia a mensagem interpolada; ela aparece no chat e chega ao
   WhatsApp com `view_status='sent'`.
4. Clique numa resposta com mídia envia a mídia com a legenda interpolada.
5. `Alt`+clique insere no composer sem enviar.
6. Fora da janela de 24h o seletor está desabilitado com aviso, e nenhuma chamada de envio é feita.
7. Gestor cria/edita/desativa uma resposta da organização e o operador com o chat aberto vê a
   mudança em ≤ 5 s, sem recarregar.
8. Operador sem `manage` não consegue criar/editar resposta de organização (403) nem enviar
   `owner_user_id` de terceiro (ignorado, forçado para si).
9. Operador A não enxerga resposta pessoal do operador B em nenhuma rota.
10. Cadastro com `{{contato.nome}}` sem fallback é rejeitado com erro claro.
11. Atalho duplicado no mesmo escopo retorna `409`.
12. `pnpm typecheck`, `lint`, `test` e `build` verdes; `slot.py check-migrations` verde.
