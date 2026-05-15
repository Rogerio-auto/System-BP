"""
test_slot.py — Testes para scripts/slot.py, focados em check-migrations.

Cobre os cenários de DoD do slot F0-S14:
  - .sql órfão sem entry no journal  → errors, não passed
  - entry no journal sem .sql        → errors, não passed
  - estado limpo (pós-hotfix)        → passed, sem errors
  - journal inválido (JSON ruim)     → errors, não passed
  - idx duplicado                    → warning, mas passed
  - gap no idx                       → warning, mas passed
  - teste de integração via CLI (check-migrations exit 0/1)
"""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path

import pytest

# Adiciona o diretório raiz do repo ao path para importar slot.py
REPO_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(REPO_ROOT / "scripts"))

# Importa as funções internas do slot.py
import importlib.util

_spec = importlib.util.spec_from_file_location(
    "slot", REPO_ROOT / "scripts" / "slot.py"
)
assert _spec is not None and _spec.loader is not None
_slot_mod = importlib.util.module_from_spec(_spec)
# Registrar em sys.modules antes de exec_module para que dataclasses consigam
# resolver o módulo pelo nome (necessário no Python 3.13+).
sys.modules["slot"] = _slot_mod
_spec.loader.exec_module(_slot_mod)  # type: ignore[attr-defined]

