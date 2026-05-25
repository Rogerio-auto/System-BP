<#
.SYNOPSIS
    Compara a fonte original (Notion JSON + CSV de analises) contra o banco de staging
    e gera um relatorio de divergencias em CSV.

.DESCRIPTION
    Para cada lead no backup Notion (JSON de export da Notion API), verifica se existe
    em staging com mesmo notion_page_id E mesmos campos de identidade (nome/telefone/cidade).

    Para cada linha no CSV de analises, verifica se existe um credit_analysis no staging
    vinculado ao lead correspondente.

    Saida: CSV com colunas:
        entity_type      - "lead" ou "analysis"
        source_id        - ID no arquivo fonte (notion_page_id ou linha CSV)
        target_id        - ID no staging (lead.id ou credit_analysis.id), ou vazio
        status           - "ok", "missing" ou "divergence"
        divergence_fields- campos com divergencia separados por ";" (vazio se ok/missing)

    Exit codes:
        0 - Sem divergencias nem ausentes
        1 - WARN: < 5% de registros com problema
        2 - FAIL: >= 5% de registros com problema

.PARAMETER NotionBackup
    Caminho para o arquivo JSON exportado do Notion (formato NotionDatabaseQueryResponse).
    Aceita caminho relativo ou absoluto.

.PARAMETER AnalysesCsv
    Caminho para o CSV de analises de credito.
    Colunas esperadas: lead_id, status, parecer, valor_aprovado, prazo_meses,
                       taxa_mensal, analista, data_decisao

.PARAMETER StagingDbUrl
    Connection string do banco de staging no formato:
    postgres://user:password@host:port/database

.PARAMETER OutputCsv
    Caminho do arquivo CSV de saida. Default: import-diff-<timestamp>.csv
    no diretorio corrente.

.PARAMETER TimeoutSeconds
    Timeout para conexao ao banco em segundos. Default: 10.

.EXAMPLE
    .\scripts\diff-import-vs-source.ps1 `
        -NotionBackup .\notion-backup.json `
        -AnalysesCsv  .\analyses.csv `
        -StagingDbUrl "postgres://elemento:secret@localhost:5432/staging"

.EXAMPLE
    .\scripts\diff-import-vs-source.ps1 `
        -NotionBackup  .\notion-backup.json `
        -AnalysesCsv   .\analyses.csv `
        -StagingDbUrl  $env:STAGING_DATABASE_URL `
        -OutputCsv     .\reports\diff-20260525.csv

.NOTES
    Requer psql no PATH para consultas ao banco.
    Sem dependencias externas alem de cmdlets nativos do PowerShell 5.1+.
    Script idempotente: pode ser re-executado sem efeitos colaterais no banco.
    PII: o script nunca loga dados de PII — apenas IDs e nomes de campos divergentes.
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$NotionBackup,

    [Parameter(Mandatory = $true)]
    [string]$AnalysesCsv,

    [Parameter(Mandatory = $true)]
    [string]$StagingDbUrl,

    [Parameter(Mandatory = $false)]
    [string]$OutputCsv = '',

    [Parameter(Mandatory = $false)]
    [ValidateRange(1, 120)]
    [int]$TimeoutSeconds = 10
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------------------
# Helpers de output (sem emoji para compatibilidade com PS5.1 e terminais legados)
# ---------------------------------------------------------------------------

function Write-Header {
    param([string]$Text)
    Write-Host ''
    Write-Host '============================================================'
    Write-Host "  $Text"
    Write-Host '============================================================'
}

function Write-Section {
    param([string]$Text)
    Write-Host ''
    Write-Host "--- $Text ---"
}

function Write-Ok {
    param([string]$Text)
    Write-Host "  [OK]   $Text" -ForegroundColor Green
}

function Write-Warn {
    param([string]$Text)
    Write-Host "  [WARN] $Text" -ForegroundColor Yellow
}

function Write-Fail {
    param([string]$Text)
    Write-Host "  [FAIL] $Text" -ForegroundColor Red
}

function Write-Info {
    param([string]$Text)
    Write-Host "  [INFO] $Text"
}

# ---------------------------------------------------------------------------
# Validacao de dependencias externas
# ---------------------------------------------------------------------------

function Test-PsqlAvailable {
    try {
        $null = & psql --version 2>&1
        return ($LASTEXITCODE -eq 0)
    }
    catch {
        return $false
    }
}

# ---------------------------------------------------------------------------
# Execucao de query no banco via psql
# Retorna a saida como string ou $null em caso de erro
# ---------------------------------------------------------------------------

function Invoke-DbQuery {
    param(
        [string]$DbUrl,
        [string]$Query,
        [int]$Timeout = $TimeoutSeconds
    )

    $result = @{
        Success = $false
        Output  = ''
        Error   = ''
    }

    try {
        # psql: -t (apenas dados, sem cabecalho), -A (sem alinhamento), -c (query)
        $output = & psql $DbUrl --no-psqlrc -t -A -c $Query 2>&1
        $exitCode = $LASTEXITCODE

        if ($exitCode -ne 0) {
            $result['Error'] = "psql exit $exitCode`: $output"
            return $result
        }

        $result['Success'] = $true
        $result['Output']  = $output -join "`n"
    }
    catch {
        $result['Error'] = $_.Exception.Message
    }

    return $result
}

