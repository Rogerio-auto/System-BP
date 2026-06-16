---
id: F19-S05
title: Frontend — botão "Encaminhar para advocacia" na ficha do inadimplente
phase: F19
task_ref: docs/planejamento-2026-06-evolucao.md
status: done
priority: high
estimated_size: S
agent_id: null
claimed_at: null
completed_at: 2026-06-16T19:22:28Z
pr_url: https://github.com/Rogerio-auto/System-BP/pull/297
depends_on: [F19-S03, F19-S04]
blocks: []
labels: [frontend, advocacia, crm, cobranca]
source_docs:
  - docs/planejamento-2026-06-evolucao.md
  - docs/18-design-system.md
docs_required: true
docs_audience:
  - operador
docs_artifacts:
  - docs/help/guias/advocacia/encaminhar-cliente.mdx
---

# F19-S05 — Frontend: encaminhar cliente para advocacia

## Objetivo

Permitir que o agente encaminhe um cliente inadimplente para o escritório de advocacia com um clique, com sugestão automática por cidade e controle de cooldown.

## Contexto

Item 10 / F.3b. Ação na ficha do cliente inadimplente. Reaproveita: escritório sugerido por cidade (`GET /api/law-firms/suggest?customer_id=`) e ação de encaminhamento (`POST /api/customers/:id/law-firm-referral`). Decisão D15: pré-seleciona padrão da cidade, agente pode trocar.

## Escopo (faz)

- Botão "Encaminhar para advocacia" na ficha do inadimplente (`CrmDetailPage` — verificar onde fica a seção de cobrança; pode também estar em CustomerDetailPage ou similar)
- Gate: `useFeatureFlag('law_firm.referral.enabled')` — se false, ocultar botão
- Gate: cooldown ativo → botão desabilitado com tooltip "Já encaminhado em DD/MM — cooldown até DD/MM/YYYY"
- Badge "Encaminhado para advocacia" na ficha quando cooldown ativo (data + nome do escritório)
- Modal de confirmação "Encaminhar para advocacia":
  - Busca sugestão via `GET /api/law-firms/suggest?customer_id=` (auto-sugere)
  - Se não houver sugestão: dropdown de todos os escritórios da org
  - Campo de observações (opcional)
  - Botão "Confirmar encaminhamento" → `POST /api/customers/:id/law-firm-referral`
  - Loading state durante envio
- Toast de sucesso: "Cliente encaminhado para [nome do escritório] ✓"
- Erro `LAW_FIRM_COOLDOWN`: "Encaminhamento em cooldown até [data]."
- DS: tokens canônicos, sem hex

## Fora de escopo (NÃO faz)

- Cadastro de escritórios (F19-S04)
- LangGraph (F19-S06)

## Arquivos permitidos (`files_allowed`)

- `apps/web/src/features/customers/**`
- `apps/web/src/features/crm/CrmDetailPage.tsx`
- `docs/help/guias/advocacia/encaminhar-cliente.mdx`

## Arquivos proibidos (`files_forbidden`)

- `apps/web/src/features/law-firms/**` (F19-S04 é dono)
- `apps/api/**`

## Contratos de entrada

- `GET /api/law-firms/suggest?customer_id=` → `{ data: LawFirmResponse | null }` (F19-S02)
- `GET /api/law-firms` → lista completa caso sugestão seja null (F19-S02)
- `POST /api/customers/:id/law-firm-referral` → `{ ok: true, cooldown_until }` (F19-S03)

## Definition of Done

- [ ] Botão visível quando feature flag ligada e cooldown inativo
- [ ] Botão desabilitado com tooltip quando cooldown ativo
- [ ] Badge na ficha com data e escritório após encaminhamento
- [ ] Modal com sugestão automática + opção de trocar
- [ ] Toast sucesso e erro inline
- [ ] DS aplicado (tokens, sem hex)
- [ ] Doc mdx gerada
- [ ] `pnpm --filter @elemento/web typecheck && lint` verdes

## Comandos de validação

```powershell
pnpm --filter @elemento/web typecheck
pnpm --filter @elemento/web lint
```

## Notas para o agente

- Verificar onde fica hoje a ficha do inadimplente (pode ser `CrmDetailPage.tsx` ou uma sub-seção de clientes com contratos vencidos — leia o código antes de editar).
- O `cooldown_until` vem da API ao tentar `POST` (409) ou pode ser buscado ao carregar a ficha se houver endpoint de status.
- Se não houver endpoint dedicado de status do cliente, checar a listagem de `customer_law_firm_referrals` — pode precisar de `GET /api/customers/:id/law-firm-referral` (verificar se F19-S03 o entrega ou se precisa de ajuste).
