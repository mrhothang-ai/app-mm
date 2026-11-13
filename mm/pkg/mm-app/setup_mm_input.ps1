# Hoi thong tin cai dat lan dau, kiem tra hop le, ghi file mm_init.env (xoa ngay sau khi dung).
param([string]$Out = "mm_init.env")
$ErrorActionPreference = "Stop"
function Plain($s) { [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)) }
function Ask($label, $def) { $v = Read-Host "$label$(if ($def) { " [$def]" })"; if (-not $v) { $v = $def }; return $v.Trim() }
$bad = "['""``$\\%!&|<>^]"
Write-Host ""
Write-Host "--- 1. Superuser PocketBase (quan tri he thong, trang /_/) ---"
do { $email = Ask "  Email superuser" "ho@ilsung.vn"; $ok = $email -match '^[^@\s]+@[^@\s]+\.[^@\s]+$'; if (-not $ok) { Write-Host "  Email khong hop le" -ForegroundColor Red } } until ($ok)
do {
  $p1 = Plain (Read-Host "  Mat khau superuser (>= 10 ky tu, khong dung ' "" $ \ % ! & | < > ^)" -AsSecureString)
  $p2 = Plain (Read-Host "  Nhap lai mat khau" -AsSecureString)
  $ok = $p1.Length -ge 10 -and $p1 -eq $p2 -and $p1 -notmatch $bad
  if (-not $ok) { Write-Host "  Mat khau qua ngan, chua khop hoac co ky tu khong dung duoc" -ForegroundColor Red }
} until ($ok)
Write-Host ""
Write-Host "--- 2. Tai khoan Quan tri app dau tien (dang nhap app bang Ma NV + mat khau) ---"
do { $user = (Ask "  Ma NV" "").ToUpper(); $ok = $user -match '^[A-Z0-9._-]{2,30}$'; if (-not $ok) { Write-Host "  Ma NV chi gom chu, so, . _ - (2-30 ky tu)" -ForegroundColor Red } } until ($ok)
$name = Ask "  Ho ten" "Quan tri"
if ($name -match $bad) { $name = "Quan tri" }
do {
  $pw1 = Plain (Read-Host "  Mat khau dang nhap app (>= 8 ky tu, co chu va so)" -AsSecureString)
  $pw2 = Plain (Read-Host "  Nhap lai mat khau" -AsSecureString)
  $ok = $pw1.Length -ge 8 -and $pw1.Length -le 64 -and $pw1 -match '[A-Za-z]' -and $pw1 -match '[0-9]' -and $pw1 -eq $pw2 -and $pw1 -notmatch $bad
  if (-not $ok) { Write-Host "  Mat khau phai 8-64 ky tu, co chu va so, 2 lan giong nhau, khong dung ' "" $ \ % ! & | < > ^" -ForegroundColor Red }
} until ($ok)
$lines = @("SU_EMAIL='$email'", "SU_PASS='$p1'", "ADMIN_USER='$user'", "ADMIN_PASS='$pw1'", "ADMIN_NAME='$name'")
[IO.File]::WriteAllText($Out, ($lines -join "`n") + "`n", (New-Object Text.UTF8Encoding $false))
Write-Host ""
Write-Host "Da ghi thong tin. Superuser: $email  |  Admin app: $user" -ForegroundColor Green
exit 0
