"""OutlineRepo：三级大纲树（M1 SPEC §4.2 / 验收 A4）。

- 最多三级：level 由 parent 推导，建第 4 级被拒绝
- 插入/移动自动重排兄弟节点 sort
- 删除为级联硬删（outline_nodes 表无 deleted_at，树结构不保留墓碑）
"""
from __future__ import annotations

from sqlalchemy import select

from ..events import OUTLINE_CHANGED
from ..models import OutlineNode
from ..schemas import OutlineCreate, OutlineDTO, OutlinePatch
from .base import BaseRepo, NotFound, StateConflict

MAX_LEVEL = 3


class OutlineRepo(BaseRepo):
    model = OutlineNode
    dto = OutlineDTO

    # ---- 查询 ----
    def subtree(self, project_id: int) -> list[OutlineDTO]:
        q = (select(OutlineNode)
             .where(OutlineNode.project_id == project_id)
             .order_by(OutlineNode.level, OutlineNode.sort))
        return [self._to_dto(o) for o in self.s.scalars(q)]

    def _siblings(self, project_id: int, parent_id: int | None) -> list[OutlineNode]:
        q = select(OutlineNode).where(
            OutlineNode.project_id == project_id,
            OutlineNode.parent_id == parent_id,
        ).order_by(OutlineNode.sort)
        return list(self.s.scalars(q))

    def _next_sort(self, project_id: int, parent_id: int | None) -> int:
        siblings = self._siblings(project_id, parent_id)
        return (siblings[-1].sort + 1) if siblings else 1

    # ---- 写操作 ----
    def create(self, data: OutlineCreate) -> OutlineDTO:
        level = 1
        if data.parent_id is not None:
            parent = self.s.get(OutlineNode, data.parent_id)
            if parent is None:
                raise NotFound(f"父节点 #{data.parent_id} 不存在")
            level = parent.level + 1
        if level > MAX_LEVEL:
            raise StateConflict("大纲最多三级，禁止创建第 4 级节点")
        sort = data.sort if data.sort is not None else self._next_sort(data.project_id, data.parent_id)
        node = OutlineNode(
            project_id=data.project_id, parent_id=data.parent_id, level=level,
            sort=sort, title=data.title, summary=data.summary,
            status=data.status, tension=data.tension,
        )
        self.s.add(node)
        self.s.flush()
        self.uow.publish(OUTLINE_CHANGED, node_id=node.id, op="create")
        self.log.info("创建大纲节点 id=%s level=%s sort=%s title=%s", node.id, level, sort, node.title)
        return self._to_dto(node)

    def update(self, node_id: int, patch: OutlinePatch) -> OutlineDTO:
        dto = super().update(node_id, patch)
        self.uow.publish(OUTLINE_CHANGED, node_id=node_id, op="update")
        return dto

    def move(self, node_id: int, parent_id: int | None, sort: int) -> OutlineDTO:
        """移动节点：重算 level，校验深度，兄弟重排（A4：中间插入自动顺延）。"""
        node = self._require(node_id)
        level = 1
        if parent_id is not None:
            parent = self.s.get(OutlineNode, parent_id)
            if parent is None:
                raise NotFound(f"父节点 #{parent_id} 不存在")
            level = parent.level + 1
        if level > MAX_LEVEL:
            raise StateConflict("移动后超过三级上限")
        # 目标子树深度检查：node 的子树高度 + level 不得超限
        depth = self._subtree_height(node_id)
        if level + depth - 1 > MAX_LEVEL:
            raise StateConflict("移动后子树将超过三级上限")

        node.parent_id = parent_id
        node.level = level
        siblings = [x for x in self._siblings(node.project_id, parent_id) if x.id != node_id]
        siblings.insert(max(0, min(sort - 1, len(siblings))), node)
        for i, x in enumerate(siblings, start=1):
            x.sort = i
        self.s.flush()
        self.uow.publish(OUTLINE_CHANGED, node_id=node_id, op="move")
        self.log.info("移动大纲节点 id=%s → parent=%s sort=%s", node_id, parent_id, node.sort)
        return self._to_dto(node)

    def _subtree_height(self, node_id: int) -> int:
        children = list(self.s.scalars(
            select(OutlineNode).where(OutlineNode.parent_id == node_id)))
        if not children:
            return 1
        return 1 + max(self._subtree_height(c.id) for c in children)

    def delete(self, node_id: int) -> None:
        """级联删除子树（硬删，表无 deleted_at）。"""
        node = self._require(node_id)
        doomed = [node]
        frontier = [node]
        while frontier:
            nxt = []
            for n in frontier:
                kids = list(self.s.scalars(
                    select(OutlineNode).where(OutlineNode.parent_id == n.id)))
                doomed.extend(kids)
                nxt.extend(kids)
            frontier = nxt
        for n in reversed(doomed):  # 叶子先删 + 逐个 flush，避免 parent_id 外键冲突
            self.s.delete(n)
            self.s.flush()
        self.uow.publish(OUTLINE_CHANGED, node_id=node_id, op="delete")
        self.log.info("级联删除大纲节点 id=%s 共 %d 节点", node_id, len(doomed))
