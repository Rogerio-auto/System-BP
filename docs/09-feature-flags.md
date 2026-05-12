# 09 — Feature Flags

## 1. Princípio

Feature flag não é controle visual. É controle real em **quatro camadas**:

1. **UI** — esconde/desabilita botões, mostra badge "Em desenvolvimento".
2. **Backend API** — endpoints retornam `403 feature_disabled`.
3. **Workers/Jobs** — não disparam jobs cuja flag está desligada.
4. **Tools da IA** — LangGraph não pode chamar tool gated por flag desligada.

## 2. Modelagem

Tabela `feature_flags` em [03-modelo-dados.md](03-modelo-dados.md). Estrutura:

```ts
type FeatureFlag = {
  key: string; // ex: "followup.enabled"
  name: string;
  description: string;
  status: 'enabled' | 'disabled' | 'internal_only';
  visible: boolean; // se aparece na UI
  ui_label?: string; // ex: "Em desenvolvimento"
  dependencies: string[]; // outras flags requeridas
  allowed_roles: string[];
  updated_by: string | null;
  updated_at: string;
};
```

Auditoria em `feature_flag_audit`. Toda mudança via UI requer permissão `flags:manage` e gera `audit_logs`.

## 3. Catálogo MVP

| Key                                          | Default           | Visível no MVP | Quando habilitar |
| -------------------------------------------- | ----------------- | -------------- | ---------------- |
| `crm.enabled`                                | enabled           | ✓              | —                |
| `crm.import.enabled`                         | enabled           | ✓              | —                |
| `kanban.enabled`                             | enabled           | ✓              | —                |
| `credit_simulation.enabled`                  | enabled           | ✓              | —                |
| `credit_analysis.enabled`                    | enabled           | ✓              | —                |
| `credit_analysis.import.enabled`             | enabled           | ✓              | —                |
| `chatwoot.integration.enabled`               | enabled           | ✓              | —                |
| `ai.whatsapp_agent.enabled`                  | enabled           | ✓              | —                |
| `ai.internal_assistant.enabled`              | disabled          | ✓ (badge)      | Fase 6           |
| `internal_assistant.actions.enabled`         | disabled          | ✓ (badge)      | Pós-MVP          |
| `followup.enabled`                           | disabled          | ✓ (badge)      | Fase 5           |
| `collection.enabled`                         | disabled          | ✓ (badge)      | Fase 5           |
| `dashboard.enabled`                          | enabled (parcial) | ✓              | —                |
| `dashboard.by_agent.enabled`                 | disabled          | ✓ (badge)      | Fase 6           |
| `dashboard.followup_metrics.enabled`         | disabled          | ✓ (badge)      | Fase 6           |
| `reports.export.enabled`                     | disabled          | ✓ (badge)      | Fase 6           |
| `multi_city_routing.enabled`                 | enabled           | ✓              | —                |
| `pwa.enabled`                                | disabled          | ✗              | Pós-MVP          |
| `internal_score.enabled`                     | disabled          | ✓ (badge)      | Pós-MVP          |
| `auto_complete_on_chatwoot_resolved.enabled` | disabled          | ✗              | Pós-validação    |
| `imports.regional.enabled`                   | disabled          | ✗              | Sob demanda      |

## 4. Comportamento por camada

### 4.1 UI

- `flag.status === 'enabled'` → comportamento normal.
- `flag.status === 'disabled' && flag.visible` → seção/menu visível com:
  - Badge "Em desenvolvimento" (ou `ui_label`).
  - Componentes interativos desabilitados.
  - Tooltip: "Esta funcionalidade está em desenvolvimento. Disponível em breve."
  - Tentativa de submit → toast informativo, sem chamada de API.
- `flag.status === 'disabled' && !flag.visible` → menu/rota não aparecem.
- `flag.status === 'internal_only'` → visível apenas para roles em `allowed_roles`.

### 4.2 Backend API

- Middleware `featureGate(flagKey)` em rotas/grupos:
  ```ts
  router.post('/api/followup-jobs', featureGate('followup.enabled'), ...);
  ```
- Quando desligada, retorna `403 { code: 'feature_disabled', flag: 'followup.enabled' }`.
- Endpoints de leitura podem ser permitidos mesmo com flag disabled (ex: visualizar régua existente) — decisão por endpoint.

### 4.3 Workers

- No início de cada job, worker checa `feature_flags`. Se desligada → marca job `cancelled` com motivo `feature_disabled`.
- Schedulers não criam novos jobs quando flag desligada.

### 4.4 Tools da IA

- Tool wrapper checa flag antes de executar:
  ```python
  @feature_gated("followup.enabled")
  def schedule_followup(...): ...
  ```
- Quando desligada, tool retorna erro estruturado `FEATURE_DISABLED`. Grafo lida graciosamente (não tenta chamar de novo, segue para próximo nó).

## 5. Carregamento e cache

- Backend mantém cache em memória com TTL 30s.
- Mudança de flag emite `feature_flag.changed` + invalida cache (em deployments multi-instância, usar pub/sub ou polling curto).
- Frontend recebe flags no bootstrap (`GET /api/feature-flags/me` filtrado por role).
- Em dev, refresh manual via UI admin.

## 6. UI admin

Tela `/admin/feature-flags`:

- Lista com filtro por status.
- Toggle para enabled/disabled (com confirmação).
- Edição de `ui_label`, `description`, `allowed_roles`.
- Histórico (últimas mudanças).
- Indicador de dependências quebradas (ex: ligar `dashboard.by_agent.enabled` enquanto `dashboard.enabled=disabled` é bloqueado).

## 7. Dependências entre flags

- Resolução: ao tentar habilitar `X` cuja `dependencies` contém `Y`, e `Y` está disabled, bloqueia.
- Ao desabilitar `Y`, alerta sobre flags dependentes que serão automaticamente forçadas a `disabled` (com confirmação).

## 8. Crítico: nada de feature flag como gambiarra

- Flag não substitui código incompleto. Toda flag tem feature funcional por trás (mesmo que em testes).
- Flag não pode ser usada para liberar funcionalidade sem permissão (use RBAC).
- Cleanup: flags devem ser removidas após estarem 100% habilitadas em prod por 30+ dias e não houver intenção de desligar. Tarefa periódica (`flags-cleanup-review`) listada no [11-roadmap-executavel.md](11-roadmap-executavel.md) Fase 7.

## 9. Crítérios de aceite

- Frontend reflete estado da flag em tempo real após toggle (com latência ≤ 30s).
- Tentativa de chamada de API com flag desligada → 403 com payload claro.
- Worker/job respeita flag.
- Tool da IA respeita flag.
- Auditoria registra cada mudança.
- Roles sem permissão não veem `/admin/feature-flags`.
