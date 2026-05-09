#!/usr/bin/env bash

echo ""
echo " ===================================================================="
echo "   MarketIntel  --  AI Investment   &  Prediction Intelligence"
echo " ===================================================================="
echo ""

# ─── Python check ───────────────────────────────────────────────────────────
if ! command -v python3 &> /dev/null; then
    if ! command -v python &> /dev/null; then
        echo -e "\033[0;31m [ERROR] Python not found.\033[0m"
        echo ""
        echo " Install Python 3.11+ from https://python.org"
        echo ""
        exit 1
    else
        PYTHON_CMD="python"
    fi
else
    PYTHON_CMD="python3"
fi

PY_VER=$($PYTHON_CMD --version 2>&1)
echo " [OK] $PY_VER"

# ─── Node.js check ──────────────────────────────────────────────────────────
if ! command -v node &> /dev/null; then
    echo -e "\033[0;31m [ERROR] Node.js not found.\033[0m"
    echo ""
    echo " Install LTS version from https://nodejs.org"
    echo ""
    exit 1
fi

NODE_VER=$(node --version 2>&1)
echo " [OK] Node.js $NODE_VER"

# ─── .env check ─────────────────────────────────────────────────────────────
echo ""
if [ ! -f "backend/.env" ]; then
    echo -e "\033[0;33m [WARN] No backend/.env file found.\033[0m"
    echo ""
    echo "        AI features need an LLM key.  Create backend/.env with:"
    echo "          ANTHROPIC_API_KEY=sk-ant-..."
    echo "        or:"
    echo "          OPENAI_API_KEY=sk-..."
    echo ""
    echo "        The app will still launch -- add your key via Settings in the UI."
    echo ""
else
    echo " [OK] backend/.env found"
fi

# ─── Python packages ────────────────────────────────────────────────────────
if ! $PYTHON_CMD -m pip show fastapi &> /dev/null; then
    echo " Installing Python packages (first run -- ~30 seconds)..."
    if ! $PYTHON_CMD -m pip install -r backend/requirements.txt; then
        echo -e "\033[0;31m\n [ERROR] pip install failed.\033[0m"
        echo " Try manually:  $PYTHON_CMD -m pip install -r backend/requirements.txt"
        echo ""
        exit 1
    fi
    echo " [OK] Python packages installed"
else
    echo " [OK] Python packages ready"
fi

# ─── Node packages (root) ───────────────────────────────────────────────────
if [ ! -d "node_modules" ]; then
    echo " Installing root Node packages..."
    if ! npm install; then
        echo -e "\033[0;31m [ERROR] npm install failed (root)\033[0m"
        exit 1
    fi
fi

# ─── Node packages (frontend) ───────────────────────────────────────────────
if [ ! -d "frontend/node_modules" ]; then
    echo " Installing frontend Node packages..."
    cd frontend || exit 1
    if ! npm install; then
        echo -e "\033[0;31m [ERROR] npm install failed (frontend)\033[0m"
        cd ..
        exit 1
    fi
    cd ..
fi
echo " [OK] Node packages ready"

# ─── Launch ─────────────────────────────────────────────────────────────────
echo ""
echo " ===================================================================="
echo "   Starting servers..."
echo ""
echo "   Backend API   ->  http://localhost:2860"
echo "   Frontend UI   ->  http://localhost:5173"
echo ""
echo "   Open http://localhost:5173 in your browser."
echo "   Press Ctrl+C to stop both servers."
echo " ===================================================================="
echo ""

npm run dev || {
    echo -e "\033[0;31m"
    echo " ===================================================================="
    echo "   [ERROR] A server crashed.  Read the output above for details."
    echo ""
    echo "   Common fixes:"
    echo "     - Port 2860 in use: close other MarketIntel windows"
    echo "     - Missing API key:  add ANTHROPIC_API_KEY to backend/.env"
    echo "     - Bad packages:     run  $PYTHON_CMD -m pip install -r backend/requirements.txt"
    echo "     - Frontend error:   run  cd frontend && npm install"
    echo " ===================================================================="
    echo -e "\033[0m"
    exit 1
}
