---
id: F29-S03
title: Backend — transcodificar áudio webm→ogg antes de enviar ao WhatsApp
phase: F29
task_ref: docs/05-modulos-funcionais.md
status: done
priority: high
estimated_size: M
agent_id: null
depends_on: []
blocks: []
labels: [backend, livechat, whatsapp, media, ffmpeg]
source_docs: [docs/05-modulos-funcionais.md]
docs_required: false
claimed_at: 2026-07-24T17:23:14Z
completed_at: 2026-07-24T17:46:21Z
pr_url: https://github.com/Rogerio-auto/System-BP/pull/456
---

# F29-S03 — Transcodificar áudio webm→ogg no envio (WhatsApp não aceita webm)

## Objetivo

Fazer o envio de áudio gravado no app funcionar no WhatsApp: converter o áudio
gravado pelo navegador (`audio/webm;codecs=opus`, no Android/Chrome) para
`audio/ogg` (Opus) — o formato de voice note que o WhatsApp aceita — antes de
mandar o link à Meta.

## Contexto

Reportado pelo Rogério (2026-07-24): enviar áudio pelo app do celular falha. Causa
confirmada:

- `useAudioRecorder` grava `audio/webm;codecs=opus` (Chrome/Android) — é o único
  formato que o Chrome expõe no `MediaRecorder`. (No iOS o Safari grava `audio/mp4`,
  que o WhatsApp aceita — por isso o bug é sobretudo no Android.)
- O upload é 2-fases direto pro storage (a API não vê os bytes); o worker de saída
  (`workers/livechat-outbound.ts` → `serializer.ts:serializeMedia`) manda
  `type:'audio'` com `{ link: publicMediaUrl }`. A Meta baixa o arquivo, vê que é
  **webm** e **rejeita** (formatos de áudio suportados: aac, amr, mpeg, mp4, ogg-Opus).

A boa notícia: o áudio **já é Opus**, só no container errado. webm/opus → ogg/opus
é uma **remuxagem** (troca de container, sem recomprimir) — rápida e sem perda.

## Escopo (faz)

- **ffmpeg na imagem:** adicionar `ffmpeg` ao estágio de runtime do
  `apps/api/Dockerfile` (`apt-get install -y --no-install-recommends ffmpeg` +
  limpeza de cache apt). É o que os workers (imagem `elemento-api`) usam.
- **Helper de transcodificação:** `apps/api/src/lib/media/transcodeAudioToOgg.ts` —
  recebe um Buffer/stream de áudio, roda ffmpeg (`-i pipe:0 -c:a libopus -f ogg
pipe:1`; preferir remux `-c:a copy` e cair para re-encode libopus se falhar),
  retorna o Buffer ogg. Timeout defensivo + mata o processo em erro. Sem shell
  injection (spawn com args array, nunca string).
- **Hook no envio:** no caminho de saída de mídia (worker `livechat-outbound.ts`
  ou onde o job de mídia é preparado antes do `serializeMedia`), **somente para
  `mediaKind` `audio`/`voice`** cujo formato de origem seja webm (detectar por
  `mime`/extensão do `publicMediaUrl` — ex.: termina em `.webm` ou mime
  `audio/webm`): baixar o arquivo do storage, transcodificar para ogg, **re-subir
  via a fachada de storage** (`apps/api/src/lib/storage`), e trocar o
  `publicMediaUrl` (+ mime `audio/ogg`) pelo do ogg antes de serializar. Formatos
  já compatíveis (mp4/aac/ogg/mpeg/amr) passam **direto, sem transcodificar**.
- **Idempotência/robustez:** a transcodificação não pode duplicar envio nem
  quebrar o fluxo dos outros tipos de mídia. Falha de transcodificação → registrar
  erro claro (sem PII, sem logar URL/bytes) e falhar o envio daquele áudio de forma
  visível (não engolir silenciosamente). Não persistir o áudio localmente (LGPD
  doc 17 — só em memória/tmp efêmero, apagado ao fim).
- **Testes:** helper transcodifica um webm/opus de fixture para ogg válido;
  o hook só dispara para áudio webm e passa mp4/ogg direto; falha de ffmpeg é
  tratada; nenhum outro tipo de mídia (imagem/vídeo/documento) é afetado.

## Fora de escopo (NÃO faz)

- Mudar o gravador do frontend (`useAudioRecorder`) — a correção é no backend.
- Transcodificar imagem/vídeo/documento.
- Mudar o contrato de upload (continua 2-fases direto pro storage).
- Marcar como "voice note" (`voice:true`) — enviar como áudio normal já resolve o
  bug de formato (o serializer já mapeia voice→audio).

## Arquivos permitidos

- `apps/api/Dockerfile`
- `apps/api/src/lib/media/**`
- `apps/api/src/workers/livechat-outbound.ts`
- `apps/api/src/integrations/channels/meta/whatsapp/serializer.ts`
- `apps/api/src/**/__tests__/**` (testes relacionados ao acima)
- `apps/api/test-fixtures/**` (fixture de áudio, se necessário)

## Arquivos proibidos

- `apps/web/**`
- `apps/langgraph-service/**`
- `packages/**`
- `apps/api/src/db/**`

## Contratos de entrada

- Job de mídia de saída com `mediaKind` `audio`/`voice`, `publicMediaUrl` e (quando
  disponível) `mime`.
- Fachada de storage existente (`apps/api/src/lib/storage`) para download + upload.

## Contratos de saída

- Áudio webm é enviado ao WhatsApp como `audio/ogg` (Opus) e é aceito.
- Demais formatos e tipos de mídia inalterados.

## Definition of Done

- [ ] `ffmpeg` presente na imagem de runtime da API (build passa)
- [ ] Helper de transcodificação webm→ogg com testes
- [ ] Envio de áudio webm vira ogg antes de ir à Meta; mp4/ogg passam direto
- [ ] Falha de transcodificação tratada (sem PII em log, sem envio silenciosamente quebrado)
- [ ] Nenhum outro tipo de mídia afetado
- [ ] `pnpm --filter @elemento/api typecheck` + `lint` + `test` verdes

## Validação

```powershell
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api test
```

## Notas para o agente

- Remux primeiro (`-c:a copy`), re-encode `libopus` só como fallback — mais rápido
  e sem perda quando a origem já é Opus.
- `spawn` com array de args (nunca string) — sem injeção de shell. Nunca logar a
  URL da mídia, o nome do arquivo nem os bytes (LGPD doc 17 §8.3/§8.5).
- Use tmp efêmero ou pipes; apague qualquer arquivo temporário no `finally`.
- Detectar "precisa transcodificar" por mime `audio/webm` OU extensão `.webm` do
  `publicMediaUrl` — o gravador nomeia o arquivo `audio.webm`.
- Reusar a fachada `lib/storage` (respeita `STORAGE_PROVIDER=supabase` em prod) —
  nunca chamar `r2.js` direto. O novo objeto ogg pode ter o mesmo nome com sufixo
  `.ogg`.
- Deploy depois: a imagem `elemento-api:prod` é rebuildada e os serviços
  api/outbox/livechat/workers atualizados via `docker service update --force`.
