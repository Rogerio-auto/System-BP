<#
.SYNOPSIS
    Smoke test de producao para o Elemento (Banco do Povo).

.DESCRIPTION
    Executa 6 checks core + 1 check opcional contra um ambiente de producao ou staging.
    Retorna exit code 0 (tudo ok), 1 (core ok, opcional falhou), ou 2 (algum check core falhou).

    Checks core:
      1. GET /health na API Node
      2. GET /health no LangGraph
      3. POST /api/auth/login com credencial de QA
      4. GET /api/dashboard/metrics com token QA
      5. GET /api/credit-products com token QA (espera >= 1 produto ativo)
      6. GET /api/feature-flags confirma followup.enabled=false e billing.enabled=false

    Check opcional (gated por -Full):
      7. POST /api/internal/test-whatsapp valida que mensagem de teste e aceita.

.PARAMETER BaseUrl
    URL base da API, sem barra final. Ex: https://elemento-prod.com

.PARAMETER AdminToken
    JWT de acesso de um usuario admin/QA previamente criado no ambiente.

.PARAMETER LangGraphUrl
    URL base do servico LangGraph. Se omitido, infere do BaseUrl trocando porta por 8000.

.PARAMETER QaEmail
    E-mail do usuario de QA para o teste de login. Default: qa@elemento.internal

.PARAMETER QaPassword
    Senha do usuario de QA. Default: usa variavel de ambiente QA_PASSWORD.

.PARAMETER Full
    Switch. Quando presente, executa tambem o check opcional de WhatsApp (check #7).

.PARAMETER TimeoutSeconds
    Timeout por requisicao em segundos. Default: 10.

.EXAMPLE
    ./scripts/smoke-prod.ps1 -BaseUrl https://elemento-prod.com -AdminToken $env:ADMIN_TOKEN

.EXAMPLE
    ./scripts/smoke-prod.ps1 -BaseUrl http://localhost:3333 -AdminToken $env:ADMIN_TOKEN -Full

.EXAMPLE
    ./scripts/smoke-prod.ps1 `
        -BaseUrl https://staging.elemento.com `
        -AdminToken $env:STAGING_TOKEN `
        -LangGraphUrl http://localhost:8000 `
        -Full
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string]$BaseUrl,

    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string]$AdminToken,

    [Parameter(Mandatory = $false)]
    [string]$LangGraphUrl = '',

    [Parameter(Mandatory = $false)]
    [string]$QaEmail = 'qa@elemento.internal',

    [Parameter(Mandatory = $false)]
    [string]$QaPassword = $env:QA_PASSWORD,

    [Parameter(Mandatory = $false)]
    [switch]$Full,

    [Parameter(Mandatory = $false)]
    [ValidateRange(1, 120)]
    [int]$TimeoutSeconds = 10
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------------------
# Constantes e estado
# ---------------------------------------------------------------------------

$BaseUrl = $BaseUrl.TrimEnd('/')

if ($LangGraphUrl -eq '') {
    # Inferir URL do LangGraph: tenta trocar porta por 8000
    $LangGraphUrl = $BaseUrl -replace ':\d+$', ':8000'
    if ($LangGraphUrl -eq $BaseUrl) {
        $uri = [System.Uri]$BaseUrl
        $LangGraphUrl = "$($uri.Scheme)://$($uri.Host):8000"
    }
}
$LangGraphUrl = $LangGraphUrl.TrimEnd('/')

$Script:CorePassed = 0
$Script:CoreFailed = 0
$Script:OptionalFailed = 0
$Script:QaToken = ''

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

function Write-CheckResult {
    param(
        [string]$Number,
        [string]$Label,
        [string]$Result,
        [string]$Detail = ''
    )

    $symbol = switch ($Result) {
        'OK'   { '[OK]  ' }
        'FAIL' { '[FAIL]' }
        'WARN' { '[WARN]' }
        'SKIP' { '[SKIP]' }
        default { '[???] ' }
    }

    $line = "  $symbol #$Number $Label"
    if ($Detail -ne '') {
        $line = "$line -- $Detail"
    }

    Write-Host $line
}

