@echo off
echo --- STARTING BACKEND (Clip-Scout-works-1) ---
cd /d "%~dp0artifacts\api-server"
start "Backend" cmd /k "set PORT=8080&& pnpm run dev"
timeout /t 3 > nul
echo --- STARTING FRONTEND (Clip-Scout-works-1) (PORT 3001) ---
cd /d "%~dp0artifacts\clipscout"
start "Frontend" cmd /k "set PORT=3001&& set BASE_PATH=/&& pnpm run dev"