# ---------------------------------------------------------------------------
# Extrai texto plain de uma propriedade Notion (compativel com types.ts)
# Suporta: title, rich_text, phone_number, email, select, status, url, number
# ---------------------------------------------------------------------------

function Get-NotionPropertyText {
    param([object]$PropValue)

    if ($null -eq $PropValue) { return $null }

    $type = $PropValue.type
    if ($null -eq $type) { return $null }

    switch ($type) {
        'title' {
            $arr = $PropValue.title
            if ($arr -is [System.Array] -and $arr.Count -gt 0) {
                return ($arr | ForEach-Object { $_.plain_text }) -join ''
            }
            return $null
        }
        'rich_text' {
            $arr = $PropValue.rich_text
            if ($arr -is [System.Array] -and $arr.Count -gt 0) {
                return ($arr | ForEach-Object { $_.plain_text }) -join ''
            }
            return $null
        }
        'phone_number' {
            $val = $PropValue.phone_number
            if ($null -ne $val -and "$val".Trim().Length -gt 0) { return "$val" }
            return $null
        }
        'email' {
            $val = $PropValue.email
            if ($null -ne $val -and "$val".Trim().Length -gt 0) { return "$val" }
            return $null
        }
        'select' {
            $sel = $PropValue.select
            if ($null -ne $sel -and $null -ne $sel.name) { return "$($sel.name)" }
            return $null
        }
        'status' {
            $st = $PropValue.status
            if ($null -ne $st -and $null -ne $st.name) { return "$($st.name)" }
            return $null
        }
        'url' {
            $val = $PropValue.url
            if ($null -ne $val -and "$val".Trim().Length -gt 0) { return "$val" }
            return $null
        }
        'number' {
            $val = $PropValue.number
            if ($null -ne $val) { return "$val" }
            return $null
        }
        default {
            return $null
        }
    }
}

# ---------------------------------------------------------------------------
# Normaliza telefone para comparacao: remove tudo que nao for digito
# ---------------------------------------------------------------------------

function Normalize-Phone {
    param([string]$Phone)
    if ([string]::IsNullOrWhiteSpace($Phone)) { return '' }
    return ($Phone -replace '[^\d]', '')
}

# ---------------------------------------------------------------------------
# Normaliza string para comparacao: trim + lowercase + remove acentos simples
# ---------------------------------------------------------------------------

