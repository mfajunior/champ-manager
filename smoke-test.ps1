# smoke-test.ps1
# Roda o fluxo completo da API contra o backend local e confere as regras de negocio.
# Uso:  .\smoke-test.ps1
#
# Nao usa acento de proposito: evita problema de encoding do console do PowerShell.

$ErrorActionPreference = 'Stop'
$base = 'http://localhost:5000/api'

function Api {
    param(
        [string]$Method,
        [string]$Path,
        [hashtable]$Body,
        [string]$Token
    )
    $headers = @{}
    if ($Token) { $headers['Authorization'] = "Bearer $Token" }

    $params = @{
        Method      = $Method
        Uri         = "$base$Path"
        Headers     = $headers
        ContentType = 'application/json; charset=utf-8'
    }
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
try {
    $auth = Api POST '/auth/register' $cred
    Write-Host '    usuario criado'
} catch {
    $auth = Api POST '/auth/login' @{ email = $cred.email; password = $cred.password }
    Write-Host '    login com usuario ja existente'
}
$token = $auth.data.token
if (-not $token) { Bad 'token nao veio na resposta'; exit 1 }
Write-Host "    token: $($token.Substring(0, 30))..."

# Confere que o token carrega 'id' (e nao 'userId'): se o payload estiver errado,
# req.user.id vira undefined e created_by grava NULL sem ninguem perceber.
$payload = $token.Split('.')[1].Replace('-', '+').Replace('_', '/')
while ($payload.Length % 4) { $payload += '=' }
$claims = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($payload)) | ConvertFrom-Json
if ($claims.id) { Ok "payload do JWT tem id=$($claims.id)" }
else { Bad 'payload do JWT nao tem a claim id - authController desatualizado'; $falhas++ }

# -------------------------------------------------------- 2. CAMPEONATO
Step 2 'Criando campeonato'
$champ = Api POST '/championships' @{
    name     = 'Smoke Championship'
    date     = '2026-10-10'
    location = 'Box Teste'
} $token
$champId = $champ.data.id
$cats = $champ.data.categories
Write-Host "    campeonato id=$champId"
foreach ($c in $cats) {
    Write-Host ("    id={0,-4} {1,-22} level={2,-10} gender={3}" -f $c.id, $c.name, $c.level, $c.gender)
}
if ($cats.Count -eq 5) { Ok '5 categorias criadas' } else { Bad "esperava 5 categorias, veio $($cats.Count)"; $falhas++ }
if ($cats[0].level -and $cats[0].gender) { Ok 'gender e level preenchidos' }
else { Bad 'gender/level vieram nulos'; $falhas++ }

$cat  = $cats[0]
$cat2 = $cats[1]

# ------------------------------------------------------------ 3. EQUIPES
Step 3 "Registrando 6 equipes em '$($cat.name)'"
1..6 | ForEach-Object {
    $t = Api POST '/teams' @{
        championship_id = $champId
        category_id     = $cat.id
        name            = "Equipe $_"
    } $token
    Write-Host "    id=$($t.data.id) $($t.data.name)"
}

# ------------------------------------------------- 4. REGRA DO NOME UNICO
Step 4 'Conferindo a regra de nome por categoria'
try {
    Api POST '/teams' @{ championship_id = $champId; category_id = $cat.id; name = 'Equipe 1' } $token | Out-Null
    Bad 'aceitou nome duplicado DENTRO da mesma categoria'; $falhas++
} catch {
    Ok 'nome duplicado na mesma categoria foi rejeitado'
}
try {
    $t = Api POST '/teams' @{ championship_id = $champId; category_id = $cat2.id; name = 'Equipe 1' } $token
    Ok "mesmo nome aceito em '$($cat2.name)' (id=$($t.data.id))"
} catch {
    Bad 'rejeitou o mesmo nome em outra categoria - constraint 002 nao aplicada'; $falhas++
}

# -------------------------------------------------------------- 5. PROVA
Step 5 'Criando prova'
$w = Api POST '/workouts' @{
    championship_id = $champId
    workout_number  = 1
    name            = 'Abertura'
    type            = 'amrap'
} $token
$workoutId = $w.data.id
Ok "prova id=$workoutId numero=$($w.data.workout_number)"

try {
    Api POST '/workouts' @{ championship_id = $champId; workout_number = 1; name = 'Repetida' } $token | Out-Null
    Bad 'aceitou duas provas com o mesmo numero'; $falhas++
} catch {
    Ok 'prova com numero repetido rejeitada'
}

