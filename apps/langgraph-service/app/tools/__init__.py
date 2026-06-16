"""Tools que os grafos invocam.

Toda tool chama um endpoint /internal/* do backend Node — NUNCA acessa banco direto.
Cliente HTTP base em `_base.py`.

Módulos disponíveis:
  - analysis_tools    : get_credit_analysis
  - audit_tools       : log_ai_decision
  - chatwoot_tools    : request_handoff, create_chatwoot_note
  - city_tools        : identify_city_from_text
  - lawyer_handoff    : check_law_firm_status, send_law_firm_referral_ai
  - leads_tools       : get_or_create_lead, get_customer_context, update_lead_profile
  - simulation_tools  : create_simulation, get_simulation
"""

from app.tools.lawyer_handoff import (
    LawFirmInfo,
    LawFirmReferralCooldown,
    LawFirmReferralDisabled,
    LawFirmReferralError,
    LawFirmReferralResult,
    LawFirmReferralSuccess,
    LawFirmStatusError,
    LawFirmStatusIneligible,
    LawFirmStatusResult,
    LawFirmStatusSuccess,
    check_law_firm_status,
    send_law_firm_referral_ai,
)

__all__ = [
    "LawFirmInfo",
    "LawFirmReferralCooldown",
    "LawFirmReferralDisabled",
    "LawFirmReferralError",
    "LawFirmReferralResult",
    "LawFirmReferralSuccess",
    "LawFirmStatusError",
    "LawFirmStatusIneligible",
    "LawFirmStatusResult",
    "LawFirmStatusSuccess",
    "check_law_firm_status",
    "send_law_firm_referral_ai",
]
