"""占位端点：等待 M2/M3/M5 实现的路由（M6 SPEC §2 契约完整性，D1）。

契约已冻结，实现未到：统一返回 501 + 可读错误；实现落地后逐个替换。
"""
from __future__ import annotations

import logging

from fastapi import APIRouter
from fastapi.responses import JSONResponse

log = logging.getLogger("m6.stubs")

router = APIRouter()

_STUBS = [
    # （方法, 路径, 等待模块）—— search/tasks/preferences 均已实现（M2/M3/M5）
    ("POST", "/sessions/{session_id}/chat", "M3 对话 Agent（SSE）"),
    ("POST", "/chapters/{chapter_id}/rewrite", "M3 划选改写（SSE）"),
    ("GET", "/tasks/{task_id}/stream", "M3 SSE 重连"),
]


def _stub(method: str, path: str, waiting_for: str):
    async def handler():
        log.warning("调用未实现端点 %s %s（等待 %s）", method, path, waiting_for)
        return JSONResponse(
            status_code=501,
            content={"code": "not_implemented",
                     "message": f"等待 {waiting_for} 实现", "details": {}})
    handler.__name__ = f"stub_{method.lower()}_{path.replace('/', '_').strip('_')}"
    router.add_api_route(path, handler, methods=[method],
                         name=handler.__name__, tags=["stubs"])


for _m, _p, _w in _STUBS:
    _stub(_m, _p, _w)
