#!/usr/bin/env python3
"""guard.py — PreToolUse hook for autonomous bypass mode.

Reads the JSON hook payload from stdin (Claude Code PreToolUse format) and
blocks dangerous Bash/PowerShell commands. Allows everything else through.

Block ladder:
  - Git destructive: force push, reset --hard main, filter-branch, gc --prune,
    update-ref -d, --no-verify (regra do projeto).
  - Filesystem destructive: rm -rf /, ~, $HOME, ..
  - Permissions: chmod -R 777, chown -R
  - Global installs: npm install -g, npm i -g
  - Remote exec: curl|sh, wget|sh, iex(iwr)
  - GitHub destructive: gh repo delete, gh release delete, gh api DELETE,
    gh secret delete/set
  - Sensitive paths: ~/.ssh, ~/.aws, ~/.gnupg, ~/.claude (settings globais)
  - Direct .env edits in production
  - System: shutdown, reboot, kill -9 1

Exit codes:
  0  → allow (no message)
  2  → block (stderr shows reason — Claude Code surfaces to user/agent)

Test:
  echo '{"tool_name":"Bash","tool_input":{"command":"git push --force"}}' | python scripts/guard.py
  echo $?   # 2
"""
from __future__ import annotations

import json
import re
import sys

DANGEROUS_PATTERNS: list[tuple[str, str]] = [
    # ---- Git destructive ---------------------------------------------------
    (r"git\s+push\s+(?:[^&|;]*\s)?(?:--force\b|--force-with-lease\b|-f\b)",
     "force push proibido em bypass mode"),
    (r"git\s+reset\s+(?:[^&|;]*\s)?--hard\s+(?:[^&|;]*\b(main|origin/main)\b|HEAD~)",
     "reset --hard em main/HEAD~ proibido"),
    (r"git\s+update-ref\s+-d",
     "update-ref -d proibido (destrói ref)"),
    (r"git\s+filter-branch",
     "filter-branch proibido (reescreve história)"),
    (r"git\s+gc\s+--prune",
     "gc --prune proibido (perde reflogs)"),
    (r"git\s+reflog\s+expire",
     "reflog expire proibido"),
    (r"git\s+branch\s+-D\s+(main|origin/main)",
     "deletar main proibido"),
    (r"--no-verify\b",
     "--no-verify proibido (regra do projeto — sempre conserte o hook)"),
    # ---- Filesystem destructive --------------------------------------------
    (r"\brm\s+-r[f]?\s+/\s*$",
     "rm -rf / proibido"),
    (r"\brm\s+-r[f]?\s+~(\s|/|$)",
     "rm -rf ~ proibido"),
    (r"\brm\s+-r[f]?\s+\$HOME",
     "rm -rf $HOME proibido"),
    (r"\brm\s+-r[f]?\s+\.\.\s*$",
     "rm -rf .. proibido (sai do projeto)"),
    (r"\brm\s+-r[f]?\s+\$\{HOME\}",
     "rm -rf ${HOME} proibido"),
    (r"Remove-Item\s+(?:[^&|;]*\s)?(-Recurse|-r)\s+(?:[^&|;]*\s)?\$HOME",
     "Remove-Item -Recurse $HOME proibido"),
    # ---- Permissions destructive -------------------------------------------
    (r"\bchmod\s+-R\s+777",
     "chmod -R 777 proibido"),
    (r"\bchown\s+-R",
     "chown -R proibido"),
    # ---- Global installs ---------------------------------------------------
    (r"\bnpm\s+install\s+(?:[^&|;]*\s)?-g\b",
     "npm install -g proibido (use --filter no monorepo)"),
    (r"\bnpm\s+i\s+(?:[^&|;]*\s)?-g\b",
     "npm i -g proibido"),
    (r"\bpip\s+install\s+(?:[^&|;]*\s)?(?:--user|--global)\b",
     "pip install --user/--global proibido (use uv venv)"),
    # ---- Remote exec -------------------------------------------------------
    (r"\bcurl\s+[^|;&]*\|\s*(sh|bash|zsh|sudo)\b",
     "curl|sh proibido"),
    (r"\bwget\s+[^|;&]*\|\s*(sh|bash|zsh|sudo)\b",
     "wget|sh proibido"),
    (r"Invoke-Expression\s*\(?\s*\(?\s*Invoke-WebRequest",
     "iex(iwr) proibido"),
    (r"iex\s*\(\s*iwr",
     "iex(iwr) abreviado proibido"),
    # ---- GitHub destructive ------------------------------------------------
    (r"\bgh\s+repo\s+delete\b",
     "gh repo delete proibido"),
    (r"\bgh\s+release\s+delete\b",
     "gh release delete proibido"),
    (r"\bgh\s+api\s+[^&|;]*-X\s+DELETE\b",
     "gh api DELETE proibido"),
    (r"\bgh\s+secret\s+(delete|set)\b",
     "gh secret set/delete proibido (segredos do repo)"),
    (r"\bgh\s+auth\s+logout\b",
     "gh auth logout proibido"),
    # ---- Sensitive paths ---------------------------------------------------
    (r"[~$]HOME[/\\]?\.(ssh|aws|gnupg|config[/\\]gh)",
     "modificação em ~/.ssh / ~/.aws / ~/.gnupg / ~/.config/gh proibida"),
    (r"\.ssh[/\\](id_|authorized_keys|known_hosts)",
     "manipular arquivos de SSH proibido"),
    (r"~[/\\]\.claude[/\\](?!projects)",
     "modificação em ~/.claude (settings globais) proibida"),
    # ---- .env files (produção) --------------------------------------------
    (r">\s*\.env(\.production|\.local)?\s*$",
     "edição direta de .env via redirect proibida"),
    (r"\bSet-Content\s+(?:[^&|;]*\s)?[\"']?\.env",
     "Set-Content em .env proibido"),
    # ---- System ------------------------------------------------------------
    (r"\bshutdown\b",
     "shutdown proibido"),
    (r"\breboot\b",
     "reboot proibido"),
    (r"\bkill\s+-9\s+1\b",
     "kill -9 1 (PID 1) proibido"),
    (r"\bStop-Computer\b",
     "Stop-Computer proibido"),
    (r"\bRestart-Computer\b",
     "Restart-Computer proibido"),
]


def main() -> int:
    raw = sys.stdin.read()
    if not raw.strip():
        return 0

    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        # Falha de parse não deve quebrar o sistema. Permite e segue.
        return 0

    tool = payload.get("tool_name", "")
    if tool not in ("Bash", "PowerShell"):
        return 0

    tool_input = payload.get("tool_input") or {}
    cmd = tool_input.get("command", "") or ""
    if not cmd:
        return 0

    for pattern, reason in DANGEROUS_PATTERNS:
        if re.search(pattern, cmd, re.IGNORECASE | re.DOTALL):
            print(
                f"[guard.py] BLOCKED: {reason}\n"
                f"  command: {cmd[:240]}",
                file=sys.stderr,
            )
            return 2

    return 0


if __name__ == "__main__":
    sys.exit(main())
