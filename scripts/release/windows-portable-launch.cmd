@echo off
"%DSH_RC_NODE%" --import "%DSH_RC_TSX_HOOK%" "%~dp0windows-portable-launch.ts" %*
exit /b %errorlevel%
