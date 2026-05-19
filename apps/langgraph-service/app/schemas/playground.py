"""Schemas Pydantic v2 para POST /process/whatsapp/playground (F9-S03).

O endpoint playground executa o grafo ``whatsapp_pre_attendance`` em modo
dry-run: sem persistência no banco, sem chamadas a Chatwoot, sem side-effects.

Contrato de segurança e LGPD
------------------------------
- ``dry_run: Literal[True]`` obrigatório no body — fail-fast 422 se ausente
  (proteção contra confundir com o endpoint de produção).
- O campo ``trace`` retornado NUNCA contém ``message_text`` bruto — apenas IDs
  opacos, intenções classificadas, nós percorridos e contagens de tokens.
- ``extra="forbid"`` em todos os schemas — payload desconhecido → 422.
- Rate limit mais permissivo que produção (operador testando, não webhook).
"""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.inbound import MessageAttachment, MessageMetadata

# ---------------------------------------------------------------------------
# Request
# ---------------------------------------------------------------------------


class PlaygroundRequest(BaseModel):
    """Payload de entrada para POST /process/whatsapp/playground.

    Idêntico a ``WhatsAppMessageRequest`` (doc 06 §4.1) com duas diferenças:
    1. ``dry_run: Literal[True]`` é obrigatório — protege contra chamada acidental
       ao endpoint de produção.
    2. ``idempotency_key`` é opcional (gerado automaticamente se ausente),
       pois dry-run não precisa de deduplicação cross-request.

    LGPD: ``customer_phone`` e ``message_text`` podem conter dados pessoais.
    O endpoint não loga esses campos — apenas o sufixo de 4 dígitos do telefone.
    """

    model_config = ConfigDict(extra="forbid")

    # Obrigatório — fail-fast se chamador esqueceu que está no playground
    dry_run: Literal[True] = Field(
        description="Deve ser exatamente ``true``. Ausência ou false → 422.",
    )

    # Identificadores de sessão
    conversation_id: str = Field(
        description="UUID da conversa (sintético ou real — apenas leitura em GET).",
        min_length=1,
    )
    lead_id: str | None = Field(
        default=None,
        description="UUID do lead. Se presente e allow_real_reads=true, leitura real.",
    )

    # Dados da mensagem
    customer_phone: str = Field(
        description="Telefone no formato E.164. Nunca aparece em logs.",
        min_length=10,
    )
    message_text: str = Field(
        default="",
        description="Texto simulado. Não é logado nem armazenado.",
    )
    message_attachments: list[MessageAttachment] = Field(
        default_factory=list,
    )
    message_timestamp: str = Field(
        description="ISO 8601. Pode ser sintético (ex.: '2026-01-01T00:00:00Z').",
        min_length=1,
    )

    # Canal e integrações (sintéticos no dry-run)
    channel: Literal["whatsapp"] = Field(default="whatsapp")
    chatwoot_conversation_id: str = Field(
        description="ID sintético do Chatwoot. Nunca contactado durante dry-run.",
        min_length=1,
    )
    chatwoot_account_id: str = Field(
        min_length=1,
    )

    # Contexto real (read-only, opcional)
    allow_real_reads: bool = Field(
        default=False,
        description=(
            "Quando True e lead_id/city_id presentes, GET ao backend são reais "
            "(read-only). POST/PATCH/PUT sempre sintéticos."
        ),
    )

    # Metadados e rastreamento
    metadata: MessageMetadata = Field(default_factory=MessageMetadata)
    correlation_id: str = Field(
        description="UUID de correlação para rastreamento. Pode ser sintético.",
        min_length=1,
    )
    idempotency_key: str = Field(
        default="",
        description="Chave de idempotência. Gerada automaticamente se vazia.",
    )

    def to_inbound_payload_dict(self) -> dict[str, Any]:
        """Converte para dict compatível com o nó ``receive_message``.

        Espelha ``WhatsAppMessageRequest.to_payload_dict()`` para reutilizar
        o nó receive_message sem modificação.
        """
        return {
            "conversation_id": self.conversation_id,
            "lead_id": self.lead_id,
            "customer_phone": self.customer_phone,
            "message_text": self.message_text,
            "message_attachments": [
                a.model_dump(exclude_none=True) for a in self.message_attachments
            ],
            "message_timestamp": self.message_timestamp,
            "channel": self.channel,
            "chatwoot_conversation_id": self.chatwoot_conversation_id,
            "chatwoot_account_id": self.chatwoot_account_id,
            "metadata": self.metadata.model_dump(),
            "correlation_id": self.correlation_id,
            # idempotency_key não é relevante para receive_message, mas mantemos
            # para compatibilidade de interface
            "idempotency_key": self.idempotency_key or f"playground-{self.correlation_id}",
        }


