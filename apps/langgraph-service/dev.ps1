# =============================================================================
# dev.ps1 -- Sobe o LangGraph service para desenvolvimento local (Windows).
#
# Compatibilidade: Windows PowerShell 5.1 (built-in do Windows) e PowerShell 7+.
# ASCII puro nos comentarios -- box-drawing chars quebram parse no PS 5.1.
#
# Faz, na ordem:
#   1. Resolve a raiz do projeto a partir do path do script (independe do cwd).
#   2. Carrega as env vars do `.env` da raiz no processo (Pydantic Settings le
#      do env do processo; o langgraph-service nao tem `.env` proprio para
#      evitar duplicacao de segredos -- fonte unica e o `.env` do root).
#   3. Verifica que o venv local existe.
#   4. Checa se a porta 8000 esta livre. Com `-Force`, derruba o processo orfao.
#   5. Sobe `uvicorn app.main:app --reload` em foreground.
#
# Uso (PowerShell 5.1):
#   .\dev.ps1                  # de dentro de apps/langgraph-service/
#   .\dev.ps1 -Force           # derruba processo orfao na 8000 e sobe
#   .\dev.ps1 -Port 8001       # porta alternativa
#
# Pre-requisitos (uma unica vez):
#   python -m venv .venv
#   .\.venv\Scripts\python.exe -m pip install -r requirements.lock.txt
# =============================================================================

[CmdletBinding()]
param(
    [switch]$Force,
    [int]$Port = 8000,
    [string]$BindHost = '127.0.0.1'
)

$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------------------
# 1. Resolve paths absolutos a partir do script
# ---------------------------------------------------------------------------
$ScriptDir = $PSScriptRoot
$RepoRoot = Resolve-Path (Join-Path $ScriptDir '..\..') | Select-Object -ExpandProperty Path
$EnvFile = Join-Path $RepoRoot '.env'
$VenvPython = Join-Path $ScriptDir '.venv\Scripts\python.exe'

Write-Host "[dev.ps1] repo root: $RepoRoot" -ForegroundColor DarkGray
Write-Host "[dev.ps1] script dir: $ScriptDir" -ForegroundColor DarkGray

# ---------------------------------------------------------------------------
# 2. Carrega env vars do .env do root
# ---------------------------------------------------------------------------
if (-not (Test-Path $EnvFile)) {
    Write-Host "[dev.ps1] ERRO: $EnvFile nao encontrado." -ForegroundColor Red
    Write-Host "          Crie o .env na raiz copiando de .env.example primeiro." -ForegroundColor Red
    exit 1
}

$loaded = 0
Get-Content $EnvFile | ForEach-Object {
    if ($_ -match '^([A-Z][A-Z0-9_]*)=(.*)$') {
        [Environment]::SetEnvironmentVariable($matches[1], $matches[2].Trim('"'), 'Process')
        $loaded++
    }
}
Write-Host "[dev.ps1] $loaded vars carregadas do .env do root" -ForegroundColor DarkGray

# Sanidade: vars criticas para o Pydantic Settings (config.py).
$required = @('BACKEND_INTERNAL_URL', 'LANGGRAPH_INTERNAL_TOKEN', 'OPENROUTER_API_KEY')
foreach ($v in $required) {
    $val = [Environment]::GetEnvironmentVariable($v, 'Process')
    if ([string]::IsNullOrWhiteSpace($val)) {
        Write-Host "[dev.ps1] ERRO: variavel obrigatoria $v nao esta setada no .env." -ForegroundColor Red
        exit 1
    }
}

# ---------------------------------------------------------------------------
# 3. Confere venv
# ---------------------------------------------------------------------------
if (-not (Test-Path $VenvPython)) {
    Write-Host "[dev.ps1] ERRO: venv nao encontrado em $VenvPython" -ForegroundColor Red
    Write-Host "          Crie com: python -m venv .venv ; .\.venv\Scripts\python.exe -m pip install -r requirements.lock.txt" -ForegroundColor Red
    exit 1
}

# ---------------------------------------------------------------------------
# 4. Checa porta livre
# ---------------------------------------------------------------------------
# NAO usar Get-NetTCPConnection: em algumas maquinas Windows ele pendura
# indefinidamente (depende do provider WMI MSFT_NetTCPConnection, que pode
# travar). netstat -ano responde em ~0.07s e ainda entrega o PID.
function Get-PidOnPort {
    param([int]$Port)
    $pattern = ':' + $Port + '\s'
    $line = netstat -ano -p TCP |
        Select-String -Pattern $pattern |
        Where-Object { $_ -match 'LISTENING' } |
        Select-Object -First 1
    if (-not $line) { return $null }
    # Ultima coluna da linha do netstat e o PID.
    $cols = ($line.ToString().Trim() -split '\s+')
    return [int]$cols[-1]
}

$pidOnPort = Get-PidOnPort -Port $Port
if ($pidOnPort) {
    $procName = (Get-Process -Id $pidOnPort -ErrorAction SilentlyContinue).ProcessName
    $portInfo = "porta $Port ocupada por PID $pidOnPort ($procName)"

    if ($Force) {
        Write-Host "[dev.ps1] $portInfo -- derrubando (Force)..." -ForegroundColor Yellow
        Stop-Process -Id $pidOnPort -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 1
        if (Get-PidOnPort -Port $Port) {
            Write-Host "[dev.ps1] ERRO: nao consegui liberar a porta $Port." -ForegroundColor Red
            exit 1
        }
        Write-Host ('[dev.ps1] porta {0} liberada' -f $Port) -ForegroundColor Green
    } else {
        Write-Host "[dev.ps1] ERRO: $portInfo." -ForegroundColor Red
        Write-Host "          Para derrubar e subir: .\dev.ps1 -Force" -ForegroundColor Yellow
        Write-Host "          Para derrubar manualmente: Stop-Process -Id $pidOnPort -Force" -ForegroundColor Yellow
        exit 1
    }
}

# ---------------------------------------------------------------------------
# 5. Sobe o uvicorn
# ---------------------------------------------------------------------------
# Evita interpolacao `${var}:${var}` que o PS 5.1 confunde com escopo de
# variavel (`${env:PATH}`). Usar -f format ou concatenacao explicita.
$url = '{0}:{1}' -f $BindHost, $Port
Write-Host ('[dev.ps1] iniciando uvicorn em http://{0} (reload ativo)' -f $url) -ForegroundColor Green
& $VenvPython -m uvicorn app.main:app --host $BindHost --port $Port --reload