function Normalize-String {
    param([string]$Value)
    if ([string]::IsNullOrWhiteSpace($Value)) { return '' }
    $s = $Value.Trim().ToLowerInvariant()
    # Substituicoes basicas de acento (sem dependencia de ICU)
    $s = $s -replace '[aáàâãä]', 'a'
    $s = $s -replace '[eéèêë]',  'e'
    $s = $s -replace '[iíìîï]',  'i'
    $s = $s -replace '[oóòôõö]', 'o'
    $s = $s -replace '[uúùûü]',  'u'
    $s = $s -replace '[cç]',     'c'
    $s = $s -replace '[nñ]',     'n'
    return $s
}

# ---------------------------------------------------------------------------
# Converte connection string postgres:// para variaveis de ambiente PGXXX
# (compatibilidade com psql em ambientes sem suporte a URI direta no PS5.1)
# ---------------------------------------------------------------------------

function Set-PgEnvFromUrl {
    param([string]$Url)

    # postgres://user:pass@host:port/database
    if ($Url -match '^postgres(?:ql)?://([^:@]+)(?::([^@]*))?@([^:/]+)(?::(\d+))?/(.+)$') {
        $env:PGUSER     = $Matches[1]
        $env:PGPASSWORD = if ($Matches[2]) { $Matches[2] } else { '' }
        $env:PGHOST     = $Matches[3]
        $env:PGPORT     = if ($Matches[4]) { $Matches[4] } else { '5432' }
        $env:PGDATABASE = $Matches[5] -replace '\?.*$', ''
        return $true
    }
    return $false
}

# ---------------------------------------------------------------------------
# INICIO DA EXECUCAO
# ---------------------------------------------------------------------------

$RunTimestamp = Get-Date -Format 'yyyyMMdd-HHmmss'

if ($OutputCsv -eq '') {
    $OutputCsv = "import-diff-$RunTimestamp.csv"
}

Write-Header 'Elemento -- Diff: Importacao vs Fonte Original'
Write-Info "Notion backup : $NotionBackup"
Write-Info "Analises CSV  : $AnalysesCsv"
Write-Info "Staging DB    : $(($StagingDbUrl -replace ':([^:@]*?)@', ':***@'))"
Write-Info "Output CSV    : $OutputCsv"
Write-Info "Hora inicio   : $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"

# ---------------------------------------------------------------------------
# Validar arquivos de entrada
# ---------------------------------------------------------------------------

Write-Section 'Validacao de inputs'

$inputErrors = @()

if (-not (Test-Path $NotionBackup)) {
    $inputErrors += "Arquivo NotionBackup nao encontrado: $NotionBackup"
}

if (-not (Test-Path $AnalysesCsv)) {
    $inputErrors += "Arquivo AnalysesCsv nao encontrado: $AnalysesCsv"
}

if ([string]::IsNullOrWhiteSpace($StagingDbUrl)) {
    $inputErrors += 'StagingDbUrl nao pode ser vazio'
}

if ($inputErrors.Count -gt 0) {
    foreach ($err in $inputErrors) {
        Write-Fail $err
    }
    Write-Host ''
    Write-Fail 'Inputs invalidos -- corrija os erros acima e tente novamente.'
    Write-Host ''
    exit 2
}

Write-Ok "NotionBackup : $(Resolve-Path $NotionBackup)"
Write-Ok "AnalysesCsv  : $(Resolve-Path $AnalysesCsv)"

# ---------------------------------------------------------------------------
# Validar psql disponivel
# ---------------------------------------------------------------------------

if (-not (Test-PsqlAvailable)) {
    Write-Fail 'psql nao encontrado no PATH.'
    Write-Fail 'Instale o cliente PostgreSQL e adicione ao PATH antes de executar este script.'
    Write-Fail 'Windows: https://www.postgresql.org/download/windows/'
    Write-Host ''
    exit 2
}

Write-Ok "psql disponivel: $(& psql --version 2>&1 | Select-Object -First 1)"

