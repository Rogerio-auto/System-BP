---
id: F20-S07
title: Frontend — canal padrão, seletor de canal em regras e simulações
phase: F20
task_ref: docs/planejamento-2026-06-multi-canal.md
status: in-progress
priority: high
estimated_size: L
agent_id: null
claimed_at: 2026-06-17T05:51:20Z
completed_at: null
pr_url: null
depends_on: [F20-S01, F20-S05]
blocks: []
labels: [frontend, multi-canal, whatsapp, configuracoes, followup, cobranca, simulacoes]
source_docs:
  - docs/18-design-system.md
docs_required: true
docs_artifacts:
  - docs/help/guias/admin/canal-padrao.mdx
---

# F20-S07 — Frontend: canal padrão + seletor de canal em regras e simulações

## Objetivo

Expor no frontend as capacidades de multi-canal que o backend passa a suportar após
F20-S01 a F20-S06:

1. **Canal padrão**: na página de Canais (Configurações), permitir marcar um canal como
   padrão da organização (`is_default = true`) com toggle visual claro.
2. **Seletor em regras de followup**: ao criar/editar uma regra de follow-up, exibir
   select de canal (opcional — deixar em branco = usar padrão da org).
3. **Seletor em regras de cobrança**: mesmo padrão nas regras de cobrança.
4. **Seletor na simulação de crédito**: ao disparar simulação via WhatsApp, mostrar
   qual canal será usado e permitir trocar.

## Contexto

Com `channel_id` agora existindo em regras e simulações (F20-S01), a UI precisa:

- Mostrar ao usuário qual canal está ativo/padrão
- Permitir associar explicitamente uma regra a um canal específico
- Confirmar antes de disparar uma simulação qual canal será usado

Design: light-first, tokens canônicos do DS. Nenhum hex hardcoded. Sem novo componente
global — usar `<select>` nativo estilizado ou componente Combobox existente.

## Escopo (faz)

### 1. API client (`apps/web/src/features/configuracoes/canais/api.ts`)

Adicionar mutation `useSetDefaultChannel`:

```ts
async function setDefaultChannel(channelId: string): Promise<void>;
// PATCH /api/channels/:id/default
```

E query `useChannels` (se não existir) que retorna lista com campo `isDefault: boolean`.

### 2. `apps/web/src/features/configuracoes/canais/CanaisPage.tsx`

Para cada canal listado, adicionar badge/botão "Canal padrão":

- Se `isDefault = true`: badge verde "Padrão" com ícone de check
- Se `isDefault = false` e há múltiplos canais: botão ghost "Definir como padrão" (chama `setDefaultChannel`)
- Se só existe um canal: badge cinza "Padrão (único)" sem botão (já é o padrão implícito)

Feedback de loading e erro inline (não toast) ao definir padrão.

### 3. Backend: endpoint PATCH /api/channels/:id/default

Criar no backend (arquivo permitido `apps/api/src/modules/channels/routes.ts`):

```
PATCH /api/channels/:id/default
  Permissão: channels:manage
  Body: vazio
  Ação: SET is_default = true WHERE id = :id AND organization_id = actor.orgId;
        SET is_default = false WHERE id != :id AND organization_id = actor.orgId
        (em uma transação)
  Resposta: 200 com o canal atualizado
```

### 4. Seletor de canal em regras de follow-up

Localizar o formulário de criação/edição de regras de follow-up no frontend.
Adicionar campo `channelId` (select opcional):

```
Canal de envio
[ Canal padrão da organização ▼ ]   (placeholder quando channelId = null)
  ○ Canal padrão da organização
  ● Número: +55 69 99999-9999 (Canal A)
  ○ Número: +55 69 88888-8888 (Canal B)
```

- Opção nula = "Canal padrão" (não envia channelId no payload → backend usa is_default)
- Valor selecionado = UUID do canal → enviado como `channelId` no body
- Só exibir o campo se `channels.length > 1` (com um único canal, sem necessidade de
  mostrar — simplifica a UX para o caso comum)

