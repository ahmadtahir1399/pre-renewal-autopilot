# Public-file hygiene scan (PowerShell, Select-String). Run from anywhere:
#   powershell -ExecutionPolicy Bypass -File scripts\hygiene.ps1
# Scans every TRACKED file and the whole git HISTORY. Blocked terms are read from the gitignored file
# docs\private\blocked-terms.txt, so this script itself never contains them. Every hit is printed for review;
# known, explained hits (test sentinels, example domains) are labelled, not hidden.

Set-Location (Split-Path -Parent $PSScriptRoot)
$termsFile = 'docs\private\blocked-terms.txt'
$found = 0
function Report($label, $hits) {
  $list = @($hits | Where-Object { $_ })
  if ($list.Count -eq 0) { Write-Host "PASS  $label" -ForegroundColor Green }
  else { Write-Host "HITS  $label ($($list.Count))" -ForegroundColor Yellow; $list | ForEach-Object { Write-Host "      $_" }; $script:found += $list.Count }
}

$tracked = git ls-files | Where-Object { Test-Path $_ -PathType Leaf }
$commits = git rev-list --all

# 1. Blocked terms (working tree + history)
if (Test-Path $termsFile) {
  $terms = Get-Content $termsFile | Where-Object { $_ -match '^[iw]:' }
  foreach ($t in $terms) {
    $mode = $t.Substring(0, 1); $term = $t.Substring(2)
    if ($mode -eq 'i') {
      $now = $tracked | Select-String -SimpleMatch -Pattern $term -List | ForEach-Object { "$($_.Path):$($_.LineNumber)" }
      $hist = $commits | ForEach-Object { git grep -I -l -i -F -e $term $_ 2>$null } | Sort-Object -Unique
    } else {
      $pattern = "\b$([regex]::Escape($term))\b"
      $now = $tracked | Select-String -CaseSensitive -Pattern $pattern -List | ForEach-Object { "$($_.Path):$($_.LineNumber)" }
      $hist = $commits | ForEach-Object { git grep -I -l -w -F -e $term $_ 2>$null } | Sort-Object -Unique
    }
    Report "blocked term #$([array]::IndexOf($terms, $t) + 1) in tracked files" $now
    Report "blocked term #$([array]::IndexOf($terms, $t) + 1) in git history" $hist
  }
} else {
  Write-Host "SKIP  blocked terms: $termsFile not found (create it; it is gitignored)" -ForegroundColor Yellow
}

# 2. Secret shapes. Known test sentinels (SENTINEL in the value) are labelled.
$key = 'sk-[A-Za-z0-9_-]{16,}'
$bot = '\b\d{6,12}:[A-Za-z0-9_-]{30,}\b'
foreach ($p in @(@('API-key-shaped string', $key), @('bot-token-shaped string', $bot))) {
  $now = $tracked | Select-String -Pattern $p[1] | ForEach-Object { $tag = if ($_.Line -match 'SENTINEL|sk-\[|\\d') { ' [test sentinel / pattern, expected]' } else { '' }; "$($_.Path):$($_.LineNumber)$tag" }
  Report "$($p[0]) in tracked files" $now
  $hist = git log --all -p --no-color | Select-String -Pattern $p[1] | Where-Object { $_.Line -notmatch 'SENTINEL|sk-\[|\\d' } | ForEach-Object { $_.Line.Trim().Substring(0, [Math]::Min(80, $_.Line.Trim().Length)) }
  Report "$($p[0]) in git history (excluding test sentinels and regex patterns)" $hist
}

# 3. Email addresses that are not example.com (or the reserved .example / .invalid names)
$email = '[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}'
$now = $tracked | Where-Object { $_ -ne 'package-lock.json' } | Select-String -Pattern $email -AllMatches | ForEach-Object { foreach ($m in $_.Matches) { if ($m.Value -notmatch '@(example\.com|[a-z0-9-]+\.example|example\.invalid)$') { "$($_.Path):$($_.LineNumber) $($m.Value)" } } }
Report 'non-example.com email in tracked files' $now
$hist = $commits | ForEach-Object { git grep -I -o -E -e '[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}' $_ -- . ':!package-lock.json' 2>$null } | ForEach-Object { ($_ -split ':', 2)[1] } | Where-Object { $_ -notmatch '@(example\.com|[a-z0-9-]+\.example|example\.invalid)$' } | Sort-Object -Unique
Report 'non-example.com email in file contents anywhere in history (path:address)' $hist
Report 'commit author/committer emails (shown for your review)' (git log --all --format='%ae%n%ce' | Sort-Object -Unique)

# 4. Files that must never be tracked (now or ever)
$bad = '^(\.env$|\.env\.|\.cache/|runtime/|output/|data/|reports/raw/|docs/private/|\.vitest/|.*\.db$)'
Report 'forbidden file tracked now' (git ls-files | Where-Object { $_ -ne '.env.example' } | Select-String -Pattern $bad | ForEach-Object { $_.Line })
Report 'forbidden file ever committed' (git log --all --name-only --pretty=format: | Where-Object { $_ -and $_ -ne '.env.example' } | Select-String -Pattern $bad | ForEach-Object { $_.Line } | Sort-Object -Unique)

# 5. .gitignore covers the essentials
$ignore = Get-Content .gitignore
$missing = @('.env', 'output/', '.cache/', 'runtime/', 'reports/*', 'docs/private/', '.vitest/') | Where-Object { $ignore -notcontains $_ }
Report '.gitignore entries missing' $missing

Write-Host ''
Write-Host "Total hits to review: $found"
