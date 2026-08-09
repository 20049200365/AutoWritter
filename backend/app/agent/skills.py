"""Skill 系统（M4）：技能包加载/校验/注入（架构 §2.1、M4 SPEC）。

Skill = 带 frontmatter 的 Markdown 包；元数据入 skills 表，正文在文件系统。
注入文本带【Skill：{name}】标记（M3 账本可溯源）。
"""
from __future__ import annotations

import logging
from pathlib import Path

from sqlalchemy import select

from ..data.db import UnitOfWork
from ..data.models import Skill

log = logging.getLogger("m4.skills")

VALID_INJECT_POINTS = {"world", "outline", "draft", "review"}

PRESETS = {
    "玄幻网文": {
        "genre": "玄幻", "inject_points": ["draft", "review"],
        "body": ("修炼体系要有代价，突破必须有铺垫；爽点密度每 800 字一处；"
                 "境界称谓前后一致；打斗写动作与反应，不写数值。"),
    },
    "情感": {
        "genre": "情感", "inject_points": ["draft", "review"],
        "body": ("情绪留白优先于直白抒情；对话要有潜台词；"
                 "用物件与动作承载情感，避免形容词堆叠。"),
    },
    "悬疑": {
        "genre": "悬疑", "inject_points": ["outline", "draft", "review"],
        "body": ("线索必须公平呈现；误导靠视角不靠隐瞒信息；"
                 "每章结尾留一个未解钩子；回收要呼应前文细节。"),
    },
}


def parse_frontmatter(text: str) -> tuple[dict, str]:
    """极简 frontmatter 解析：--- 包裹的 key: value / [a, b] 列表。"""
    if not text.startswith("---"):
        return {}, text
    parts = text.split("---", 2)
    if len(parts) < 3:
        return {}, text
    meta: dict = {}
    for line in parts[1].strip().splitlines():
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        key, value = key.strip(), value.strip()
        if value.startswith("[") and value.endswith("]"):
            meta[key] = [v.strip() for v in value[1:-1].split(",") if v.strip()]
        elif value.isdigit():
            meta[key] = int(value)
        else:
            meta[key] = value
    return meta, parts[2].strip()


def validate_package(meta: dict) -> list[str]:
    """校验规则（M4 SPEC §2.2），返回错误列表。"""
    errors = []
    if not meta.get("name"):
        errors.append("缺 name")
    points = meta.get("inject_points") or []
    if not points:
        errors.append("缺 inject_points")
    elif not set(points) <= VALID_INJECT_POINTS:
        errors.append(f"inject_points 含非法值: {set(points) - VALID_INJECT_POINTS}")
    return errors


class SkillRegistry:
    def __init__(self, session_factory, skills_dir: str | Path) -> None:
        self.factory = session_factory
        self.dir = Path(skills_dir)
        self._cache: dict[int, str] = {}  # skill_id → 正文

    # ---------- 加载 ----------

    def bootstrap_presets(self) -> None:
        """预置模板落盘 + 入库（已存在则跳过，M4 SPEC §4）。"""
        self.dir.mkdir(parents=True, exist_ok=True)
        with UnitOfWork(self.factory) as uow:
            for name, spec in PRESETS.items():
                pkg_dir = self.dir / name
                skill_md = pkg_dir / "skill.md"
                if not skill_md.exists():
                    pkg_dir.mkdir(parents=True, exist_ok=True)
                    skill_md.write_text(
                        f"---\nname: {name}\ngenre: {spec['genre']}\nversion: 1\n"
                        f"inject_points: [{', '.join(spec['inject_points'])}]\n---\n"
                        f"{spec['body']}\n", encoding="utf-8")
                exists = uow.session.scalar(select(Skill).where(
                    Skill.scope == "global", Skill.name == name))
                if exists is None:
                    uow.session.add(Skill(scope="global", name=name, genre=spec["genre"],
                                          inject_points=spec["inject_points"],
                                          filepath=str(skill_md)))
            uow.session.flush()
        log.info("预置 Skill 就绪 dir=%s", self.dir)

    def load_all(self) -> int:
        """扫描全部 Skill 包：校验 → 缓存正文 → 与表对账。返回有效包数。"""
        ok = 0
        with UnitOfWork(self.factory) as uow:
            for skill in uow.session.scalars(select(Skill)):
                body = self._read_body(skill.filepath)
                if body is None:
                    log.warning("Skill 文件缺失 id=%s path=%s", skill.id, skill.filepath)
                    continue
                meta, text = parse_frontmatter(body) if body.startswith("---") else ({}, body)
                errors = validate_package({**meta, "name": skill.name,
                                           "inject_points": skill.inject_points})
                if errors:
                    log.warning("Skill 校验失败 id=%s errors=%s", skill.id, errors)
                    continue
                self._cache[skill.id] = text
                ok += 1
        log.info("Skill 加载完成 有效=%d", ok)
        return ok

    def reload(self, skill_id: int) -> None:
        """热切换：重新读单个包（编辑/启停后即时生效，G6）。"""
        with UnitOfWork(self.factory) as uow:
            skill = uow.session.get(Skill, skill_id)
            if skill is None:
                self._cache.pop(skill_id, None)
                return
            body = self._read_body(skill.filepath)
            if body is not None:
                _, text = parse_frontmatter(body) if body.startswith("---") else ({}, body)
                self._cache[skill_id] = text

    # ---------- 注入 ----------

    def render(self, inject_point: str, project_id: int) -> str:
        """按注入点装配：global + 本项目、enabled、声明该注入点的 Skill。"""
        parts = []
        with UnitOfWork(self.factory) as uow:
            rows = uow.session.scalars(select(Skill).where(Skill.enabled.is_(True)))
            for s in rows:
                if s.scope == "project" and s.project_id != project_id:
                    continue
                if inject_point not in (s.inject_points or []):
                    continue
                text = self._cache.get(s.id)
                if text is None:
                    body = self._read_body(s.filepath)
                    if body is None:
                        continue
                    _, text = parse_frontmatter(body) if body.startswith("---") else ({}, body)
                    self._cache[s.id] = text
                parts.append(f"【Skill：{s.name}】\n{text}")
        return "\n\n".join(parts)

    def list_injected(self, inject_point: str, project_id: int) -> list[str]:
        names = []
        with UnitOfWork(self.factory) as uow:
            for s in uow.session.scalars(select(Skill).where(Skill.enabled.is_(True))):
                if s.scope == "project" and s.project_id != project_id:
                    continue
                if inject_point in (s.inject_points or []):
                    names.append(s.name)
        return names

    @staticmethod
    def _read_body(filepath: str) -> str | None:
        p = Path(filepath)
        if not p.exists():
            return None
        return p.read_text(encoding="utf-8")
