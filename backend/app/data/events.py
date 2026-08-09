"""领域事件总线（M1 SPEC §4.3 冻结清单）。

规则：事件由 UnitOfWork 在事务成功提交后派发（after-commit）；
订阅者异常仅记日志，不回滚、不阻塞主流程（M3 B8 同源原则）。
"""
from __future__ import annotations

import logging
from collections import defaultdict
from collections.abc import Callable
from typing import Any

logger = logging.getLogger("m1.events")

# ---- 冻结事件清单（M1 SPEC §4.3）----
CHAPTER_TEXT_COMMITTED = "chapter_text_committed"   # {chapter_id, version}      → M2
CHAPTER_ACCEPTED = "chapter_accepted"               # {chapter_id, task_id}      → M8/M2
CHAPTER_DELETED = "chapter_deleted"                 # {chapter_id}               → M2
WORLD_ENTRY_CHANGED = "world_entry_changed"         # {entry_id, op}             → M2
OUTLINE_CHANGED = "outline_changed"                 # {node_id, op}              → M2
CHARACTER_CHANGED = "character_changed"             # {character_id, op}         → M2

Handler = Callable[[dict[str, Any]], None]


class EventBus:
    def __init__(self) -> None:
        self._handlers: dict[str, list[Handler]] = defaultdict(list)

    def subscribe(self, event: str, handler: Handler) -> None:
        self._handlers[event].append(handler)

    def clear(self) -> None:
        """测试夹具用。"""
        self._handlers.clear()

    def emit(self, event: str, payload: dict[str, Any]) -> None:
        logger.info("事件派发 event=%s payload=%s", event, payload)
        for handler in self._handlers.get(event, []):
            try:
                handler(payload)
            except Exception:  # noqa: BLE001 - 订阅者故障不阻塞主流程（§4.3）
                logger.exception("事件订阅者异常（已隔离）event=%s", event)


bus = EventBus()
