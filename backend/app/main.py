"""应用装配与启动（M6 SPEC §5：迁移 → 装配 → 路由 → 起服）。"""
from __future__ import annotations

import logging
from pathlib import Path

from fastapi import FastAPI

from .api import chapters, entities, outline, projects, search, sessions, skills, stubs, system, tasks
from .api.deps import register_error_handlers, register_request_logging
from .config import REPO_ROOT, Settings
from .agent.provider import ProviderLayer
from .data.db import make_engine, make_session_factory
from .data.events import bus
from .logging_utils import setup_logging
from .search.service import ensure_fts_table
from .search.wiring import register_index_subscribers

log = logging.getLogger("m6.main")

BACKEND_DIR = Path(__file__).resolve().parents[1]


def _run_migrations() -> None:
    """启动时 alembic upgrade head（M6 §5 第 1 步）。"""
    from alembic import command
    from alembic.config import Config
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    command.upgrade(cfg, "head")


def create_app() -> FastAPI:
    settings = Settings()  # 新实例：测试可经 DATA_DIR 环境变量隔离
    settings.ensure_dirs()
    setup_logging(Path(settings.data_dir) / "logs")

    _run_migrations()

    engine = make_engine(settings.db_path)
    ensure_fts_table(engine)
    app = FastAPI(title="Novel Studio API", version="0.1.0")
    app.state.session_factory = make_session_factory(engine)
    app.state.settings = settings
    app.state.provider = ProviderLayer(settings)  # 测试可替换为 FakeProvider（B10）

    register_index_subscribers(bus, app.state.session_factory)
    register_error_handlers(app)
    register_request_logging(app)

    for mod in (system, projects, outline, chapters, entities, skills, sessions, search, tasks, stubs):
        app.include_router(mod.router)

    # 静态托管：前端 dist/ 存在时挂载（M7 交付后启用，D8）
    dist = REPO_ROOT / "frontend" / "dist"
    if dist.exists():
        from fastapi.staticfiles import StaticFiles
        app.mount("/", StaticFiles(directory=str(dist), html=True), name="frontend")

    log.info("应用装配完成 db=%s 路由数=%d", settings.db_path, len(app.routes))
    return app