# ----------------------------------------------------------- 6. VARIANTES
Step 6 'Escrevendo a variante de cada categoria'
foreach ($c in $cats) {
    $carga = switch ($c.level) {
        'iniciante' { '30kg' }
        'scale'     { '35kg' }
        default     { '43kg' }
    }
    Api PUT "/workouts/$workoutId/variants/$($c.id)" @{
        description      = "12 min AMRAP - Thruster $carga + Pull-up ($($c.name))"
        time_cap_seconds = 720
    } $token | Out-Null
    Write-Host "    $($c.name): thruster $carga"
}

$detalhe = Api GET "/workouts/$workoutId"
if ($detalhe.data.variants.Count -eq 5) { Ok '5 variantes gravadas e retornadas no detalhe da prova' }
else { Bad "esperava 5 variantes, veio $($detalhe.data.variants.Count)"; $falhas++ }

# Idempotencia: reescrever a mesma variante nao pode criar uma segunda linha
Api PUT "/workouts/$workoutId/variants/$($cat.id)" @{ description = 'Descricao corrigida' } $token | Out-Null
$detalhe2 = Api GET "/workouts/$workoutId"
if ($detalhe2.data.variants.Count -eq 5) { Ok 'PUT repetido atualizou no lugar de duplicar' }
else { Bad 'PUT repetido duplicou a variante'; $falhas++ }

# ------------------------------------------------------------ 7. BATERIAS
Step 7 'Gerando baterias - 6 equipes em box de 4 raias'
$heats = Api POST "/workouts/$workoutId/heats" @{
    category_id    = $cat.id
    lanes_per_heat = 4
} $token

Write-Host "    $($heats.meta.heatsCreated) bateria(s) para $($heats.meta.totalTeams) equipes"
foreach ($h in $heats.data) {
    Write-Host "    Bateria $($h.heat_number): $($h.lanes_used) equipes, $($h.lanes_empty) raia(s) vaga(s)"
    foreach ($lane in $h.teams) {
        Write-Host "        raia $($lane.lane_number) -> $($lane.team_name)"
    }
}

$tamanhos = $heats.data | ForEach-Object { $_.lanes_used }
if ($heats.data.Count -eq 2) { Ok '2 baterias' } else { Bad "esperava 2 baterias, veio $($heats.data.Count)"; $falhas++ }
if (($tamanhos | Sort-Object -Unique).Count -eq 1 -and $tamanhos[0] -eq 3) {
    Ok 'distribuicao equilibrada 3+3 (e nao 4+2)'
} else {
    Bad "distribuicao desequilibrada: $($tamanhos -join '+')"; $falhas++
}

# Regerar sem resultados lancados deve funcionar sem exigir force
try {
    Api POST "/workouts/$workoutId/heats" @{ category_id = $cat.id; lanes_per_heat = 3 } $token | Out-Null
    Ok 'regerou as baterias (ainda nao ha resultados lancados)'
} catch {
    Bad 'bloqueou a regeracao sem ter resultado nenhum'; $falhas++
}

# --------------------------------------------------------- 8. VALIDACOES
Step 8 'Validacoes de borda'
try {
    Api POST "/workouts/$workoutId/heats" @{ category_id = $cat.id; lanes_per_heat = 0 } $token | Out-Null
    Bad 'aceitou lanes_per_heat = 0'; $falhas++
} catch { Ok 'lanes_per_heat = 0 rejeitado' }

try {
    Api POST '/teams' @{ championship_id = $champId; category_id = 99999; name = 'Fantasma' } $token | Out-Null
    Bad 'aceitou categoria inexistente'; $falhas++
} catch { Ok 'categoria inexistente rejeitada' }

try {
    Api POST '/championships' @{ name = 'Sem token'; date = '2026-10-10'; location = 'X' } | Out-Null
    Bad 'criou campeonato SEM token'; $falhas++
} catch { Ok 'rota protegida recusou requisicao sem token' }

# ------------------------------------------------------------- RESULTADO
Write-Host ''
if ($falhas -eq 0) {
    Write-Host '=== TUDO PASSOU ===' -ForegroundColor Green
} else {
    Write-Host "=== $falhas FALHA(S) ===" -ForegroundColor Red
}
Write-Host "Campeonato de teste: id=$champId  (DELETE /api/championships/$champId limpa tudo)"
