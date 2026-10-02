@echo off
REM ============================================================
REM  Readit Exam Feed — GitHub push helper
REM  Repo folder: C:\Pdf Reader\exam-feed-repo  (already committed)
REM  Ye script: gh login check → repo create → push → feed URL print
REM ============================================================
cd /d "%~dp0"

where gh >nul 2>nul
if errorlevel 1 (
  echo GitHub CLI ^(gh^) installed nahi hai. Pehle install karo:
  echo   https://cli.github.com/
  pause
  exit /b 1
)

gh auth status >nul 2>&1
if errorlevel 1 (
  echo GitHub login karo — browser khulega:
  call gh auth login
)

set "REPO=readit-exam-feed"
set /p REPO_INPUT=GitHub repo naam [Enter = readit-exam-feed]: 
if not "%REPO_INPUT%"=="" set "REPO=%REPO_INPUT%"

echo.
echo Repo "%REPO%" create + push ho raha hai...
call gh repo create %REPO% --public --source . --remote origin --push
if errorlevel 1 (
  echo Push fail hua — remote pehle se laga ho to sirf ye chalao: git push -u origin main
  pause
  exit /b 1
)

for /f "delims=" %%i in ('gh api user -q .login') do set "GH_USER=%%i"

echo.
echo ============================================================
echo  DONE! Ab ye URL copy karo:
echo.
echo  https://raw.githubusercontent.com/%GH_USER%/%REPO%/main/exam-feed/feeds/job_bulletins.json
echo.
echo  Aur Readit app me paste karo:
echo  Home ^> Tools ^> 🚀 Form Vault ^> My Exam Bulletins ^> 🤖 Crawler Feed Sync box
echo ============================================================
pause
