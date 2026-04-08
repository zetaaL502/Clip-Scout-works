@echo off
echo --- STARTING BACKEND (Clip-Scout-works-2) ---
cd /d "C:\Users\Galaxy\Clip-Scout-works-2\artifacts\api-server"
start "Backend (Clip-Scout-works-2)" pnpm run dev
timeout /t 3
echo --- STARTING FRONTEND (Clip-Scout-works-2) (PORT 3001) ---
cd /d "C:\Users\Galaxy\Clip-Scout-works-2\artifacts\clipscout"
set PORT=3001
set BASE_PATH=/
start "Frontend (Clip-Scout-works-2)" pnpm run dev