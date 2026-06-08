"""
slot_finish_docs_test.py -- Testes para validate_docs_required em scripts/slot.py.

Cobre os 3 cenarios de DoD do slot F10-S14:
  1. docs_required: false -> passa (None retornado)
  2. docs_required: true + artefatos listados e existentes -> passa
  3. docs_required: true + docs_artifacts vazio -> bloqueia (mensagem [block])
  4. docs_required: true + artefatos listados mas inexistentes -> bloqueia com lista
  5. docs_required: true + --skip-docs -> passa + registra em _skip-docs.log
  6. docs_required ausente -> default true -> bloqueia se sem artefatos
"""

from __future__ import annotations

import sys
import tempfile
import textwrap
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(REPO_ROOT / "scripts"))

import importlib.util

_spec = importlib.util.spec_from_file_location(
    "slot", REPO_ROOT / "scripts" / "slot.py"
)
assert _spec is not None and _spec.loader is not None
_slot_mod = importlib.util.module_from_spec(_spec)
sys.modules["slot"] = _slot_mod
_spec.loader.exec_module(_slot_mod)  # type: ignore[attr-defined]

validate_docs_required = _slot_mod.validate_docs_required


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


def _make_slot_file(tmp_path: Path, docs_required: str, docs_artifacts_block: str) -> Path:
    """Cria arquivo de slot fake com frontmatter para testes."""
    content = textwrap.dedent(f"""
        ---
        id: F10-S99
        title: Slot fake para testes
        phase: F10
        task_ref: test
        status: in-progress
        priority: low
        estimated_size: XS
        agent_id: null
        claimed_at: null
        completed_at: null
        pr_url: null
        depends_on: []
        blocks: []
        docs_required: {docs_required}
        docs_audience: []
        {docs_artifacts_block}
        ---

        # F10-S99 fake
    """).lstrip()
    p = tmp_path / "F10-S99-fake.md"
    p.write_text(content, encoding="utf-8")
    return p


# ---------------------------------------------------------------------------
# Cenario 1: docs_required false -> passa
# ---------------------------------------------------------------------------


def test_docs_required_false_passes(tmp_path: Path) -> None:
    slot_file = _make_slot_file(tmp_path, docs_required="false", docs_artifacts_block="docs_artifacts: []")
    result = validate_docs_required(slot_file, skip_docs=False, slot_id="F10-S99")
    assert result is None, f"Esperava None, obteve: {result!r}"


# ---------------------------------------------------------------------------
# Cenario 2: docs_required true + artefatos existem -> passa
# ---------------------------------------------------------------------------


def test_docs_required_true_with_existing_artifact_passes(tmp_path: Path) -> None:
    artifact = tmp_path / "some_doc.mdx"
    artifact.write_text("# Doc", encoding="utf-8")
    slot_file = _make_slot_file(
        tmp_path,
        docs_required="true",
        docs_artifacts_block=f"docs_artifacts: [{artifact}]",
    )
    result = validate_docs_required(slot_file, skip_docs=False, slot_id="F10-S99")
    assert result is None, f"Esperava None, obteve: {result!r}"


# ---------------------------------------------------------------------------
# Cenario 3: docs_required true + docs_artifacts vazio -> bloqueia
# ---------------------------------------------------------------------------


def test_docs_required_true_empty_artifacts_blocks(tmp_path: Path) -> None:
    slot_file = _make_slot_file(tmp_path, docs_required="true", docs_artifacts_block="docs_artifacts: []")
    result = validate_docs_required(slot_file, skip_docs=False, slot_id="F10-S99")
    assert result is not None, "Esperava mensagem de bloqueio"
    assert "[block]" in result
    assert "docs_artifacts" in result


# ---------------------------------------------------------------------------
# Cenario 4: docs_required true + artefatos inexistentes -> bloqueia com lista
# ---------------------------------------------------------------------------


def test_docs_required_true_missing_artifacts_blocks(tmp_path: Path) -> None:
    slot_file = _make_slot_file(
        tmp_path,
        docs_required="true",
        docs_artifacts_block="docs_artifacts: [docs/help/nao/existe.mdx]",
    )
    result = validate_docs_required(slot_file, skip_docs=False, slot_id="F10-S99")
    assert result is not None
    assert "[block]" in result
    assert "docs/help/nao/existe.mdx" in result


# ---------------------------------------------------------------------------
# Cenario 5: docs_required true + --skip-docs -> passa + log registrado
# ---------------------------------------------------------------------------


def test_skip_docs_bypasses_and_logs(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    log_path = tmp_path / "_skip-docs.log"
    monkeypatch.setattr(_slot_mod, "_SKIP_DOCS_LOG", log_path)

    slot_file = _make_slot_file(tmp_path, docs_required="true", docs_artifacts_block="docs_artifacts: []")
    result = validate_docs_required(
        slot_file,
        skip_docs=True,
        skip_reason="hotfix emergencial de producao",
        slot_id="F10-S99",
    )
    assert result is None, f"--skip-docs deveria retornar None, obteve: {result!r}"
    assert log_path.exists(), "_skip-docs.log deve ser criado"
    log_content = log_path.read_text(encoding="utf-8")
    assert "F10-S99" in log_content
    assert "hotfix emergencial de producao" in log_content


# ---------------------------------------------------------------------------
# Cenario 6: docs_required ausente -> default true -> bloqueia sem artefatos
# ---------------------------------------------------------------------------


def test_docs_required_absent_defaults_to_true(tmp_path: Path) -> None:
    # Cria slot sem o campo docs_required no frontmatter
    content = textwrap.dedent("""
        ---
        id: F10-S99
        title: Slot sem docs_required
        phase: F10
        status: in-progress
        priority: low
        docs_artifacts: []
        ---
        # Body
    """).lstrip()
    slot_file = tmp_path / "F10-S99-no-dr.md"
    slot_file.write_text(content, encoding="utf-8")
    result = validate_docs_required(slot_file, skip_docs=False, slot_id="F10-S99")
    assert result is not None, "docs_required ausente deve default para true e bloquear"
    assert "[block]" in result
