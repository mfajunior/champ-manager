# smoke-test-leaderboard.ps1
# Testa o scoring_type (agora aceito no create/update de workouts) e o
# leaderboard (team_standings), incluindo o caso AMRAP (reps, maior vence).
# Uso:  .\smoke-test-leaderboard.ps1

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

function Step { param($n, $msg) Write-Host "`n[$n] $msg" -ForegroundColor Cyan }
function Ok   { param($msg) Write-Host "    OK    $msg" -ForegroundColor Green }
function Bad  { param($msg) Write-Host "    FALHA $msg" -ForegroundColor Red }

$falhas = 0

# ---------------------------------------------------------------- 1. AUTH
Step 1 'Autenticando'
$cred = @{ email = 'smoke@champy.local'; password = 'smoke12345'; name = 'Smoke Test' }
try { $auth = Api POST '/auth/register' $cred }
catch { $auth = Api POST '/auth/login' @{ email = $cred.email; password = $cred.password } }
$token = $auth.data.token
Ok "autenticado"

# --------------------------------------------------- 2. SETUP: prova AMRAP
Step 2 'Montando o cenario: campeonato, 4 equipes, prova AMRAP (scoring_type=reps)'
$champ = Api POST '/championships' @{ name = 'Smoke Leaderboard'; date = '2026-11-01'; location = 'Box Teste' } $token
$champId = $champ.data.id
$cat = $champ.data.categories[0]

$teamIds = @()
'A', 'B', 'C', 'D' | ForEach-Object {
    $t = Api POST '/teams' @{ championship_id = $champId; category_id = $cat.id; name = "Equipe $_" } $token
    $teamIds += $t.data.id
}
Ok "4 equipes registradas"

$w = Api POST '/workouts' @{ championship_id = $champId; workout_number = 1; name = 'Prova AMRAP'; type = 'amrap'; scoring_type = 'reps' } $token
$workoutId = $w.data.id
if ($w.data.scoring_type -eq 'reps') { Ok "workout criado ja com scoring_type=reps (era o bug: sempre vinha 'time')" }
else { Bad "scoring_type deveria ser 'reps', veio '$($w.data.scoring_type)'"; $falhas++ }

$wDetail = Api GET "/workouts/$workoutId"
if ($wDetail.data.scoring_type -eq 'reps') { Ok "GET /workouts/:id tambem devolve scoring_type" }
else { Bad "GET /workouts/:id nao devolveu scoring_type corretamente"; $falhas++ }

try {
    Api POST '/workouts' @{ championship_id = $champId; workout_number = 2; name = 'Prova invalida'; scoring_type = 'pontos' } $token | Out-Null
    Bad 'aceitou scoring_type invalido'; $falhas++
} catch { Ok 'scoring_type invalido rejeitado' }

Api PUT "/workouts/$workoutId/variants/$($cat.id)" @{ description = '12 min AMRAP teste' } $token | Out-Null
$heats = Api POST "/workouts/$workoutId/heats" @{ category_id = $cat.id; lanes_per_heat = 4 } $token
$lanes = (Api GET "/workouts/$workoutId/heats").data[0].teams

$htA = ($lanes | Where-Object { $_.team_name -eq 'Equipe A' }).heat_team_id
$htB = ($lanes | Where-Object { $_.team_name -eq 'Equipe B' }).heat_team_id
$htC = ($lanes | Where-Object { $_.team_name -eq 'Equipe C' }).heat_team_id
$htD = ($lanes | Where-Object { $_.team_name -eq 'Equipe D' }).heat_team_id

# -------------------------------------------- 3. LANCAR REPS (maior vence)
Step 3 'Lancando reps: A=150, B=180 (melhor), C=180 (empate com B), D=DNF'
Api POST '/results' @{ heat_team_id = $htA; raw_value = 150 } $token | Out-Null
Api POST '/results' @{ heat_team_id = $htB; raw_value = 180 } $token | Out-Null
Api POST '/results' @{ heat_team_id = $htC; raw_value = 180 } $token | Out-Null
Api POST '/results' @{ heat_team_id = $htD; did_not_finish = $true } $token | Out-Null

$ranking = Api GET "/results?workout_id=$workoutId&category_id=$($cat.id)"
$byName = @{}
$ranking.data | ForEach-Object { $byName[$_.team_name] = $_.place }
foreach ($r in $ranking.data) {
    Write-Host ("    place={0}  {1,-10} raw_value={2}" -f $r.place, $r.team_name, $r.raw_value)
}
if ($byName['Equipe B'] -eq 1 -and $byName['Equipe C'] -eq 1 -and $byName['Equipe A'] -eq 3 -and $byName['Equipe D'] -eq 4) {
    Ok 'ranking por reps correto: maior numero vence (scoring_type=reps funcionando)'
} else {
    Bad 'ranking por reps nao bateu com o esperado (scoring_type pode nao estar sendo respeitado)'; $falhas++
}

# ------------------------------------------------------- 4. LEADERBOARD
Step 4 'Conferindo o leaderboard (team_standings)'
$lb = Api GET "/leaderboard?championship_id=$champId&category_id=$($cat.id)"
foreach ($l in $lb.data) {
    Write-Host ("    place={0}  {1,-10} total_score={2}  provas={3}" -f $l.place, $l.team_name, $l.total_score, $l.workouts_completed)
}
$lbByName = @{}
$lb.data | ForEach-Object { $lbByName[$_.team_name] = @{ place = $_.place; score = $_.total_score } }

# total_score = soma das colocacoes (menor eh melhor no standings, mesmo numa prova de reps,
# porque o que soma eh o PLACE, nao o raw_value). B e C empataram em place=1 na unica prova.
if ($lbByName['Equipe B'].score -eq 1 -and $lbByName['Equipe C'].score -eq 1 -and
    $lbByName['Equipe A'].score -eq 3 -and $lbByName['Equipe D'].score -eq 4) {
    Ok 'total_score do leaderboard bate com as colocacoes da prova'
} else {
    Bad 'total_score do leaderboard nao bateu com o esperado'; $falhas++
}
# ROW_NUMBER com desempate por team_id: sem empates no leaderboard final, sempre 1..4 sequencial.
$places = $lb.data.place | Sort-Object
if (($places -join ',') -eq '1,2,3,4') {
    Ok 'leaderboard nao tem buracos nem empates (ROW_NUMBER com desempate por team_id)'
} else {
    Bad "places do leaderboard vieram $($places -join ','), esperado 1,2,3,4"; $falhas++
}

Step 5 'Validacoes de borda do leaderboard'
try {
    Api GET "/leaderboard" | Out-Null
    Bad 'aceitou GET /leaderboard sem championship_id'; $falhas++
} catch { Ok 'championship_id ausente rejeitado (400)' }

try {
    Api GET "/leaderboard?championship_id=999999" | Out-Null
    Bad 'aceitou championship_id inexistente'; $falhas++
} catch { Ok 'championship_id inexistente rejeitado (404)' }

try {
    Api GET "/leaderboard?championship_id=$champId&category_id=999999" | Out-Null
    Bad 'aceitou category_id inexistente'; $falhas++
} catch { Ok 'category_id inexistente rejeitado (404)' }

# ------------------------------------------------------------- RESULTADO
Write-Host ''
if ($falhas -eq 0) { Write-Host '=== TUDO PASSOU ===' -ForegroundColor Green }
else { Write-Host "=== $falhas FALHA(S) ===" -ForegroundColor Red }
Write-Host "Campeonato de teste: id=$champId  (DELETE /api/championships/$champId limpa tudo)"
