"""Schema Pydantic v2 para o response de POST /process/whatsapp/message.

Contrato canônico: doc 06 §4.2.

Regras de validação:
- model_config = ConfigDict(extra="forbid") — garante que o handler não
  passe campos extras por engano; documentado e controlado.

LGPD (doc 17 §8.3 / §8.4):
- reply.content não deve conter PII bruta. O nó send_response já garante
  isso — o schema não faz verificação de conteúdo (seria muito caro).
- O campo state é um snapshot do ConversationState e pode conter dados
  de contexto de fluxo, mas nunca deve propagar CPF, RG ou tokens de PII.

F16-S41 (B3 — saída multi-mensagem):
- WhatsAppMessageResponse.messages — array de mensagens curtas (≤300 chars
  no total, sem newline, cada item não-vazio) produzido pelo agente agêntico.
- reply permanece retrocompatível para o worker livechat-ai.ts até que
  o sibling backend slot itere messages[] diretamente.
"""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

# ---------------------------------------------------------------------------
# Constante canônica de limite de soma de chars em messages[]
# ---------------------------------------------------------------------------

MESSAGES_MAX_TOTAL_CHARS: int = 300


class ReplyPayload(BaseModel):
    """Resposta a ser enviada ao cliente via canal WhatsApp (doc 06 §4.2)."""

    model_config = ConfigDict(extra="forbid")

    type: Literal["text", "template", "none"] = Field(
        description="Tipo da resposta: texto livre, template WhatsApp ou nenhuma.",
    )
    content: str = Field(
        default="",
        description="Texto da mensagem quando type=text; vazio nos demais casos.",
    )
    template_name: str | None = Field(
        default=None,
        description="Nome do template WhatsApp aprovado quando type=template.",
    )
    template_variables: list[str] | None = Field(
        default=None,
        description="Variáveis do template em ordem quando type=template.",
    )


class ActionItem(BaseModel):
    """Evento de domínio emitido pelo grafo (doc 06 §4.2 / §5.1 actions_emitted)."""

    model_config = ConfigDict(extra="ignore")

    type: str = Field(description="Tipo da ação.")
    status: Literal["success", "error", "skipped"] = Field(default="success")
    entity_id: str | None = Field(default=None)
    data: dict[str, Any] | None = Field(default=None)


class HandoffInfo(BaseModel):
    """Informações sobre handoff para atendimento humano (doc 06 §4.2)."""

    model_config = ConfigDict(extra="forbid")

    required: bool = Field(description="True se o grafo solicitou transferência para humano.")
    reason: str | None = Field(default=None, description="Motivo do handoff.")
    summary: str | None = Field(default=None, description="Resumo do contexto para o atendente.")


class StateSnapshot(BaseModel):
    """Snapshot resumido do estado do grafo após o turno (doc 06 §4.2)."""

    model_config = ConfigDict(extra="ignore")

    current_stage: str | None = None
    current_intent: str | None = None
    next_expected_input: str | None = None
    missing_fields: list[str] = Field(default_factory=list)


class WhatsAppMessageResponse(BaseModel):
    """Response de POST /process/whatsapp/message (doc 06 §4.2)."""

    model_config = ConfigDict(extra="forbid")

    conversation_id: str = Field(description="UUID da conversa processada.")
    lead_id: str | None = Field(default=None, description="UUID do lead.")

    reply: ReplyPayload = Field(description="Resposta a ser enviada ao cliente.")
    actions: list[ActionItem] = Field(default_factory=list)
    handoff: HandoffInfo = Field(description="Informações de handoff.")
    state: StateSnapshot = Field(description="Snapshot de estado de fluxo.")

    messages: list[str] = Field(
        default_factory=list,
        description=(
            "Array de mensagens curtas do agente (soma <= 300 chars total, sem newline). "
            "Vazio no funil determinístico (flag off). "
            "Retrocompat: reply.content = join ou primeira msg até worker migrar."
        ),
    )

    model: str | None = Field(default=None)
    prompt_version: str | None = Field(default=None)
    graph_version: str = Field(description="Versão semântica do grafo.")
    latency_ms: int = Field(ge=0)
    errors: list[dict[str, Any]] = Field(default_factory=list)

    @field_validator("messages", mode="before")
    @classmethod
    def validate_messages_items(cls, v: Any) -> list[str]:
        if not isinstance(v, list):
            raise ValueError("messages deve ser uma lista")
        for i, item in enumerate(v):
            if not isinstance(item, str):
                raise ValueError(f"messages[{i}] deve ser str")
            if not item:
                raise ValueError(f"messages[{i}] nao pode ser vazio")
            if chr(10) in item:
                raise ValueError(f"messages[{i}] nao pode conter newline")
        return v

    @model_validator(mode="after")
    def validate_messages_total_chars(self) -> WhatsAppMessageResponse:
        total = sum(len(m) for m in self.messages)
        if total > MESSAGES_MAX_TOTAL_CHARS:
            raise ValueError(
                f"messages soma {total} chars, excede o limite de {MESSAGES_MAX_TOTAL_CHARS}. "
                f"O no send_response deve truncar antes de popular o campo."
            )
        return self


__all__ = [
    "MESSAGES_MAX_TOTAL_CHARS",
    "ActionItem",
    "HandoffInfo",
    "ReplyPayload",
    "StateSnapshot",
    "WhatsAppMessageResponse",
]
