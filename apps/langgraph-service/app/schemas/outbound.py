"""Schema Pydantic v2 para o response de POST /process/whatsapp/message.

Contrato canônico: doc 06 §4.2.

Regras de validação:
- ``model_config = ConfigDict(extra="forbid")`` — garante que o handler não
  passe campos extras por engano; documentado e controlado.

LGPD (doc 17 §8.3 / §8.4):
- ``reply.content`` não deve conter PII bruta. O nó send_response já garante
  isso — o schema não faz verificação de conteúdo (seria muito caro).
- O campo ``state`` é um snapshot do ConversationState e pode conter dados
  de contexto de fluxo, mas nunca deve propagar CPF, RG ou tokens de PII.
"""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class ReplyPayload(BaseModel):
    """Resposta a ser enviada ao cliente via canal WhatsApp (doc 06 §4.2)."""

    model_config = ConfigDict(extra="forbid")

    type: Literal["text", "template", "none"] = Field(
        description="Tipo da resposta: texto livre, template WhatsApp ou nenhuma.",
    )
    content: str = Field(
        default="",
        description="Texto da mensagem quando type='text'; vazio nos demais casos.",
    )
    template_name: str | None = Field(
        default=None,
        description="Nome do template WhatsApp aprovado quando type='template'.",
    )
    template_variables: list[str] | None = Field(
        default=None,
        description="Variáveis do template em ordem quando type='template'.",
    )


class ActionItem(BaseModel):
    """Evento de domínio emitido pelo grafo (doc 06 §4.2 / §5.1 actions_emitted).

    O backend processa estas ações depois de receber a resposta.
    """

    model_config = ConfigDict(extra="allow")

    type: str = Field(
        description="Tipo da ação: 'lead_created', 'city_identified', 'simulation_sent', etc.",
    )
    status: Literal["success", "error", "skipped"] = Field(default="success")
    entity_id: str | None = Field(default=None)
    data: dict[str, Any] | None = Field(default=None)


class HandoffInfo(BaseModel):
    """Informações sobre handoff para atendimento humano (doc 06 §4.2)."""

    model_config = ConfigDict(extra="forbid")

    required: bool = Field(
        description="True se o grafo solicitou transferência para humano.",
    )
    reason: str | None = Field(
        default=None,
        description="Motivo do handoff ('falar_atendente', 'error', 'timeout', etc.).",
    )
    summary: str | None = Field(
        default=None,
        description="Resumo do contexto para o atendente humano (sem PII bruta).",
    )


class StateSnapshot(BaseModel):
    """Snapshot resumido do estado do grafo após o turno (doc 06 §4.2).

    Inclui apenas campos de fluxo — nunca PII bruta.
    """

    model_config = ConfigDict(extra="allow")

    current_stage: str | None = None
    current_intent: str | None = None
    next_expected_input: str | None = None
    missing_fields: list[str] = Field(default_factory=list)


class WhatsAppMessageResponse(BaseModel):
    """Response de POST /process/whatsapp/message (doc 06 §4.2).

    Inclui todos os campos documentados: reply, actions, handoff, state,
    model, prompt_version, graph_version, latency_ms e errors.
    """

    model_config = ConfigDict(extra="forbid")

    # Identificadores da sessão (ecoados para facilitar correlação)
    conversation_id: str = Field(description="UUID da conversa processada.")
    lead_id: str | None = Field(
        default=None,
        description="UUID do lead identificado ou criado neste turno.",
    )

    # Resultado do processamento
    reply: ReplyPayload = Field(
        description="Resposta a ser enviada ao cliente.",
    )
    actions: list[ActionItem] = Field(
        default_factory=list,
        description="Ações de domínio emitidas pelo grafo neste turno.",
    )
    handoff: HandoffInfo = Field(
        description="Informações de handoff para atendimento humano.",
    )
    state: StateSnapshot = Field(
        description="Snapshot de estado de fluxo após o turno.",
    )

    # Metadados de observabilidade (doc 06 §11 / §4.2)
    model: str | None = Field(
        default=None,
        description="Identificador do modelo LLM usado no turno principal.",
    )
    prompt_version: str | None = Field(
        default=None,
        description="Versão do prompt (ex.: 'pre_attendance@v3').",
    )
    graph_version: str = Field(
        description="Versão semântica do grafo (SemVer).",
    )
    latency_ms: int = Field(
        description="Latência total do processamento em milissegundos.",
        ge=0,
    )
    errors: list[dict[str, Any]] = Field(
        default_factory=list,
        description="Erros acumulados durante o processamento (sem PII bruta).",
    )


__all__ = [
    "ActionItem",
    "HandoffInfo",
    "ReplyPayload",
    "StateSnapshot",
    "WhatsAppMessageResponse",
]
