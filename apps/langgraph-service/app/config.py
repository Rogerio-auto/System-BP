"""Configuração via variáveis de ambiente. Falhar cedo se algo estiver faltando."""
from __future__ import annotations

from pydantic import Field, HttpUrl, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    environment: str = Field(default="development", validation_alias="NODE_ENV")
    log_level: str = Field(default="INFO", validation_alias="LOG_LEVEL")

    host: str = Field(default="0.0.0.0", validation_alias="LANGGRAPH_HOST")
    port: int = Field(default=8000, validation_alias="LANGGRAPH_PORT")

    backend_internal_url: HttpUrl = Field(validation_alias="BACKEND_INTERNAL_URL")
    internal_token: SecretStr = Field(validation_alias="LANGGRAPH_INTERNAL_TOKEN")

    # LLM gateway
    llm_provider: str = Field(default="openrouter", validation_alias="LLM_PROVIDER")
    openrouter_api_key: SecretStr | None = Field(
        default=None, validation_alias="OPENROUTER_API_KEY"
    )
    openrouter_base_url: str = Field(
        default="https://openrouter.ai/api/v1", validation_alias="OPENROUTER_BASE_URL"
    )
    openrouter_http_referer: str = Field(
        default="https://elemento.local", validation_alias="OPENROUTER_HTTP_REFERER"
    )
    openrouter_app_title: str = Field(
        default="Elemento", validation_alias="OPENROUTER_APP_TITLE"
    )

    anthropic_api_key: SecretStr | None = Field(default=None, validation_alias="ANTHROPIC_API_KEY")
    openai_api_key: SecretStr | None = Field(default=None, validation_alias="OPENAI_API_KEY")

    model_classifier: str = Field(
        default="anthropic/claude-3.5-haiku", validation_alias="LLM_MODEL_CLASSIFIER"
    )
    # Kimi K2 (moonshot/kimi-k2) é o reasoner default: throughput alto, custo competitivo
    # e capacidade de raciocínio em PT-BR adequada aos fluxos de qualificação e simulação.
    # Requisito explícito do CTO para go-live (F7-S01, 2026-05-22).
    model_reasoner: str = Field(
        default="moonshot/kimi-k2", validation_alias="LLM_MODEL_REASONER"
    )
    # Claude Sonnet 4 permanece como fallback automático caso Kimi K2 esteja indisponível
    # (rate-limit, 5xx). O gateway (F3-S00) honra este valor no caminho de retry.
    model_fallback: str = Field(
        default="anthropic/claude-sonnet-4", validation_alias="LLM_MODEL_FALLBACK"
    )

    daily_budget_usd: float = Field(default=20.0, validation_alias="LLM_DAILY_BUDGET_USD")
    max_tokens_per_conversation: int = Field(
        default=8000, validation_alias="LLM_MAX_TOKENS_PER_CONVERSATION"
    )


settings = Settings()  # type: ignore[call-arg]