Atualizar schema Zod/React Hook Form para aceitar `channelId?: string | null`.
Atualizar API call para enviar `channelId` no body.

### 5. Seletor de canal em regras de cobrança

Mesmo padrão do item 4 aplicado nas regras de cobrança.

### 6. Indicador de canal na tela de simulação

Na tela/modal de disparo de simulação por WhatsApp:

- Mostrar "Será enviado por: [nome do canal padrão]" em texto pequeno
- Se múltiplos canais: link "trocar" que abre inline select
- Enviar `channelId` no body do POST de disparo (ou null para usar padrão)

## Fora de escopo (NÃO faz)

- Não criar página nova de gerenciamento de canais
- Não implementar analytics de mensagens por canal
- Não implementar fallback automático de canal na UI
- Não suporte a meta_instagram ou waha na UI (manter apenas meta_whatsapp)

## Arquivos permitidos (`files_allowed`)

- `apps/web/src/features/configuracoes/canais/CanaisPage.tsx`
- `apps/web/src/features/configuracoes/canais/api.ts` (criar se não existir)
- `apps/web/src/features/followup/` (arquivos de regras de followup — identificar com grep)
- `apps/web/src/features/cobranca/` (arquivos de regras de cobrança — idem)
- `apps/web/src/features/credit-analyses/` (simulação — verificar com grep)
- `apps/api/src/modules/channels/routes.ts`
- `apps/api/src/modules/channels/controller.ts`
- `apps/api/src/modules/channels/service.ts`
- `apps/api/src/modules/channels/schemas.ts`

## Arquivos proibidos (`files_forbidden`)

- `apps/api/src/workers/**`
- `apps/api/src/modules/billing/**`
- `apps/api/src/modules/simulations/**`
- `apps/api/src/db/schema/**`
- `apps/api/src/db/migrations/**`

## Contratos de saída

- UI permite marcar canal como padrão (com feedback visual)
- Regras de followup e cobrança têm select de canal quando há múltiplos canais
- Formulário de disparo de simulação mostra/permite trocar o canal
- Todos os endpoints novos validados com Zod
- `pnpm typecheck` verde, `pnpm build` verde

## Definition of Done

- [ ] `CanaisPage.tsx`: badge "Padrão" e botão "Definir como padrão" com loading/erro
- [ ] `PATCH /api/channels/:id/default` implementado e com autorização `channels:manage`
- [ ] Formulário de regra de followup: campo canal (visível apenas se > 1 canal)
- [ ] Formulário de regra de cobrança: idem
- [ ] Simulação: indicador + seletor de canal antes do disparo
- [ ] Tokens de DS usados em todo novo markup (nenhum hex, nenhuma cor hardcoded)
- [ ] `pnpm --filter @elemento/web typecheck` verde
- [ ] `pnpm --filter @elemento/web build` verde

## Comandos de validação

```powershell
pnpm --filter @elemento/web typecheck
pnpm --filter @elemento/web build
pnpm --filter @elemento/api typecheck
```

## Notas para o agente

- Usar `docs/18-design-system.md` para tokens e padrões de componente — DS é lei.
- Identificar os formulários de regras com:
  `grep -rn "followup.*rule\|FollowupRule\|regra.*followup" apps/web/src/ --include="*.tsx" -l`
  `grep -rn "collection.*rule\|CollectionRule\|regra.*cobran" apps/web/src/ --include="*.tsx" -l`
- O endpoint `PATCH /api/channels/:id/default` deve usar transação para garantir que
  apenas um canal tenha `is_default = true` por organização — não usar UPDATE individual.
- `useChannels` hook (ou equivalente) provavelmente já existe — verificar antes de criar novo.
- "Canal padrão da organização" como opção nula no select deve ficar sempre como
  primeiro item e não deve ser removível pelo usuário.
- Formulários que já usam React Hook Form: adicionar `channelId` como campo controlado
  com `Controller` ou `register('channelId')`.
