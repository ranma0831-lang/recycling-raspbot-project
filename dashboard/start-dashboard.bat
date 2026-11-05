@echo off
rem 분리수거 로봇 대시보드 실행: 더블클릭 → 로봇 IP 입력(없으면 엔터) → 브라우저가 열린다. 끝낼 때는 이 창을 닫는다.
chcp 65001 >nul
cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 (
  echo [오류] Python 이 없습니다. https://www.python.org 에서 설치할 때 "Add python.exe to PATH" 를 체크하세요.
  pause
  exit /b 1
)

echo.
echo  분리수거 로봇 대시보드
echo  - 로봇과 같은 핫스팟에 연결돼 있어야 합니다.
echo  - 로봇 IP 를 모르면 그냥 엔터 = 가짜 로봇으로 연습 (화면에서 나중에 연결 가능)
echo.
set "ROBOT="
set /p "ROBOT=로봇 IP (예: 192.168.0.23): "

set "URL=http://localhost:8765/"
if not "%ROBOT%"=="" (
  if /i "%ROBOT:~0,4%"=="http" (set "URL=http://localhost:8765/?robot=%ROBOT%") else (set "URL=http://localhost:8765/?robot=http://%ROBOT%:8000")
)

rem 서버가 뜰 시간을 2초 주고 브라우저를 연다
start "" /b cmd /c "ping -n 3 127.0.0.1 >nul && start "" "%URL%""
echo.
echo  열리는 주소: %URL%
echo  (포트 8765 는 로봇 CORS 에 등록된 주소라 바꾸지 마세요)
echo.
python -m http.server 8765
pause
