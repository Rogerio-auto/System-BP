-- =============================================================================
-- 0045_enable_followup_flag.sql — Habilita a flag de UI de follow-up em produção.
--
-- Contexto: cutover pós-F7-S09. Liga apenas `followup.enabled` (camada de UI):
--   - Painéis `/admin/followup/rules` e `/admin/followup/jobs` ficam acessíveis.
--   - Workers (`followup.scheduler.enabled`, `followup.sender.enabled`) permanecem
--     em `disabled` — nenhuma mensagem sai. Ligar workers em migration separada
--     após validação operacional da UI pelo cliente.
--
-- Política (F5/README + doc 09):
--   "Habilitação progressiva pós sign-off da semana 1 (primeiro followup.enabled,
--    depois billing.enabled, com janelas de observação ≥ 7 dias entre cada)."
--
-- Idempotente: UPDATE com WHERE inclui status antigo. Re-rodar não altera nada
--   após a primeira aplicação (e nunca regride caso o flag já tenha sido toggled
--   via UI/admin pós-merge).
--
-- Auditoria: `updated_by=NULL` indica origem migration/sistema (não há actor).
--   Mudanças subsequentes pela UI de admin sobrescrevem com o user UUID.
-- =============================================================================

UPDATE feature_flags
SET
  status = 'enabled',
  updated_at = NOW(),
  updated_by = NULL
WHERE
  key = 'followup.enabled'
  AND status = 'disabled';
