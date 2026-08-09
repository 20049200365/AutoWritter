"""ChapterRepo：章节 + 版本留档 + 中间插章重编号（M1 SPEC §4.2 / A4 / A5）。"""
from __future__ import annotations

from sqlalchemy import func, select

from ..events import CHAPTER_ACCEPTED, CHAPTER_DELETED, CHAPTER_TEXT_COMMITTED
from ..models import Chapter, ChapterVersion
from ..schemas import ChapterCreate, ChapterDTO, ChapterPatch
from ..stats import word_count
from ...logging_utils import text_digest
from .base import BaseRepo, StateConflict


class ChapterRepo(BaseRepo):
    model = Chapter
    dto = ChapterDTO

    # ---- 创建：中间插入自动重编章号（A4）----
    def create(self, data: ChapterCreate) -> ChapterDTO:
        max_seq = self.s.scalar(
            select(func.max(Chapter.seq)).where(
                Chapter.project_id == data.project_id,
                Chapter.deleted_at.is_(None),
            )) or 0
        if data.seq is None:
            seq = max_seq + 1
        else:
            seq = data.seq
            if seq > max_seq + 1:
                raise StateConflict(f"章号 {seq} 与现有 {max_seq} 章不连续")
            # 中间插入：后续章号顺延 +1（按章号倒序逐行腾位 + 逐行 flush，
            # 避免批量 UPDATE 的中间态撞唯一键）
            later = list(self.s.scalars(
                select(Chapter)
                .where(Chapter.project_id == data.project_id,
                       Chapter.deleted_at.is_(None),
                       Chapter.seq >= seq)
                .order_by(Chapter.seq.desc())
            ))
            for ch_later in later:
                ch_later.seq += 1
                self.s.flush()
        ch = Chapter(project_id=data.project_id, title=data.title, seq=seq,
                     outline_node_id=data.outline_node_id, sort=seq)
        self.s.add(ch)
        self.s.flush()
        self.log.info("创建章节 id=%s seq=%s title=%s", ch.id, seq, data.title)
        return self._to_dto(ch)

    # ---- 草稿提交：重算字数 + 版本留档 + 事件（A5 / A3）----
    def commit_draft(self, chapter_id: int, text: str,
                     source: str = "human", task_id: int | None = None) -> int:
        ch = self._require(chapter_id)
        ch.text = text
        ch.word_count = word_count(text)
        if ch.status in ("构思", "大纲"):
            ch.status = "草稿"
        version = (self.s.scalar(
            select(func.max(ChapterVersion.version)).where(
                ChapterVersion.chapter_id == chapter_id)) or 0) + 1
        self.s.add(ChapterVersion(chapter_id=chapter_id, version=version,
                                  text=text, source=source, task_id=task_id))
        self.s.flush()
        self.uow.publish(CHAPTER_TEXT_COMMITTED, chapter_id=chapter_id, version=version)
        self.log.info("提交草稿 chapter=%s version=%s %s", chapter_id, version, text_digest(text))
        return version

    def versions(self, chapter_id: int) -> list[dict]:
        rows = self.s.scalars(
            select(ChapterVersion).where(ChapterVersion.chapter_id == chapter_id)
            .order_by(ChapterVersion.version))
        return [{"version": r.version, "source": r.source,
                 "word_count": word_count(r.text), "created_at": r.created_at}
                for r in rows]

    def version_text(self, chapter_id: int, version: int) -> str:
        row = self.s.scalar(select(ChapterVersion).where(
            ChapterVersion.chapter_id == chapter_id,
            ChapterVersion.version == version))
        if row is None:
            from .base import NotFound
            raise NotFound(f"chapter#{chapter_id} v{version} 不存在")
        return row.text

    # ---- 接受定稿：事件触发 M8 后处理 ----
    def accept(self, chapter_id: int, task_id: int | None = None) -> ChapterDTO:
        ch = self._require(chapter_id)
        if not ch.text:
            raise StateConflict("空正文不能定稿")
        ch.status = "定稿"
        self.s.flush()
        self.uow.publish(CHAPTER_ACCEPTED, chapter_id=chapter_id, task_id=task_id)
        self.log.info("章节定稿 chapter=%s task=%s", chapter_id, task_id)
        return self._to_dto(ch)

    # ---- 挂载大纲（随时可改挂，§用户红线）----
    def assign_outline(self, chapter_id: int, outline_node_id: int | None) -> ChapterDTO:
        return self.update(chapter_id, ChapterPatch(outline_node_id=outline_node_id))

    def delete(self, chapter_id: int) -> None:
        super().delete(chapter_id)
        self.uow.publish(CHAPTER_DELETED, chapter_id=chapter_id)
