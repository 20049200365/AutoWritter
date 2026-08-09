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
    # （方法, 路径, 等待模块）
    ("POST", "/sessions/{session_id}/chat", "M3 对话 Agent（SSE）"),
    ("POST", "/chapters/{chapter_id}/generate", "M3 单章流水线（SSE）"),
    ("POST", "/chapters/{chapter_id}/rewrite", "M3 划选改写（SSE）"),
    ("GET", "/tasks", "M3 任务列表"),
    ("GET", "/tasks/{task_id}", "M3 任务详情（含账本）"),
    ("POST", "/tasks/{task_id}/confirm-plan", "M3 细纲确认"),
    ("POST", "/tasks/{task_id}/decide", "M3 接受/驳回"),
    ("POST", "/tasks/{task_id}/cancel", "M3 停止生成"),
    ("POST", "/tasks/{task_id}/resume", "M3 续跑"),
    ("GET", "/tasks/{task_id}/stream", "M3 SSE 重连"),
    ("GET", "/preferences/{project_id}", "M5 画像读取"),
    ("PUT", "/preferences/{project_id}", "M5 画像手动修正"),
    ("GET", "/preferences/{project_id}/events", "M5 事件时间线"),
    ("POST", "/preferences/{project_id}/rollback", "M5 画像回滚"),
    ("GET", "/projects/{project_id}/search", "M2 检索"),
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
