# Runs everything Prompt 1 built, then opens the three checkpoint PDFs.
# The project folder is the parent of this scripts folder (no machine-specific path).
Set-Location (Split-Path -Parent $PSScriptRoot)

Write-Host "`n=== 1. Config check ===" -ForegroundColor Cyan
npm run env:check

Write-Host "`n=== 2. Tests ===" -ForegroundColor Cyan
npm test

Write-Host "`n=== 3. Regenerate fixtures (must be byte-identical) ===" -ForegroundColor Cyan
npm run fixtures:generate
npm run fixtures:hash -- --check

Write-Host "`n=== 4. Verify fixtures ===" -ForegroundColor Cyan
npm run fixtures:verify

Write-Host "`n=== 5. Opening the three checkpoint PDFs ===" -ForegroundColor Cyan
Start-Process 'fixtures\documents\pol-s01\expiring.pdf'
Start-Process 'fixtures\documents\pol-s08\expiring.pdf'
Start-Process 'fixtures\documents\pol-s14\expiring.pdf'
Write-Host "Done." -ForegroundColor Green
