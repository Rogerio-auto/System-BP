-- =============================================================================
-- 0053_seed_simulation_template_flag.sql — Template WhatsApp + flag de simulação.
--
-- Contexto: F14-S05 — endpoint POST /api/simulations/:id/send.
--
-- Registra:
--   1. Feature flag `simulations.send.enabled` (disabled por padrão — ativar após
--      aprovação do template na Meta e validação operacional).
--   2. Permissão `simulations:send` e atribuição ao role 'admin'.
--   3. Registro do template `simulacao_resultado` em whatsapp_templates para a
--      organização default (seed de desenvolvimento/staging). Em produção,
--      o registro real é criado via UI de templates após aprovação Meta.
--
-- NOTA sobre o template:
--   O template `simulacao_resultado` deve estar aprovado na Meta antes de ser
--   usado em produção. Em dev, o seed usa meta_template_id='dev-mock-sim-001'
--   (valor fictício — o MetaWhatsAppClient.sendTemplate usa o `name` para
--   lookup local, não o meta_template_id). O status 'pending' impede uso em
--   workers automáticos que filtram por status='approved'; o endpoint manual
--   não filtra por status (cabe ao agente usar o botão na UI quando aprovado).
--
-- Variáveis do template (ordem posicional = {{1}}, {{2}}, ...):
--   1. nome_cliente      — nome do lead (sem CPF — LGPD)
--   2. valor_solicitado  — ex: R$ 2.000,00
--   3. num_parcelas      — ex: 12
--   4. valor_parcela     — ex: R$ 187,53
--   5. taxa_mensal       — ex: 2,50%
--
-- Idempotente: ON CONFLICT DO NOTHING em todos os inserts.
--
-- LGPD: template não contém PII — apenas estrutura de texto com variáveis.
--   Valores reais das variáveis são preenchidos no momento do envio (nunca
--   persistidos na tabela de templates).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Feature flag: simulations.send.enabled (disabled por padrão)
-- ---------------------------------------------------------------------------

INSERT INTO feature_flags (key, status, visible, ui_label, description, updated_by)
VALUES (
  'simulations.send.enabled',
  'disabled',
  true,
  'Envio de simulação por WhatsApp',
  'Habilita o botão "Enviar por WhatsApp" na tela de simulação (POST /api/simulations/:id/send). Ativar somente após aprovação do template simulacao_resultado na Meta e validação operacional.',
  NULL
)
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Permissão RBAC: simulations:send
-- ---------------------------------------------------------------------------

INSERT INTO permissions (key, description)
VALUES (
  'simulations:send',
  'Disparo de simulação de crédito por WhatsApp para o lead'
)
ON CONFLICT (key) DO NOTHING;

-- Atribui à role 'admin'
INSERT INTO role_permissions (role_id, permission_id)
SELECT
  r.id AS role_id,
  p.id AS permission_id
FROM roles r
CROSS JOIN permissions p
WHERE r.key = 'admin'
  AND p.key = 'simulations:send'
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. Template WhatsApp: simulacao_resultado
--
-- INSERT condicional: insere apenas na organização seed (banco_do_povo_seed).
-- Em ambientes sem organização seed (CI headless, produção real), o INSERT
-- é um no-op via WHERE NOT EXISTS — sem efeito colateral.
--
-- O campo meta_template_id='dev-mock-sim-001' é placeholder de dev/staging.
-- Em produção, o registro é criado via UI de templates (F5-S05) após
-- submissão e aprovação real pela Meta Business Suite.
-- ---------------------------------------------------------------------------

INSERT INTO whatsapp_templates (
  organization_id,
  meta_template_id,
  name,
  language,
  category,
  body,
  header_type,
  header_text,
  header_handle,
  variables,
  status
)
SELECT
  o.id,
  'dev-mock-sim-001',
  'simulacao_resultado',
  'pt_BR',
  'utility',
  'Olá {{1}}! Segue o resultado da sua simulação de crédito: Valor: *{{2}}* | Parcelas: *{{3}}x de {{4}}* | Taxa: *{{5}} a.m.* Para mais informações, fale com seu agente.',
  'none',
  NULL,
  NULL,
  ARRAY['nome_cliente','valor_solicitado','num_parcelas','valor_parcela','taxa_mensal'],
  'pending'
FROM organizations o
WHERE o.slug = 'banco_do_povo_seed'
  AND NOT EXISTS (
    SELECT 1
    FROM whatsapp_templates wt
    WHERE wt.organization_id = o.id
      AND wt.name = 'simulacao_resultado'
  );