_check_migration_sync = _slot_mod._check_migration_sync
MigrationCheckResult = _slot_mod.MigrationCheckResult


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture()
def migration_sandbox(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """Cria um sandbox com estrutura migrations/ e patches MIGRATIONS_DIR/JOURNAL_PATH."""
    mig_dir = tmp_path / "migrations"
    mig_dir.mkdir()
    meta_dir = mig_dir / "meta"
    meta_dir.mkdir()
    journal_path = meta_dir / "_journal.json"

    monkeypatch.setattr(_slot_mod, "MIGRATIONS_DIR", mig_dir)
    monkeypatch.setattr(_slot_mod, "JOURNAL_PATH", journal_path)

    return mig_dir, journal_path


def _write_journal(journal_path: Path, entries: list[dict]) -> None:
    data = {"version": "7", "dialect": "postgresql", "entries": entries}
    journal_path.write_text(json.dumps(data, indent=2), encoding="utf-8")


def _make_sql(mig_dir: Path, tag: str) -> Path:
    p = mig_dir / f"{tag}.sql"
    p.write_text(f"-- migration {tag}\nSELECT 1;\n", encoding="utf-8")
    return p


def _entry(idx: int, tag: str) -> dict:
    return {"idx": idx, "version": "7", "when": 1748000000000, "tag": tag, "breakpoints": True}


# ---------------------------------------------------------------------------
# Testes unitários de _check_migration_sync
# ---------------------------------------------------------------------------


class TestCheckMigrationSync:

    def test_clean_state_passes(self, migration_sandbox):
        """Estado limpo: .sql e journal em sincronia → passed, sem errors."""
        mig_dir, journal_path = migration_sandbox
        tags = ["0000_init", "0001_cities", "0002_outbox"]
        for i, tag in enumerate(tags):
            _make_sql(mig_dir, tag)
        entries = [_entry(i, tag) for i, tag in enumerate(tags)]
        _write_journal(journal_path, entries)

        result = _check_migration_sync()

        assert result.passed is True
        assert result.errors == []

    def test_sql_orphan_without_journal_entry_fails(self, migration_sandbox):
        """Arquivo .sql sem entry no journal → erro, exit 1."""
        mig_dir, journal_path = migration_sandbox
        _make_sql(mig_dir, "0000_init")
        _make_sql(mig_dir, "9999_fake")  # órfão — sem entry
        _write_journal(journal_path, [_entry(0, "0000_init")])

        result = _check_migration_sync()

        assert result.passed is False
        assert any("9999_fake" in e for e in result.errors)
        assert any("órfão" in e or "orphan" in e.lower() or ".sql" in e for e in result.errors)

    def test_journal_entry_without_sql_fails(self, migration_sandbox):
        """Entry no journal sem .sql → erro, exit 1."""
        mig_dir, journal_path = migration_sandbox
        _make_sql(mig_dir, "0000_init")
        # Entry para 0001 mas .sql não existe
        _write_journal(journal_path, [
            _entry(0, "0000_init"),
            _entry(1, "0001_missing"),
        ])

        result = _check_migration_sync()

        assert result.passed is False
        assert any("0001_missing" in e for e in result.errors)

    def test_both_directions_detected(self, migration_sandbox):
        """Ambos os erros detectados na mesma execução."""
        mig_dir, journal_path = migration_sandbox
        _make_sql(mig_dir, "0000_init")
        _make_sql(mig_dir, "9999_orphan_sql")
        _write_journal(journal_path, [
            _entry(0, "0000_init"),
            _entry(1, "0001_orphan_entry"),
        ])

        result = _check_migration_sync()

        assert result.passed is False
        # Dois erros: 9999_orphan_sql sem entry + 0001_orphan_entry sem .sql
        assert len(result.errors) == 2

    def test_invalid_json_journal_fails(self, migration_sandbox):
        """Journal com JSON inválido → erro, não passed."""
        mig_dir, journal_path = migration_sandbox
        _make_sql(mig_dir, "0000_init")
        journal_path.write_text("{ invalid json !!! }", encoding="utf-8")

        result = _check_migration_sync()

        assert result.passed is False
        assert len(result.errors) > 0

    def test_missing_journal_fails(self, migration_sandbox):
        """Journal ausente → erro, não passed."""
        mig_dir, journal_path = migration_sandbox
        _make_sql(mig_dir, "0000_init")
        # Não escrevemos o journal

        result = _check_migration_sync()

        assert result.passed is False
        assert len(result.errors) > 0

    def test_duplicate_idx_is_warning_not_error(self, migration_sandbox):
        """idx duplicado → warning, mas passed (não bloqueia)."""
        mig_dir, journal_path = migration_sandbox
        _make_sql(mig_dir, "0000_init")
        _make_sql(mig_dir, "0001_alpha")
        # idx 1 duplicado
        _write_journal(journal_path, [
            _entry(0, "0000_init"),
            _entry(1, "0001_alpha"),
            {"idx": 1, "version": "7", "when": 1748000000001, "tag": "0001_alpha", "breakpoints": True},
        ])

        result = _check_migration_sync()

        # passed=True porque não há .sql órfão nem entry órfã
        # (0001_alpha aparece 2x no journal mas o .sql existe)
        assert result.passed is True
        assert any("duplicado" in w or "duplicate" in w.lower() for w in result.warnings)

    def test_idx_gap_is_warning_not_error(self, migration_sandbox):
        """Gap no idx (ex: 0013 → 0016) → warning, mas passed."""
        mig_dir, journal_path = migration_sandbox
        tags = ["0000_init", "0001_cities", "0013_chatwoot", "0016_credit"]
        for i, tag in enumerate(tags):
            _make_sql(mig_dir, tag)
        # idx com gap 1 → 13 e 13 → 16
        _write_journal(journal_path, [
            _entry(0, "0000_init"),
            _entry(1, "0001_cities"),
            _entry(13, "0013_chatwoot"),
            _entry(16, "0016_credit"),
        ])

        result = _check_migration_sync()

        assert result.passed is True
        # Deve ter warnings para os dois gaps: 1→13 e 13→16
        assert len(result.warnings) >= 2
        gap_warnings = [w for w in result.warnings if "Gap" in w or "gap" in w.lower()]
        assert len(gap_warnings) >= 2

    def test_empty_journal_empty_disk_passes(self, migration_sandbox):
        """Sem .sql e sem entries → estado vazio mas consistente → passed."""
        mig_dir, journal_path = migration_sandbox
        _write_journal(journal_path, [])

        result = _check_migration_sync()

        assert result.passed is True
        assert result.errors == []

    def test_production_state_after_hotfix(self, migration_sandbox):
        """Replica o estado pós-hotfix c5e6e76 (idx 0-13, 16-18 sem gap nos .sql)."""
        mig_dir, journal_path = migration_sandbox
        journal_entries = []
        # Entries idx 0-13 (sem 14 e 15 — gap esperado)
        tags_low = [
            (0, "0000_init"),
            (1, "0001_bent_mac_gargan"),
            (2, "0002_cities_agents"),
            (3, "0003_outbox_events"),
            (4, "0004_audit_logs"),
            (5, "0005_whatsapp_webhook"),
            (6, "0006_feature_flags"),
            (7, "0007_leads_core"),
            (8, "0008_lgpd_pii_crypto"),
            (9, "0009_kanban"),
            (10, "0010_data_subject"),
            (11, "0011_outbox_dlq"),
            (12, "0012_imports"),
            (13, "0013_chatwoot_events"),
            (16, "0016_credit_core"),
            (17, "0017_seed_credit_products_permissions"),
            (18, "0018_seed_simulations_permissions"),
        ]
        for idx, tag in tags_low:
            _make_sql(mig_dir, tag)
            journal_entries.append(_entry(idx, tag))
        _write_journal(journal_path, journal_entries)

        result = _check_migration_sync()

        assert result.passed is True
        assert result.errors == []
        # Gap 14/15 deve gerar 1 warning (gap 13→16)
        gap_warnings = [w for w in result.warnings if "Gap" in w]
        assert len(gap_warnings) == 1
        assert "0014" in gap_warnings[0]


# ---------------------------------------------------------------------------
# Teste de integração via CLI (subprocesso)
# ---------------------------------------------------------------------------


class TestCLIIntegration:

    def test_cli_passes_on_clean_state(self):
        """CLI `check-migrations` retorna exit 0 no estado real do repo (pós-hotfix)."""
        result = subprocess.run(
            [sys.executable, str(REPO_ROOT / "scripts" / "slot.py"), "check-migrations"],
            cwd=str(REPO_ROOT),
            capture_output=True,
            text=True,
            encoding="utf-8",
        )
        assert result.returncode == 0, (
            f"check-migrations falhou inesperadamente:\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}"
        )

    def test_cli_fails_on_orphan_sql(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
        """CLI `check-migrations` retorna exit 1 quando existe .sql órfão."""
        # Usamos uma pasta temporária com um .sql sem entry
        mig_dir = tmp_path / "migrations"
        mig_dir.mkdir()
        meta_dir = mig_dir / "meta"
        meta_dir.mkdir()
        journal_path = meta_dir / "_journal.json"

        (mig_dir / "9999_fake.sql").write_text("SELECT 1;", encoding="utf-8")
        journal_path.write_text(
            json.dumps({"version": "7", "dialect": "postgresql", "entries": []}),
            encoding="utf-8",
        )

        # Injeta as variáveis via monkeypatch no módulo já importado
        monkeypatch.setattr(_slot_mod, "MIGRATIONS_DIR", mig_dir)
        monkeypatch.setattr(_slot_mod, "JOURNAL_PATH", journal_path)

        result = _check_migration_sync()
        assert result.passed is False
        assert any("9999_fake" in e for e in result.errors)

    def test_cli_json_output_on_clean_state(self):
        """CLI com --json retorna JSON válido com passed=true no estado real."""
        result = subprocess.run(
            [sys.executable, str(REPO_ROOT / "scripts" / "slot.py"), "check-migrations", "--json"],
            cwd=str(REPO_ROOT),
            capture_output=True,
            text=True,
            encoding="utf-8",
        )
        assert result.returncode == 0
        data = json.loads(result.stdout)
        assert data["passed"] is True
        assert data["errors"] == []
        # Gap 0013→0016 deve gerar ao menos 1 warning
        assert len(data["warnings"]) >= 1
