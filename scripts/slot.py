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

  brief <slot-id> [--json]
      Briefing self-contained: frontmatter, deps satisfeitos, especialista
      sugerido, files_allowed parseados do corpo, arquivos existentes,
      próximo número de migration, seções (Objetivo/Escopo/DoD/Validação).
      Reduz o overhead inicial de 6-10 reads para 1 call.

  plan-batch [--max N] [--json]
      Recomenda batch de até N slots paralelos respeitando prioridade e
      detectando colisão de files_allowed. Saída pronta para o orchestrator.

  auto-review <slot-id> [--against REF] [--json]
      Pré-relatório determinístico de segurança via grep no diff vs main.
      Detecta: `as any`, `@ts-ignore`, `console.log`, hex hardcoded,
      `localStorage` de token, compare não timing-safe, colisão de migration.
      Saída JSON consumida pelo security-reviewer (que só confirma achados).

  worktree-clean
      Remove todos os worktrees .claude/worktrees/agent-* — unlock + git
      worktree remove --force + cmd rmdir com prefix \\?\\ para long-path
      no Windows + git worktree prune.

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


def _hook_env_for_worktree() -> dict[str, str] | None:
    """Retorna env dict com PATH aumentado para hooks pnpm em worktrees.

    Em worktrees adicionais, node_modules/ não existe (apenas no working tree
    principal). Hooks como .husky/pre-commit rodam `pnpm lint-staged` e falham
    com 'lint-staged not found'.

    Solução: injetar o node_modules/.bin do working tree principal no PATH para
    que pnpm possa resolver o binário lint-staged.

    Retorna None quando não estamos num worktree (sem necessidade de augmentar).
    """
    if not is_in_worktree():
        return None
    main = main_worktree_path()
    if main is None:
        return None
    main_bin = main / "node_modules" / ".bin"
    if not main_bin.is_dir():
        return None
    current_path = os.environ.get("PATH", "")
    augmented = f"{main_bin}{os.pathsep}{current_path}"
    env = {**os.environ, "PATH": augmented}
    return env


def run_git_commit(message: str) -> subprocess.CompletedProcess:
    """Executa 'git commit -m <message>' com env adequado para worktrees.

    Em worktrees adicionais, aumenta PATH com node_modules/.bin do working tree
    principal para que o pre-commit hook (pnpm lint-staged) resolva corretamente.
    """
    env = _hook_env_for_worktree()
    return subprocess.run(
        ["git", "commit", "-m", message],
        cwd=REPO_ROOT,
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
        **({"env": env} if env is not None else {}),
    )


def current_branch() -> str:
    return run_git(["rev-parse", "--abbrev-ref", "HEAD"]).stdout.strip()


def working_tree_dirty() -> bool:
    """True se há mudanças não-commitadas tracked.

    Ignora:
    - .claude/settings.local.json (config local volátil)
    - Arquivos untracked (??) — não afetam operações de branch/checkout

    Nota: arquivos untracked não interferem com `git checkout` nem com
    `git switch -c`, então não devem bloquear o claim. O que bloqueia são
    arquivos tracked modificados (M, A, D, R, C) ou arquivos staged.
    """
    out = run_git(["status", "--porcelain"]).stdout
    for line in out.splitlines():
        xy = line[:2]
        path = line[3:].strip()
        # Untracked — inofensivo para operações de branch
        if xy == "??":
            continue
        if path == ".claude/settings.local.json":
            continue
        return True
    return False


def is_in_worktree() -> bool:
    """Retorna True se REPO_ROOT está num worktree não-principal.

    Estratégia primária: `git rev-parse --git-dir` (com cwd=REPO_ROOT) retorna
    `.git` no working tree principal e um caminho absoluto contendo `worktrees`
    (ex: `/abs/path/.git/worktrees/<name>`) em worktrees adicionais.

    Estratégia de fallback: compara `git rev-parse --show-toplevel` com o
    primeiro entry de `git worktree list --porcelain` (que é sempre o main).
    Cobre edge cases onde o git-dir não segue a convenção `worktrees/`.

    Nota: REPO_ROOT é derivado de `Path(__file__).resolve()`, portanto quando
    o script é invocado de dentro de um worktree adicional, REPO_ROOT já aponta
    para o working tree do worktree — não para o main. Os comandos git rodam
    com cwd=REPO_ROOT, operando corretamente no contexto local.
    """
    res = run_git(["rev-parse", "--git-dir"], check=False)
    if res.returncode != 0:
        return False
    git_dir = res.stdout.strip().replace("\\", "/")
    # Em worktree adicional o git-dir contém "worktrees" no path
    if "worktrees" in git_dir:
        return True
    # Fallback: compara toplevel atual com o main worktree
    main_path = main_worktree_path()
    if main_path is None:
        return False
    toplevel_res = run_git(["rev-parse", "--show-toplevel"], check=False)
    if toplevel_res.returncode != 0:
        return False
    try:
        return Path(toplevel_res.stdout.strip()).resolve() != main_path.resolve()
    except (OSError, ValueError):
        return False