function Invoke-SmokeRequest {
    param(
        [string]$Method,
        [string]$Uri,
        [hashtable]$Headers = @{},
        [object]$Body = $null,
        [int]$Timeout = $TimeoutSeconds
    )

    $result = @{
        Success    = $false
        StatusCode = 0
        Body       = $null
        Error      = ''
    }

    $params = @{
        Method      = $Method
        Uri         = $Uri
        Headers     = $Headers
        TimeoutSec  = $Timeout
        ErrorAction = 'Stop'
    }

    if ($null -ne $Body) {
        $params['Body']        = ($Body | ConvertTo-Json -Depth 10)
        $params['ContentType'] = 'application/json'
    }

    try {
        $response = Invoke-RestMethod @params
        # Invoke-RestMethod lanca excecao em 4xx/5xx por padrao; se chegou aqui e 2xx
        $result['Success']    = $true
        $result['StatusCode'] = 200   # estimativa — sem StatusCodeVariable no PS5
        $result['Body']       = $response
    }
    catch {
        $webEx = $_.Exception
        if ($null -ne $webEx.Response) {
            try {
                $result['StatusCode'] = [int]$webEx.Response.StatusCode
                $stream = $webEx.Response.GetResponseStream()
                $reader = New-Object System.IO.StreamReader($stream)
                $rawBody = $reader.ReadToEnd()
                $reader.Close()
                $result['Body'] = $rawBody | ConvertFrom-Json -ErrorAction SilentlyContinue
            }
            catch {}
        }
        $result['Error'] = $webEx.Message
    }

    return $result
}

function Get-QaHeaders {
    return @{
        'Authorization' = "Bearer $($Script:QaToken)"
        'Accept'        = 'application/json'
    }
}

function Get-AdminHeaders {
    return @{
        'Authorization' = "Bearer $AdminToken"
        'Accept'        = 'application/json'
    }
}

# ---------------------------------------------------------------------------
# Header de execucao
# ---------------------------------------------------------------------------

Write-Host ''
Write-Host '=================================================='
Write-Host '  Elemento -- Smoke Test de Producao'
Write-Host '=================================================='
Write-Host "  BaseUrl    : $BaseUrl"
Write-Host "  LangGraph  : $LangGraphUrl"
Write-Host "  Full mode  : $($Full.IsPresent)"
Write-Host "  Timeout    : ${TimeoutSeconds}s por check"
Write-Host "  Hora       : $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
Write-Host '--------------------------------------------------'
Write-Host ''

# ---------------------------------------------------------------------------
# Check #1 -- API health
# ---------------------------------------------------------------------------

Write-Host 'Check #1: API health'
$r = Invoke-SmokeRequest -Method GET -Uri "$BaseUrl/health"

if ($r.Success -and $r.Body) {
    $bodyStr = $r.Body | ConvertTo-Json -Depth 3
    if ($bodyStr -match '"ok"') {
        Write-CheckResult -Number '1' -Label 'API health' -Result 'OK' -Detail "HTTP 200 status:ok"
        $Script:CorePassed++
    }
    else {
        Write-CheckResult -Number '1' -Label 'API health' -Result 'FAIL' -Detail "HTTP 200 mas status:ok ausente no body"
        $Script:CoreFailed++
    }
}
else {
    $detail = if ($r.Error -ne '') { $r.Error } else { "HTTP $($r.StatusCode)" }
    Write-CheckResult -Number '1' -Label 'API health' -Result 'FAIL' -Detail $detail
    $Script:CoreFailed++
}

# ---------------------------------------------------------------------------
# Check #2 -- LangGraph health
# ---------------------------------------------------------------------------

Write-Host 'Check #2: LangGraph health'
$r = Invoke-SmokeRequest -Method GET -Uri "$LangGraphUrl/health"

if ($r.Success) {
    Write-CheckResult -Number '2' -Label 'LangGraph health' -Result 'OK' -Detail "HTTP 200"
    $Script:CorePassed++
}
else {
    $detail = if ($r.Error -ne '') { $r.Error } else { "HTTP $($r.StatusCode)" }
    Write-CheckResult -Number '2' -Label 'LangGraph health' -Result 'FAIL' -Detail $detail
    $Script:CoreFailed++
}

# ---------------------------------------------------------------------------
# Check #3 -- Login QA
# ---------------------------------------------------------------------------

Write-Host 'Check #3: Login QA'

