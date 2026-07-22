---
id: F28-S04
title: Backend — mídia da biblioteca (signed URL) e telemetria de uso
phase: F28
task_ref: docs/25-respostas-rapidas.md
status: blocked
priority: high
estimated_size: S
agent_id: null
depends_on: [F28-S03]
blocks: [F28-S06, F28-S07]
labels: [backend, livechat, quick-replies, storage]
source_docs: [docs/25-respostas-rapidas.md, docs/17-lgpd-protecao-dados.md]
docs_required: false
claimed_at: null
completed_at: null
pr_url: null
---

# F28-S04 — Mídia da biblioteca e contador de uso

## Objetivo

Permitir anexar mídia a uma resposta rápida (upload em duas fases, com key própria no storage) e
registrar quantas vezes cada resposta foi usada.

## Contexto

Doc 25 §7 e §10. O live chat já sobe mídia em duas fases (signed URL + `PUT` direto do browser) em
`modules/conversations/send.service.ts:733`. Aqui o mecanismo é o mesmo, mas a key usa o prefixo
`quick-replies/{organizationId}/{uuid}{ext}` — mídia de biblioteca é ativo institucional, não dado
de conversa, e não pode ser confundida com o material sujeito à retenção do atendimento.

O serializer da Meta envia mídia por **`link` (URL pública)**, não `media_id` — a URL retornada
precisa ser publicamente alcançável.

## Escopo (faz)

- `POST /api/quick-replies/uploads/signed-url` — body `{ fileName, mime, sizeBytes }`, resposta
  `{ uploadUrl, publicMediaUrl, expiresAt }`:
  - Reusa `createSignedUploadUrl` de `lib/storage`.
  - Key `quick-replies/{organizationId}/{uuid}{ext}` — **sem PII na key**.
  - Valida MIME contra a allowlist e tamanho por `maxUploadBytesForMime` (mesmos limites do live chat).
  - Exige `livechat:quick_reply:write` + `featureGate`.
- `POST /api/quick-replies/:id/used` — incrementa `usage_count` e grava `last_used_at`:
  - Exige `livechat:quick_reply:read` + `featureGate`.
  - Sem `Idempotency-Key`: contador aproximado é aceitável.
  - `UPDATE ... SET usage_count = usage_count + 1` atômico, escopado por `organization_id` e pela
    regra de visibilidade (não é possível incrementar a resposta pessoal de outro).
  - Resposta `204`. Nunca lança para o cliente por falha de telemetria.
- Testes: key gerada sem PII e com o prefixo correto; MIME/tamanho fora do limite → 400;
  incremento concorrente é atômico; incremento em resposta de outro operador → 404.

## Fora de escopo (NÃO faz)

- CRUD de respostas rápidas (F28-S03 — já feito).
- Qualquer alteração no envio de mensagem (`modules/conversations/**`) — o envio reusa
  `POST /api/conversations/:id/messages` sem modificação.
- Limpeza física de mídia órfã no storage (doc 25 §13).
- Qualquer frontend.

## Arquivos permitidos

- `apps/api/src/modules/quick-replies/**`

## Arquivos proibidos

- `apps/web/**`
- `apps/langgraph-service/**`
- `apps/api/src/db/**`
- `apps/api/src/workers/**`
- `apps/api/src/modules/conversations/**`
- `apps/api/src/lib/storage/**`
- `apps/api/src/app.ts`
- `packages/**`

## Contratos de entrada

- Módulo `quick-replies` registrado e funcional (F28-S03).
- `quickReplySignedUrlBodySchema` (F28-S02).

## Contratos de saída

- `POST /api/quick-replies/uploads/signed-url` retornando `publicMediaUrl` estável e público.
- `POST /api/quick-replies/:id/used` (204).

## Definition of Done

- [ ] Signed URL com key `quick-replies/{orgId}/{uuid}{ext}` e sem PII, coberta por teste
- [ ] Limites por MIME idênticos aos do live chat (reuso, não cópia)
- [ ] `usage_count` incrementado atomicamente em SQL (sem read-modify-write)
- [ ] Telemetria não consegue tocar resposta pessoal de outro operador (teste)
- [ ] `featureGate` e permissões aplicadas
- [ ] `pnpm --filter @elemento/api typecheck` + `lint` + `test` + `build` verdes

## Validação

```powershell
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api test
pnpm --filter @elemento/api build
```

## Notas para o agente

- Molde da signed URL: `modules/conversations/send.service.ts:733` (`generateUploadSignedUrl`) —
  **copiar o padrão, mudar o prefixo da key**. Não importar a função do módulo de conversas.
- O driver de storage é resolvido em runtime por `env.STORAGE_PROVIDER` (`lib/storage/index.ts:34`).
  Não assumir R2 nem Supabase no código do módulo.
- A URL precisa ser alcançável pela Meta a partir da internet. Em prod o bucket `elemento-media` é
  público — não gerar URL assinada de leitura de curta duração para `publicMediaUrl`.
- Registro do plugin já foi feito no F28-S03; `app.ts` está proibido aqui de propósito.
