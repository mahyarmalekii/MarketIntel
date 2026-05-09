@echo off
setlocal enabledelayedexpansion
title MarketIntel Launcher
color 0A

echo.
echo  ====================================================================
echo    MarketIntel  --  AI Investment   ^&  Prediction Intelligence
echo  ====================================================================
echo.

:: ─── Python check ───────────────────────────────────────────────────────────
where python >nul 2>&1
if errorlevel 1 (
    color 0C
    echo  [ERROR] Python not found.
    echo.
    echo  Install Python 3.11+ from https://python.org
    echo  IMPORTANT: check "Add Python to PATH" during installation.
    echo.
    pause
    exit /b 1
)
for /f "tokens=*" %%i in ('python --version 2^>^&1') do set PY_VER=%%i
echo  [OK] %PY_VER%

:: ─── Node.js check ──────────────────────────────────────────────────────────
where node >nul 2>&1
if errorlevel 1 (
    color 0C
    echo  [ERROR] Node.js not found.
    echo.
    echo  Install LTS version from https://nodejs.org
    echo.
    pause
    exit /b 1
)
for /f "tokens=*" %%i in ('node --version 2^>^&1') do set NODE_VER=%%i
echo  [OK] Node.js %NODE_VER%

:: ─── .env check ─────────────────────────────────────────────────────────────
echo.
if not exist "backend\.env" (
    echo  [WARN] No backend\.env file found.
    echo.
    echo         AI features need an LLM key.  Create backend\.env with:
    echo           ANTHROPIC_API_KEY=sk-ant-...
    echo         or:
    echo           OPENAI_API_KEY=sk-...
    echo.
    echo         The app will still launch -- add your key via Settings in the UI.
    echo.
) else (
    echo  [OK] backend\.env found
)

:: ─── Python packages ────────────────────────────────────────────────────────
python -m pip show fastapi >nul 2>&1
if errorlevel 1 (
    echo  Installing Python packages (first run -- ~30 seconds)...
    python -m pip install -r backend\requirements.txt
    if errorlevel 1 (
        color 0C
        echo.
        echo  [ERROR] pip install failed.
        echo  Try manually:  python -m pip install -r backend\requirements.txt
        echo.
        pause
        exit /b 1
    )
    echo  [OK] Python packages installed
) else (
    echo  [OK] Python packages ready
)

:: ─── Node packages (root) ───────────────────────────────────────────────────
if not exist "node_modules\" (
    echo  Installing root Node packages...
    call npm install
    if errorlevel 1 (
        color 0C
        echo  [ERROR] npm install failed (root^)
        pause
        exit /b 1
    )
)

:: ─── Node packages (frontend) ───────────────────────────────────────────────
if not exist "frontend\node_modules\" (
    echo  Installing frontend Node packages...
    cd frontend
    call npm install
    cd ..
    if errorlevel 1 (
        color 0C
        echo  [ERROR] npm install failed (frontend^)
        pause
        exit /b 1
    )
)
echo  [OK] Node packages ready

:: ─── Launch ─────────────────────────────────────────────────────────────────
echo.
echo  ====================================================================
echo    Starting servers...
echo.
echo    Backend API   -^>  http://localhost:2860
echo    Frontend UI   -^>  http://localhost:5173
echo.
echo    Open http://localhost:5173 in your browser.
echo    Press Ctrl+C to stop both servers.
echo  ====================================================================
echo.

call npm run dev

:: ─── Crash handler ──────────────────────────────────────────────────────────
if errorlevel 1 (
    color 0C
    echo.
    echo  ====================================================================
    echo    [ERROR] A server crashed.  Read the output above for details.
    echo.
    echo    Common fixes:
    echo      - Port 2860 in use: close other MarketIntel windows
    echo      - Missing API key:  add ANTHROPIC_API_KEY to backend\.env
    echo      - Bad packages:     run  pip install -r backend\requirements.txt
    echo      - Frontend error:   run  cd frontend ^&^& npm install
    echo  ====================================================================
    echo.
    pause
)
