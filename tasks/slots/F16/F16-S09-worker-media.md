---
id: F16-S09
title: Worker media — download via adapter, dedup SHA-256, upload R2, media_ready
phase: F16
task_ref: docs/planejamento-live-chat-proprio.md#5-midia-pipeline
status: available
priority: medium
estimated_size: M
agent_id: null
claimed_at: null
completed_at: null
pr_url: null
depends_on: [F16-S01, F16-S05, F16-S07]
blocks: []
labels: [lgpd-impact]
source_docs:
  - docs/planejamento-live-chat-proprio.md
  - docs/17-lgpd-protecao-dados.md
docs_required: false
docs_audience: [dev]
docs_artifacts: []
---

# F16-S09 — Worker media

## Objetivo

Consumir `hm.q.inbound.media`, baixar a mídia via adapter, deduplicar por SHA-256, subir no R2 e
atualizar a mensagem com a URL — publicando `message:media_ready` para o front trocar o placeholder.

## Contexto

URLs de mídia da Meta expiram; o worker materializa no nosso storage (R2, decisão D6). Passo 5 do
planejamento. Separado do inbound para isolar concorrência/memória (ffmpeg/sharp).

## Escopo (faz)

- `workers/livechat-media.ts`: consumer com concorrência limitada (`OUTBOUND_MEDIA_MAX_CONCURRENCY`).
  1. `adapter.downloadMedia`; 2. SHA-256; 3. dedup (reusa `media_url` se hash já existe); 4. upload R2
     com key `{orgId}/{yyyy}/{mm}/{dd}/{uuid}.{ext}`; 5. update `messages.media_*`; 6. publish
     `socket.relay` `message:media_ready`.
- Conversão opcional (sharp para imagem; ffmpeg para áudio/vídeo) com limite de tamanho (25MB).

## Fora de escopo (NÃO faz)

- Upload de mídia outbound (S13 faz signed-url; o envio é S10).
- Inbound de texto (S08).

## Arquivos permitidos (`files_allowed`)

- `apps/api/src/workers/livechat-media.ts`
- `apps/api/src/workers/__tests__/livechat-media.test.ts`

## Arquivos proibidos (`files_forbidden`)

- `apps/api/src/workers/index.ts` (S08 registra os workers — coordenar via S08; se precisar, sequenciar)
- `apps/api/src/modules/livechat/**`

## Contratos de entrada

- Job `inbound.media` (S08), `adapter.downloadMedia` (S05), R2 client (S01), update via `livechatService` (S07).

## Definition of Done

- [ ] Download + SHA-256 + dedup (hash existente reusa URL, não re-sobe)
- [ ] Upload R2 com key namespaced por org/data
- [ ] `messages.media_url/mime/size/sha256` atualizados
- [ ] Publica `message:media_ready`
- [ ] Limite de tamanho + timeout no download (mídia grande não estoura memória)
- [ ] **LGPD:** mídia pode conter PII; preferir referência/ID; logs sem URL assinada; label `lgpd-impact`
- [ ] `pnpm --filter @elemento/api typecheck` / `lint` / `test` verdes

## Comandos de validação

```powershell
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api test -- livechat-media
```

## Notas para o agente

- Registro do worker: se `workers/index.ts` já foi tocado por S08, este slot depende de S08 estar `done`
  (ou coordene o registro lá). Mantido fora de `files_allowed` aqui para não colidir.
- Stream o download; nunca carregar o arquivo inteiro em memória sem limite.
