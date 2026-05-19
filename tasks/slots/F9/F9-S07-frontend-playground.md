---
id: F9-S07
title: Frontend — playground (com contexto real opcional + DRY-RUN banner)
phase: F9
task_ref: T9.7
status: available
priority: high
estimated_size: M
agent_id: frontend-engineer
claimed_at:
completed_at:
pr_url:
depends_on: [F9-S04, F8-S08, F1-S08]
blocks: []
labels: [lgpd-impact]
source_docs:
  - docs/05-modulos-funcionais.md
  - docs/10-seguranca-permissoes.md
  - docs/18-design-system.md
  - docs/design-system/index.html
  - docs/17-lgpd-protecao-dados.md
---

# F9-S07 — Frontend: playground do agente

## Objetivo

Tela dentro do Hub de Configurações, seção "Agente de IA → Playground", consumindo a API de F9-S04. Admin testa o grafo com mensagem + contexto opcional (lead/city reais em modo leitura), vê o trace de execução, sem afetar produção.

## Escopo

- Sub-rota `/configuracoes/ia/playground`.
- **Layout 2 colunas:**
  - **Esquerda — formulário:**
    - Textarea: mensagem do operador.
    - Toggle: "Usar contexto real (read-only)" / "Sintético".
    - Quando contexto real: 2 autocompletes (`lead` por nome/telefone; `city` por nome — reutilizar componentes existentes do CRM se houver, senão criar leves).
    - Quando sintético: preenche dados de fixture (botão "Carregar fixture" com 5 opções: lead novo, lead com cidade conhecida, handoff pedido, etc. — reusar nomes das fixtures do F3-S35 quando possível, mas dados visíveis na UI são apenas labels).
    - Botão "Rodar" — desabilitado se mensagem vazia.
  - **Direita — resultado:**
    - **Banner permanente no topo:** "DRY-RUN — nada é persistido e nada é enviado ao cliente." (cor de alerta do DS — não vermelho de erro, mas amarelo de aviso).
    - Resposta da IA (a `reply` que seria enviada).
    - Aviso de DLP quando `dlp_applied: true`: lista os tokens mascarados (`<CPF_1>`, `<PHONE_1>`) com tooltip explicando que a mensagem do operador foi mascarada antes de chegar ao gateway.
    - Trace do grafo: cards por nó (componente reusado de F9-S06 `DecisionCard` se sintaxe compatível, senão variante).
    - Métricas globais: tokens totais, latência total, prompt versions usadas.
- **Permissões:** Sem `ai_playground:run` → 404. Botão "Rodar" e form ocultos sem permissão.

## Design System

- Banner DRY-RUN: chip de alerta com ícone, sempre visível.
- Cards de trace: profundidade 2-3 do DS; hover sutil.
- Estado de loading durante a chamada (skeleton no painel direito + spinner no botão).
- Estado de erro: card explicativo se backend retornar 4xx/5xx, sem expor stacktrace.

## LGPD

- Label `lgpd-impact`. Checklist §14.2.
- **Não envia a mensagem ao backend até o operador clicar Rodar.** Sem auto-save de drafts.
- O frontend não faz DLP local (responsabilidade do backend F9-S04) — apenas exibe o resultado.
- Quando o operador seleciona "Contexto real", mostrar aviso: "Você selecionou um lead real. Dados deste lead serão usados em modo somente leitura. Nenhum dado será gravado e nenhuma mensagem será enviada ao cliente."

## Hooks e cliente API

- `apps/web/src/hooks/ai-console/usePlayground.ts` — `useRunPlayground()` (mutation TanStack Query).
- `apps/web/src/lib/api.ts` — endpoint `aiConsole.playground.run`.

## Fora de escopo

- Backend (F9-S04 — pré-requisito). LangGraph dry-run (F9-S03 — pré-requisito do F9-S04). Modo A/B (rodar 2 versões de prompt em paralelo — backlog). Salvar runs como "casos de teste regressivos" (backlog).

## Arquivos permitidos

- `apps/web/src/features/configuracoes/ai-console/playground/PlaygroundPage.tsx`
- `apps/web/src/features/configuracoes/ai-console/playground/PlaygroundForm.tsx`
- `apps/web/src/features/configuracoes/ai-console/playground/PlaygroundTrace.tsx`
- `apps/web/src/features/configuracoes/ai-console/playground/DlpNotice.tsx`
- `apps/web/src/features/configuracoes/ai-console/playground/__tests__/*.test.tsx`
- `apps/web/src/hooks/ai-console/usePlayground.ts`
- `apps/web/src/lib/api.ts`
- `apps/web/src/App.tsx` (rota, se aplicável)

## Definition of Done

- [ ] Form e painel de trace funcionando; botão desabilita até mensagem preenchida.
- [ ] Banner DRY-RUN sempre visível.
- [ ] DLP notice exibido quando `dlp_applied: true`.
- [ ] Permissão `ai_playground:run` respeitada (404 sem).
- [ ] Toggle real/sintético funcionando; lead/city selecionáveis quando real.
- [ ] DS aplicado.
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` verdes.
- [ ] PR com label `lgpd-impact`.

## Validação

```powershell
pnpm --filter @elemento/web typecheck
pnpm --filter @elemento/web lint
pnpm --filter @elemento/web test -- ai-console/playground
pnpm --filter @elemento/web build
```
