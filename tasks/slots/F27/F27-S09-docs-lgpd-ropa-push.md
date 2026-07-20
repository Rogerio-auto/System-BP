---
id: F27-S09
title: Docs LGPD — RoPA de push_subscriptions (doc 17 §3.3/§3.4)
phase: F27
task_ref: docs/24-pwa.md
status: done
priority: high
estimated_size: S
agent_id: null
depends_on: [F27-S06]
blocks: []
labels: [docs, lgpd]
source_docs: [docs/17-lgpd-protecao-dados.md, docs/24-pwa.md]
docs_required: false
claimed_at: 2026-07-20T16:12:52Z
completed_at: 2026-07-20T16:17:24Z
pr_url: https://github.com/Rogerio-auto/System-BP/pull/435
---

# F27-S09 — RoPA de push_subscriptions

## Objetivo

Fechar o gate LGPD do Web Push (F27-S06): registrar no RoPA (doc 17 §3.3/§3.4) o novo tratamento
de dados pessoais introduzido pela tabela `push_subscriptions` — `endpoint`/`p256dh`/`auth` como
identificador de device de colaborador interno. Exigido pelo PROTOCOL §4.1 (nova finalidade →
RoPA na mesma iniciativa) e destacado como pendência no PR #433.

## Contexto

O F27-S06 entregou o Web Push (VAPID) com o checklist do doc 17 §14.2 quase todo cumprido —
payload sem PII, `pino.redact` dos campos, soft-delete/retenção, RBAC/escopo, allowlist anti-SSRF,
guarda cross-org. **Única pendência: a atualização documental do RoPA**, que é normativa
(controlador/DPO) e ficou fora do `files_allowed` do S06. Este slot cobre exclusivamente essa
atualização de documento.

## Escopo (faz)

- **doc 17 §3.3 (RoPA por finalidade)**: adicionar a finalidade "Notificação operacional interna
  via Web Push" — base legal (legítimo interesse do controlador / execução), categorias de titular
  (colaborador interno), dados (`endpoint`, `p256dh`, `auth`, `user_agent`), retenção (soft-delete
  no opt-out/logout + remoção automática 404/410 + job de retenção de órfãs), suboperadores
  (push services do navegador — FCM/Mozilla/Apple/WNS, tratados como canal não-confiável, payload
  sem PII).
- **doc 17 §3.4 (PII por tabela)**: adicionar a linha da tabela `push_subscriptions` ao mapa
  técnico, marcando os campos de dado pessoal e a cobertura de `pino.redact`.
- Avaliar (e registrar a conclusão no PR) se há necessidade de **DPIA** — a leitura preliminar do
  doc 24 §9 é que não há novo risco alto (reutiliza padrão já avaliado, sem PII no payload, dado
  de colaborador interno), mas a decisão é do DPO.

## Fora de escopo (NÃO faz)

- Qualquer código (o backend já está em `done` — F27-S06).
- Alterar retenção/coleta real (só documentar o que já existe).

## Arquivos permitidos

- `docs/17-lgpd-protecao-dados.md`

## Arquivos proibidos

- `apps/**`
- `packages/**`
- `tasks/**`

## Definition of Done

- [ ] doc 17 §3.3 tem a finalidade de Web Push com base legal, dados, retenção e suboperadores
- [ ] doc 17 §3.4 tem a linha de `push_subscriptions` com os campos de PII e a cobertura de redact
- [ ] Conclusão sobre DPIA registrada (necessária ou justificadamente dispensável) para aval do DPO
- [ ] Consistente com o que o F27-S06 realmente implementou (sem descrever controle inexistente)

## Validação

```powershell
# Slot documental — sem build. Conferência manual de consistência com doc 24 §5/§9 e F27-S06.
git diff --stat docs/17-lgpd-protecao-dados.md
```

## Notas para o agente

- `docs/17` é **normativo** — descrever apenas o tratamento REAL (F27-S06), sem inventar controle.
- Payload de push não carrega PII (doc 24 §5.3) — refletir isso na análise de risco.
- Pendência registrada no PR #433; este slot a resolve formalmente.
  </content>
