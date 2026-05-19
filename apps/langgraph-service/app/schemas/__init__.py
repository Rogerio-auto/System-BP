"""Schemas Pydantic v2 para o contrato HTTP do LangGraph service.

Módulos:
    inbound  — Request: POST /process/whatsapp/message (doc 06 §4.1)
    outbound — Response: 200 OK (doc 06 §4.2)
"""

from app.schemas.inbound import WhatsAppMessageRequest
from app.schemas.outbound import (
    ActionItem,
    HandoffInfo,
    ReplyPayload,
    StateSnapshot,
    WhatsAppMessageResponse,
)

__all__ = [
    "ActionItem",
    "HandoffInfo",
    "ReplyPayload",
    "StateSnapshot",
    "WhatsAppMessageRequest",
    "WhatsAppMessageResponse",
]
