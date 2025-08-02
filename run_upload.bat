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
echo Press any key to close this window...
echo ================================================
pause