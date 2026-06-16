---
id: F16-S18
title: Composer — upload de mídia (imagem, vídeo, documento, áudio)
phase: F16
task_ref: docs/planejamento-live-chat-proprio.md
status: done
priority: high
estimated_size: M
agent_id: null
claimed_at: 2026-06-16T18:21:06Z
completed_at: 2026-06-16T18:34:39Z
pr_url: https://github.com/Rogerio-auto/System-BP/pull/292
depends_on: [F16-S13, F16-S17]
blocks: [F16-S21]
labels: []
source_docs:
  - docs/planejamento-live-chat-proprio.md
  - docs/18-design-system.md
docs_required: false
docs_audience: []
docs_artifacts: []
---

# F16-S18 — Composer: upload de mídia

## Objetivo

Implementar o fluxo completo de envio de mídia no MessageComposer. O botão de anexo já existe
como placeholder no composer (S17) — este slot conecta o handler real.

## Contexto

O backend já tem tudo pronto:

- `POST /api/conversations/:id/uploads/signed-url` → retorna `{ uploadUrl, publicMediaUrl, expiresAt }`
- `PUT <uploadUrl>` direto para R2 (sem passar pelo backend)
- `POST /api/conversations/:id/messages` com `{ type: 'media', mediaKind, publicMediaUrl, mime, fileName }`

O composer em `apps/web/src/features/conversations/components/MessageComposer/MessageComposer.tsx`
já tem `<input type="file" accept="image/*,video/*,audio/*,application/pdf,.doc,.docx">` mas sem handler.

## Escopo (faz)

- Handler no MessageComposer para `onChange` do input de arquivo
- Preview antes de enviar: thumbnail (imagem/vídeo) ou ícone + nome + tamanho (doc/áudio)
- Progress bar durante o PUT para R2 (usando `XMLHttpRequest` para ter progresso real)
- Botão cancelar upload em andamento
- Envio automático após upload completo (chama `sendMessage` da mutation existente)
- Detecção de `mediaKind` a partir do MIME type: `image/*` → `image`, `video/*` → `video`,
  `audio/*` → `audio`, `application/pdf` + `doc*` → `document`
- Limite de tamanho: 16 MB (WhatsApp limit) — rejeitar com mensagem amigável antes de fazer upload
- LGPD: não logar nome de arquivo nem URL em console

## Fora de escopo (NÃO faz)

- Gravação de áudio (S21)
- Stickers
- Multi-arquivo (apenas 1 arquivo por envio)

## Arquivos permitidos (`files_allowed`)

- `apps/web/src/features/conversations/components/MessageComposer/**`
- `apps/web/src/features/conversations/hooks/useUploadMedia.ts` (novo)

## Arquivos proibidos (`files_forbidden`)

- `apps/web/src/features/conversations/queries.ts` (S15 dono)
- `apps/web/src/lib/realtime/**` (S15 dono)
- `apps/api/**`

## Contratos de saída

- Hook `useUploadMedia` exportado — reutilizado por S21 (gravação de áudio)

## Definition of Done

- [ ] Selecionar imagem → preview thumbnail → upload → bolha aparece no chat
- [ ] Selecionar PDF → preview nome → upload → bolha de documento no chat
- [ ] Arquivo > 16 MB → mensagem de erro inline, sem upload
- [ ] Progress bar visível durante upload
- [ ] Cancelar upload em andamento aborta o XHR e limpa o preview
- [ ] `pnpm --filter @elemento/web typecheck` / `lint` verdes

## Comandos de validação

```powershell
pnpm --filter @elemento/web typecheck
pnpm --filter @elemento/web lint
```
