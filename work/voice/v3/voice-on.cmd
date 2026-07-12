@echo off
rem Alex Voice v3 - turn spoken replies ON (creates the flag the Stop hook gates on).
if not exist "%~dp0..\..\..\outputs\voice" mkdir "%~dp0..\..\..\outputs\voice"
echo on> "%~dp0..\..\..\outputs\voice\voice-on.flag"
echo Alex voice: ON (replies will be spoken aloud in Claude Code sessions).