# ---------------------------------------------------------------------------
# Configurar variaveis de ambiente para psql
# ---------------------------------------------------------------------------

$pgUrlSet = Set-PgEnvFromUrl -Url $StagingDbUrl

if (-not $pgUrlSet) {
    Write-Fail "Formato de StagingDbUrl invalido. Use: postgres://user:pass@host:port/database"
    exit 2
}

# ---------------------------------------------------------------------------
# Testar conexao ao banco
# ---------------------------------------------------------------------------

Write-Section 'Teste de conexao ao banco de staging'

$pingResult = Invoke-DbQuery -DbUrl $StagingDbUrl -Query 'SELECT 1'

if (-not $pingResult.Success) {
    Write-Fail "Nao foi possivel conectar ao banco de staging."
    Write-Fail "Erro: $($pingResult.Error)"
    Write-Fail "Verifique a connection string e se o banco esta acessivel."
    Write-Host ''
    exit 2
}

Write-Ok "Conexao ao banco de staging estabelecida."

# ---------------------------------------------------------------------------
# Carregar Notion backup
# ---------------------------------------------------------------------------

Write-Section 'Carregando backup Notion'

try {
    $notionRaw = Get-Content -Path $NotionBackup -Raw -Encoding UTF8
    $notionData = $notionRaw | ConvertFrom-Json
}
catch {
    Write-Fail "Falha ao carregar/parsear o arquivo Notion JSON: $_"
    exit 2
}

# Suporta tanto o formato { results: [...] } quanto array direto de pages
$notionPages = $null

if ($null -ne $notionData.results -and $notionData.results -is [System.Array]) {
    $notionPages = $notionData.results
}
elseif ($notionData -is [System.Array]) {
    $notionPages = $notionData
}
else {
    Write-Fail 'Formato do arquivo Notion nao reconhecido.'
    Write-Fail 'Esperado: { "results": [...] } ou array de pages.'
    exit 2
}

# Filtrar pages arquivadas
$notionPages = @($notionPages | Where-Object { -not $_.archived })

Write-Ok "Pages Notion carregadas: $($notionPages.Count) (arquivadas ignoradas)"

# ---------------------------------------------------------------------------
# Carregar CSV de analises
# ---------------------------------------------------------------------------

Write-Section 'Carregando CSV de analises'

try {
    $analysesData = Import-Csv -Path $AnalysesCsv -Encoding UTF8
}
catch {
    Write-Fail "Falha ao carregar o arquivo de analises CSV: $_"
    exit 2
}

Write-Ok "Linhas de analises carregadas: $($analysesData.Count)"

# ---------------------------------------------------------------------------
# Buscar todos os leads no staging com notion_page_id
# ---------------------------------------------------------------------------

Write-Section 'Consultando leads no staging'

$leadsQuery = @"
SELECT
    id,
    notion_page_id,
    display_name,
    primary_phone,
    city_id
FROM leads
WHERE notion_page_id IS NOT NULL
ORDER BY notion_page_id;
"@

$leadsResult = Invoke-DbQuery -DbUrl $StagingDbUrl -Query $leadsQuery

if (-not $leadsResult.Success) {
    Write-Fail "Falha ao consultar leads no staging: $($leadsResult.Error)"
    exit 2
}

# Parse da saida do psql (formato: campo|campo|campo)
$stagingLeads = @{}  # notion_page_id -> { id, display_name, primary_phone, city_id }

$leadsLines = ($leadsResult.Output -split "`n") | Where-Object { $_.Trim() -ne '' }
foreach ($line in $leadsLines) {
    $parts = $line -split '\|'
    if ($parts.Count -ge 4) {
        $notionPageId = $parts[1].Trim()
        if ($notionPageId -ne '') {
            $stagingLeads[$notionPageId] = @{
                id           = $parts[0].Trim()
                display_name = $parts[2].Trim()
                primary_phone = $parts[3].Trim()
                city_id      = if ($parts.Count -ge 5) { $parts[4].Trim() } else { '' }
            }
        }
    }
}

