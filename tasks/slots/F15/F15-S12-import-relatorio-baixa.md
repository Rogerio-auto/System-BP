---
id: F15-S12
title: Importar relatório de baixa — conciliação CPF + nº da parcela (BLOCKED — D10)
phase: F15
task_ref: null
status: blocked
priority: medium
estimated_size: L
agent_id: null
claimed_at: null
completed_at: null
pr_url: null
depends_on: []
blocks: []
labels: [cobranca, imports, conciliacao, lgpd, blocked-decision]
source_docs:
  - docs/planejamento-2026-06-evolucao.md#f1-importar-relatório-de-baixa-item-7
  - docs/17-lgpd-protecao-dados.md
---

# F15-S12 — Importar relatório de baixa (item 7)

> **BLOQUEADO por decisão D10:** aguarda o Rogério trazer o exemplo real (anonimizado) do
> relatório de baixa (cabeçalhos das colunas) para fechar o mapeamento definitivo e o caso
> de cliente com múltiplos contratos. Quando D10 chegar, **dividir este slot** em
> (a) schema/conciliação backend e (b) UI de mapeamento — não implementar como um único PR.

## Objetivo

Ao importar o relatório semanal de baixas, dar baixa automática na **parcela exata** informada (concilia por CPF-hash + número da parcela; telefone/nome como reforço) e cancelar os `collection_jobs` pendentes daquela parcela.

## Contexto

Item 7 / Épico F.1. Reaproveita o módulo `imports` genérico (já tem mapeamento de colunas em `features/imports/StepConfirm.tsx`). Conciliação: CPF (`hashDocument` → `customers.document_hash`) identifica o cliente; `payment_dues.installment_number` identifica a parcela; telefone normalizado precisa **prefixar DDI 55** (relatório vem sem o 55). Decisão D9: baixa na parcela informada; ambíguo (cliente com 2 contratos, mesma numeração) → logar para revisão manual.

## Escopo (faz) — a detalhar quando D10 chegar

- Normalização das chaves na borda de importação (CPF strip+hash; telefone +55; nome sem acento só para reforço).
- Conciliação em camadas (CPF→customer, parcela→`payment_dues`, telefone/nome reforço).
- Marcar `paid` + `paid_at`; cancelar `collection_jobs` pendentes; idempotência por batch (re-subir não duplica baixa nem reabre parcela paga).
- Relatório de resultado: casados / não encontrados / ambíguos.
- UI: mapeamento de colunas (nome, telefone, CPF, nº da parcela) + preview com PII mascarada (`lib/format/pii.ts`).

## Fora de escopo (NÃO faz)

- Integração bancária / leitura automática de boleto.
- Entidade contrato (Épico E) — a baixa opera direto sobre `payment_dues`.

## Arquivos permitidos (`files_allowed`)

- _A definir na divisão pós-D10_ (provável: `apps/api/src/modules/imports/**`, `apps/api/src/workers/import-processor.ts`, `apps/web/src/features/imports/**`).

## Definition of Done

- [ ] **Pré-requisito:** D10 respondida (exemplo real do relatório) e slot dividido
- [ ] Conciliação por CPF+parcela com reforço telefone/nome
- [ ] Idempotência por batch; ambíguos logados para revisão manual
- [ ] PII mascarada no preview; checklist §14.2 do doc 17
- [ ] Testes de conciliação (casado / não encontrado / ambíguo / re-subida)

## Comandos de validação

```powershell
pnpm --filter @elemento/api test -- imports
```

## Notas para o agente

- **Não claimar enquanto status=blocked.** Destravar só após D10 e a divisão em sub-slots.
- Telefone: tolerância ao nono dígito ausente em cadastros legados (casar por sufixo).