def main_worktree_path() -> Path | None:
    """Caminho absoluto do working tree principal (primeiro entry de worktree list).

    `git worktree list --porcelain` emite blocos separados por linha em branco.
    O primeiro bloco é sempre o working tree principal:

        worktree /abs/path/to/main
        HEAD <sha>
        branch refs/heads/main

    Retorna None se o comando falhar ou saída for inesperada.
    """
    res = run_git(["worktree", "list", "--porcelain"], check=False)
    if res.returncode != 0:
        return None
    for line in res.stdout.splitlines():
        if line.startswith("worktree "):
            path_str = line[len("worktree "):].strip()
            return Path(path_str)
    return None


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
        # Padrão: "key:" seguido de espaço opcional e qualquer valor (incluindo vazio).
        # Exemplo: "claimed_at:" (sem valor) e "claimed_at: 2026-..." devem ser substituídos.
        pattern = rf"^{re.escape(key)}:[ \t]*.*$"
        replacement = f"{key}: {value}"
        new_fm, count = re.subn(pattern, replacement, fm_text, count=1, flags=re.MULTILINE)
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

    in_wt = is_in_worktree()
    info(f"[slot] claiming {slot_id} (branch: {branch}, worktree: {in_wt})")

    if in_wt:
        # Worktree não-principal: NÃO fazer checkout main (git proíbe ter o mesmo
        # branch em dois worktrees simultâneos). O worktree já foi criado pelo
        # orchestrator a partir de um ponto válido de main — criar a branch feat/*
        # diretamente a partir do HEAD atual.
        #
        # Decisão documentada: não atualizamos main no worktree antes de criar a
        # branch. É responsabilidade do orchestrator criar o worktree com um HEAD
        # atualizado (ex: `git worktree add ... origin/main` ou equivalente).
        # Se for necessário fetch parcial de refs, isso deve ser feito antes do
        # dispatch do agente — não aqui.
        run_git(["switch", "-c", branch])
    else:
        # Working tree principal: comportamento original — garante que partimos
        # de um main atualizado.
        run_git(["fetch", "origin", "main"], check=False)
        run_git(["checkout", "main"])
        run_git(["pull", "--ff-only", "origin", "main"], check=False)
        run_git(["checkout", "-b", branch])

    # Frontmatter + STATUS.md (idêntico em ambos os casos)
    # agent_id: usa ELEMENTO_AGENT_ID se setado; caso contrário preserva o valor
    # existente no frontmatter (evita sobrescrever 'backend-engineer' com 'claude-code').
    _fm_match = _FRONTMATTER_RE.match(path.read_text(encoding="utf-8"))
    if not _fm_match:
        die("No frontmatter")
    fm_current = _parse_yaml_subset(_fm_match.group(1))
    agent_id_value = os.environ.get("ELEMENTO_AGENT_ID") or fm_current.get("agent_id") or "backend-engineer"
    update_frontmatter_fields(path, {
        "status": "in-progress",
        "agent_id": agent_id_value,
        "claimed_at": now_iso(),
    })
    sync_status_md()

    # Commit chore — usa run_git_commit para lidar com hook pnpm em worktrees
    run_git(["add", str(path.relative_to(REPO_ROOT)), str(STATUS_FILE.relative_to(REPO_ROOT))])
    # Slot ID em lowercase para passar subject-case do commitlint (§7.5 do PROTOCOL.md)
    run_git_commit(f"chore(tasks): {slot_id.lower()} in-progress")

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


def _find_all_slot_branches(slot_id: str, remote: str = "origin") -> list[tuple[str, str]]:
    """Como _find_slot_branch_tip, mas retorna TODAS as branches que matcham.

    Resolve o bug onde múltiplas branches existem para o mesmo slot
    (ex: feat/f1-s06 e feat/f1-s06-crud-cities) e o pick aleatório
    do `_find_slot_branch_tip` pega a abandonada.

    Retorna lista de (short_name, tip_sha). Dedup por sha.
    """
    needle = f"feat/{slot_id.lower()}"
    seen_shas: set[str] = set()
    out: list[tuple[str, str]] = []
    for ref_kind in ("refs/heads", f"refs/remotes/{remote}"):
        res = run_git(["for-each-ref", "--format=%(refname:short) %(objectname)", ref_kind], check=False)
        if res.returncode != 0:
            continue
        for line in res.stdout.splitlines():
            name, _, sha = line.partition(" ")
            sha = sha.strip()
            if not sha or sha in seen_shas:
                continue
            short = name[len(f"{remote}/"):] if name.startswith(f"{remote}/") else name
            if short.lower().startswith(needle):
                seen_shas.add(sha)
                out.append((short, sha))
    return out