Write-Ok "Leads com notion_page_id encontrados no staging: $($stagingLeads.Count)"

# ---------------------------------------------------------------------------
# Buscar cidades no staging para resolucao de nome -> id
# ---------------------------------------------------------------------------

$citiesQuery = 'SELECT id, name FROM cities ORDER BY name;'
$citiesResult = Invoke-DbQuery -DbUrl $StagingDbUrl -Query $citiesQuery

$stagingCities = @{}  # normalized_name -> id

if ($citiesResult.Success) {
    $cityLines = ($citiesResult.Output -split "`n") | Where-Object { $_.Trim() -ne '' }
    foreach ($line in $cityLines) {
        $parts = $line -split '\|'
        if ($parts.Count -ge 2) {
            $cityId   = $parts[0].Trim()
            $cityName = Normalize-String -Value $parts[1].Trim()
            if ($cityName -ne '') {
                $stagingCities[$cityName] = $cityId
            }
        }
    }
    Write-Ok "Cidades carregadas do staging: $($stagingCities.Count)"
}
else {
    Write-Warn "Nao foi possivel carregar cidades: $($citiesResult.Error)"
    Write-Warn "Campos de cidade serao ignorados no diff."
}

# ---------------------------------------------------------------------------
# Buscar credit_analyses no staging
# ---------------------------------------------------------------------------

Write-Section 'Consultando credit_analyses no staging'

$analysesQuery = @"
SELECT
    ca.id,
    ca.lead_id,
    ca.status
FROM credit_analyses ca
ORDER BY ca.lead_id, ca.created_at;
"@

$analysesResult = Invoke-DbQuery -DbUrl $StagingDbUrl -Query $analysesQuery

if (-not $analysesResult.Success) {
    Write-Fail "Falha ao consultar credit_analyses no staging: $($analysesResult.Error)"
    exit 2
}

# Parse: lead_id -> lista de { id, status }
$stagingAnalyses = @{}  # lead_id -> @(...)

$analysesLines = ($analysesResult.Output -split "`n") | Where-Object { $_.Trim() -ne '' }
foreach ($line in $analysesLines) {
    $parts = $line -split '\|'
    if ($parts.Count -ge 3) {
        $analysisId = $parts[0].Trim()
        $leadId     = $parts[1].Trim()
        $status     = $parts[2].Trim()
        if ($leadId -ne '') {
            if (-not $stagingAnalyses.ContainsKey($leadId)) {
                $stagingAnalyses[$leadId] = [System.Collections.Generic.List[hashtable]]::new()
            }
            $stagingAnalyses[$leadId].Add(@{
                id     = $analysisId
                status = $status
            })
        }
    }
}

Write-Ok "Leads com credit_analyses no staging: $($stagingAnalyses.Count)"

# ---------------------------------------------------------------------------
# Detectar mapeamento de propriedades Notion
# Auto-deteccao dos campos canonicos usando nomes de propriedade mais comuns
# ---------------------------------------------------------------------------

function Get-NotionFieldValue {
    param(
        [object]$Properties,
        [string[]]$CandidateNames
    )
    foreach ($name in $CandidateNames) {
        if ($null -ne $Properties.$name) {
            $val = Get-NotionPropertyText -PropValue $Properties.$name
            if ($null -ne $val -and $val.Trim().Length -gt 0) {
                return $val.Trim()
            }
        }
    }
    return ''
}

# Nomes canonicos por campo (case-insensitive match feito pelo PowerShell em PSCustomObject)
$nameFields   = @('Nome', 'Name', 'nome', 'name', 'NOME')
$phoneFields  = @('WhatsApp', 'Telefone', 'Phone', 'Celular', 'whatsapp', 'telefone', 'phone', 'celular')
$cityFields   = @('Cidade', 'City', 'cidade', 'city', 'CIDADE')

