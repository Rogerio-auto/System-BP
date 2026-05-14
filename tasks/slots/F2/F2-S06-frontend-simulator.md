---
id: F2-S06
title: Frontend simulador interno (form + resultado + amortização)
phase: F2
task_ref: T2.6
status: available
priority: high
estimated_size: M
agent_id: frontend-engineer
claimed_at:
completed_at:
pr_url:
depends_on: [F2-S04, F1-S08]
blocks: []
labels: []
source_docs:
  - docs/18-design-system.md
  - docs/design-system/index.html
  - docs/05-modulos-funcionais.md
---

# F2-S06 — Frontend simulador interno

## Objetivo

Tela `/simulator` (ou drawer disparado a partir do `CrmDetailPage`, decisão no slot) que
permite ao agente simular crédito para um lead: escolher produto + valor + prazo, ver
resultado (parcela, total, juros) e tabela de amortização. Submete `POST /api/simulations`
(F2-S04) e mostra o resultado.

## Escopo

### Página `/simulator` (standalone) — caminho A

Layout em 2 colunas (desktop):

**Coluna esquerda — Form (sticky):**

- `Select` lead (combobox com search — reutilizar `UserCombobox` se viável; senão criar
  `LeadCombobox`). Mostra nome + cidade + status.
- `Select` produto (puxa `GET /api/credit-products`). Mostra `name` + faixa de valor/prazo
  da regra ativa em caption discreto.
- `Input` valor solicitado (formatação BR `R$ 1.000,00`). Validação live contra a regra:
  `min_amount`/`max_amount` da regra ativa do produto + cidade do lead.
- `Input` prazo em meses (número). Validação live `min_term_months`/`max_term_months`.
- Botão "Simular" (primary) — desabilitado se form inválido.

**Coluna direita — Resultado:**

- Estado inicial: ilustração + "Preencha o form e clique em Simular".
- Após submit:
  - Stats row: Parcela mensal (Bricolage, destaque), Total a pagar, Total de juros, Taxa
    aplicada (caption).
  - Card com tabela de amortização (rolagem vertical). Colunas: #, Principal, Juros,
    Parcela, Saldo. Valores em JetBrains Mono (`td-amount`).
  - Botão "Nova simulação" reseta o form mantendo o lead.
  - Botão "Ver no CRM" leva para `/crm/:leadId` (que mostrará o histórico em F2-S08).

### Drawer no `/crm/:id` — caminho B (escolher um — preferência A)

Se decidir por drawer (lateral direito no CrmDetailPage), simplifica o select de lead
(já contextualizado). Documentar a decisão no PR.

### Acesso

- Rota protegida por `AuthGuard` + permissão `simulations:create`.
- Sidebar item "Simulador" (sob "Crédito" se houver seção; senão, no topo).

### Estados

- Loading do submit: botão com spinner; form bloqueado.
- Erro 422 (fora de limites): destacar campo com erro + mensagem específica do backend.
- Erro 409 (sem regra para cidade): banner amarelo com link para "Gerir produtos" (F2-S07).
- Erro 503 (flag off): banner "Módulo de simulação desativado".

### Feature flag

- Se `credit_simulation.enabled` off (hook `useFeatureFlag`): ocultar item de menu +
  rota retorna 404 client-side.

### Design System

- `Stat` cards para o resultado (DS §9.1).
- `Card` `elev-3` para a tabela de amortização (DS §9.2).
- Cores: parcela mensal usa `--state-info` ou cor primária da bandeira de Rondônia.
- Funciona em ambos os temas.

## Arquivos permitidos

- `apps/web/src/pages/simulator/SimulatorPage.tsx`
- `apps/web/src/features/simulator/SimulatorForm.tsx`
- `apps/web/src/features/simulator/SimulatorResult.tsx`
- `apps/web/src/features/simulator/AmortizationTable.tsx`
- `apps/web/src/features/simulator/LeadCombobox.tsx` (se A — escolhido)
- `apps/web/src/features/simulator/ProductSelect.tsx`
- `apps/web/src/features/simulator/__tests__/SimulatorForm.test.tsx`
- `apps/web/src/features/simulator/__tests__/SimulatorResult.test.tsx`
- `apps/web/src/hooks/simulator/useSimulate.ts`
- `apps/web/src/hooks/simulator/useProducts.ts`
- `apps/web/src/hooks/simulator/types.ts`
- `apps/web/src/App.tsx` (registrar rota)
- `apps/web/src/components/layout/Sidebar.tsx` (item de menu)

## Definition of Done

- [ ] Form valida live contra regra ativa do produto.
- [ ] Submit cria simulação e exibe resultado + tabela.
- [ ] Tabela de amortização tem `termMonths` linhas; somas batem com a resposta do backend.
- [ ] Erros 422/409/503 tratados com UX clara.
- [ ] Feature flag esconde item de menu + rota.
- [ ] Tests: form valida e submete; resultado renderiza; erros aparecem.
- [ ] Funciona em ambos os temas, mobile responsivo.
- [ ] PR com screenshots (light + dark, estado vazio + com resultado).

## Validação

```powershell
pnpm --filter @elemento/web test -- simulator
pnpm --filter @elemento/web lint
pnpm --filter @elemento/web typecheck
pnpm --filter @elemento/web build
```