# ---------------------------------------------------------------------------
# Trace entry (por nó percorrido)
# ---------------------------------------------------------------------------


class TraceEntry(BaseModel):
    """Entrada de trace para um nó percorrido durante a execução dry-run.

    LGPD: nunca contém ``message_text`` bruto, ``customer_phone``,
    ``customer_name`` nem qualquer PII bruta.
    """

    model_config = ConfigDict(extra="forbid")

    node: str = Field(description="Nome canônico do nó executado.")
    dry_run: bool = Field(
        default=True,
        description="Sempre True em respostas do playground.",
    )
    intent: str | None = Field(
        default=None,
        description="Intenção classificada (somente nós de classificação).",
    )
    prompt_version: str | None = Field(
        default=None,
        description="Versão do prompt usado neste nó (ex.: 'intent_classifier@v3').",
    )
    model: str | None = Field(
        default=None,
        description="Modelo LLM usado neste nó.",
    )
    tokens_in: int | None = Field(
        default=None,
        ge=0,
        description="Tokens de entrada enviados ao LLM neste nó.",
    )
    tokens_out: int | None = Field(
        default=None,
        ge=0,
        description="Tokens de saída gerados neste nó.",
    )
    latency_ms: float | None = Field(
        default=None,
        ge=0,
        description="Latência da chamada LLM deste nó em milissegundos.",
    )
    intercepted_method: str | None = Field(
        default=None,
        description="Método HTTP interceptado (GET/POST/PUT) — entradas do sink.",
    )
    intercepted_path: str | None = Field(
        default=None,
        description="Path interceptado — entradas do sink.",
    )
    idempotency_key: str | None = Field(
        default=None,
        description="Chave de idempotência da chamada interceptada, se presente.",
    )


# ---------------------------------------------------------------------------
# Response
# ---------------------------------------------------------------------------


class PlaygroundResponse(BaseModel):
    """Resposta de POST /process/whatsapp/playground.

    Contém o resultado do grafo em modo dry-run: reply, trace dos nós
    percorridos, versões de prompt usadas e metadados de custo/latência.
    Não inclui o estado completo da conversa (evita vazar PII de contexto).

    LGPD: nenhum campo de PII bruta é exposto. ``reply.content`` pode conter
    texto gerado pelo LLM — responsabilidade dos nós garantir ausência de PII.
    """

    model_config = ConfigDict(extra="forbid")

    # Eco dos identificadores
    conversation_id: str = Field(description="Ecoado do request.")
    dry_run: Literal[True] = Field(
        default=True,
        description="Sempre True — confirma modo dry-run.",
    )

    # Resultado do processamento
    reply_type: str = Field(
        description="Tipo do reply gerado: 'text', 'template' ou 'none'.",
    )
    reply_content: str = Field(
        default="",
        description="Conteúdo do reply quando type='text'.",
    )
    handoff_required: bool = Field(
        description="True se o grafo ativou handoff durante dry-run.",
    )
    handoff_reason: str | None = Field(
        default=None,
        description="Razão do handoff, se ativado.",
    )

    # Observabilidade
    trace: list[TraceEntry] = Field(
        default_factory=list,
        description=(
            "Nós percorridos + chamadas ao backend interceptadas. "
            "Sem PII bruta."
        ),
    )
    prompt_versions_used: list[str] = Field(
        default_factory=list,
        description="Versões de prompt distintas usadas nesta execução.",
    )
    tokens_total: int = Field(
        default=0,
        ge=0,
        description="Total de tokens (in + out) consumidos na execução.",
    )
    graph_version: str = Field(
        description="Versão semântica do grafo (SemVer).",
    )
    latency_ms: int = Field(
        ge=0,
        description="Latência total da execução em milissegundos.",
    )
    errors: list[dict[str, Any]] = Field(
        default_factory=list,
        description="Erros acumulados durante a execução (sem PII bruta).",
    )


__all__ = [
    "PlaygroundRequest",
    "PlaygroundResponse",
    "TraceEntry",
]
