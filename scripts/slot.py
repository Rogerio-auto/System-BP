#!/usr/bin/env python3
"""
slot.py — CLI canônica para o ciclo de vida de slots do Elemento.

Reduz overhead de tokens e elimina classes de bug (claim race,
working-tree compartilhado entre agentes) ao consolidar em comandos
atômicos o que antes era 5-7 comandos git+markdown manuais.

Subcomandos
-----------
  status [--json] [--phase F0]
      Resumo compacto do board (substitui leitura de STATUS.md gigante).

  claim <slot-id> [--from-main] [--force]
      Atômico: valida main limpo, cria branch feat/<slot-id-lc>, atualiza
      frontmatter + STATUS.md, commita chore. Rejeita claim duplicado.

  finish <slot-id> [--no-commit]
      Marca slot review: atualiza frontmatter (status, completed_at),
      atualiza STATUS.md, commita chore.

  validate <slot-id>
      Parseia o bloco "Validação" do slot e roda cada comando.
      Saída JSON com pass/fail por comando.

  done <slot-id> [--pr-url URL]
      Marca slot done (pós-merge). Atualiza frontmatter e STATUS.md.
      Idempotente — rodar 2x é no-op.

  sync
      Reconcilia STATUS.md a partir dos frontmatters dos slots.
      Slot files = fonte da verdade; STATUS.md = view derivada.

  list-available
      Lista slot ids com status=available e depends_on satisfeitos.
      Útil para o orchestrator escolher próximo slot.

  reconcile-merged [--remote origin] [--write]
      Detecta slots cujo branch foi mergeado em main e marca como done.
      Por default só lista; passe --write para aplicar.

  preflight [--json]
      Checa estado do working tree antes de qualquer agente começar.
      Aborta com código 1 se sujo ou em main com pull pendente.

  pr open <slot-id> [--draft]
      Abre PR no GitHub a partir do branch do slot. Título/body
      derivados do frontmatter + summary block do slot. Usa `gh`.

  pr merge <pr-number> [--reconcile]
      Mergeia PR via `gh pr merge --merge`. Com --reconcile, sincroniza
      main local e roda reconcile-merged --write em sequência.

Princípios
----------
- Stdlib only (sem PyYAML / sem deps). Frontmatter é regex-friendly.
- Idempotência: rodar duas vezes não duplica chore commits ou claims.
- Falha cedo: aborta com mensagem clara se pré-condição violada.
- Saída em UTF-8 explícito (Windows-safe).
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shlex
import subprocess
import sys
from collections import Counter
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

# -----------------------------------------------------------------------------
# Constantes
# -----------------------------------------------------------------------------

REPO_ROOT = Path(__file__).resolve().parent.parent
SLOTS_DIR = REPO_ROOT / "tasks" / "slots"
STATUS_FILE = REPO_ROOT / "tasks" / "STATUS.md"

VALID_STATUS = {
    "available", "blocked", "claimed", "in-progress",
    "review", "done", "cancelled",
}

STATUS_EMOJI = {
    "available": "🟢",
    "blocked": "⏸️",
    "claimed": "🟡",
    "in-progress": "🔵",
    "review": "🟣",
    "done": "✅",
    "cancelled": "⚫",
}

# Ordem das colunas no resumo do STATUS.md
SUMMARY_ORDER = ["available", "blocked", "claimed", "in-progress", "review", "done"]


# -----------------------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------------------

def die(msg: str, code: int = 1) -> None:
    print(f"error: {msg}", file=sys.stderr)
    sys.exit(code)


def warn(msg: str) -> None:
    print(f"warning: {msg}", file=sys.stderr)


def info(msg: str) -> None:
    print(msg, file=sys.stderr)


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def run_git(args: list[str], check: bool = True, capture: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["git", *args],
        cwd=REPO_ROOT,
        check=check,
        capture_output=capture,
        text=True,
        encoding="utf-8",
    )


def current_branch() -> str:
    return run_git(["rev-parse", "--abbrev-ref", "HEAD"]).stdout.strip()


def working_tree_dirty() -> bool:
    """True se há mudanças não-commitadas (ignora .claude/settings.local.json)."""
    out = run_git(["status", "--porcelain"]).stdout
    for line in out.splitlines():
        path = line[3:].strip()
        if path == ".claude/settings.local.json":
            continue
        return True
    return False


def branch_exists(name: str) -> bool:
    res = run_git(["rev-parse", "--verify", f"refs/heads/{name}"], check=False)
    return res.returncode == 0


def slot_id_to_branch(slot_id: str) -> str:
    return f"feat/{slot_id.lower()}"


def phase_of(slot_id: str) -> str:
    m = re.match(r"^(F\d+)-", slot_id)
    if not m:
        die(f"Invalid slot id: {slot_id}")
    return m.group(1)


# -----------------------------------------------------------------------------
# Frontmatter (parser regex, sem PyYAML)
# -----------------------------------------------------------------------------

@dataclass
class Slot:
    """Estado parseado de um slot file."""
    id: str
    title: str
    phase: str
    status: str
    priority: str
    depends_on: list[str]
    path: Path

    def to_dict(self) -> dict:
        d = asdict(self)
        d["path"] = str(self.path.relative_to(REPO_ROOT))
        return d


_FRONTMATTER_RE = re.compile(r"^---\s*\n(.*?)\n---\s*\n", re.DOTALL)


def find_slot_file(slot_id: str) -> Path:
    """Localiza o arquivo .md do slot por ID."""
    phase = phase_of(slot_id)
    phase_dir = SLOTS_DIR / phase
    if not phase_dir.is_dir():
        die(f"Phase dir not found: {phase_dir}")
    candidates = sorted(phase_dir.glob(f"{slot_id}-*.md"))
    if not candidates:
        die(f"Slot file not found for {slot_id} in {phase_dir}")
    if len(candidates) > 1:
        die(f"Multiple slot files match {slot_id}: {[p.name for p in candidates]}")
    return candidates[0]


def parse_slot(path: Path) -> Slot:
    text = path.read_text(encoding="utf-8")
    m = _FRONTMATTER_RE.match(text)
    if not m:
        die(f"No frontmatter in {path}")
    fm = _parse_yaml_subset(m.group(1))

    def required(key: str) -> str:
        v = fm.get(key)
        if v is None:
            die(f"Missing field '{key}' in {path}")
        return v

    raw_deps = fm.get("depends_on", "[]")
    deps = _parse_list_inline(raw_deps)

    return Slot(
        id=required("id"),
        title=required("title"),
        phase=required("phase"),
        status=required("status"),
        priority=fm.get("priority", "medium"),
        depends_on=deps,
        path=path,
    )


def _parse_yaml_subset(text: str) -> dict[str, str]:
    """Parseia subset de YAML usado nos frontmatters (chaves top-level simples)."""
    result: dict[str, str] = {}
    for raw in text.splitlines():
        if not raw or raw.startswith("#"):
            continue
        if raw[0] in " \t":
            # subkeys de lista em formato YAML multilinha — ignorar (não usado nas chaves que parseamos)
            continue
        if ":" not in raw:
            continue
        key, _, value = raw.partition(":")
        result[key.strip()] = value.strip()
    return result


def _parse_list_inline(value: str) -> list[str]:
    """Parseia lista inline YAML: '[F0-S01, F0-S02]' → ['F0-S01', 'F0-S02']."""
    value = value.strip()
    if not value or value in ("[]", "null", "~"):
        return []
    if value.startswith("[") and value.endswith("]"):
        inner = value[1:-1].strip()
        if not inner:
            return []
        return [x.strip().strip("'\"") for x in inner.split(",") if x.strip()]
    # Não suportamos lista YAML em multilinha aqui — slots usam inline.
    return [value]


def update_frontmatter_fields(path: Path, updates: dict[str, str]) -> None:
    """Atualiza N campos no frontmatter, in-place. Cria campo se não existir."""
    text = path.read_text(encoding="utf-8")
    m = _FRONTMATTER_RE.match(text)
    if not m:
        die(f"No frontmatter in {path}")
    fm_text = m.group(1)
    body = text[m.end():]

    for key, value in updates.items():
        pattern = rf"^({re.escape(key)}: ).*$"
        new_fm, count = re.subn(pattern, rf"\g<1>{value}", fm_text, count=1, flags=re.MULTILINE)
        if count == 0:
            # Append no fim do frontmatter
            new_fm = fm_text.rstrip("\n") + f"\n{key}: {value}\n"
        fm_text = new_fm

    new_text = f"---\n{fm_text}\n---\n{body}"
    path.write_text(new_text, encoding="utf-8")


# -----------------------------------------------------------------------------
# STATUS.md — view derivada dos frontmatters
# -----------------------------------------------------------------------------

def all_slots() -> list[Slot]:
    slots: list[Slot] = []
    for path in sorted(SLOTS_DIR.rglob("F*-S*.md")):
        if path.name.endswith("README.md"):
            continue
        try:
            slots.append(parse_slot(path))
        except SystemExit:
            raise
        except Exception as e:  # noqa: BLE001
            warn(f"skip {path.relative_to(REPO_ROOT)}: {e}")
    return slots


def slots_by_phase(slots: Iterable[Slot]) -> dict[str, list[Slot]]:
    by_phase: dict[str, list[Slot]] = {}
    for s in slots:
        by_phase.setdefault(s.phase, []).append(s)
    return by_phase


def slot_to_status_row(s: Slot, col_widths: dict[str, int]) -> str:
    emoji_status = f"{STATUS_EMOJI.get(s.status, '❓')} {s.status}"
    deps = ", ".join(s.depends_on) if s.depends_on else "—"
    cells = [
        s.id.ljust(col_widths["id"]),
        s.title.ljust(col_widths["title"]),
        emoji_status.ljust(col_widths["status"]),
        s.priority.ljust(col_widths["priority"]),
        deps.ljust(col_widths["deps"]),
    ]
    return "| " + " | ".join(cells) + " |"


def render_status_md(slots: list[Slot]) -> str:
    """Renderiza STATUS.md completo a partir dos slots."""
    header = [
        "# STATUS — Board de slots",
        "",
        "> Atualize via `python scripts/slot.py sync` (NÃO edite à mão — slot frontmatters são a fonte da verdade).",
        "",
        "Legenda: `available` 🟢 · `blocked` ⏸️ · `claimed` 🟡 · `in-progress` 🔵 · `review` 🟣 · `done` ✅ · `cancelled` ⚫",
        "",
        "## Resumo",
        "",
        "| Fase | Total | 🟢  | ⏸️  | 🟡  | 🔵  | 🟣  | ✅  |",
        "| ---- | ----- | --- | --- | --- | --- | --- | --- |",
    ]

    by_phase = slots_by_phase(slots)
    for phase in sorted(by_phase.keys()):
        phase_slots = by_phase[phase]
        counts = Counter(s.status for s in phase_slots)
        row = (
            f"| {phase}   | {len(phase_slots)}     | "
            f"{counts.get('available', 0)}   | "
            f"{counts.get('blocked', 0)}   | "
            f"{counts.get('claimed', 0)}   | "
            f"{counts.get('in-progress', 0)}   | "
            f"{counts.get('review', 0)}   | "
            f"{counts.get('done', 0)}   |"
        )
        header.append(row)

    header.append("")

    for phase in sorted(by_phase.keys()):
        phase_slots = by_phase[phase]
        phase_label = {
            "F0": "Preparação",
            "F1": "Base operacional",
            "F2": "Crédito e simulação",
            "F3": "Agentes IA",
            "F4": "Atendimento WhatsApp + Chatwoot",
            "F5": "Follow-up e cobrança",
            "F6": "Dashboards e relatórios",
            "F7": "Hardening final",
        }.get(phase, "")
        header.append(f"## Fase {phase[1:]} — {phase_label}".rstrip())
        header.append("")

        col_widths = {
            "id": max(len("ID"), max((len(s.id) for s in phase_slots), default=2)),
            "title": max(len("Título"), max((len(s.title) for s in phase_slots), default=6)),
            "status": max(len("Status"), max((len(f"{STATUS_EMOJI.get(s.status, '❓')} {s.status}") for s in phase_slots), default=6)),
            "priority": max(len("Prioridade"), max((len(s.priority) for s in phase_slots), default=10)),
            "deps": max(len("Depende de"), max((len(", ".join(s.depends_on) or "—") for s in phase_slots), default=10)),
        }
        head = "| " + " | ".join([
            "ID".ljust(col_widths["id"]),
            "Título".ljust(col_widths["title"]),
            "Status".ljust(col_widths["status"]),
            "Prioridade".ljust(col_widths["priority"]),
            "Depende de".ljust(col_widths["deps"]),
        ]) + " |"
        sep = "| " + " | ".join(["-" * col_widths[k] for k in ["id", "title", "status", "priority", "deps"]]) + " |"
        header.append(head)
        header.append(sep)
        for s in sorted(phase_slots, key=_slot_sort_key):
            header.append(slot_to_status_row(s, col_widths))
        header.append("")

    return "\n".join(header).rstrip() + "\n"


def _slot_sort_key(s: Slot) -> tuple:
    """Ordena F1-S01 antes de F1-S10 e antes de F1-S03b corretamente."""
    m = re.match(r"^F(\d+)-S(\d+)([a-z]?)$", s.id)
    if not m:
        return (99, 99, "z", s.id)
    return (int(m.group(1)), int(m.group(2)), m.group(3) or "")


# -----------------------------------------------------------------------------
# Subcommand: status
# -----------------------------------------------------------------------------

def cmd_status(args: argparse.Namespace) -> int:
    slots = all_slots()
    if args.phase:
        slots = [s for s in slots if s.phase == args.phase.upper()]
    by_phase = slots_by_phase(slots)

    if args.json:
        out = {
            "phases": {
                phase: {
                    "total": len(phase_slots),
                    "counts": dict(Counter(s.status for s in phase_slots)),
                    "slots": [s.to_dict() for s in sorted(phase_slots, key=_slot_sort_key)],
                }
                for phase, phase_slots in sorted(by_phase.items())
            },
            "totals": dict(Counter(s.status for s in slots)),
            "total": len(slots),
        }
        print(json.dumps(out, indent=2, ensure_ascii=False))
        return 0

    # Texto compacto (default)
    print(f"Board ({len(slots)} slots total)")
    print()
    for phase in sorted(by_phase.keys()):
        phase_slots = by_phase[phase]
        counts = Counter(s.status for s in phase_slots)
        parts = [f"{STATUS_EMOJI[k]}{counts.get(k, 0)}" for k in SUMMARY_ORDER if counts.get(k, 0)]
        print(f"  {phase}  ({len(phase_slots):2d}):  {'  '.join(parts)}")
    print()
    return 0


# -----------------------------------------------------------------------------
# Subcommand: list-available
# -----------------------------------------------------------------------------

def cmd_list_available(args: argparse.Namespace) -> int:
    slots = all_slots()
    by_id = {s.id: s for s in slots}
    available = []
    for s in slots:
        if s.status != "available":
            continue
        if not all(by_id.get(dep) and by_id[dep].status == "done" for dep in s.depends_on):
            # Tem dep que não está done
            continue
        available.append(s)

    if args.json:
        print(json.dumps([s.to_dict() for s in sorted(available, key=_slot_sort_key)], indent=2, ensure_ascii=False))
    else:
        if not available:
            print("(nenhum slot available com deps satisfeitos)")
        for s in sorted(available, key=_slot_sort_key):
            print(f"  {s.id}  [{s.priority}]  {s.title}")
    return 0


# -----------------------------------------------------------------------------
# Subcommand: claim
# -----------------------------------------------------------------------------

def cmd_claim(args: argparse.Namespace) -> int:
    slot_id = args.slot_id
    path = find_slot_file(slot_id)
    slot = parse_slot(path)

    # Pré-condições
    if slot.status not in ("available", "blocked") and not args.force:
        die(f"Slot {slot_id} is '{slot.status}', not available. Use --force to override.")

    if working_tree_dirty():
        die("Working tree is dirty. Commit or stash before claiming.")

    branch = slot_id_to_branch(slot_id)
    if branch_exists(branch):
        die(f"Branch {branch} already exists. Use --force to checkout existing.")

    # Checkout main, pull, branch
    info(f"[slot] claiming {slot_id} (branch: {branch})")
    run_git(["fetch", "origin", "main"], check=False)
    run_git(["checkout", "main"])
    run_git(["pull", "--ff-only", "origin", "main"], check=False)
    run_git(["checkout", "-b", branch])

    # Frontmatter + STATUS.md
    update_frontmatter_fields(path, {
        "status": "in-progress",
        "agent_id": os.environ.get("ELEMENTO_AGENT_ID", "claude-code"),
        "claimed_at": now_iso(),
    })
    sync_status_md()

    # Commit chore
    run_git(["add", str(path.relative_to(REPO_ROOT)), str(STATUS_FILE.relative_to(REPO_ROOT))])
    run_git(["commit", "-m", f"chore(tasks): {slot_id} in-progress"])

    info(f"[slot] {slot_id} claimed on branch {branch} (commit {_short_sha()})")
    return 0


def _short_sha() -> str:
    return run_git(["rev-parse", "--short", "HEAD"]).stdout.strip()


def _find_slot_branch_tip(slot_id: str, remote: str = "origin") -> str | None:
    """Encontra o tip do branch do slot — aceita prefixos case-insensitive.

    Procura por refs locais e remotos cujo nome começa com 'feat/<slot-id-lc>'
    (case-insensitive). Os branches reais têm sufixo descritivo
    (ex: feat/F0-S03-api-healthcheck) — case varia entre F0/f0.
    """
    needle = f"feat/{slot_id.lower()}"
    for ref_kind in ("refs/heads", f"refs/remotes/{remote}"):
        res = run_git(["for-each-ref", "--format=%(refname:short) %(objectname)", ref_kind], check=False)
        if res.returncode != 0:
            continue
        for line in res.stdout.splitlines():
            name, _, sha = line.partition(" ")
            short = name[len(f"{remote}/"):] if name.startswith(f"{remote}/") else name
            if short.lower().startswith(needle):
                return sha.strip()
    return None


# -----------------------------------------------------------------------------
# Subcommand: finish
# -----------------------------------------------------------------------------

def cmd_finish(args: argparse.Namespace) -> int:
    slot_id = args.slot_id
    path = find_slot_file(slot_id)
    slot = parse_slot(path)

    branch = slot_id_to_branch(slot_id)
    if current_branch() != branch and not args.force:
        die(f"Not on branch {branch} (current: {current_branch()}). Use --force to override.")

    if slot.status == "review":
        info(f"[slot] {slot_id} already in review — nothing to do")
        return 0

    update_frontmatter_fields(path, {
        "status": "review",
        "completed_at": now_iso(),
    })
    sync_status_md()

    if not args.no_commit:
        run_git(["add", str(path.relative_to(REPO_ROOT)), str(STATUS_FILE.relative_to(REPO_ROOT))])
        run_git(["commit", "-m", f"chore(tasks): {slot_id} review"])
        info(f"[slot] {slot_id} marked review (commit {_short_sha()})")
    else:
        info(f"[slot] {slot_id} marked review (no commit; files staged via sync)")

    return 0


# -----------------------------------------------------------------------------
# Subcommand: validate
# -----------------------------------------------------------------------------

_VALIDATION_BLOCK_RE = re.compile(
    r"^##\s+Valida[cç][aã]o\s*\n(.*?)(?=^##\s+|\Z)",
    re.MULTILINE | re.DOTALL,
)
_CODE_FENCE_RE = re.compile(r"^```(?:[a-z]*)\n(.*?)\n```", re.MULTILINE | re.DOTALL)


def cmd_validate(args: argparse.Namespace) -> int:
    slot_id = args.slot_id
    path = find_slot_file(slot_id)
    text = path.read_text(encoding="utf-8")

    m = _VALIDATION_BLOCK_RE.search(text)
    if not m:
        die(f"No '## Validação' block in {path.name}")

    commands: list[str] = []
    for fence in _CODE_FENCE_RE.finditer(m.group(1)):
        for line in fence.group(1).splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            commands.append(line)

    if not commands:
        die(f"'## Validação' block has no shell commands in {path.name}")

    results = []
    for cmd in commands:
        info(f"[validate] $ {cmd}")
        # Shell=True para suportar pipes e &&. POSIX/Windows-compatible.
        proc = subprocess.run(
            cmd, cwd=REPO_ROOT, shell=True, capture_output=True, text=True, encoding="utf-8",
        )
        results.append({
            "command": cmd,
            "returncode": proc.returncode,
            "passed": proc.returncode == 0,
            "stdout_tail": proc.stdout.splitlines()[-5:] if proc.stdout else [],
            "stderr_tail": proc.stderr.splitlines()[-5:] if proc.stderr else [],
        })

    passed = all(r["passed"] for r in results)
    out = {
        "slot": slot_id,
        "commands": len(commands),
        "passed": passed,
        "results": results,
    }
    print(json.dumps(out, indent=2, ensure_ascii=False))
    return 0 if passed else 1


# -----------------------------------------------------------------------------
# Subcommand: done
# -----------------------------------------------------------------------------

def cmd_done(args: argparse.Namespace) -> int:
    slot_id = args.slot_id
    path = find_slot_file(slot_id)
    slot = parse_slot(path)

    if slot.status == "done":
        info(f"[slot] {slot_id} already done — no-op")
        return 0

    updates = {"status": "done"}
    if args.pr_url:
        updates["pr_url"] = args.pr_url
    # completed_at — preserva se já existe
    text = path.read_text(encoding="utf-8")
    if not re.search(r"^completed_at:\s+\d{4}-", text, re.MULTILINE):
        updates["completed_at"] = now_iso()

    update_frontmatter_fields(path, updates)
    sync_status_md()
    info(f"[slot] {slot_id} marked done")
    return 0


# -----------------------------------------------------------------------------
# Subcommand: reconcile-merged
# -----------------------------------------------------------------------------

def cmd_reconcile_merged(args: argparse.Namespace) -> int:
    """Detecta slots cujo branch (feat/<slot-id-lc>) foi mergeado em main.

    Heurística: o tip do branch é alcançável a partir de origin/main.
    """
    base = f"{args.remote}/main"
    # Garantir que temos o ref atualizado
    run_git(["fetch", args.remote, "main"], check=False)

    slots = all_slots()
    actions: list[tuple[str, str]] = []  # (slot_id, action)

    for s in slots:
        if s.status == "done":
            continue
        tip = _find_slot_branch_tip(s.id, args.remote)
        if not tip:
            continue
        # tip está alcançável a partir de origin/main?
        res = run_git(["merge-base", "--is-ancestor", tip, base], check=False, capture=False)
        if res.returncode == 0:
            actions.append((s.id, f"{s.status} → done"))

    if not actions:
        info("[reconcile] nada a mudar")
        return 0

    for slot_id, action in actions:
        print(f"  {slot_id}  {action}")

    if not args.write:
        info("[reconcile] (dry-run; passe --write para aplicar)")
        return 0

    for slot_id, _ in actions:
        path = find_slot_file(slot_id)
        slot = parse_slot(path)
        if slot.status == "done":
            continue
        updates = {"status": "done"}
        text = path.read_text(encoding="utf-8")
        if not re.search(r"^completed_at:\s+\d{4}-", text, re.MULTILINE):
            updates["completed_at"] = now_iso()
        update_frontmatter_fields(path, updates)

    sync_status_md()
    info(f"[reconcile] {len(actions)} slot(s) marcados done + STATUS.md atualizado")
    return 0


# -----------------------------------------------------------------------------
# Subcommand: preflight
# -----------------------------------------------------------------------------

def cmd_preflight(args: argparse.Namespace) -> int:
    """Validação rápida do working tree — primeiro comando de qualquer agente."""
    branch = current_branch()
    dirty = working_tree_dirty()

    # Ignorar arquivo de config local + warnings de line-ending
    status_lines = []
    raw = run_git(["status", "--porcelain"]).stdout.splitlines()
    for line in raw:
        path = line[3:].strip()
        if path == ".claude/settings.local.json":
            continue
        status_lines.append(line)

    # Verificar se main está sync com origin (se estamos em main)
    main_behind = 0
    if branch == "main":
        run_git(["fetch", "origin", "main"], check=False)
        res = run_git(["rev-list", "--count", "main..origin/main"], check=False)
        if res.returncode == 0:
            try:
                main_behind = int(res.stdout.strip())
            except ValueError:
                main_behind = 0

    payload = {
        "branch": branch,
        "dirty": bool(status_lines),
        "dirty_paths": [l[3:].strip() for l in status_lines],
        "on_main": branch == "main",
        "main_behind_origin": main_behind,
        "ok": (not status_lines) and (main_behind == 0 or branch != "main"),
    }

    if args.json:
        print(json.dumps(payload, indent=2, ensure_ascii=False))
    else:
        status_symbol = "OK" if payload["ok"] else "BLOCK"
        print(f"[{status_symbol}] branch={branch}  dirty={'yes' if payload['dirty'] else 'no'}  main_behind={main_behind}")
        if payload["dirty"]:
            print("  Arquivos modificados:")
            for p in payload["dirty_paths"]:
                print(f"    {p}")
        if main_behind > 0 and branch == "main":
            print(f"  main está {main_behind} commits atrás de origin/main — rode `git pull --ff-only`")

    return 0 if payload["ok"] else 1


# -----------------------------------------------------------------------------
# Subcommands: pr open / pr merge
# -----------------------------------------------------------------------------

def _extract_section(text: str, heading: str) -> str | None:
    """Extrai uma seção de markdown por heading (## Heading) até próximo ## ou EOF."""
    pattern = rf"^##\s+{re.escape(heading)}\s*\n(.*?)(?=^##\s+|\Z)"
    m = re.search(pattern, text, re.MULTILINE | re.DOTALL)
    return m.group(1).strip() if m else None


def cmd_pr_open(args: argparse.Namespace) -> int:
    """Abre PR no GitHub usando `gh`. Body derivado do slot."""
    slot_id = args.slot_id
    path = find_slot_file(slot_id)
    slot = parse_slot(path)
    text = path.read_text(encoding="utf-8")

    tip = _find_slot_branch_tip(slot_id, "origin")
    if not tip:
        die(f"Branch do slot {slot_id} não encontrada em origin (push primeiro).")

    # Branch real (não o id-baseado) — pega o nome do ref
    branch = None
    res = run_git(["for-each-ref", "--format=%(refname:short)", f"refs/remotes/origin"], check=False)
    needle = f"feat/{slot_id.lower()}"
    for line in res.stdout.splitlines():
        short = line[len("origin/"):] if line.startswith("origin/") else line
        if short.lower().startswith(needle):
            branch = short
            break
    if not branch:
        die(f"Não encontrei branch remoto para {slot_id}")

    # Title: do feat commit mais recente do branch
    res = run_git(["log", "-1", "--format=%s", branch], check=False)
    title = res.stdout.strip() or f"[{slot_id}] {slot.title}"

    # Body: estrutura mínima a partir do slot
    relative = path.relative_to(REPO_ROOT).as_posix()
    parts = [
        f"## Slot",
        f"[{slot_id} — {slot.title}]({relative})",
    ]

    summary = _extract_section(text, "Resumo") or _extract_section(text, "Objetivo")
    if summary:
        parts += ["", "## Resumo", summary]

    dod = _extract_section(text, "Definition of Done") or _extract_section(text, "DoD")
    if dod:
        parts += ["", "## Definition of Done", dod]

    body = "\n".join(parts)

    cmd = ["gh", "pr", "create", "--base", "main", "--head", branch, "--title", title, "--body", body]
    if args.draft:
        cmd.append("--draft")

    info(f"[pr] opening PR for {slot_id} ({branch} → main)")
    proc = subprocess.run(cmd, cwd=REPO_ROOT, capture_output=True, text=True, encoding="utf-8")
    if proc.returncode != 0:
        die(f"gh pr create failed:\n{proc.stderr}")

    url = proc.stdout.strip()
    print(url)
    return 0


def cmd_pr_merge(args: argparse.Namespace) -> int:
    """Mergeia PR via gh + opcionalmente reconcilia main."""
    pr_number = args.pr_number
    info(f"[pr] merging PR #{pr_number}")
    proc = subprocess.run(
        ["gh", "pr", "merge", str(pr_number), "--merge", "--delete-branch=false"],
        cwd=REPO_ROOT, capture_output=True, text=True, encoding="utf-8",
    )
    if proc.returncode != 0:
        die(f"gh pr merge failed:\n{proc.stderr}")
    info(f"[pr] #{pr_number} merged")

    if args.reconcile:
        info("[pr] pulling main + reconciling slots")
        run_git(["fetch", "origin", "main"], check=False)
        cur = current_branch()
        if cur != "main":
            run_git(["checkout", "main"])
        run_git(["pull", "--ff-only", "origin", "main"], check=False)
        # Chama a si mesmo para reconcile
        return cmd_reconcile_merged(argparse.Namespace(remote="origin", write=True))

    return 0


# -----------------------------------------------------------------------------
# Subcommand: sync
# -----------------------------------------------------------------------------

def sync_status_md() -> None:
    slots = all_slots()
    rendered = render_status_md(slots)
    STATUS_FILE.write_text(rendered, encoding="utf-8")


def cmd_sync(args: argparse.Namespace) -> int:
    sync_status_md()
    info(f"[slot] STATUS.md re-rendered from {len(all_slots())} slot frontmatters")
    return 0


# -----------------------------------------------------------------------------
# Main
# -----------------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="slot.py", description="CLI canônica para slots do Elemento")
    sub = p.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("status", help="Resumo compacto do board")
    s.add_argument("--json", action="store_true")
    s.add_argument("--phase", help="Filtrar por fase (ex: F0, F1)")
    s.set_defaults(func=cmd_status)

    s = sub.add_parser("list-available", help="Lista slots available com deps satisfeitos")
    s.add_argument("--json", action="store_true")
    s.set_defaults(func=cmd_list_available)

    s = sub.add_parser("claim", help="Reserva slot e cria branch")
    s.add_argument("slot_id")
    s.add_argument("--force", action="store_true")
    s.set_defaults(func=cmd_claim)

    s = sub.add_parser("finish", help="Marca slot review e commita")
    s.add_argument("slot_id")
    s.add_argument("--no-commit", action="store_true")
    s.add_argument("--force", action="store_true")
    s.set_defaults(func=cmd_finish)

    s = sub.add_parser("validate", help="Roda comandos do bloco Validação do slot")
    s.add_argument("slot_id")
    s.set_defaults(func=cmd_validate)

    s = sub.add_parser("done", help="Marca slot done (pós-merge)")
    s.add_argument("slot_id")
    s.add_argument("--pr-url")
    s.set_defaults(func=cmd_done)

    s = sub.add_parser("reconcile-merged", help="Detecta slots mergeados em main e marca done")
    s.add_argument("--remote", default="origin")
    s.add_argument("--write", action="store_true")
    s.set_defaults(func=cmd_reconcile_merged)

    s = sub.add_parser("sync", help="Re-renderiza STATUS.md a partir dos frontmatters")
    s.set_defaults(func=cmd_sync)

    s = sub.add_parser("preflight", help="Checa working tree antes de começar slot")
    s.add_argument("--json", action="store_true")
    s.set_defaults(func=cmd_preflight)

    pr = sub.add_parser("pr", help="Helpers de PR (gh wrapper)")
    pr_sub = pr.add_subparsers(dest="pr_cmd", required=True)
    pr_open = pr_sub.add_parser("open", help="Abre PR do slot")
    pr_open.add_argument("slot_id")
    pr_open.add_argument("--draft", action="store_true")
    pr_open.set_defaults(func=cmd_pr_open)
    pr_merge = pr_sub.add_parser("merge", help="Mergeia PR + reconcile")
    pr_merge.add_argument("pr_number", type=int)
    pr_merge.add_argument("--reconcile", action="store_true")
    pr_merge.set_defaults(func=cmd_pr_merge)

    return p


def main(argv: list[str] | None = None) -> int:
    # UTF-8 stdout no Windows
    if sys.platform == "win32":
        try:
            sys.stdout.reconfigure(encoding="utf-8")
            sys.stderr.reconfigure(encoding="utf-8")
        except Exception:  # noqa: BLE001
            pass

    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
