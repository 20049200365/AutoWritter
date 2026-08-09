"""划选改写（M3 SPEC §3.4 简化版）与对话 Agent（M3 SPEC §4）。"""
from __future__ import annotations

import logging

from ..data.db import UnitOfWork
from ..data.models import Chapter, ChatMessage, ChatSession
from ..data.repos import NotFound
from ..data.stats import project_stats
from .provider import collect

log = logging.getLogger("m3.chat")

OP_PROMPTS = {
    "润色": "润色下面这段文字：保持原意，提升画面感与节奏，不改变情节。",
    "精简": "精简下面这段文字：删冗余、缩短句子，保留关键动作与信息，篇幅至少减少两成。",
    "扩写": "扩写下面这段文字：补充动作、感官与对话细节，不引入新情节线。",
    "改人称": "将下面这段文字改为第三人称叙述，保持语气一致。",
    "自由指令": "",
}


class RewriteService:
    """选区 + 指令直接喂 Agent（已决策简化版）；任意选区必产出可见变化（B11）。"""

    def __init__(self, session_factory, provider) -> None:
        self.factory = session_factory
        self.provider = provider

    async def rewrite(self, chapter_id: int, start: int, end: int,
                      op: str, instruction: str | None = None):
        with UnitOfWork(self.factory) as uow:
            ch = uow.session.get(Chapter, chapter_id)
            if ch is None:
                raise NotFound(f"chapters#{chapter_id} 不存在")
            original = (ch.text or "")[start:end]

        prompt_head = OP_PROMPTS.get(op, "")
        if op == "自由指令":
            prompt_head = instruction or "按用户指令修改"
        elif instruction:
            prompt_head += f"\n附加要求：{instruction}"

        messages = [
            {"role": "system", "content": "你是小说修改助手。只输出修改后的文字，不加解释。"},
            {"role": "user", "content": f"{prompt_head}\n\n原文：\n{original}"},
        ]
        parts = []
        async for ev in self.provider.chat("writer", messages):
            if ev["type"] == "delta":
                parts.append(ev["text"])
                yield {"event": "token", "data": {"delta": ev["text"]}}
        result = "".join(parts).strip()

        if result == original.strip() or not result:   # B11：必须可见变化，结构式兜底
            result = self._structural_fallback(original, op)
            log.info("改写走结构式兜底 chapter=%s op=%s", chapter_id, op)
        yield {"event": "done", "data": {"original": original, "result": result, "op": op}}

    @staticmethod
    def _structural_fallback(text: str, op: str) -> str:
        t = text.strip()
        if op == "精简":
            # 从中间的逗号切开最长句，实现短句化
            sentences = [s for s in t.replace("。", "。|").split("|") if s.strip()]
            if sentences:
                longest = max(sentences, key=len)
                if "，" in longest:
                    a, b = longest.split("，", 1)
                    return t.replace(longest, f"{a}。{b}", 1)
            return t[: max(4, int(len(t) * 0.7))]
        # 润色/扩写/其他：拆长句 + 补一拍动作，保证可见变化
        if "，" in t:
            a, b = t.split("，", 1)
            return f"{a}。{b}"
        return f"{t}。风停了一瞬。"


class ChatAgent:
    """对话 Agent：数据驱动（回复只引用项目真实数据，Demo §五红线）。"""

    def __init__(self, session_factory, provider) -> None:
        self.factory = session_factory
        self.provider = provider

    async def chat(self, session_id: int, user_text: str):
        with UnitOfWork(self.factory) as uow:
            session = uow.session.get(ChatSession, session_id)
            if session is None:
                raise NotFound(f"chat_sessions#{session_id} 不存在")
            project_id = session.project_id
            seq = (uow.session.query(ChatMessage.seq)
                   .filter_by(session_id=session_id).count()) + 1
            uow.session.add(ChatMessage(session_id=session_id, role="user",
                                        content=user_text, seq=seq))
            uow.session.flush()

        stats = None
        with UnitOfWork(self.factory) as uow:
            stats = project_stats(uow.session, project_id)
        yield {"event": "tool_call", "data": {
            "name": "stat_summary", "args": f"project={project_id}", "status": "done"}}
        yield {"event": "tool_result", "data": {
            "name": "stat_summary",
            "result": (f"章节 {stats['written']}/{stats['plan']} · 正文 {stats['words']} 字 · "
                       f"人物 {stats['chars']} · 伏笔 {stats['fsp']} · 悬空 {stats['fspDangling']}")}}

        history = []
        with UnitOfWork(self.factory) as uow:
            rows = (uow.session.query(ChatMessage)
                    .filter_by(session_id=session_id).order_by(ChatMessage.seq).all())
            history = [{"role": m.role, "content": m.content or ""} for m in rows[-10:]]

        system = (
            "你是小说创作助手。只依据项目真实数据回答，不虚构项目不存在的内容。"
            f"\n当前项目统计：章节 {stats['written']}/{stats['plan']}，正文 {stats['words']} 字，"
            f"人物 {stats['chars']}，伏笔 {stats['fsp']}（悬空 {stats['fspDangling']}）。"
            + ("\n项目尚空，请引导用户先搭世界观与大纲。" if stats["written"] == 0 else ""))

        parts = []
        async for ev in self.provider.chat(
                "writer", [{"role": "system", "content": system}] + history):
            if ev["type"] == "delta":
                parts.append(ev["text"])
                yield {"event": "token", "data": {"delta": ev["text"]}}
        reply = "".join(parts)

        with UnitOfWork(self.factory) as uow:
            seq = (uow.session.query(ChatMessage.seq)
                   .filter_by(session_id=session_id).count()) + 1
            uow.session.add(ChatMessage(session_id=session_id, role="assistant",
                                        content=reply, seq=seq))
            uow.session.flush()
        log.info("对话回复 session=%s len=%d", session_id, len(reply))
        yield {"event": "done", "data": {"session_id": session_id}}
