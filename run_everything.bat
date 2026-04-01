@echo off
:: Change this path if your folder does NOT have the -2
cd /d "C:\Users\Galaxy\Clip-Scout-works-2\artifacts\api-server"
start /b pnpm run dev

cd /d "C:\Users\Galaxy\Clip-Scout-works-2\artifacts\clipscout"
set PORT=3001
set BASE_PATH=/
start /b pnpm run dev