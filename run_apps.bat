@echo off
echo --- STARTING BACKEND ---
cd /d "C:\Users\Galaxy\Clip-Scout-works-2\artifacts\api-server"
start /b "" "C:\Users\Galaxy\AppData\Roaming\npm\pnpm.cmd" run dev
echo Backend starting in background...
timeout /t 5
echo --- STARTING FRONTEND (PORT 3001) ---
cd /d "C:\Users\Galaxy\Clip-Scout-works-2\artifacts\clipscout"
set PORT=3001
set BASE_PATH=/
"C:\Users\Galaxy\AppData\Roaming\npm\pnpm.cmd" run dev
