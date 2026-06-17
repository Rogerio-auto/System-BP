---
id: F20-S08
title: Backend — deprecar env vars META_WHATSAPP_* após migração completa para channels
phase: F20
task_ref: docs/planejamento-2026-06-multi-canal.md
status: review
priority: low
estimated_size: S
agent_id: null
claimed_at: 2026-06-17T06:11:06Z
completed_at: 2026-06-17T06:17:27Z
pr_url: null
depends_on: [F20-S03, F20-S04, F20-S05, F20-S06]
blocks: []
labels: [backend, cleanup, multi-canal, whatsapp, env]
source_docs: []
docs_required: false
---

# F20-S08 — Deprecar env vars META*WHATSAPP*\* após migração completa

## Objetivo

Após todos os workers e módulos estarem usando a tabela `channels`, remover ou
deprecar as variáveis de ambiente `META_WHATSAPP_ACCESS_TOKEN`,
`META_WHATSAPP_PHONE_NUMBER_ID`, `META_WABA_ID` e `META_APP_ID` do código de
produção. Manter apenas `WHATSAPP_APP_SECRET` e `WHATSAPP_VERIFY_TOKEN` (usados
para validação de webhook — não para envio, não podem ser migrados para o banco).

## Contexto

Este slot só pode ser executado DEPOIS de F20-S03, F20-S04, F20-S05 e F20-S06
estarem merged — garantindo que nenhum código em produção usa mais as env vars
para envio/gestão de mensagens.

A remoção é gradual:

1. **Fase 1** (este slot): marcar as 4 variáveis como deprecated no `env.ts`
   com log de warning na inicialização se ainda estiverem definidas.
2. **Fase 2** (slot futuro, após validação em prod): remover completamente.

O `.env.example` deve ser atualizado para remover as 4 variáveis deprecated e
adicionar comentário explicando que as credenciais agora ficam na tabela `channels`.

## Escopo (faz)

### `apps/api/src/config/env.ts`

Marcar as 4 variáveis como deprecated:

```ts
// DEPRECATED após F20: credenciais agora ficam em channels + channel_secrets no banco.
// Manter definição para evitar crash em deploys que ainda tenham essas vars no .env.
// Serão removidas no próximo ciclo após validação em produção.
META_WHATSAPP_ACCESS_TOKEN: z.string().optional(),
META_WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
META_WABA_ID: z.string().optional(),
META_APP_ID: z.string().optional(),
```

### `apps/api/src/app.ts` (ou bootstrap)

Adicionar log de warning na inicialização se as vars ainda estiverem definidas:

```ts
if (env.META_WHATSAPP_ACCESS_TOKEN) {
  logger.warn(
    'META_WHATSAPP_ACCESS_TOKEN ainda definida no ambiente. ' +
      'Esta variável está deprecated após F20 — as credenciais devem estar na tabela channels. ' +
      'Remova do .env para eliminar este aviso.',
  );
}
// idem para META_WHATSAPP_PHONE_NUMBER_ID, META_WABA_ID, META_APP_ID
```

### `.env.example`

Mover as 4 variáveis para uma seção `# DEPRECATED — migrado para tabela channels`:

```
# DEPRECATED após F20-S03/S04/S05/S06 — remover do .env
# As credenciais WhatsApp agora ficam em channels + channel_secrets no banco.
# Cadastre o canal em Configurações > Canais na UI.
# META_WHATSAPP_ACCESS_TOKEN=
# META_WHATSAPP_PHONE_NUMBER_ID=
# META_WABA_ID=
# META_APP_ID=
```

Manter `WHATSAPP_APP_SECRET` e `WHATSAPP_VERIFY_TOKEN` (necessários para webhook):

```
# Webhook Meta WhatsApp (MANTER — validação de assinatura, não envio)
WHATSAPP_APP_SECRET=seu_app_secret
WHATSAPP_VERIFY_TOKEN=token_de_verificacao
```

## Fora de escopo (NÃO faz)

- Não remover completamente as variáveis do `env.ts` (remoção total = slot futuro pós-validação prod)
- Não alterar lógica de webhook (WHATSAPP_APP_SECRET / WHATSAPP_VERIFY_TOKEN ficam intactos)
- Não alterar workers ou módulos (já feito em S03-S06)

## Arquivos permitidos (`files_allowed`)

- `apps/api/src/config/env.ts`
- `apps/api/src/app.ts`
- `.env.example`

## Arquivos proibidos (`files_forbidden`)

- `apps/api/src/workers/**`
- `apps/api/src/modules/**`
- `apps/web/**`

## Contratos de saída

- `env.ts` ainda aceita as vars sem crash (backward-compat para deploys em transição)
- Warning de log na inicialização se vars deprecated ainda estiverem definidas
- `.env.example` documenta claramente o que é deprecated e o que substituiu
- `pnpm typecheck` verde

## Definition of Done

- [ ] `env.ts`: 4 vars deprecated com comentário explicativo
- [ ] `app.ts`: warning de log na inicialização para cada var deprecated presente
- [ ] `.env.example`: seção DEPRECATED com vars comentadas + nota de migração
- [ ] `WHATSAPP_APP_SECRET` e `WHATSAPP_VERIFY_TOKEN` intactos e obrigatórios
- [ ] `pnpm --filter @elemento/api typecheck` verde

## Comandos de validação

```powershell
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
```

## Notas para o agente

- Este slot é o último da F20 e só faz sentido após todos os outros estarem merged.
- O warning de inicialização ajuda a ops a identificar ambientes que ainda têm as
  vars antigas definidas — não remove funcionalidade, apenas alerta.
- `WHATSAPP_APP_SECRET` não deve ser tocado — é usado no handler de webhook para
  validar a assinatura HMAC da Meta; não tem nada a ver com envio de mensagens.
- Verificar se algum teste usa as env vars deprecated antes de remover — atualizar
  os testes para não dependerem delas.
