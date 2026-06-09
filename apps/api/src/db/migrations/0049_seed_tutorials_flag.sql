-- =============================================================================
-- 0049_seed_tutorials_flag.sql — Semente da feature flag tutorials.enabled.
--
-- Contexto (norma 21 §12):
--   Todo o sistema de tutoriais em vídeo e ajuda contextual fica atrás da flag
--   `tutorials.enabled`. Sem esta linha no banco, featureGate() retorna false e:
--     - O item de menu /admin/tutoriais fica oculto (visible=false no gate).
--     - Todas as rotas de leitura e admin respondem 403.
--     - O ⓘ contextual não é renderizado em nenhuma tela.
--
-- Status inicial = 'enabled':
--   Libera o painel admin (/admin/tutoriais) e a leitura pública dos tutoriais
--   cadastrados. Operadores não veem nada até que um tutorial seja criado e
--   marcado como ativo (is_active = true na tabela feature_tutorials).
--
-- Idempotente: ON CONFLICT (key) DO NOTHING.
--   Re-rodar não altera estado caso a flag já tenha sido toggled pela UI admin
--   pós-merge. Auditoria: updated_by = NULL indica origem migration/sistema
--   (sem actor humano — conforme padrão das demais seeds de flags).
-- =============================================================================

INSERT INTO feature_flags (key, status, visible, ui_label, description, updated_by)
VALUES (
  'tutorials.enabled',
  'enabled',
  true,
  'Tutoriais em vídeo',
  'Habilita o sistema de tutoriais em vídeo e a ajuda contextual (ⓘ) em todas as telas. Quando desativado, o painel /admin/tutoriais e os ícones de ajuda ficam ocultos.',
  NULL
)
ON CONFLICT (key) DO NOTHING;
