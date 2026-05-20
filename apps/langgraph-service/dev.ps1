# =============================================================================
# dev.ps1 — Sobe o LangGraph service para desenvolvimento local (Windows/PowerShell).
#
# Faz, na ordem:
#   1. Resolve a raiz do projeto a partir do path do script (independe do cwd).
#   2. Carrega as env vars do `.env` da raiz no processo (Pydantic Settings lê do
#      env do processo; o langgraph-service não tem `.env` próprio para evitar
#      duplicação de segredos — fonte única é o `.env` do root).
#   3. Verifica que o venv local existe (`apps/langgraph-service/.venv`).
#   4. Checa se a porta 8000 está livre. Se ocupada por um processo Python (ex.:
#      uvicorn de uma sessão anterior que não morreu), informa o PID e instrui
#      como derrubar. Com `-Force`, derruba automaticamente.
#   5. Sobe `uvicorn app.main:app --reload` em foreground.
#
# Uso (do root do repo ou de qualquer pasta):
#   pwsh apps/langgraph-service/dev.ps1
#   pwsh apps/langgraph-service/dev.ps1 -Force      # derruba processo na 8000 se houver
#   pwsh apps/langgraph-service/dev.ps1 -Port 8001  # porta alternativa
#
# Pré-requisitos (uma única vez):
#   cd apps/langgraph-service
#   python -m venv .venv
#   .\.venv\Scripts\python.exe -m pip install -r requirements.lock.txt
# =============================================================================

[CmdletBinding()]
param(
    # Derruba qualquer processo que esteja escutando na porta antes de subir.
    # Usar quando uma sessão anterior do uvicorn ficou pendurada.
    [switch]$Force,

    # Porta alternativa (default 8000 — bate com LANGGRAPH_PORT no .env).
    [int]$Port = 8000,

    # Host de bind. 127.0.0.1 (default) só aceita conexões locais — seguro para dev.
    [string]$BindHost = '127.0.0.1'
)

$ErrorActionPreference = 'Stop'

# ── 1. Resolve paths absolutos a partir do script ──────────────────────────────
$ScriptDir = $PSScriptRoot
$RepoRoot = Resolve-Path (Join-Path $ScriptDir '..\..') | Select-Object -ExpandProperty Path
$EnvFile = Join-Path $RepoRoot '.env'
$VenvPython = Join-Path $ScriptDir '.venv\Scripts\python.exe'

Write-Host "[dev.ps1] repo root: $RepoRoot" -ForegroundColor DarkGray
Write-Host "[dev.ps1] script dir: $ScriptDir" -ForegroundColor DarkGray

# ── 2. Carrega env vars do .env do root ────────────────────────────────────────
if (-not (Test-Path $EnvFile)) {
    Write-Host "[dev.ps1] ERRO: $EnvFile não encontrado." -ForegroundColor Red
    Write-Host "          Crie o .env na raiz copiando de .env.example primeiro." -ForegroundColor Red
    exit 1
}

$loaded = 0
Get-Content $EnvFile | ForEach-Object {
    # Aceita KEY=value e KEY="value" (aspas removidas). Linhas em branco e
    # comentários (# no início) são ignorados pelo regex de validação.
    if ($_ -match '^([A-Z][A-Z0-9_]*)=(.*)$') {
        [Environment]::SetEnvironmentVariable($matches[1], $matches[2].Trim('"'), 'Process')
        $loaded++
    }
}
Write-Host "[dev.ps1] $loaded vars carregadas do .env do root" -ForegroundColor DarkGray

# Sanidade: vars críticas para o Pydantic Settings do serviço (config.py).
$required = @('BACKEND_INTERNAL_URL', 'LANGGRAPH_INTERNAL_TOKEN', 'OPENROUTER_API_KEY')
foreach ($v in $required) {
    $val = [Environment]::GetEnvironmentVariable($v, 'Process')
    if ([string]::IsNullOrWhiteSpace($val)) {
        Write-Host "[dev.ps1] ERRO: variável obrigatória $v não está setada no .env." -ForegroundColor Red
        exit 1
    }
}

# ── 3. Confere venv ────────────────────────────────────────────────────────────
if (-not (Test-Path $VenvPython)) {
    Write-Host "[dev.ps1] ERRO: venv não encontrado em $VenvPython" -ForegroundColor Red
    Write-Host "          Crie com: python -m venv .venv ; .\.venv\Scripts\python.exe -m pip install -r requirements.lock.txt" -ForegroundColor Red
    exit 1
}

# ── 4. Checa porta livre ───────────────────────────────────────────────────────
$listening = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($listening) {
    $pidOnPort = ($listening | Select-Object -First 1).OwningProcess
    $procName = (Get-Process -Id $pidOnPort -ErrorAction SilentlyContinue).ProcessName

    if ($Force) {
        Write-Host "[dev.ps1] porta $Port ocupada por PID $pidOnPort ($procName) — derrubando (Force)..." -ForegroundColor Yellow
        Stop-Process -Id $pidOnPort -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 1
        if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) {
            Write-Host "[dev.ps1] ERRO: não consegui liberar a porta $Port." -ForegroundColor Red
            exit 1
        }
        Write-Host "[dev.ps1] porta $Port liberada" -ForegroundColor Green
    } else {
        Write-Host "[dev.ps1] ERRO: porta $Port ocupada por PID $pidOnPort ($procName)." -ForegroundColor Red
        Write-Host "          Para derrubar e subir: pwsh apps/langgraph-service/dev.ps1 -Force" -ForegroundColor Yellow
        Write-Host "          Para derrubar manualmente: Stop-Process -Id $pidOnPort -Force" -ForegroundColor Yellow
        exit 1
    }
}

# ── 5. Sobe o uvicorn ──────────────────────────────────────────────────────────
Write-Host "[dev.ps1] iniciando uvicorn em http://${BindHost}:${Port} (--reload)" -ForegroundColor Green
& $VenvPython -m uvicorn app.main:app --host $BindHost --port $Port --reload
