"""M2 事件订阅接线：数据变更 → 增量索引维护（M2 SPEC §3.3）。"""
from __future__ import annotations

import logging

from ..data.db import UnitOfWork
from ..data.events import (
    CHARACTER_CHANGED, CHAPTER_DELETED, CHAPTER_TEXT_COMMITTED,
    OUTLINE_CHANGED, WORLD_ENTRY_CHANGED,
)
from .service import SearchService

log = logging.getLogger("m2.wiring")


def register_index_subscribers(bus, session_factory) -> None:
    """订阅 M1 事件；每次派发独立开 UoW（事件在提交后触发，原会话已关闭）。"""

    def wrap(fn):
        def handler(payload: dict) -> None:
            try:
                with UnitOfWork(session_factory) as uow:
                    fn(SearchService(uow), payload)
            except Exception:  # noqa: BLE001 - 索引失败不阻塞主流程（可 rebuild 修复）
                log.exception("索引维护失败 payload=%s", payload)
        return handler

    def on_text_committed(svc, p):
        svc.refresh_user_words_from_chapter(p["chapter_id"])
        svc.index_source("chapter", p["chapter_id"])

    def on_chapter_deleted(svc, p):
        svc.remove_source("chapter", p["chapter_id"])

    def on_world_changed(svc, p):
        if p.get("op") == "delete":
            svc.remove_source("world", p["entry_id"])
        else:
            svc.refresh_user_words_from_entry(p["entry_id"])
            svc.index_source("world", p["entry_id"])

    def on_outline_changed(svc, p):
        if p.get("op") == "delete":
            svc.remove_source("outline", p["node_id"])
        else:
            svc.index_source("outline", p["node_id"])

    def on_character_changed(svc, p):
        svc.refresh_user_words_from_character(p["character_id"])
        svc.index_source("char", p["character_id"])

    bus.subscribe(CHAPTER_TEXT_COMMITTED, wrap(on_text_committed), key="m2.text_committed")
    bus.subscribe(CHAPTER_DELETED, wrap(on_chapter_deleted), key="m2.chapter_deleted")
    bus.subscribe(WORLD_ENTRY_CHANGED, wrap(on_world_changed), key="m2.world_changed")
    bus.subscribe(OUTLINE_CHANGED, wrap(on_outline_changed), key="m2.outline_changed")
    bus.subscribe(CHARACTER_CHANGED, wrap(on_character_changed), key="m2.character_changed")
    log.info("M2 索引订阅已注册（5 个事件）")
