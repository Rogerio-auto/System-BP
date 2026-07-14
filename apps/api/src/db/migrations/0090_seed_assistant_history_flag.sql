-- ---------------------------------------------------------------------------
-- 0090_seed_assistant_history_flag.sql — Flag do histórico do copiloto (F6-S25).
--
-- Cria a linha de catálogo da feature flag `assistant.history.enabled`
-- DESLIGADA. Sem esta linha, o gate do backend já falha fechado (no-op), mas
-- um admin não consegue LIGAR a flag via painel — a linha precisa existir.
--
-- IMPORTANTE (LGPD / DPIA): esta migration NÃO liga o tratamento. A flag nasce
-- `disabled`. Ligá-la em produção trata dado pessoal (histórico persistente) e
-- depende do PARECER DO DPO oficial — ver docs/anexos/lgpd/dpia-historico-copiloto.md
-- §6 e o gate F6-S23. Criar a linha desligada é seguro e não constitui tratamento.
--
-- `visible = false`: a flag não aparece no painel geral até a ativação ser
-- autorizada (evita que alguém ligue "sem querer" antes do parecer).
-- ---------------------------------------------------------------------------

INSERT INTO "feature_flags" ("key", "status", "visible", "ui_label", "description", "audience")
VALUES (
  'assistant.history.enabled',
  'disabled',
  false,
  'Histórico do copiloto interno',
  'Persiste o histórico de conversas do copiloto interno (sem PII em repouso — apenas '
    || 'referências de entidade, hidratadas ao vivo com o RBAC do usuário). Ativação em '
    || 'produção depende do parecer do DPO (DPIA docs/anexos/lgpd/dpia-historico-copiloto.md).',
  '{}'
)
ON CONFLICT ("key") DO NOTHING;
