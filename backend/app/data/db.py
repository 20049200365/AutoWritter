"""数据库引擎与会话工厂（M1 SPEC §2.1/§2.2：SQLite + WAL + 外键）。"""
from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.exc import PendingRollbackError
from sqlalchemy.orm import Session, sessionmaker

from .events import EventBus, bus as _global_bus


def make_engine(db_path: str | Path) -> Engine:
    engine = create_engine(f"sqlite:///{db_path}", future=True)

    @event.listens_for(engine, "connect")
    def _sqlite_pragmas(dbapi_conn, _record) -> None:  # pragma: no cover - 由驱动触发
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA journal_mode=WAL")
        cur.execute("PRAGMA foreign_keys=ON")
        cur.execute("PRAGMA synchronous=NORMAL")
        cur.execute("PRAGMA busy_timeout=5000")
        cur.close()

    return engine


class UnitOfWork:
    """一次请求/任务 = 一个事务（M1 SPEC §2.3：Repository 不自行 commit）。

    领域事件在事务内登记（publish），**提交成功后**才派发（M1 SPEC §4.3）。
    """

    def __init__(self, session_factory: sessionmaker[Session],
                 bus: EventBus | None = None) -> None:
        self._session_factory = session_factory
        self._bus = bus or _global_bus
        self.session: Session | None = None
        self._pending_events: list[tuple[str, dict]] = []

    def publish(self, event_name: str, **payload) -> None:
        """事务内登记事件；提交后才真正派发。"""
        self._pending_events.append((event_name, payload))

    def __enter__(self) -> "UnitOfWork":
        self.session = self._session_factory()
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        assert self.session is not None
        committed = False
        try:
            if exc_type is None:
                self.session.commit()
                committed = True
            else:
                self.session.rollback()
        except PendingRollbackError:
            # 调用方在块内吞掉了 flush 异常，会话已污染：回滚后把错误抛出去
            self.session.rollback()
            if exc_type is None:
                raise
        finally:
            self.session.close()
            self.session = None
        if committed:  # after-commit 派发；订阅者异常由 bus 内部隔离
            for name, payload in self._pending_events:
                self._bus.emit(name, payload)
        self._pending_events.clear()


def make_session_factory(engine: Engine) -> sessionmaker[Session]:
    return sessionmaker(bind=engine, expire_on_commit=False, future=True)


def iter_uow(session_factory: sessionmaker[Session]) -> Iterator[UnitOfWork]:
    """FastAPI Depends 用的生成器。"""
    uow = UnitOfWork(session_factory)
    with uow:
        yield uow