# ---------------------------------------------------------------------------
# DIFF: Leads Notion vs Staging
# ---------------------------------------------------------------------------

Write-Section 'Executando diff de leads (Notion -> Staging)'

$diffRows = [System.Collections.Generic.List[hashtable]]::new()

$leadsOk         = 0
$leadsMissing    = 0
$leadsDivergence = 0

$totalLeads = $notionPages.Count
$processed  = 0

foreach ($page in $notionPages) {
    $processed++
    if ($processed % 100 -eq 0) {
        Write-Info "Processando leads: $processed / $totalLeads..."
    }

    $notionPageId = $page.id
    $props        = $page.properties

    # Extrair campos da fonte
    $srcName  = Get-NotionFieldValue -Properties $props -CandidateNames $nameFields
    $srcPhone = Get-NotionFieldValue -Properties $props -CandidateNames $phoneFields
    $srcCity  = Get-NotionFieldValue -Properties $props -CandidateNames $cityFields

    # Verificar se existe no staging
    if (-not $stagingLeads.ContainsKey($notionPageId)) {
        $leadsMissing++
        $diffRows.Add(@{
            entity_type       = 'lead'
            source_id         = $notionPageId
            target_id         = ''
            status            = 'missing'
            divergence_fields = ''
        })
        continue
    }

    $stagingLead = $stagingLeads[$notionPageId]
    $divergentFields = [System.Collections.Generic.List[string]]::new()

    # Comparar nome (normalizado)
    if ($srcName -ne '') {
        $srcNameNorm     = Normalize-String -Value $srcName
        $stagingNameNorm = Normalize-String -Value $stagingLead.display_name
        if ($srcNameNorm -ne $stagingNameNorm -and $stagingNameNorm -ne '') {
            $divergentFields.Add('display_name')
        }
    }

    # Comparar telefone (somente digitos)
    if ($srcPhone -ne '') {
        $srcPhoneNorm     = Normalize-Phone -Phone $srcPhone
        $stagingPhoneNorm = Normalize-Phone -Phone $stagingLead.primary_phone
        # Comparar sufixo: staging pode estar em E.164 (+5569...) vs (69...)
        $srcSuffix     = $srcPhoneNorm     -replace '^55', ''
        $stagingSuffix = $stagingPhoneNorm -replace '^55', ''
        if ($srcSuffix -ne '' -and $stagingSuffix -ne '' -and $srcSuffix -ne $stagingSuffix) {
            $divergentFields.Add('primary_phone')
        }
    }

    # Comparar cidade (se tabela de cidades disponivel)
    if ($srcCity -ne '' -and $stagingCities.Count -gt 0) {
        $srcCityNorm = Normalize-String -Value $srcCity
        if ($stagingCities.ContainsKey($srcCityNorm)) {
            $expectedCityId = $stagingCities[$srcCityNorm]
            if ($stagingLead.city_id -ne '' -and $stagingLead.city_id -ne $expectedCityId) {
                $divergentFields.Add('city_id')
            }
        }
    }

    if ($divergentFields.Count -gt 0) {
        $leadsDivergence++
        $diffRows.Add(@{
            entity_type       = 'lead'
            source_id         = $notionPageId
            target_id         = $stagingLead.id
            status            = 'divergence'
            divergence_fields = $divergentFields -join ';'
        })
    }
    else {
        $leadsOk++
        $diffRows.Add(@{
            entity_type       = 'lead'
            source_id         = $notionPageId
            target_id         = $stagingLead.id
            status            = 'ok'
            divergence_fields = ''
        })
    }
}

Write-Ok "Leads processados: $totalLeads"
Write-Info "  OK         : $leadsOk"
if ($leadsMissing -gt 0) {
    Write-Warn "  Missing    : $leadsMissing"
}
else {
    Write-Ok "  Missing    : $leadsMissing"
}
if ($leadsDivergence -gt 0) {
    Write-Warn "  Divergence : $leadsDivergence"
}
else {
    Write-Ok "  Divergence : $leadsDivergence"
}

