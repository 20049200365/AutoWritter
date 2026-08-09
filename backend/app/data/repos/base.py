"""Repository 基类：通用 CRUD + 软删除/撤销 + 过期清理（M1 SPEC §2.4 / A2）。

规则：
- Repository 不 commit，事务由 UnitOfWork 管（§2.3）
- 写操作与事件派发记 INFO 日志，正文类内容只记 text_digest（架构 §3.4 / A14）
- 有 deleted_at 列的实体走软删除+restore；无该列的（如 outline_nodes）走硬删除
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from pydantic import BaseModel
from sqlalchemy import select

from ..db import UnitOfWork
from ..models import Base


class RepoError(ValueError):
    """仓储层错误基类（M6 映射 4xx）。"""


class NotFound(RepoError):
    pass


class StateConflict(RepoError):
    pass


class BaseRepo:
    model: type[Base]
    dto: type[BaseModel]

    def __init__(self, uow: UnitOfWork) -> None:
        self.uow = uow
        self.s = uow.session
        assert self.s is not None, "UnitOfWork 未进入上下文"
        self.log = logging.getLogger(f"m1.repo.{self.model.__tablename__}")

    # ---- 内部工具 ----
    @property
    def _soft(self) -> bool:
        return hasattr(self.model, "deleted_at")

    def _require(self, entity_id: int):
        obj = self.s.get(self.model, entity_id)
        if obj is None or (self._soft and obj.deleted_at is not None):
            raise NotFound(f"{self.model.__tablename__}#{entity_id} 不存在")
        return obj

    def _to_dto(self, obj) -> BaseModel:
        return self.dto.model_validate(obj)

    # ---- 通用 CRUD ----
    def create(self, data: BaseModel) -> BaseModel:
        obj = self.model(**data.model_dump())
        self.s.add(obj)
        self.s.flush()
        self.log.info("创建 %s id=%s", self.model.__tablename__, obj.id)
        return self._to_dto(obj)

    def get(self, entity_id: int) -> BaseModel | None:
        obj = self.s.get(self.model, entity_id)
        if obj is None or (self._soft and obj.deleted_at is not None):
            return None
        return self._to_dto(obj)

    def list(self, project_id: int | None = None, include_deleted: bool = False) -> list[BaseModel]:
        q = select(self.model)
        if project_id is not None and hasattr(self.model, "project_id"):
            q = q.where(self.model.project_id == project_id)
        if self._soft and not include_deleted:
            q = q.where(self.model.deleted_at.is_(None))
        q = q.order_by(self.model.id)
        return [self._to_dto(o) for o in self.s.scalars(q)]

    def update(self, entity_id: int, patch: BaseModel) -> BaseModel:
        obj = self._require(entity_id)
        changed = patch.model_dump(exclude_unset=True)
        for key, value in changed.items():
            setattr(obj, key, value)
        self.s.flush()
        self.log.info("更新 %s id=%s fields=%s", self.model.__tablename__, entity_id, list(changed))
        return self._to_dto(obj)

    def delete(self, entity_id: int) -> None:
        obj = self._require(entity_id)
        if self._soft:
            obj.deleted_at = datetime.now(timezone.utc)  # 进入 5 秒撤销窗口（§2.4）
            self.log.info("软删除 %s id=%s", self.model.__tablename__, entity_id)
        else:
            self.s.delete(obj)
            self.log.info("删除 %s id=%s", self.model.__tablename__, entity_id)
        self.s.flush()

    def restore(self, entity_id: int) -> BaseModel:
        """撤销窗口内恢复：sort 未动过，天然回原位（A2）。"""
        if not self._soft:
            raise StateConflict(f"{self.model.__tablename__} 不支持撤销")
        obj = self.s.get(self.model, entity_id)
        if obj is None or obj.deleted_at is None:
            raise NotFound(f"{self.model.__tablename__}#{entity_id} 无可恢复项")
        obj.deleted_at = None
        self.s.flush()
        self.log.info("撤销恢复 %s id=%s", self.model.__tablename__, entity_id)
        return self._to_dto(obj)

    def purge_expired(self, seconds: float = 5.0) -> int:
        """撤销窗口到期 → 物理清理（A2）。"""
        if not self._soft:
            return 0
        cutoff = datetime.now(timezone.utc) - timedelta(seconds=seconds)
        q = select(self.model).where(self.model.deleted_at <= cutoff)
        expired = list(self.s.scalars(q))
        for obj in expired:
            self.s.delete(obj)
        self.s.flush()
        if expired:
            self.log.info("物理清理 %s 过期软删 %d 条", self.model.__tablename__, len(expired))
        return len(expired)