# Commits considerados "não-implementação" (ruído de tooling).
# Match no prefixo de tipo do conventional commit antes do escopo.
_CHORE_TYPES = ("chore", "docs", "ci", "build", "style")


def _count_substantive_commits(tip: str, base: str = "origin/main") -> int:
    """Conta commits em `tip` que NÃO estão em `base` e cujo type não é chore/docs/ci.

    Resolve o bug F1-S06: uma branch abandonada que só tem `chore(tasks): claim`
    não deve ser considerada "implementada" mesmo se mergeada por acidente.
    """
    res = run_git(["log", "--format=%s", f"{base}..{tip}"], check=False)
    if res.returncode != 0:
        return 0
    count = 0
    for subject in res.stdout.splitlines():
        # Conventional commit: "<type>(<scope>): <subject>" ou "<type>: <subject>"
        m = re.match(r"^([a-z]+)(?:\([^)]+\))?:", subject)
        if m and m.group(1) in _CHORE_TYPES:
            continue
        count += 1
    return count


def _find_pr_for_slot(slot_id: str) -> dict | None:
    """Procura PR mergeado que referência o slot ID via gh CLI.

    Layer 2 de defesa: detecta squash-merges (que invalidam a heurística
    de --is-ancestor) e enriquece o frontmatter com pr_url + mergedAt.

    Retorna dict com keys: number, url, mergedAt, mergeCommit. None se não
    encontrar PR mergeado, gh ausente, ou erro de rede.
    """
    gh = _gh_path()
    if not gh:
        return None
    # Busca em title + body. `gh pr list --search` aceita sintaxe GitHub.
    try:
        res = subprocess.run(
            [gh, "pr", "list",
             "--state", "merged",
             "--search", slot_id,
             "--limit", "20",
             "--json", "number,title,body,url,mergedAt,mergeCommit"],
            cwd=REPO_ROOT,
            check=False,
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=15,
        )
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return None
    if res.returncode != 0 or not res.stdout.strip():
        return None
    try:
        items = json.loads(res.stdout)
    except json.JSONDecodeError:
        return None
    # Match estrito: o slot_id precisa aparecer no TÍTULO do PR como token
    # delimitado. Body é descartado — PRs comumente mencionam outros slots
    # como dependência, follow-up ou "out of scope", e isso causaria falso
    # positivo (ex: PR #22 que entrega F1-S20 menciona F1-S21 no body).
    token_re = re.compile(rf"(?<![A-Za-z0-9-]){re.escape(slot_id)}(?![A-Za-z0-9-])", re.IGNORECASE)
    # Filtra PRs cujo conventional type é chore/docs/ci/build/style — eles
    # mencionam slot IDs (bookkeeping, sync, hotfix de tooling) mas NÃO
    # entregam a feature. Mesma regra de _count_substantive_commits.
    chore_title_re = re.compile(rf"^({'|'.join(_CHORE_TYPES)})(?:\([^)]+\))?:", re.IGNORECASE)
    candidates = []
    for pr in items:
        title = pr.get("title", "") or ""
        if chore_title_re.match(title):
            continue
        if token_re.search(title):
            candidates.append(pr)
    if not candidates:
        return None
    # Mais recente primeiro (mergedAt desc); pega o primeiro.
    candidates.sort(key=lambda p: p.get("mergedAt") or "", reverse=True)
    return candidates[0]


