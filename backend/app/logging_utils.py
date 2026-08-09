"""统一日志基建（架构 SPEC §3.4：全模块横切要求）。

- 控制台 + 滚动文件（~/.novelstudio/logs/）
- 格式：时间 | 级别 | 模块 | 消息（关联 ID 由各模块以 extra/结构化前缀携带）
- 红线：API key 永不入日志；正文只记长度，不记全文
"""
from __future__ import annotations

import logging
import logging.handlers
from pathlib import Path

_CONFIGURED = False

FORMAT = "%(asctime)s | %(levelname)-7s | %(name)s | %(message)s"


def setup_logging(log_dir: str | Path, level: int = logging.INFO) -> None:
    """初始化全局日志；重复调用幂等。"""
    global _CONFIGURED
    if _CONFIGURED:
        return

    log_dir = Path(log_dir)
    log_dir.mkdir(parents=True, exist_ok=True)

    root = logging.getLogger()
    root.setLevel(level)

    console = logging.StreamHandler()
    console.setFormatter(logging.Formatter(FORMAT))
    root.addHandler(console)

    file_handler = logging.handlers.RotatingFileHandler(
        log_dir / "novelstudio.log",
        maxBytes=5 * 1024 * 1024,
        backupCount=5,
        encoding="utf-8",
    )
    file_handler.setFormatter(logging.Formatter(FORMAT))
    root.addHandler(file_handler)

    # 第三方库降噪
    for noisy in ("uvicorn.access", "httpx", "LiteLLM"):
        logging.getLogger(noisy).setLevel(logging.WARNING)

    _CONFIGURED = True


def get_logger(name: str) -> logging.Logger:
    return logging.getLogger(name)


def text_digest(text: str | None, head: int = 20) -> str:
    """正文/草稿的安全日志表示：长度 + 开头少量字符，绝不记全文（§3.4 红线）。"""
    if not text:
        return "<空>"
    return f"len={len(text)} head={text[:head]!r}"