if ($null -eq $QaPassword -or $QaPassword -eq '') {
    Write-CheckResult -Number '3' -Label 'Login QA' -Result 'FAIL' -Detail 'QaPassword nao fornecida -- use -QaPassword ou defina QA_PASSWORD no ambiente'
    $Script:CoreFailed++
}
else {
    $loginBody = @{
        email    = $QaEmail
        password = $QaPassword
    }
    $r = Invoke-SmokeRequest -Method POST -Uri "$BaseUrl/api/auth/login" -Body $loginBody

    if ($r.Success -and $null -ne $r.Body) {
        $token = $r.Body.accessToken
        if ($null -ne $token -and $token -ne '') {
            $Script:QaToken = $token
            $preview = $token.Substring(0, [Math]::Min(20, $token.Length))
            Write-CheckResult -Number '3' -Label 'Login QA' -Result 'OK' -Detail "token obtido ($preview...)"
            $Script:CorePassed++
        }
        else {
            Write-CheckResult -Number '3' -Label 'Login QA' -Result 'FAIL' -Detail 'HTTP 200 mas accessToken ausente no body'
            $Script:CoreFailed++
        }
    }
    else {
        $detail = if ($r.Error -ne '') { $r.Error } else { "HTTP $($r.StatusCode)" }
        Write-CheckResult -Number '3' -Label 'Login QA' -Result 'FAIL' -Detail $detail
        $Script:CoreFailed++
    }
}

# ---------------------------------------------------------------------------
# Check #4 -- Dashboard metrics
# ---------------------------------------------------------------------------

Write-Host 'Check #4: Dashboard metrics'

if ($Script:QaToken -eq '') {
    Write-CheckResult -Number '4' -Label 'Dashboard metrics' -Result 'FAIL' -Detail 'Pulado -- token QA nao disponivel (check #3 falhou)'
    $Script:CoreFailed++
}
else {
    $r = Invoke-SmokeRequest -Method GET -Uri "$BaseUrl/api/dashboard/metrics" -Headers (Get-QaHeaders)

    if ($r.Success -and $null -ne $r.Body) {
        $bodyJson = $r.Body | ConvertTo-Json -Depth 3
        if ($bodyJson.Length -gt 5) {
            Write-CheckResult -Number '4' -Label 'Dashboard metrics' -Result 'OK' -Detail "HTTP 200, body nao-vazio"
            $Script:CorePassed++
        }
        else {
            Write-CheckResult -Number '4' -Label 'Dashboard metrics' -Result 'FAIL' -Detail 'HTTP 200 mas body vazio ou trivial'
            $Script:CoreFailed++
        }
    }
    else {
        $detail = if ($r.Error -ne '') { $r.Error } else { "HTTP $($r.StatusCode)" }
        Write-CheckResult -Number '4' -Label 'Dashboard metrics' -Result 'FAIL' -Detail $detail
        $Script:CoreFailed++
    }
}

# ---------------------------------------------------------------------------
# Check #5 -- Credit products listagem
# ---------------------------------------------------------------------------

Write-Host 'Check #5: Credit products'

if ($Script:QaToken -eq '') {
    Write-CheckResult -Number '5' -Label 'Credit products' -Result 'FAIL' -Detail 'Pulado -- token QA nao disponivel (check #3 falhou)'
    $Script:CoreFailed++
}
else {
    $r = Invoke-SmokeRequest -Method GET -Uri "$BaseUrl/api/credit-products" -Headers (Get-QaHeaders)

    if ($r.Success -and $null -ne $r.Body) {
        $count = 0
        if ($r.Body -is [System.Array]) {
            $count = $r.Body.Count
        }
        elseif ($null -ne $r.Body.data -and $r.Body.data -is [System.Array]) {
            $count = $r.Body.data.Count
        }

        if ($count -ge 1) {
            Write-CheckResult -Number '5' -Label 'Credit products' -Result 'OK' -Detail "$count produto(s) ativo(s)"
            $Script:CorePassed++
        }
        else {
            Write-CheckResult -Number '5' -Label 'Credit products' -Result 'FAIL' -Detail 'HTTP 200 mas array vazio -- seed de producao pode estar faltando'
            $Script:CoreFailed++
        }
    }
    else {
        $detail = if ($r.Error -ne '') { $r.Error } else { "HTTP $($r.StatusCode)" }
        Write-CheckResult -Number '5' -Label 'Credit products' -Result 'FAIL' -Detail $detail
        $Script:CoreFailed++
    }
}

# ---------------------------------------------------------------------------
# Check #6 -- Feature flags (followup e billing devem estar disabled)
# ---------------------------------------------------------------------------

Write-Host 'Check #6: Feature flags'

