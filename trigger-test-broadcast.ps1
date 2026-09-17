# trigger-test-broadcast.ps1
# Dispara UM evento de leaderboard_updated num campeonato que ja existe, para
# testar o listener (test-websocket.js) sem precisar rodar o smoke test
# inteiro de novo. Pega o primeiro resultado ja lancado na primeira prova do
# campeonato e corrige o raw_value dele com um numero aleatorio.
#
# Uso: .\trigger-test-broadcast.ps1 <championship_id>

param(
    [Parameter(Mandatory = $true)]
    [int]$ChampionshipId
)

$ErrorActionPreference = 'Stop'
$base = 'http://localhost:5000/api'

function Api {
    param([string]$Method, [string]$Path, [hashtable]$Body, [string]$Token)
    $headers = @{}
    if ($Token) { $headers['Authorization'] = "Bearer $Token" }
    $params = @{ Method = $Method; Uri = "$base$Path"; Headers = $headers; ContentType = 'application/json; charset=utf-8' }
    if ($Body) {
        $json = $Body | ConvertTo-Json -Depth 6 -Compress
        $params['Body'] = [System.Text.Encoding]::UTF8.GetBytes($json)
    }
    Invoke-RestMethod @params
}

$cred = @{ email = 'smoke@champy.local'; password = 'smoke12345'; name = 'Smoke Test' }
try { $auth = Api POST '/auth/register' $cred }
catch { $auth = Api POST '/auth/login' @{ email = $cred.email; password = $cred.password } }
$token = $auth.data.token

$workouts = Api GET "/workouts?championship_id=$ChampionshipId"
if ($workouts.data.Count -eq 0) {
    Write-Host "Nenhuma prova encontrada no campeonato $ChampionshipId." -ForegroundColor Red
    exit 1
}
$workoutId = $workouts.data[0].id

$results = Api GET "/results?workout_id=$workoutId"
if ($results.data.Count -eq 0) {
    Write-Host "Nenhum resultado lancado na prova $workoutId ainda." -ForegroundColor Red
    exit 1
}
$r = $results.data[0]

$novoValor = Get-Random -Minimum 100 -Maximum 999
Write-Host "Corrigindo resultado id=$($r.id) (equipe $($r.team_name)) para raw_value=$novoValor..."
Api PUT "/results/$($r.id)" @{ raw_value = $novoValor } $token | Out-Null
Write-Host "Feito. Confira a janela do node test-websocket.js - deveria ter chegado um leaderboard_updated." -ForegroundColor Green
