"""Provider 层（M3 SPEC §2.1）：唯一接触 LLM SDK 的地方。

- 三角色模型路由：writer / reviewer / distiller（.env 可分别配置）
- 流式输出统一为事件字典：{"type": delta|tool_calls|usage|done, ...}
- FakeProvider：预录回复的假实现，测试零 API 成本（验收 B10）
"""
from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from typing import Any

log = logging.getLogger("m3.provider")


class ProviderError(RuntimeError):
    pass


class ProviderLayer:
    """真模型实现：litellm + OpenAI 兼容协议（DeepSeek 等）。"""

    def __init__(self, settings) -> None:
        self.settings = settings
        self._models = {
            "writer": settings.llm_writer_model,
            "reviewer": settings.llm_reviewer_model,
            "distiller": settings.llm_distiller_model,
        }

    def model_of(self, role: str) -> str:
        return self._models.get(role, self._models["writer"])

    async def chat(self, role: str, messages: list[dict],
                   temperature: float = 0.7) -> AsyncIterator[dict]:
        import litellm
        model = self.model_of(role)
        log.info("LLM 调用 role=%s model=%s msgs=%d", role, model, len(messages))
        resp = await litellm.acompletion(
            model=f"openai/{model}",
            api_base=self.settings.deepseek_base_url,
            api_key=self.settings.deepseek_api_key,
            messages=messages,
            temperature=temperature,
            stream=True,
        )
        async for part in resp:
            delta = (part.choices[0].delta.content or "") if part.choices else ""
            if delta:
                yield {"type": "delta", "text": delta}
        yield {"type": "done"}


class FakeProvider(ProviderLayer):
    """预录回复：按消息中的标记词路由到固定输出（确定性，可断言）。

    canned: {标记词: 回复文本或回复列表（列表则轮询）}；默认回复 fallback。
    """

    def __init__(self, canned: dict[str, Any] | None = None,
                 fallback: str = "（FakeProvider 默认回复）") -> None:
        self.canned = canned or {}
        self.fallback = fallback
        self.calls: list[dict] = []  # 调用记录（测试断言用）
        self._counters: dict[str, int] = {}

    def model_of(self, role: str) -> str:
        return f"fake-{role}"

    async def chat(self, role: str, messages: list[dict],
                   temperature: float = 0.7) -> AsyncIterator[dict]:
        joined = " ".join(str(m.get("content", "")) for m in messages)
        reply = self.fallback
        for marker, content in self.canned.items():
            if marker in joined:
                if isinstance(content, list):
                    i = self._counters.get(marker, 0)
                    reply = content[i % len(content)]
                    self._counters[marker] = i + 1
                else:
                    reply = content
                break
        self.calls.append({"role": role, "marker_hit": reply[:20], "n_msgs": len(messages)})
        # 模拟流式：按段吐出
        for piece in self._split(reply):
            yield {"type": "delta", "text": piece}
        yield {"type": "done"}

    @staticmethod
    def _split(text: str, size: int = 24) -> list[str]:
        return [text[i:i + size] for i in range(0, len(text), size)] or [""]


async def collect(agen: AsyncIterator[dict]) -> str:
    """把流式事件聚合为完整文本（编排层内部用）。"""
    parts = []
    async for ev in agen:
        if ev["type"] == "delta":
            parts.append(ev["text"])
    return "".join(parts)