if ($Script:QaToken -eq '') {
    Write-CheckResult -Number '6' -Label 'Feature flags' -Result 'FAIL' -Detail 'Pulado -- token QA nao disponivel (check #3 falhou)'
    $Script:CoreFailed++
}
else {
    $r = Invoke-SmokeRequest -Method GET -Uri "$BaseUrl/api/feature-flags" -Headers (Get-QaHeaders)

    if ($r.Success -and $null -ne $r.Body) {
        $bodyJson = $r.Body | ConvertTo-Json -Depth 5

        $followupEnabled = $false
        $billingEnabled  = $false

        if ($r.Body -is [System.Array]) {
            foreach ($flag in $r.Body) {
                if ($flag.key -like 'followup*' -and $flag.enabled -eq $true) { $followupEnabled = $true }
                if ($flag.key -like 'billing*'  -and $flag.enabled -eq $true) { $billingEnabled  = $true }
            }
        }
        elseif ($null -ne $r.Body.flags -and $r.Body.flags -is [System.Array]) {
            foreach ($flag in $r.Body.flags) {
                if ($flag.key -like 'followup*' -and $flag.enabled -eq $true) { $followupEnabled = $true }
                if ($flag.key -like 'billing*'  -and $flag.enabled -eq $true) { $billingEnabled  = $true }
            }
        }
        else {
            # Fallback via JSON string para formatos customizados
            if ($bodyJson -match '"followup[^"]*"[^}]*"enabled"\s*:\s*true') { $followupEnabled = $true }
            if ($bodyJson -match '"billing[^"]*"[^}]*"enabled"\s*:\s*true')  { $billingEnabled  = $true }
        }

        if (-not $followupEnabled -and -not $billingEnabled) {
            Write-CheckResult -Number '6' -Label 'Feature flags' -Result 'OK' -Detail 'followup=disabled, billing=disabled'
            $Script:CorePassed++
        }
        else {
            $active = [System.Collections.Generic.List[string]]::new()
            if ($followupEnabled) { $active.Add('followup') }
            if ($billingEnabled)  { $active.Add('billing') }
            Write-CheckResult -Number '6' -Label 'Feature flags' -Result 'FAIL' -Detail "flags pos-MVP habilitadas indevidamente: $($active -join ', ')"
            $Script:CoreFailed++
        }
    }
    else {
        $detail = if ($r.Error -ne '') { $r.Error } else { "HTTP $($r.StatusCode)" }
        Write-CheckResult -Number '6' -Label 'Feature flags' -Result 'FAIL' -Detail $detail
        $Script:CoreFailed++
    }
}

# ---------------------------------------------------------------------------
# Check #7 -- WhatsApp QA (opcional, gated por -Full)
# ---------------------------------------------------------------------------

if ($Full.IsPresent) {
    Write-Host 'Check #7: WhatsApp QA (opcional)'

    $waBody = @{
        message   = '[SMOKE TEST] Mensagem automatica de validacao -- ignorar.'
        test_mode = $true
    }

    $r = Invoke-SmokeRequest -Method POST -Uri "$BaseUrl/api/internal/test-whatsapp" -Headers (Get-AdminHeaders) -Body $waBody -Timeout 35

    if ($r.Success) {
        Write-CheckResult -Number '7' -Label 'WhatsApp QA' -Result 'OK' -Detail "HTTP 200/202 -- mensagem aceita"
    }
    elseif ($r.StatusCode -eq 404) {
        Write-CheckResult -Number '7' -Label 'WhatsApp QA' -Result 'WARN' -Detail 'Endpoint nao encontrado (404) -- verificar implementacao'
        $Script:OptionalFailed++
    }
    else {
        $detail = if ($r.Error -ne '') { $r.Error } else { "HTTP $($r.StatusCode)" }
        Write-CheckResult -Number '7' -Label 'WhatsApp QA' -Result 'WARN' -Detail $detail
        $Script:OptionalFailed++
    }
}
else {
    Write-Host '  [SKIP] #7 WhatsApp QA -- use -Full para incluir este check'
}

# ---------------------------------------------------------------------------
# Sumario final e exit code
# ---------------------------------------------------------------------------

Write-Host ''
Write-Host '--------------------------------------------------'
Write-Host "  Resultado: $($Script:CorePassed) core OK | $($Script:CoreFailed) core FAIL | $($Script:OptionalFailed) optional WARN"
Write-Host "  Hora fim : $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
Write-Host '--------------------------------------------------'

if ($Script:CoreFailed -gt 0) {
    Write-Host '  STATUS: FAIL -- deploy NAO deve prosseguir sem correcao dos erros core acima.'
    Write-Host ''
    exit 2
}

if ($Script:OptionalFailed -gt 0) {
    Write-Host '  STATUS: WARN -- checks core ok, check opcional falhou. Investigar antes de considerar go-live completo.'
    Write-Host ''
    exit 1
}

Write-Host '  STATUS: OK -- todos os checks passaram. Ambiente pronto para go-live.'
Write-Host ''
exit 0