# ---------------------------------------------------------------------------
# DIFF: Analises CSV vs Staging
# ---------------------------------------------------------------------------

Write-Section 'Executando diff de analises (CSV -> Staging)'

$analysesOk         = 0
$analysesMissing    = 0
$analysesDivergence = 0

$totalAnalyses = $analysesData.Count
$processedA    = 0

foreach ($row in $analysesData) {
    $processedA++
    if ($processedA % 100 -eq 0) {
        Write-Info "Processando analises: $processedA / $totalAnalyses..."
    }

    # Identificar lead pelo lead_id da coluna CSV
    $csvLeadId = $null
    $sourceId  = "row-$processedA"

    # Tentar campo lead_id direto
    if ($null -ne $row.lead_id -and $row.lead_id.Trim() -ne '') {
        $csvLeadId = $row.lead_id.Trim()
        $sourceId  = "lead:$csvLeadId"
    }

    $csvStatus = ''
    if ($null -ne $row.status) { $csvStatus = $row.status.Trim().ToLowerInvariant() }

    if ($null -eq $csvLeadId) {
        # Sem lead_id identificavel — missing sem possibilidade de match
        $analysesMissing++
        $diffRows.Add(@{
            entity_type       = 'analysis'
            source_id         = $sourceId
            target_id         = ''
            status            = 'missing'
            divergence_fields = 'lead_id_not_found_in_csv'
        })
        continue
    }

    # Verificar se o lead existe no staging
    $leadExistsResult = Invoke-DbQuery -DbUrl $StagingDbUrl `
        -Query "SELECT id FROM leads WHERE id = '$csvLeadId' LIMIT 1"

    if (-not $leadExistsResult.Success -or $leadExistsResult.Output.Trim() -eq '') {
        # Lead nao encontrado — analise "orphan"
        $analysesMissing++
        $diffRows.Add(@{
            entity_type       = 'analysis'
            source_id         = $sourceId
            target_id         = ''
            status            = 'missing'
            divergence_fields = 'lead_not_in_staging'
        })
        continue
    }

    # Verificar se existe credit_analysis para este lead
    if (-not $stagingAnalyses.ContainsKey($csvLeadId)) {
        $analysesMissing++
        $diffRows.Add(@{
            entity_type       = 'analysis'
            source_id         = $sourceId
            target_id         = ''
            status            = 'missing'
            divergence_fields = ''
        })
        continue
    }

    # Encontrou analyses para o lead — verificar status
    $matchingAnalyses = $stagingAnalyses[$csvLeadId]
    $targetId         = $matchingAnalyses[0].id  # usar a mais recente encontrada
    $stagingStatus    = $matchingAnalyses[0].status.Trim().ToLowerInvariant()

    $divergentFields = [System.Collections.Generic.List[string]]::new()

    # Comparar status (normalizado: remover acentos e espaços)
    if ($csvStatus -ne '') {
        $csvStatusNorm     = Normalize-String -Value $csvStatus
        $stagingStatusNorm = Normalize-String -Value $stagingStatus

        # Mapeamentos comuns entre CSV e enum interno
        $statusMap = @{
            'aprovado'    = 'approved'
            'recusado'    = 'rejected'
            'em_analise'  = 'in_review'
            'em analise'  = 'in_review'
            'pendente'    = 'pending'
            'cancelado'   = 'cancelled'
        }

        $normalizedCsv     = if ($statusMap.ContainsKey($csvStatusNorm)) { $statusMap[$csvStatusNorm] } else { $csvStatusNorm }
        $normalizedStaging = if ($statusMap.ContainsKey($stagingStatusNorm)) { $statusMap[$stagingStatusNorm] } else { $stagingStatusNorm }

        if ($normalizedCsv -ne $normalizedStaging) {
            $divergentFields.Add('status')
        }
    }

    if ($divergentFields.Count -gt 0) {
        $analysesDivergence++
        $diffRows.Add(@{
            entity_type       = 'analysis'
            source_id         = $sourceId
            target_id         = $targetId
            status            = 'divergence'
            divergence_fields = $divergentFields -join ';'
        })
    }
    else {
        $analysesOk++
        $diffRows.Add(@{
            entity_type       = 'analysis'
            source_id         = $sourceId
            target_id         = $targetId
            status            = 'ok'
            divergence_fields = ''
        })
    }
}

Write-Ok "Analises processadas: $totalAnalyses"
Write-Info "  OK         : $analysesOk"
if ($analysesMissing -gt 0) {
    Write-Warn "  Missing    : $analysesMissing"
}
else {
    Write-Ok "  Missing    : $analysesMissing"
}
if ($analysesDivergence -gt 0) {
    Write-Warn "  Divergence : $analysesDivergence"
}
else {
    Write-Ok "  Divergence : $analysesDivergence"
}

# ---------------------------------------------------------------------------
# Gravar CSV de output
# ---------------------------------------------------------------------------

Write-Section 'Gerando CSV de output'

try {
    # Cabecalho
    $csvLines = [System.Collections.Generic.List[string]]::new()
    $csvLines.Add('entity_type,source_id,target_id,status,divergence_fields')

    foreach ($row in $diffRows) {
        # Escapar campos que podem ter virgulas
        $entityType  = $row.entity_type
        $sourceId    = $row.source_id    -replace '"', '""'
        $targetId    = $row.target_id    -replace '"', '""'
        $status      = $row.status
        $divFields   = $row.divergence_fields -replace '"', '""'

        $csvLines.Add("`"$entityType`",`"$sourceId`",`"$targetId`",`"$status`",`"$divFields`"")
    }

    $csvLines | Out-File -FilePath $OutputCsv -Encoding UTF8 -Force
    Write-Ok "CSV gravado: $OutputCsv ($($diffRows.Count) linhas)"
}
catch {
    Write-Fail "Falha ao gravar CSV de output: $_"
    exit 2
}

