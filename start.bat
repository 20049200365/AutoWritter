@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Novel Studio

rem ---------- 定位 Python（优先真实安装路径，避开商店假桩） ----------
set "PY="
if exist "%LOCALAPPDATA%\Programs\Python\Python312\python.exe" set "PY=%LOCALAPPDATA%\Programs\Python\Python312\python.exe"
if not defined PY (
    where py >nul 2>nul
    if not errorlevel 1 set "PY=py"
)
if not defined PY (
    where python >nul 2>nul
    if not errorlevel 1 set "PY=python"
)
if not defined PY goto :no_python

rem ---------- 首次：后端虚拟环境 + 依赖 ----------
if not exist "backend\.venv\Scripts\python.exe" (
    echo [首次运行] 创建 Python 虚拟环境...
    "%PY%" -m venv backend\.venv || goto :fail
    echo [首次运行] 安装后端依赖（约 1~2 分钟）...
    call backend\.venv\Scripts\pip install -q -r backend\requirements.txt || goto :fail
)

rem ---------- 首次：前端构建 ----------
if not exist "frontend\dist\index.html" (
    where npm >nul 2>nul
    if errorlevel 1 (
        echo [错误] 未找到 npm，请先安装 Node.js：https://nodejs.org
        pause
        exit /b 1
    )
    echo [首次运行] 安装前端依赖并构建（约 1~2 分钟）...
    pushd frontend
    call npm install --no-audit --no-fund || goto :fail
    call npm run build || goto :fail
    popd
)

if not exist ".env" (
    echo [提示] 未找到 .env，AI 生成功能不可用。请创建 .env 并填入 DEEPSEEK_API_KEY。
)

echo.
echo ================================================
echo    Novel Studio · AI 小说创作工作台
echo    URL  http://127.0.0.1:8000
echo    关闭弹出的终端窗口即停止服务
echo ================================================
echo.

start "Novel Studio" /D "%~dp0backend" .venv\Scripts\python.exe -m app
ping -n 5 127.0.0.1 >nul
start "" "http://127.0.0.1:8000"
exit /b 0

:no_python
echo [错误] 未找到 Python。请先安装 Python 3.12：https://www.python.org/downloads/
pause
exit /b 1

:fail
echo [错误] 初始化失败，请查看上方报错信息。
pause
exit /b 1
