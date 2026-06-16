# Pendências e problemas — Revisão 2026-06-16

> Gerado automaticamente durante sessão noturna de implementação autônoma.
> Itens ordenados por urgência. Rogério revisa amanhã.

---

## 🔴 Decisões bloqueando slots (ação necessária do Rogério)

### D8 — Win-back: quando disparar? (bloqueia F17-S09, F17-S10)

F17-S09 (backend win-back automático) e F17-S10 (frontend win-back) estão com status `blocked` aguardando a decisão D8:

> **Pergunta:** Qual o gatilho para win-back?
>
> - (A) Lead ficou X dias sem movimentação no Kanban
> - (B) Lead fechado como `closed_lost`
> - (C) Ambos (com critérios independentes)
>
> Também: qual o delay mínimo para reabordagem após perda?

Enquanto D8 não for definida, esses dois slots não podem ser implementados.

---

### D10 — Relatório de baixa real (bloqueia F15-S12)

F15-S12 (importar relatório de baixa para cobrança) está `blocked` aguardando um arquivo de exemplo real:

> **Necessidade:** Um arquivo `.xlsx` ou `.csv` de exemplo que o banco exporta como "relatório de baixa" de parcelas pagas — para definir o parser correto e os cabeçalhos esperados.

Sem o arquivo exemplo, não é possível implementar o parser sem arriscar incompatibilidade.

---

## 🟡 PRs abertos aguardando CI e merge

### PR #252 — F17-S12: `analysis_id` em contracts (migration 0062)

- **Branch:** `feat/f17-s12`
- **CI:** Rodando (novo push com fix de vitest + lockfile)
- **Bloqueio pós-merge:** F17-S13 (handler auto-contrato) e F17-S14 (badge análise→contrato)
- **Ação:** Mergar assim que CI passar (E2E Smoke é o gate obrigatório para migrations)

### PR #254 — F17-S11: Modal de criação de contrato (frontend)

- **Branch:** `feat/f17-s11`
- **CI:** Rodando
- **Security:** Aprovado (sem bloqueadores)
- **Achado médio (não-bloqueador):** `principal_amount` aceita `0` no schema de criação — considerar validação `z.number().positive()` em slot futuro
- **Ação:** Mergar assim que CI passar

### PR #255 — F16-S04: Channels core live chat

- **Branch:** `feat/f16-s04`
- **CI:** Pendente
- **Contexto:** F16 tem ainda 13 slots restantes (S05–S17) para completar o live chat próprio. S04 é o core de adapter e GraphClient.
- **Pergunta para Rogério:** F16 live chat é prioridade agora? Ou pausa enquanto F17/F18 fecham?

### PR #227 — fix/migrations-idempotent-triggers (antigo, verde)

- **CI:** Todo verde (passou há dias)
- **Conteúdo:** Torna triggers dos migrations 0032/0034 idempotentes (`CREATE OR REPLACE`)
- **Estado:** Nunca mergeado — provavelmente ficou esquecido
- **Ação sugerida:** Mergar (baixo risco, melhora robustez de re-run de migrations)

---

## 🟠 F18 — Estado atual da Onda 1 e 2

### Grupo A (5 agentes rodando agora em paralelo)

| Slot    | Título                                     | Agente           |
| ------- | ------------------------------------------ | ---------------- |
| F18-S01 | Backend: city_name em LeadResponse         | Em implementação |
| F18-S03 | Frontend: CurrencyInput fix (bug de moeda) | Em implementação |
| F18-S04 | Backend: activateRuleVersion               | Em implementação |
| F18-S06 | Frontend: follow-up por estágio/outcome    | Em implementação |
| F18-S07 | Frontend: avgDaysInStage + Kanban no CRM   | Em implementação |

**Após Group A:** F18-S11 (send simulação WhatsApp) pode rodar quando F18-S04 mergear. F18-S08 (schema lead PJ) pode rodar quando F18-S01 mergear.