# ---------------------------------------------------------------------------
# Sumario final
# ---------------------------------------------------------------------------

$totalSource   = $totalLeads + $totalAnalyses
$totalOk       = $leadsOk + $analysesOk
$totalMissing  = $leadsMissing + $analysesMissing
$totalDiverg   = $leadsDivergence + $analysesDivergence
$totalProblems = $totalMissing + $totalDiverg

$pctProblems = if ($totalSource -gt 0) {
    [Math]::Round(($totalProblems / $totalSource) * 100, 2)
}
else {
    0
}

Write-Header 'Sumario Final'
Write-Host "  Total na fonte  : $totalSource  (leads: $totalLeads | analises: $totalAnalyses)"
Write-Host "  OK              : $totalOk"
Write-Host "  Missing         : $totalMissing"
Write-Host "  Divergence      : $totalDiverg"
Write-Host "  Total problemas : $totalProblems  ($pctProblems%)"
Write-Host "  Output CSV      : $OutputCsv"
Write-Host "  Hora fim        : $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
Write-Host ''

# ---------------------------------------------------------------------------
# Exit code
# ---------------------------------------------------------------------------

if ($totalProblems -eq 0) {
    Write-Ok 'STATUS: OK -- sem divergencias. Importacao perfeita.'
    Write-Host ''
    exit 0
}

if ($pctProblems -lt 5.0) {
    Write-Warn "STATUS: WARN -- $pctProblems% de divergencias/ausentes (< 5%). Revisar com gestor antes de prosseguir."
    Write-Host ''
    exit 1
}

Write-Fail "STATUS: FAIL -- $pctProblems% de divergencias/ausentes (>= 5%). NAO prosseguir sem investigar."
Write-Host ''
exit 2
