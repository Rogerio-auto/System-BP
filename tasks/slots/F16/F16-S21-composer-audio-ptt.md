---
id: F16-S21
title: Composer — gravação de áudio PTT (push-to-talk)
phase: F16
task_ref: docs/planejamento-live-chat-proprio.md
status: in-progress
priority: medium
estimated_size: M
agent_id: null
claimed_at: 2026-06-16T18:46:18Z
completed_at: null
pr_url: null
depends_on: [F16-S18]
blocks: []
labels: []
source_docs:
  - docs/planejamento-live-chat-proprio.md
  - docs/18-design-system.md
docs_required: false
docs_audience: []
docs_artifacts: []
---

# F16-S21 — Composer: gravação de áudio PTT

## Objetivo

Permitir que o atendente grave e envie áudios (push-to-talk) diretamente pelo browser,
igual ao comportamento do WhatsApp Web.

## Contexto

O backend suporta `type: 'media', mediaKind: 'voice'` (mapeado para `audio` na Meta API).
O hook `useUploadMedia` (S18) já implementa o upload via signed-url — este slot reutiliza.

**API do browser:** `MediaRecorder` + `getUserMedia` — sem dependência externa.
Formato de saída: `audio/webm;codecs=opus` (suportado em Chrome/Edge/Firefox) ou
`audio/ogg;codecs=opus` (fallback Firefox). A Meta aceita `audio/ogg` e `audio/mpeg`.
Conversão para mp3 não é necessária — a Meta aceita ogg/webm diretamente como voice.

## Escopo (faz)

- Botão de microfone no MessageComposer (substitui área de texto durante gravação)
- Pressionar → solicita permissão `getUserMedia({ audio: true })` → inicia `MediaRecorder`
- Durante gravação:
  - Timer crescente (00:00 → MM:SS)
  - Visualização de amplitude simples (barra pulsante via `AnalyserNode`)
  - Botão cancelar (descarta) e botão enviar (para + envia)
- Ao enviar: agrupa os chunks do MediaRecorder em Blob → chama `useUploadMedia` (S18) →
  envia `{ type: 'media', mediaKind: 'voice', publicMediaUrl, mime, fileName: 'audio.ogg' }`
- Permissão negada: mensagem amigável ("Permissão de microfone necessária")
- Limite: 5 minutos (restrição Meta para voice messages)

## Arquivos permitidos (`files_allowed`)

- `apps/web/src/features/conversations/components/MessageComposer/AudioRecorder.tsx` (novo)
- `apps/web/src/features/conversations/components/MessageComposer/MessageComposer.tsx`
- `apps/web/src/features/conversations/hooks/useAudioRecorder.ts` (novo)

## Arquivos proibidos (`files_forbidden`)

- `apps/api/**`
- `package.json` (sem nova dependência)

## Definition of Done

- [ ] Clicar no microfone → browser pede permissão → inicia gravação
- [ ] Timer e amplitude visíveis durante gravação
- [ ] Clicar em enviar → upload → bolha de áudio aparece no chat
- [ ] Clicar em cancelar → descarta, volta ao composer normal
- [ ] Permissão negada → mensagem de erro amigável
- [ ] Gravação > 5 min → para automaticamente e envia
- [ ] `pnpm --filter @elemento/web typecheck` / `lint` verdes

## Comandos de validação

```powershell
pnpm --filter @elemento/web typecheck
pnpm --filter @elemento/web lint
```
