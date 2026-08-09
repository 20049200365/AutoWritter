"""RelationRepo：实体图边（多态端点校验 + N 跳子图，M1 SPEC §4.2 / A13）。"""
from __future__ import annotations

from sqlalchemy import or_, select

from ..models import Character, Relation, WorldEntry
from ..schemas import RelationCreate, RelationDTO
from .base import BaseRepo, NotFound

_ENDPOINT_MODELS = {"char": Character, "world": WorldEntry}


class RelationRepo(BaseRepo):
    model = Relation
    dto = RelationDTO

    def _check_endpoint(self, kind: str, entity_id: int) -> None:
        model = _ENDPOINT_MODELS.get(kind)
        if model is None:
            raise NotFound(f"非法端点类型: {kind}")
        obj = self.s.get(model, entity_id)
        if obj is None or getattr(obj, "deleted_at", None) is not None:
            raise NotFound(f"边端点不存在: {kind}#{entity_id}")

    def create(self, data: RelationCreate) -> RelationDTO:
        # 多态端点无 DB 外键，应用层校验（架构 §4.1 / A13）
        self._check_endpoint(data.src_kind, data.src_id)
        self._check_endpoint(data.dst_kind, data.dst_id)
        return super().create(data)

    def neighbors(self, kind: str, entity_id: int, depth: int = 1) -> dict:
        """1~2 跳子图（应用层 BFS）：返回 {nodes, edges}，供 M3 装配与 M7 画图。"""
        seen_nodes: set[tuple[str, int]] = {(kind, entity_id)}
        frontier: set[tuple[str, int]] = {(kind, entity_id)}
        edges: list[RelationDTO] = []
        seen_edge_ids: set[int] = set()

        for _ in range(max(1, min(depth, 2))):
            if not frontier:
                break
            conds = []
            for k, eid in frontier:
                conds.append((Relation.src_kind == k) & (Relation.src_id == eid))
                conds.append((Relation.dst_kind == k) & (Relation.dst_id == eid))
            found = list(self.s.scalars(select(Relation).where(or_(*conds))))
            nxt: set[tuple[str, int]] = set()
            for rel in found:
                if rel.id not in seen_edge_ids:
                    seen_edge_ids.add(rel.id)
                    edges.append(self._to_dto(rel))
                for k, eid in ((rel.src_kind, rel.src_id), (rel.dst_kind, rel.dst_id)):
                    if (k, eid) not in seen_nodes:
                        seen_nodes.add((k, eid))
                        nxt.add((k, eid))
            frontier = nxt

        nodes = [{"kind": k, "id": eid} for k, eid in sorted(seen_nodes)]
        return {"nodes": nodes, "edges": edges}
