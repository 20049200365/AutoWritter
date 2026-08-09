"""切块策略（M2 SPEC §2）+ jieba 分词与专名保护（§3.2）。"""
from __future__ import annotations

import re

import jieba

MIN_CHARS = 200
MAX_CHARS = 600

_PARA_SPLIT = re.compile(r"\n+")


def chunk_text(text: str, min_chars: int = MIN_CHARS, max_chars: int = MAX_CHARS) -> list[str]:
    """章节正文按自然段落合并为 200~600 字块；尾部不足 min 并入前块。"""
    if not text or not text.strip():
        return []
    paragraphs = [p.strip() for p in _PARA_SPLIT.split(text) if p.strip()]
    blocks: list[str] = []
    cur = ""
    for para in paragraphs:
        if len(cur) + len(para) + 1 <= max_chars:
            cur = f"{cur}\n{para}" if cur else para
            continue
        if cur:
            blocks.append(cur)
        while len(para) > max_chars:  # 超长段硬切
            blocks.append(para[:max_chars])
            para = para[max_chars:]
        cur = para
    if cur:
        if blocks and len(cur) < min_chars:
            blocks[-1] = f"{blocks[-1]}\n{cur}"
        else:
            blocks.append(cur)
    return blocks


def register_user_words(words: list[str]) -> None:
    """专名保护：人名/别名/词条名注册为 jieba 用户词（C6）。"""
    for w in words:
        if w:
            jieba.add_word(w)


def tokenize_for_fts(text: str) -> str:
    """FTS 入库形态：jieba 空格分词。"""
    return " ".join(jieba.cut_for_search(text or ""))
