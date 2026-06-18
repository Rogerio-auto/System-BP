"""Schema Pydantic v2 para o request POST /process/whatsapp/message.

Contrato canônico: doc 06 §4.1.

Regras de validação:
- ``model_config = ConfigDict(extra="forbid")`` — rejeita payload desconhecido.
- Todos os campos obrigatórios levantam ``ValidationError`` se ausentes ou com
  tipo errado; FastAPI devolve HTTP 422.

LGPD (doc 17 §8.3 / §8.4):
- ``customer_phone`` nunca deve aparecer em logs. O endpoint só loga o sufixo.
- ``message_text`` pode conter PII bruta — DLP aplicado antes de qualquer
  chamada ao gateway LLM (responsabilidade dos nós, não do schema).
- ``organization_id`` NÃO é PII — pode aparecer em logs.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class MessageMetadata(BaseModel):
    """Metadados opcionais enviados pelo backend junto com a mensagem.

    Campos propagados ao estado inicial do grafo para evitar round-trips
    desnecessários ao backend.
    """

    model_config = ConfigDict(extra="forbid")

    city_id: str | None = None
    city_name: str | None = None
    customer_name: str | None = None
    previous_state_loaded: bool = False


class MessageAttachment(BaseModel):
    """Representação de um anexo de mensagem WhatsApp."""

    model_config = ConfigDict(extra="forbid")

    type: str = Field(description="Tipo do anexo: 'image', 'document', 'audio', etc.")
    url: str | None = None
    caption: str | None = None
    mime_type: str | None = None


class WhatsAppMessageRequest(BaseModel):
    """Payload de entrada para POST /process/whatsapp/message (doc 06 §4.1).

    Validação estrita: extra="forbid" rejeita qualquer campo não documentado.

    Multi-tenant: ``organization_id`` é obrigatório e deve ser repassado
    a todas as chamadas /internal/* de escrita (F16-S34/S35).
    """

    model_config = ConfigDict(extra="forbid")

    # Multi-tenant: obrigatório para escritas /internal/* — não é PII, pode logar
    organization_id: str = Field(
        description="UUID da organização. Repassado a todas as escritas /internal/*.",
        min_length=36,
    )

    # Identificadores de sessão
    conversation_id: str = Field(
        description="UUID da conversa no banco.",
        min_length=1,
    )
    lead_id: str | None = Field(
        default=None,
        description="UUID do lead, se já identificado.",
    )

    # Dados da mensagem
    customer_phone: str = Field(
        description="Telefone do cliente no formato E.164 (+5569...).",
        min_length=10,
    )
    message_text: str = Field(
        default="",
        description="Texto da mensagem recebida.",
    )
    message_attachments: list[MessageAttachment] = Field(
        default_factory=list,
        description="Lista de anexos da mensagem.",
    )
    message_timestamp: datetime = Field(
        description="Timestamp ISO 8601 da mensagem.",
    )

    # Canal e integrações
    channel: Literal["whatsapp"] = Field(
        default="whatsapp",
        description="Canal de origem. Sempre 'whatsapp' nesta rota.",
    )
    chatwoot_conversation_id: str = Field(
        description="ID da conversa no Chatwoot.",
        min_length=1,
    )
    chatwoot_account_id: str = Field(
        description="ID da conta no Chatwoot.",
        min_length=1,
    )

    # Metadados e rastreamento
    metadata: MessageMetadata = Field(
        default_factory=MessageMetadata,
        description="Metadados opcionais propagados ao estado inicial.",
    )
    correlation_id: str = Field(
        description="UUID de correlação para rastreamento distribuído.",
        min_length=1,
    )
    idempotency_key: str = Field(
        description="Chave de idempotência para deduplicação (ex.: wa_msg_<id>).",
        min_length=1,
    )

    @field_validator("customer_phone")
    @classmethod
    def validate_phone_format(cls, v: str) -> str:
        """Valida que o telefone segue o formato E.164 mínimo."""
        if not v.startswith("+"):
            raise ValueError("customer_phone deve estar no formato E.164 (ex.: +5569999999999)")
        if not v[1:].isdigit():
            raise ValueError("customer_phone deve conter apenas dígitos após o '+'")
        return v

    @field_validator("organization_id")
    @classmethod
    def validate_organization_id(cls, v: str) -> str:
        """Valida formato UUID (RFC 4122)."""
        import uuid
        try:
            uuid.UUID(v)
        except ValueError as exc:
            raise ValueError(
                "organization_id deve ser um UUID válido (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)"
            ) from exc
        return v

    def to_payload_dict(self) -> dict[str, Any]:
        """Converte para dict compatível com o nó receive_message.

        O nó receive_message espera um dict com snake_case matching os campos
        do payload inbound (doc 06 §4.1). organization_id é incluído para
        propagação ao ConversationState e às escritas /internal/*.
        """
        return {
            "organization_id": self.organization_id,
            "conversation_id": self.conversation_id,
            "lead_id": self.lead_id,
            "customer_phone": self.customer_phone,
            "message_text": self.message_text,
            "message_attachments": [
                a.model_dump(exclude_none=True) for a in self.message_attachments
            ],
            "message_timestamp": self.message_timestamp.isoformat(),
            "channel": self.channel,
            "chatwoot_conversation_id": self.chatwoot_conversation_id,
            "chatwoot_account_id": self.chatwoot_account_id,
            "metadata": self.metadata.model_dump(),
            "correlation_id": self.correlation_id,
            "idempotency_key": self.idempotency_key,
        }


__all__ = [
    "MessageAttachment",
    "MessageMetadata",
    "WhatsAppMessageRequest",
]
