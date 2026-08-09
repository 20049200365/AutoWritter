"""依赖注入与错误映射（M6 SPEC §4：错误模型 + 每请求一个 UoW）。"""
from __future__ import annotations

import logging

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from ..data.db import UnitOfWork
from ..data.repos.base import NotFound, RepoError, StateConflict

log = logging.getLogger("m6.api")


def get_uow(request: Request):
    """一次请求 = 一个事务（M1 SPEC §2.3）。"""
    uow = UnitOfWork(request.app.state.session_factory)
    with uow:
        yield uow


def _err(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(status_code=status,
                        content={"code": code, "message": message, "details": {}})


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(NotFound)
    async def _not_found(_req: Request, exc: NotFound):
        return _err(404, "not_found", str(exc))

    @app.exception_handler(StateConflict)
    async def _conflict(_req: Request, exc: StateConflict):
        return _err(409, "state_conflict", str(exc))

    @app.exception_handler(RepoError)
    async def _repo_err(_req: Request, exc: RepoError):
        return _err(400, "repo_error", str(exc))


def register_request_logging(app: FastAPI) -> None:
    """请求行日志（D10）：方法/路径/状态码/耗时；不记请求体。"""

    @app.middleware("http")
    async def _log_requests(request: Request, call_next):
        import time
        t0 = time.perf_counter()
        response = await call_next(request)
        elapsed = (time.perf_counter() - t0) * 1000
        level = logging.WARNING if response.status_code >= 400 else logging.INFO
        log.log(level, "%s %s -> %d (%.1fms)",
                request.method, request.url.path, response.status_code, elapsed)
        return response
