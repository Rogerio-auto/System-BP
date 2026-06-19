"""Testes unitários para app/config.py — Settings.

Cobre:
- graph_timeout_sec: default 8.0 quando GRAPH_TIMEOUT_SEC não está definido
- graph_timeout_sec: override via variável de ambiente GRAPH_TIMEOUT_SEC
- Garante que o default 8.0s (doc 06 §4.4 — SLA de produção) não regride
"""
from __future__ import annotations

import importlib
import sys

import pytest


def _reload_settings(env_patch: dict[str, str]) -> object:
    """Reimporta app.config com patch de ambiente.

    Faz reload do módulo inteiro para que Settings() releia as vars de env
    com os valores patchados — necessário porque pydantic-settings lê o env
    no momento da instanciação, não em cada acesso.
    """
    # Remove módulo do cache para forçar reimportação
    for mod in list(sys.modules.keys()):
        if mod.startswith("app.config"):
            del sys.modules[mod]
    return None


# ---------------------------------------------------------------------------
# graph_timeout_sec
# ---------------------------------------------------------------------------


def test_graph_timeout_sec_default(monkeypatch: pytest.MonkeyPatch) -> None:
    """Default é 20.0 quando GRAPH_TIMEOUT_SEC não está no ambiente (F16-S49:
    8.0 era curto p/ o pré-atendimento agêntico; subiu p/ 20.0)."""
    monkeypatch.delenv("GRAPH_TIMEOUT_SEC", raising=False)
    _reload_settings({})

    import app.config as cfg  # noqa: PLC0415

    # Precisa reimportar após reload
    importlib.reload(cfg)
    assert cfg.settings.graph_timeout_sec == pytest.approx(20.0)


def test_graph_timeout_sec_override(monkeypatch: pytest.MonkeyPatch) -> None:
    """GRAPH_TIMEOUT_SEC=30 é lido corretamente e reflete em settings."""
    monkeypatch.setenv("GRAPH_TIMEOUT_SEC", "30")
    _reload_settings({"GRAPH_TIMEOUT_SEC": "30"})

    import app.config as cfg  # noqa: PLC0415

    importlib.reload(cfg)
    assert cfg.settings.graph_timeout_sec == pytest.approx(30.0)


def test_graph_timeout_sec_float(monkeypatch: pytest.MonkeyPatch) -> None:
    """Aceita valor float (ex: 12.5)."""
    monkeypatch.setenv("GRAPH_TIMEOUT_SEC", "12.5")
    _reload_settings({"GRAPH_TIMEOUT_SEC": "12.5"})

    import app.config as cfg  # noqa: PLC0415

    importlib.reload(cfg)
    assert cfg.settings.graph_timeout_sec == pytest.approx(12.5)
