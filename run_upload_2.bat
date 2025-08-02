@echo off
echo ================================================
echo ATHLETE CSV UPLOADER - BACKGROUND PROCESS
echo ================================================
echo Starting upload at %date% %time%
echo.

node athlete-csv-uploader.js

echo.
echo ================================================
echo Upload completed at %date% %time%
echo Window will close in 3 seconds...
echo ================================================
timeout /t 3 /nobreak >nul
exit