### Grupo B (bloqueados por dependência de arquivo)

- **F18-S08** (schema lead PJ + personal_email): aguarda F18-S01 (conflito em `packages/shared-schemas/src/leads.ts`)
- **F18-S11** (backend enviar simulação por WhatsApp): aguarda F18-S04 (conflito em `apps/api/src/events/types.ts`)

### Slots bloqueados por dependência de feature

- **F18-S02** (frontend cidade CRM/Kanban): aguarda F18-S01
- **F18-S05** (frontend usar versão produto): aguarda F18-S04
- **F18-S09** (validações PJ + email blocklist): aguarda F18-S08
- **F18-S10** (UI lead PJ): aguarda F18-S09
- **F18-S12** (frontend enviar simulação): aguarda F18-S11

---

## 🔧 Débitos técnicos e ajustes pendentes

### Bug corrigido: vitest não era dependência de `packages/shared-schemas`

A PR #253 (F16 foundation) adicionou `packages/shared-schemas/src/__tests__/livechat.test.ts` que importa `vitest`, mas não adicionou `vitest` como `devDependency` do pacote. Isso causou falha de CI em todos os PRs abertos.

**Correção aplicada esta noite:**

- `packages/shared-schemas/package.json`: adicionado `"vitest": "^2.1.9"` + script `"test": "vitest run"`
- `pnpm-lock.yaml`: atualizado
- Pushado para `main` + PRs #252 e #254

### `principal_amount` aceita `0` (finding de security — F17-S11)

Em `apps/api/src/modules/contracts/schemas.ts`, `principal_amount` usa `z.number()` sem `.positive()`. Contrato com valor zero é inválido mas aceito pela API.

**Ação sugerida:** Adicionar `z.number().min(0.01)` em um slot de hardening futuro.

### Feature flags `spc.enabled` e `spc.scan.enabled` sem registro formal

Os flags de SPC (F15-S08) foram implementados mas não estão no catálogo formal de feature flags. Se a tabela `feature_flags` tem enum de flags permitidas, esses dois precisam ser seedados.

**Verificar:** `apps/api/src/db/migrations/` para ver se há seed dos flags de SPC.

### Stash `F16-S02 schema partial work` (rebuild/f16-s02)

Existe um stash `stash@{0}` em `rebuild/f16-s02` com trabalho parcial de schema do F16-S02. Porém, F16-S02 foi integrado ao PR #253 (F16 foundation, mergeado). O stash provavelmente está obsoleto.

**Ação:** Verificar se o stash tem algo útil não incluído no PR #253, então descartar com `git stash drop stash@{0}`.

---

## 📋 Slots F17 ainda abertos

| Slot    | Título                             | Status  | Bloqueio             |
| ------- | ---------------------------------- | ------- | -------------------- |
| F17-S09 | Backend win-back automático        | blocked | D8 (decisão Rogério) |
| F17-S10 | Frontend win-back                  | blocked | D8 (decisão Rogério) |
| F17-S13 | Handler auto-contrato na aprovação | blocked | F17-S12 (PR #252)    |
| F17-S14 | Badge análise→contrato no CRM      | blocked | F17-S12 + F17-S13    |

Após PR #252 mergear, F17-S13 pode ser implementado imediatamente.

---

## 📋 Próximos passos recomendados (ordem de prioridade)

1. **Mergar PR #227** (fix triggers) — sem risco, CI verde
2. **Monitorar CI** #252 e #254 → mergear assim que E2E Smoke passar
3. **Definir D8** (win-back) → desbloqueia F17-S09/S10
4. **Fornecer exemplo de relatório de baixa** → desbloqueia F15-S12
5. **Decidir se F16 (live chat)** continua agora ou pausa (PR #255 aberto)
6. Após PRs F18 Group A mergearem → dispatchar F18-S08 e F18-S11 sequencialmente
