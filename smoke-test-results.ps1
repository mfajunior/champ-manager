# smoke-test-results.ps1
# Testa o fluxo de resultados: lancar desempenho bruto, empate, DNF, correcao
# e a protecao contra lancamento duplicado. Roda contra o backend local.
# Uso:  .\smoke-test-results.ps1

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

# ------------------------------------------------------- 2. SETUP: campeonato, time, prova
Step 2 'Montando o cenario: campeonato, 4 equipes, prova FOR_TIME'
$champ = Api POST '/championships' @{ name = 'Smoke Results'; date = '2026-11-01'; location = 'Box Teste' } $token
$champId = $champ.data.id
$cat = $champ.data.categories[0]
Write-Host "    campeonato id=$champId, categoria='$($cat.name)' id=$($cat.id)"

$teamIds = @()
'A', 'B', 'C', 'D' | ForEach-Object {
    $t = Api POST '/teams' @{ championship_id = $champId; category_id = $cat.id; name = "Equipe $_" } $token
    $teamIds += $t.data.id
}
Ok "4 equipes registradas"

$w = Api POST '/workouts' @{ championship_id = $champId; workout_number = 1; name = 'Prova FT'; type = 'for_time' } $token
$workoutId = $w.data.id

# scoring_type default e 'time' (nao exposto no create ainda) - confere direto no GET
$wDetail = Api GET "/workouts/$workoutId"
Write-Host "    prova id=$workoutId, scoring_type=$($wDetail.data.scoring_type)"

Api PUT "/workouts/$workoutId/variants/$($cat.id)" @{ description = '12 min AMRAP teste' } $token | Out-Null

$heats = Api POST "/workouts/$workoutId/heats" @{ category_id = $cat.id; lanes_per_heat = 4 } $token
$heat = $heats.data[0]
Ok "1 bateria gerada com $($heat.lanes_used) equipes"

# ------------------------------------------------- 3. PEGAR heat_team_id
Step 3 'Buscando heat_team_id de cada equipe (via GET heats)'
$heatsDetail = Api GET "/workouts/$workoutId/heats"
$lanes = $heatsDetail.data[0].teams
foreach ($l in $lanes) {
    Write-Host "    raia $($l.lane_number) -> $($l.team_name) (heat_team_id=$($l.heat_team_id))"
}
if ($lanes[0].heat_team_id) { Ok 'heat_team_id presente na resposta (bug do heatController corrigido)' }
else { Bad 'heat_team_id ausente - a correcao do heatController.getByWorkout nao pegou'; $falhas++ }

$htA = ($lanes | Where-Object { $_.team_name -eq 'Equipe A' }).heat_team_id
$htB = ($lanes | Where-Object { $_.team_name -eq 'Equipe B' }).heat_team_id
$htC = ($lanes | Where-Object { $_.team_name -eq 'Equipe C' }).heat_team_id
$htD = ($lanes | Where-Object { $_.team_name -eq 'Equipe D' }).heat_team_id

# ------------------------------------------------- 4. LANCAR RESULTADOS
Step 4 'Lancando resultados: A=600s, B=600s (empate), C=500s (melhor), D=DNF'
$rA = Api POST '/results' @{ heat_team_id = $htA; raw_value = 600 } $token
$rB = Api POST '/results' @{ heat_team_id = $htB; raw_value = 600 } $token
$rC = Api POST '/results' @{ heat_team_id = $htC; raw_value = 500 } $token
$rD = Api POST '/results' @{ heat_team_id = $htD; did_not_finish = $true } $token

Write-Host "    place no momento do POST -> A=$($rA.data.place) B=$($rB.data.place) C=$($rC.data.place) D=$($rD.data.place)"
if ($rC.data.place -eq 1) { Ok 'C (500s) ja volta com place=1 no proprio POST (segundo SELECT funcionando)' }
else { Bad "C deveria ja vir com place=1, veio $($rC.data.place)"; $falhas++ }

