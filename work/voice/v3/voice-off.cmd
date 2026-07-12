@echo off
rem Alex Voice v3 - turn spoken replies OFF (removes the flag; hooks exit instantly).
del /q "%~dp0..\..\..\outputs\voice\voice-on.flag" 2>nul
echo Alex voice: OFF.
