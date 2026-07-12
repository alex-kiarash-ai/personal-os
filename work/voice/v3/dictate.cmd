@echo off
rem Alex Voice v3 - trilingual dictation lane (whisper, local, no Enter injected).
rem Runs windowless so focus stays on the terminal you pressed the hotkey from.
start "" "%~dp0..\.venv\Scripts\pythonw.exe" "%~dp0dictate.py"
