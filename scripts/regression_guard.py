#!/usr/bin/env python3
"""regression_guard.py — Anti-regression guard.

Lists historical `fix:` commits and the files each one touched, so agents can
check, before editing, whether a file had a fix that must not be reverted.

Usage:
  python scripts/regression_guard.py list                         # human-readable list
  python scripts/regression_guard.py list --json                  # machine-readable
  python scripts/regression_guard.py check <file>                 # checks one file
  python scripts/regression_guard.py check <file> --json
  python scripts/regression_guard.py check-diff                   # checks staged+unstaged
  python scripts/regression_guard.py sync-table                   # regenerates table in SKILL.md

Exit codes:
  0 — no risk detected (or report-only)
  1 — argument/IO error
  2 — risk detected (use in pre-commit / CI as gate)
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
SKILL_FILE = REPO_ROOT / ".claude" / "skills" / "regression-guard" / "SKILL.md"

# Conventional commit fix prefixes we consider relevant.
FIX_PREFIXES = re.compile(r"^fix(\([^)]+\))?: ", re.IGNORECASE)

# Files in these globs are noise — ignore them when listing fixes.
IGNORE_PATHS = (
    "pnpm-lock.yaml",
    "package-lock.json",
    "tasks/",          # slot frontmatters/STATUS — not code
    "docs/",           # docs — not runtime
    ".claude/",        # skills/settings — not runtime
)

# How far back to look (number of commits scanned).
DEFAULT_LOOKBACK = 200


def run_git(*args: str) -> str:
    result = subprocess.run(
        ["git", *args],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=False,
        encoding="utf-8",
        errors="replace",
    )
    if result.returncode != 0:
        sys.stderr.write(result.stderr)
        raise SystemExit(1)
    return result.stdout


def is_relevant_path(path: str) -> bool:
    if not path:
        return False
    if path.endswith(".lock") or path.endswith(".lockb"):
        return False
    for ignored in IGNORE_PATHS:
        if path.startswith(ignored):
            return False
    return True


def collect_fixes(lookback: int = DEFAULT_LOOKBACK) -> list[dict]:
    """Returns list of {sha, date, subject, files: [...]}, newest first."""
    log = run_git(
        "log",
        f"-n{lookback}",
        "--pretty=format:%H%x09%ad%x09%s",
        "--date=short",
        "--name-only",
    )

    fixes: list[dict] = []
    blocks = log.split("\n\n")  # commits separated by blank lines
    for block in blocks:
        lines = [ln for ln in block.splitlines() if ln.strip()]
        if not lines:
            continue
        header = lines[0]
        try:
            sha, date, subject = header.split("\t", 2)
        except ValueError:
            continue
        if not FIX_PREFIXES.match(subject):
            continue
        files = [p for p in lines[1:] if is_relevant_path(p)]
        if not files:
            continue
        fixes.append({
            "sha": sha[:7],
            "date": date,
            "subject": subject,
            "files": files,
        })
    return fixes


def cmd_list(args: argparse.Namespace) -> int:
    fixes = collect_fixes(args.lookback)
    if args.json:
        print(json.dumps(fixes, indent=2, ensure_ascii=False))
        return 0
    if not fixes:
        print("[regression-guard] nenhum commit fix: encontrado nos últimos "
              f"{args.lookback} commits")
        return 0
    print(f"[regression-guard] {len(fixes)} commits fix: (lookback={args.lookback})\n")
    for fx in fixes:
        print(f"  {fx['sha']}  {fx['date']}  {fx['subject']}")
        for f in fx["files"]:
            print(f"      {f}")
        print()
    return 0


def find_fixes_touching(target: str, fixes: list[dict]) -> list[dict]:
    target_norm = target.replace("\\", "/")
    matches = []
    for fx in fixes:
        for f in fx["files"]:
            if f == target_norm or target_norm.endswith(f) or f.endswith(target_norm):
                matches.append(fx)
                break
    return matches


def cmd_check(args: argparse.Namespace) -> int:
    fixes = collect_fixes(args.lookback)
    matches = find_fixes_touching(args.file, fixes)
    if args.json:
        print(json.dumps({"file": args.file, "fixes": matches},
                         indent=2, ensure_ascii=False))
        return 2 if matches else 0
    if not matches:
        print(f"[OK] {args.file} — sem fix: histórico")
        return 0
    print(f"[WARN] {args.file} — {len(matches)} fix(es) histórico(s):")
    for fx in matches:
        print(f"  {fx['sha']}  {fx['date']}  {fx['subject']}")
    print("\nLeia cada commit com `git show <sha>` antes de editar.")
    print("Se o refactor reverter parte do fix, CITE o sha no commit message.")
    return 2


def cmd_check_diff(args: argparse.Namespace) -> int:
    diff_files = run_git("diff", "--name-only", "HEAD").splitlines()
    diff_files += run_git("diff", "--name-only", "--cached").splitlines()
    diff_files = sorted({f for f in diff_files if is_relevant_path(f)})
    fixes = collect_fixes(args.lookback)

    risky: list[dict] = []
    for f in diff_files:
        matches = find_fixes_touching(f, fixes)
        if matches:
            risky.append({"file": f, "fixes": matches})

    if args.json:
        print(json.dumps({"diff_files": diff_files, "risky": risky},
                         indent=2, ensure_ascii=False))
        return 2 if risky else 0
    if not risky:
        print(f"[OK] {len(diff_files)} arquivo(s) modificado(s), sem regressão potencial")
        return 0
    print(f"[WARN] {len(risky)} arquivo(s) modificado(s) com fix: histórico:\n")
    for entry in risky:
        print(f"  {entry['file']}")
        for fx in entry["fixes"]:
            print(f"    ← {fx['sha']}  {fx['date']}  {fx['subject']}")
        print()
    return 2


def cmd_sync_table(args: argparse.Namespace) -> int:
    if not SKILL_FILE.exists():
        sys.stderr.write(f"SKILL.md não encontrado em {SKILL_FILE}\n")
        return 1
    fixes = collect_fixes(args.lookback)

    lines = ["| SHA | Data | Subject | Arquivos |", "| --- | ---- | ------- | -------- |"]
    for fx in fixes:
        files_inline = "<br>".join(f"`{f}`" for f in fx["files"][:6])
        if len(fx["files"]) > 6:
            files_inline += f"<br>… (+{len(fx['files']) - 6})"
        subject_escaped = fx["subject"].replace("|", "\\|")
        lines.append(f"| `{fx['sha']}` | {fx['date']} | {subject_escaped} | {files_inline} |")
    table = "\n".join(lines)

    content = SKILL_FILE.read_text(encoding="utf-8")
    marker_start = "<!-- regression-guard:table:start -->"
    marker_end = "<!-- regression-guard:table:end -->"
    block = f"{marker_start}\n{table}\n{marker_end}"

    if marker_start in content and marker_end in content:
        new_content = re.sub(
            rf"{re.escape(marker_start)}.*?{re.escape(marker_end)}",
            block,
            content,
            flags=re.DOTALL,
        )
    else:
        new_content = content.rstrip() + "\n\n## Tabela gerada (sync-table)\n\n" + block + "\n"

    if args.dry_run:
        print(table)
        return 0

    SKILL_FILE.write_text(new_content, encoding="utf-8")
    print(f"[OK] {SKILL_FILE} atualizado com {len(fixes)} fix(es)")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(prog="regression-guard")
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--lookback", type=int, default=DEFAULT_LOOKBACK,
                        help="quantos commits olhar para trás (default 200)")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_list = sub.add_parser("list", parents=[common],
                            help="lista todos os fix: e seus arquivos")
    p_list.add_argument("--json", action="store_true")
    p_list.set_defaults(func=cmd_list)

    p_check = sub.add_parser("check", parents=[common],
                             help="checa um arquivo contra o histórico de fix:")
    p_check.add_argument("file")
    p_check.add_argument("--json", action="store_true")
    p_check.set_defaults(func=cmd_check)

    p_check_diff = sub.add_parser("check-diff", parents=[common],
                                  help="checa todos os arquivos modificados no working tree")
    p_check_diff.add_argument("--json", action="store_true")
    p_check_diff.set_defaults(func=cmd_check_diff)

    p_sync = sub.add_parser("sync-table", parents=[common],
                            help="regenera tabela canônica em SKILL.md")
    p_sync.add_argument("--dry-run", action="store_true")
    p_sync.set_defaults(func=cmd_sync_table)

    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