def _gh_path() -> str | None:
    """Localiza o binário do gh CLI (PATH ou Program Files no Windows)."""
    from shutil import which
    found = which("gh")
    if found:
        return found
    if os.name == "nt":
        candidate = Path(os.environ.get("ProgramFiles", r"C:\Program Files")) / "GitHub CLI" / "gh.exe"
        if candidate.exists():
            return str(candidate)
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
        # Slot ID em lowercase para passar subject-case do commitlint (§7.5 do PROTOCOL.md)
        # run_git_commit augmenta PATH para hooks pnpm em worktrees
        run_git_commit(f"chore(tasks): {slot_id.lower()} review")
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
            # Remove inline comments (# ...) para não passar para o shell
            # Exemplo: "pnpm test # motivo" → "pnpm test"
            if " #" in line:
                line = line[: line.index(" #")].rstrip()
            if not line:
                continue
            commands.append(line)

    if not commands:
        die(f"'## Validação' block has no shell commands in {path.name}")

    # Em worktrees adicionais, node_modules/ não existe — rodar os comandos de
    # validação a partir do working tree principal onde node_modules/ está presente.
    validate_cwd = REPO_ROOT
    if is_in_worktree():
        main = main_worktree_path()
        if main is not None:
            validate_cwd = main
            info(f"[validate] worktree detectado — usando cwd do main: {main}")

    results = []
    for cmd in commands:
        info(f"[validate] $ {cmd}")
        # Shell=True para suportar pipes e &&. POSIX/Windows-compatible.
        proc = subprocess.run(
            cmd, cwd=validate_cwd, shell=True, capture_output=True, text=True, encoding="utf-8",
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
    """Detecta slots realmente entregues e marca como done.

    Defesa em 2 camadas (vs. heurística antiga que dava falsos positivos/negativos):

      Layer 2 — PR mergeado via gh CLI:
        Procura PR mergeado que referência o slot ID no título/body.
        Cobre squash-merges (que quebram --is-ancestor).
        Enriquece o frontmatter com pr_url + completed_at = mergedAt.

      Layer 1 — branch git com commits substantivos:
        Se Layer 2 falhar (gh ausente, sem PR, etc.), tenta detectar via
        branches locais/remotos. Mas EXIGE:
          (a) tip ancestor de origin/main (--is-ancestor)
          (b) >=1 commit não-chore/docs/ci entre base e tip
        Resolve o bug F1-S06: branches só com commit `chore(tasks): claim`
        não são consideradas implementação.

    Caso nenhuma camada confirme → não toca no slot.
    """
    base = f"{args.remote}/main"
    run_git(["fetch", args.remote, "main"], check=False)

    slots = all_slots()
    plan: list[tuple[str, str, dict]] = []  # (slot_id, reason, updates)

    for s in slots:
        if s.status == "done":
            continue

        # ── Layer 2: gh PR detection ─────────────────────────────────────────
        pr = _find_pr_for_slot(s.id)
        if pr is not None:
            updates: dict[str, str] = {"status": "done"}
            text = (find_slot_file(s.id)).read_text(encoding="utf-8")
            if not re.search(r"^completed_at:\s+\d{4}-", text, re.MULTILINE):
                updates["completed_at"] = pr.get("mergedAt") or now_iso()
            # pr_url só se ainda não preenchido (preserva edição manual)
            if not re.search(r"^pr_url:\s+https?://", text, re.MULTILINE):
                updates["pr_url"] = pr.get("url", "")
            plan.append((s.id, f"{s.status} → done  (PR #{pr.get('number')})", updates))
            continue

        # ── Layer 1: git branch + commits substantivos ───────────────────────
        branches = _find_all_slot_branches(s.id, args.remote)
        merged_branch: tuple[str, str] | None = None
        for short, tip in branches:
            is_ancestor = run_git(
                ["merge-base", "--is-ancestor", tip, base],
                check=False, capture=False,
            ).returncode == 0
            if not is_ancestor:
                continue
            if _count_substantive_commits(tip, base) == 0:
                continue
            merged_branch = (short, tip)
            break

        if merged_branch is not None:
            updates = {"status": "done"}
            text = (find_slot_file(s.id)).read_text(encoding="utf-8")
            if not re.search(r"^completed_at:\s+\d{4}-", text, re.MULTILINE):
                updates["completed_at"] = now_iso()
            short, _tip = merged_branch
            plan.append((s.id, f"{s.status} → done  (branch {short})", updates))

    if not plan:
        info("[reconcile] nada a mudar")
        return 0

    for slot_id, reason, _ in plan:
        print(f"  {slot_id}  {reason}")

    if not args.write:
        info("[reconcile] (dry-run; passe --write para aplicar)")
        return 0

    for slot_id, _, updates in plan:
        path = find_slot_file(slot_id)
        slot = parse_slot(path)
        if slot.status == "done":
            continue
        update_frontmatter_fields(path, updates)

    sync_status_md()
    info(f"[reconcile] {len(plan)} slot(s) marcados done + STATUS.md atualizado")
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
# Subcommand: brief — Briefing self-contained para o agente especialista.
# Reduz overhead inicial: 1 call em vez de 6-10 (frontmatter, escopo, deps,
# arquivos vizinhos, migration counter, source_docs, sections...).
# -----------------------------------------------------------------------------

_SPECIALIST_PATTERNS: list[tuple[str, str]] = [
    (r"^apps/api/src/db/", "db-schema-engineer"),
    (r"^apps/api/", "backend-engineer"),
    (r"^packages/shared-", "backend-engineer"),
    (r"^apps/web/", "frontend-engineer"),
    (r"^apps/langgraph-service/", "python-engineer"),
]


def _infer_specialist(files_paths: list[str], phase: str) -> str:
    if not files_paths:
        # Heurística por phase
        return "python-engineer" if phase.startswith("F3") else "backend-engineer"
    score: Counter[str] = Counter()
    for fp in files_paths:
        for pat, name in _SPECIALIST_PATTERNS:
            if re.match(pat, fp):
                score[name] += 1
                break
    if not score:
        return "backend-engineer"
    return score.most_common(1)[0][0]


def _extract_files_allowed(body_text: str) -> list[str]:
    """Extrai paths de uma seção 'files_allowed' do corpo do slot.

    Suporta:
      ## files_allowed   (markdown heading)
      **files_allowed:**
      ### Files allowed
      ## Arquivos permitidos
    """
    headings = [
        r"##\s+files[_ ]allowed",
        r"##\s+arquivos\s+permitidos",
        r"###\s+files[_ ]allowed",
        r"\*\*files[_ ]allowed\*\*\s*:?",
    ]
    block = None
    for h in headings:
        m = re.search(rf"^{h}\s*\n(.*?)(?=^##|\Z)", body_text, re.MULTILINE | re.DOTALL | re.IGNORECASE)
        if m:
            block = m.group(1)
            break
    if not block:
        return []
    paths: list[str] = []
    for line in block.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        # bullets: "- foo" / "* foo" / "+ foo"
        m = re.match(r"^[-*+]\s+`?([^`\s]+)`?", line)
        if m:
            p = m.group(1).strip()
            if p:
                paths.append(p)
            continue
        # backticks inline em linha de prosa
        for inner in re.findall(r"`([^`]+)`", line):
            if "/" in inner or inner.endswith(".ts") or inner.endswith(".py"):
                paths.append(inner.strip())
    return paths


def _migration_next_number() -> int:
    mig_dir = REPO_ROOT / "apps" / "api" / "src" / "db" / "migrations"
    if not mig_dir.is_dir():
        return 0
    last = -1
    for p in mig_dir.glob("[0-9][0-9][0-9][0-9]_*.sql"):
        try:
            n = int(p.name[:4])
            if n > last:
                last = n
        except ValueError:
            continue
    return last + 1


def _existing_files_in_globs(globs: list[str], limit: int = 40) -> list[str]:
    """Lista arquivos existentes que casam com os globs de files_allowed."""
    out: list[str] = []
    for g in globs:
        # Remove trailing /** ou /* para listar parent
        base = g.rstrip("*").rstrip("/")
        path = REPO_ROOT / base
        if path.is_file():
            out.append(g)
        elif path.is_dir():
            # Lista até `limit` arquivos do dir
            for p in sorted(path.rglob("*")):
                if p.is_file() and not p.suffix in (".lock", ""):
                    rel = p.relative_to(REPO_ROOT).as_posix()
                    out.append(rel)
                    if len(out) >= limit:
                        return out
    return out[:limit]


def cmd_brief(args: argparse.Namespace) -> int:
    slot_id = args.slot_id
    path = find_slot_file(slot_id)
    slot = parse_slot(path)
    text = path.read_text(encoding="utf-8")

    body = re.sub(_FRONTMATTER_RE, "", text, count=1)
    fm_match = _FRONTMATTER_RE.match(text)
    raw_fm = fm_match.group(1) if fm_match else ""

    # Source docs (parseia bloco source_docs:)
    source_docs: list[str] = []
    sd_match = re.search(r"^source_docs:\s*\n((?:\s+-\s+\S.*\n?)+)", raw_fm, re.MULTILINE)
    if sd_match:
        for line in sd_match.group(1).splitlines():
            m = re.match(r"\s+-\s+(\S+)", line)
            if m:
                source_docs.append(m.group(1))

    files_allowed = _extract_files_allowed(body)
    specialist = _infer_specialist(files_allowed, slot.phase)
    existing = _existing_files_in_globs(files_allowed) if files_allowed else []

    # Deps satisfeitos?
    by_id = {s.id: s for s in all_slots()}
    deps_status: list[dict] = []
    for d in slot.depends_on:
        st = by_id.get(d)
        deps_status.append({"id": d, "status": st.status if st else "unknown"})

    # Sections-chave do body (Objetivo, Escopo, DoD, Validação)
    sections: dict[str, str] = {}
    for h in ["Objetivo", "Escopo", "Definition of Done", "DoD", "Validação", "Resumo"]:
        s = _extract_section(text, h)
        if s:
            sections[h] = s

    # Pre-flight summary
    dirty = working_tree_dirty()
    branch = current_branch()

    out = {
        "slot": slot.to_dict(),
        "specialist": specialist,
        "files_allowed": files_allowed,
        "existing_files": existing,
        "source_docs": source_docs,
        "depends_on": deps_status,
        "deps_satisfied": all(d["status"] == "done" for d in deps_status),
        "preflight": {"branch": branch, "dirty": dirty},
        "next_migration_number": _migration_next_number(),
        "sections": sections,
    }

    if args.json:
        print(json.dumps(out, indent=2, ensure_ascii=False))
    else:
        print(f"# Briefing: {slot.id} — {slot.title}")
        print(f"phase={slot.phase}  priority={slot.priority}  status={slot.status}")
        print(f"specialist (sugerido): {specialist}")
        print()
        print(f"Pre-flight: branch={branch}  dirty={dirty}")
        print(f"Deps satisfeitos: {out['deps_satisfied']} — {deps_status}")
        print(f"Próxima migration: {out['next_migration_number']:04d}")
        print()
        print("Source docs:")
        for d in source_docs:
            print(f"  {d}")
        print()
        if files_allowed:
            print("files_allowed:")
            for f in files_allowed:
                print(f"  {f}")
        else:
            print("files_allowed: (não declarado — buscar no corpo do slot)")
        if existing:
            print()
            print(f"Existing files ({len(existing)}):")
            for f in existing[:20]:
                print(f"  {f}")
        print()
        for k, v in sections.items():
            print(f"## {k}")
            print(v[:600])
            print()
    return 0


# -----------------------------------------------------------------------------
# Subcommand: plan-batch — recomenda batch paralelo respeitando colisões.
# -----------------------------------------------------------------------------

_PRIORITY_ORDER = {"critical": 0, "high": 1, "medium": 2, "low": 3}


def _files_overlap(a: list[str], b: list[str]) -> bool:
    """True se quaisquer dois globs/paths se sobrepõem ao nível de pasta."""
    def norm(g: str) -> str:
        # Compara só o prefixo até o primeiro '*' ou fim
        return g.split("*")[0].rstrip("/")
    pa = [norm(x) for x in a]
    pb = [norm(x) for x in b]
    for x in pa:
        for y in pb:
            if x.startswith(y) or y.startswith(x):
                # path identico OU um é prefixo do outro
                return True
    return False


def cmd_plan_batch(args: argparse.Namespace) -> int:
    by_id = {s.id: s for s in all_slots()}
    available: list[Slot] = []
    for s in all_slots():
        if s.status != "available":
            continue
        if all(by_id.get(dep) and by_id[dep].status == "done" for dep in s.depends_on):
            available.append(s)

    available.sort(key=lambda s: (_PRIORITY_ORDER.get(s.priority, 9), s.id))

    # Resolve files_allowed por slot (para detectar colisão)
    enriched: list[dict] = []
    for s in available:
        text = s.path.read_text(encoding="utf-8")
        body = re.sub(_FRONTMATTER_RE, "", text, count=1)
        fa = _extract_files_allowed(body)
        enriched.append({
            "slot": s,
            "files_allowed": fa,
            "specialist": _infer_specialist(fa, s.phase),
        })

    batch: list[dict] = []
    deferred: list[dict] = []
    max_n = args.max
    for entry in enriched:
        if len(batch) >= max_n:
            deferred.append({"slot_id": entry["slot"].id, "reason": f"max-batch={max_n}"})
            continue
        collides_with = None
        for in_batch in batch:
            if _files_overlap(entry["files_allowed"] or [entry["slot"].id], in_batch["files_allowed"] or [in_batch["slot"].id]):
                collides_with = in_batch["slot"].id
                break
        if collides_with:
            deferred.append({"slot_id": entry["slot"].id, "reason": f"files_overlap with {collides_with}"})
            continue
        batch.append(entry)

    next_mig = _migration_next_number()
    out = {
        "batch": [
            {
                "slot_id": e["slot"].id,
                "title": e["slot"].title,
                "priority": e["slot"].priority,
                "specialist": e["specialist"],
                "files_allowed": e["files_allowed"],
                "isolation": "worktree",
            }
            for e in batch
        ],
        "deferred": deferred,
        "next_migration_number": next_mig,
        "note": (
            "Disparar com isolation='worktree' obrigatório. "
            f"Próxima migration disponível: {next_mig:04d}."
        ),
    }

    if args.json:
        print(json.dumps(out, indent=2, ensure_ascii=False))
    else:
        print(f"## Batch recomendado ({len(batch)} slot(s) em paralelo)")
        for b in out["batch"]:
            print(f"  - {b['slot_id']} [{b['priority']}] → {b['specialist']}  (worktree isolada)")
        if deferred:
            print()
            print("## Adiados (próximo ciclo)")
            for d in deferred:
                print(f"  - {d['slot_id']}: {d['reason']}")
        print()
        print(out["note"])
    return 0


# -----------------------------------------------------------------------------
# Subcommand: auto-review — pré-flight de security review.
# Roda greps determinísticos contra o diff. Saída JSON consumida pelo agente
# security-reviewer, que só precisa confirmar/expandir achados ambíguos.
# -----------------------------------------------------------------------------

# (pattern, label, severity, glob_filter)
_REVIEW_CHECKS: list[tuple[str, str, str, str]] = [
    (r"\bas\s+any\b", "ts:as-any", "high", "*.ts"),
    (r":\s*any\b", "ts:annotation-any", "medium", "*.ts"),
    (r"//\s*@ts-ignore", "ts:ts-ignore", "medium", "*.ts"),
    (r"--no-verify", "git:no-verify", "high", "*"),
    (r"console\.(log|warn|error)\s*\(", "log:console", "low", "*.ts"),
    (r"process\.env\[", "env:direct-access", "low", "*.ts"),
    (r"#[0-9a-fA-F]{6}\b", "design:hex-color", "medium", "*.tsx"),
    (r"#[0-9a-fA-F]{6}\b", "design:hex-color", "medium", "*.css"),
    (r"localStorage\.(setItem|getItem).*['\"](token|access|refresh|jwt)", "lgpd:token-storage", "high", "*.ts"),
    (r"document\.cookie\s*=", "lgpd:cookie-write-client", "medium", "*.ts"),
    (r"==\s*tokenPayload|tokenPayload\s*==", "auth:non-timing-safe-compare", "high", "*.ts"),
    (r"crypto\.timingSafeEqual", "auth:timing-safe-ok", "info", "*.ts"),
]


def _git_diff_files(against: str) -> list[str]:
    res = run_git(["diff", "--name-only", f"{against}..HEAD"], check=False)
    if res.returncode != 0:
        return []
    files = [f for f in res.stdout.splitlines() if f.strip()]
    return files


def _git_show_lines(file_path: str, against: str) -> str:
    """Retorna apenas as linhas adicionadas (sem '+' prefix)."""
    res = run_git(["diff", "--unified=0", f"{against}..HEAD", "--", file_path], check=False)
    if res.returncode != 0:
        return ""
    out: list[str] = []
    for line in res.stdout.splitlines():
        if line.startswith("+++") or line.startswith("---"):
            continue
        if line.startswith("+"):
            out.append(line[1:])
    return "\n".join(out)


def cmd_auto_review(args: argparse.Namespace) -> int:
    slot_id = args.slot_id
    path = find_slot_file(slot_id)
    slot = parse_slot(path)
    against = args.against or "origin/main"

    files = _git_diff_files(against)
    files = [f for f in files if not f.endswith(".md") or "tasks/" in f]

    findings: list[dict] = []
    for f in files:
        # filtro de glob (suffix)
        diff_text = _git_show_lines(f, against)
        if not diff_text:
            continue
        for pat, label, severity, glob in _REVIEW_CHECKS:
            if glob != "*" and not f.endswith(glob.lstrip("*")):
                continue
            for ln_no, ln in enumerate(diff_text.splitlines(), 1):
                if re.search(pat, ln):
                    findings.append({
                        "file": f,
                        "line": ln_no,
                        "check": label,
                        "severity": severity,
                        "snippet": ln.strip()[:160],
                    })

    # Migration numbering collision check
    mig_files = [f for f in files if "/migrations/" in f and f.endswith(".sql")]
    if mig_files:
        mig_numbers = []
        for f in mig_files:
            m = re.search(r"/(\d{4})_", f)
            if m:
                mig_numbers.append((int(m.group(1)), f))
        if mig_numbers:
            existing = []
            for p in (REPO_ROOT / "apps" / "api" / "src" / "db" / "migrations").glob("[0-9][0-9][0-9][0-9]_*.sql"):
                try:
                    existing.append((int(p.name[:4]), p.name))
                except ValueError:
                    continue
            for n, f in mig_numbers:
                dups = [name for x, name in existing if x == n and name != Path(f).name]
                if dups:
                    findings.append({
                        "file": f,
                        "check": "db:migration-number-collision",
                        "severity": "high",
                        "snippet": f"conflicts with {dups}",
                    })

    # Bloqueio rápido: count of high
    high_count = sum(1 for x in findings if x["severity"] == "high")
    out = {
        "slot_id": slot_id,
        "diff_against": against,
        "files_changed": len(files),
        "findings": findings,
        "high_count": high_count,
        "summary_by_severity": dict(Counter(x["severity"] for x in findings)),
    }

    if args.json:
        print(json.dumps(out, indent=2, ensure_ascii=False))
    else:
        print(f"## Auto-review: {slot_id} (vs {against})")
        print(f"Files changed: {len(files)}  |  Findings: {len(findings)}  |  High: {high_count}")
        if not findings:
            print("(nenhum achado automático — passar ao security-reviewer humano)")
        else:
            by_sev: dict[str, list[dict]] = {}
            for x in findings:
                by_sev.setdefault(x["severity"], []).append(x)
            for sev in ("high", "medium", "low", "info"):
                if sev not in by_sev:
                    continue
                print(f"\n[{sev.upper()}]")
                for x in by_sev[sev]:
                    print(f"  {x['file']}:{x.get('line','?')}  [{x['check']}]  {x['snippet']}")
    return 0 if high_count == 0 else 2


# -----------------------------------------------------------------------------
# Subcommand: worktree-clean — remove worktrees stale (Windows long-path safe).
# -----------------------------------------------------------------------------

def cmd_worktree_clean(args: argparse.Namespace) -> int:
    r"""Limpa worktrees em .claude/worktrees/agent-*.

    No Windows, node_modules profundos batem em MAX_PATH; usamos prefixo \\?\.
    """
    base = REPO_ROOT / ".claude" / "worktrees"
    if not base.is_dir():
        info("[worktree-clean] no worktrees dir — nothing to do")
        return 0

    res = run_git(["worktree", "list"], check=False)
    targets: list[Path] = []
    for line in res.stdout.splitlines():
        parts = line.split()
        if not parts:
            continue
        p = parts[0]
        path = Path(p)
        try:
            rel = path.relative_to(REPO_ROOT)
        except ValueError:
            continue
        if "worktrees" in rel.parts and "agent-" in path.name:
            targets.append(path)

    # Unlock e remoção via git
    for p in targets:
        run_git(["worktree", "unlock", str(p)], check=False)
        run_git(["worktree", "remove", "--force", str(p)], check=False)

    # Limpeza física residual (long-path safe via Windows API)
    leftover = [p for p in base.iterdir() if p.is_dir() and p.name.startswith("agent-")]
    if leftover and sys.platform == "win32":
        import ctypes  # local import
        kernel32 = ctypes.windll.kernel32
        for d in leftover:
            try:
                subprocess.run(
                    ["cmd", "/c", "rmdir", "/S", "/Q", f"\\\\?\\{d}"],
                    check=False, capture_output=True,
                )
            except Exception:  # noqa: BLE001
                pass
    elif leftover:
        for d in leftover:
            try:
                subprocess.run(["rm", "-rf", str(d)], check=False)
            except Exception:  # noqa: BLE001
                pass

    run_git(["worktree", "prune"], check=False)

    remaining = [p for p in base.iterdir() if p.is_dir() and p.name.startswith("agent-")] if base.is_dir() else []
    info(f"[worktree-clean] git worktrees removed: {len(targets)}  filesystem leftover: {len(remaining)}")
    return 0 if not remaining else 1


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

    s = sub.add_parser("brief", help="Briefing self-contained do slot (substitui 6-10 reads)")
    s.add_argument("slot_id")
    s.add_argument("--json", action="store_true")
    s.set_defaults(func=cmd_brief)

    s = sub.add_parser("plan-batch", help="Recomenda batch paralelo respeitando colisões")
    s.add_argument("--max", type=int, default=3, help="Máximo de slots em paralelo (default 3)")
    s.add_argument("--json", action="store_true")
    s.set_defaults(func=cmd_plan_batch)

    s = sub.add_parser("auto-review", help="Pré-relatório de segurança via grep determinístico")
    s.add_argument("slot_id")
    s.add_argument("--against", default="origin/main", help="Ref para diff (default origin/main)")
    s.add_argument("--json", action="store_true")
    s.set_defaults(func=cmd_auto_review)

    s = sub.add_parser("worktree-clean", help="Remove worktrees stale (Windows long-path safe)")
    s.set_defaults(func=cmd_worktree_clean)

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
