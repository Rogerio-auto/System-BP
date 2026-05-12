# =============================================================================
# check-compose.ps1 - Validacao ponta a ponta do docker-compose
# Compatibilidade: PowerShell 5.1+
# =============================================================================

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$API_URL       = 'http://localhost:3333'
$LANGGRAPH_URL = 'http://localhost:8000'
$TIMEOUT_S     = 120
$POLL_S        = 5

function Write-Step { param([string]$msg) Write-Host "`n[>] $msg" -ForegroundColor Cyan }
function Write-Ok   { param([string]$msg) Write-Host "[OK] $msg" -ForegroundColor Green }
function Write-Fail { param([string]$msg) Write-Host "[FAIL] $msg" -ForegroundColor Red }
function Write-Info { param([string]$msg) Write-Host "     $msg" -ForegroundColor Gray }

function Invoke-Down {
    Write-Step 'Derrubando stack...'
    docker compose down --remove-orphans 2>&1 | Out-Null
    Write-Ok 'Stack encerrada.'
}

trap {
    Write-Fail "Erro inesperado: $_"
    Invoke-Down
    exit 1
}

# 1. Derrubar stack anterior (idempotencia)
Invoke-Down

# 2. Subir stack com build
Write-Step 'Subindo stack com --build...'
docker compose up --build -d
if (-not $?) { Write-Fail 'docker compose up falhou.'; exit 1 }
Write-Ok 'Containers iniciados.'

# 3. Aguardar healthchecks
Write-Step "Aguardando todos os servicos ficarem healthy (timeout: ${TIMEOUT_S}s)..."

$services = @('postgres', 'api', 'langgraph-service', 'web')
$deadline  = (Get-Date).AddSeconds($TIMEOUT_S)

while ((Get-Date) -lt $deadline) {
    $allHealthy = $true
    foreach ($svc in $services) {
        $status = docker inspect --format '{{.State.Health.Status}}' "elemento-${svc}-1" 2>$null
        if ($status -ne 'healthy') { $allHealthy = $false; Write-Info "${svc}: ${status}" }
    }
    if ($allHealthy) { Write-Ok 'Todos os servicos estao healthy.'; break }
    Start-Sleep -Seconds $POLL_S
}

if ((Get-Date) -ge $deadline) {
    Write-Fail "Timeout de ${TIMEOUT_S}s atingido. Algum servico nao ficou healthy."
    docker compose ps
    Invoke-Down
    exit 1
}

# 4. Validar /health da API
Write-Step "Verificando ${API_URL}/health..."
try {
    $response = Invoke-WebRequest -Uri "${API_URL}/health" -UseBasicParsing -TimeoutSec 10
    if ($response.StatusCode -ne 200) { Write-Fail "API /health retornou HTTP $($response.StatusCode)"; Invoke-Down; exit 1 }
    $body = $response.Content | ConvertFrom-Json
    if ($body.status -ne 'ok') { Write-Fail "API /health status inesperado: $($body.status)"; Invoke-Down; exit 1 }
    Write-Ok "API /health OK - status=$($body.status)"
    Write-Info "Response: $($response.Content)"
} catch {
    Write-Fail "Falha ao chamar API /health: $_"
    Invoke-Down
    exit 1
}

# 5. Validar /health do LangGraph
Write-Step "Verificando ${LANGGRAPH_URL}/health..."
try {
    $response = Invoke-WebRequest -Uri "${LANGGRAPH_URL}/health" -UseBasicParsing -TimeoutSec 10
    if ($response.StatusCode -ne 200) { Write-Fail "LangGraph /health retornou HTTP $($response.StatusCode)"; Invoke-Down; exit 1 }
    Write-Ok "LangGraph /health OK - HTTP $($response.StatusCode)"
    Write-Info "Response: $($response.Content)"
} catch {
    Write-Fail "Falha ao chamar LangGraph /health: $_"
    Invoke-Down
    exit 1
}

# 6. Teardown
Invoke-Down

# 7. Sucesso
Write-Host ''
Write-Host '============================================================' -ForegroundColor Green
Write-Host '  check-compose.ps1 PASSOU - todos os servicos saudaveis    ' -ForegroundColor Green
Write-Host '============================================================' -ForegroundColor Green
exit 0