# --------------------------------------------------- 5. CONFERIR RANKING
Step 5 'Conferindo o ranking completo (esperado: C=1, A=2, B=2, D=4)'
$ranking = Api GET "/results?workout_id=$workoutId&category_id=$($cat.id)"
foreach ($r in $ranking.data) {
    Write-Host ("    place={0}  {1,-10} raw_value={2}  dnf={3}" -f $r.place, $r.team_name, $r.raw_value, $r.did_not_finish)
}
$byName = @{}
$ranking.data | ForEach-Object { $byName[$_.team_name] = $_.place }
if ($byName['Equipe C'] -eq 1 -and $byName['Equipe A'] -eq 2 -and $byName['Equipe B'] -eq 2 -and $byName['Equipe D'] -eq 4) {
    Ok 'ranking correto: empate dividindo posicao, DNF por ultimo, RANK pulando de 2 para 4'
} else {
    Bad 'ranking nao bateu com o esperado'; $falhas++
}

# ------------------------------------------------------ 6. VALIDACOES
Step 6 'Validacoes de borda'
try {
    Api POST '/results' @{ heat_team_id = $htA; raw_value = 999 } $token | Out-Null
    Bad 'aceitou um segundo resultado para o mesmo heat_team_id'; $falhas++
} catch { Ok 'lancamento duplicado na mesma bateria rejeitado (409)' }

try {
    Api POST '/results' @{ heat_team_id = $htB; raw_value = 500; did_not_finish = $true } $token | Out-Null
    Bad 'aceitou raw_value e did_not_finish juntos'; $falhas++
} catch { Ok 'raw_value + did_not_finish juntos rejeitado' }

try {
    Api POST '/results' @{ heat_team_id = 999999; raw_value = 500 } $token | Out-Null
    Bad 'aceitou heat_team_id inexistente'; $falhas++
} catch { Ok 'heat_team_id inexistente rejeitado' }

# --------------------------------------------------------- 7. CORRECAO
Step 7 'Corrigindo D de DNF para 400s (deve virar 1o lugar sozinho)'
Api PUT "/results/$($rD.data.id)" @{ raw_value = 400; did_not_finish = $false } $token | Out-Null
$ranking2 = Api GET "/results?workout_id=$workoutId&category_id=$($cat.id)"
$byName2 = @{}
$ranking2.data | ForEach-Object { $byName2[$_.team_name] = $_.place }
foreach ($r in $ranking2.data) {
    Write-Host ("    place={0}  {1,-10} raw_value={2}" -f $r.place, $r.team_name, $r.raw_value)
}
if ($byName2['Equipe D'] -eq 1 -and $byName2['Equipe C'] -eq 2) {
    Ok 'UPDATE recalculou o ranking corretamente apos a correcao'
} else {
    Bad 'ranking nao recalculou certo apos o UPDATE'; $falhas++
}

# ----------------------------------------------------------- 8. DELETE
Step 8 'Removendo o resultado de C (lancado por engano) e conferindo recalculo'
Api DELETE "/results/$($rC.data.id)" $token | Out-Null
$ranking3 = Api GET "/results?workout_id=$workoutId&category_id=$($cat.id)"
Write-Host "    resultados restantes: $($ranking3.data.Count)"
$byName3 = @{}
$ranking3.data | ForEach-Object { $byName3[$_.team_name] = $_.place }
if ($ranking3.data.Count -eq 3 -and $byName3['Equipe D'] -eq 1 -and $byName3['Equipe A'] -eq 2 -and $byName3['Equipe B'] -eq 2) {
    Ok 'DELETE recalculou o ranking sem a equipe C (place ajustado, sem gap)'
} else {
    Bad 'ranking nao recalculou certo apos o DELETE'; $falhas++
}

# ------------------------------------------------------------- RESULTADO
Write-Host ''
if ($falhas -eq 0) { Write-Host '=== TUDO PASSOU ===' -ForegroundColor Green }
else { Write-Host "=== $falhas FALHA(S) ===" -ForegroundColor Red }
Write-Host "Campeonato de teste: id=$champId  (DELETE /api/championships/$champId limpa tudo)"
