"""真链路冒烟（M3 F11 / 联调验收）：真实 DeepSeek 模型跑通完整单章流水线。

流程：建项目 → 大纲节拍 → 生成(细纲) → 确认 → 扩写 → 评审 → 接受 → 后处理
运行：cd backend && set PYTHONPATH=. && .venv\\Scripts\\python.exe tools\\real_smoke.py
"""
from __future__ import annotations

import asyncio
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

# 冒烟用独立数据目录，不污染正式库
os.environ.setdefault("DATA_DIR", str(Path(tempfile.gettempdir()) / "novelstudio_smoke"))

from app.main import create_app  # noqa: E402
from app.agent.pipeline import ChapterPipeline  # noqa: E402
from app.data.db import UnitOfWork  # noqa: E402
from app.data.models import Chapter  # noqa: E402


async def collect_events(agen):
    events = []
    async for ev in agen:
        events.append(ev)
        if ev["event"] == "token":
            print(ev["data"]["delta"], end="", flush=True)
    print()
    return events


async def main():
    app = create_app()
    print(f"[setup] provider={type(app.state.provider).__name__} "
          f"model={app.state.settings.llm_writer_model}")

    # ---- 1. 项目 + 大纲 + 章节 ----
    import httpx
    from starlette.testclient import TestClient
    client = TestClient(app)
    pid = client.post("/projects", json={
        "title": "无锋", "genre": "玄幻", "synopsis": "少年携无名之剑入宗门"}).json()["id"]
    vol = client.post("/outline", json={"project_id": pid, "title": "卷一",
                                        "summary": "剑出断雷崖"}).json()
    beat = client.post("/outline", json={
        "project_id": pid, "parent_id": vol["id"],
        "title": "试剑峰会", "summary": "沈听澜携无锋剑赴峰会，遭北冥阁挑衅，剑自鸣而不拔"}).json()
    ch = client.post("/chapters", json={"project_id": pid, "title": "试剑峰会"}).json()
    client.patch(f"/chapters/{ch['id']}", json={"outline_node_id": beat["id"]})
    print(f"[seed] project={pid} chapter={ch['id']}")

    pipe = ChapterPipeline(app.state.session_factory, app.state.provider,
                           app.state.settings,
                           skill_registry=app.state.skill_registry,
                           preference_service=app.state.preference_service)

    # ---- 2. 生成细纲 ----
    print("\n===== 阶段A：装配 + 细纲生成 =====")
    events = await collect_events(pipe.generate(ch["id"]))
    ctx = next(e for e in events if e["event"] == "context_ready")
    plan_ev = next(e for e in events if e["event"] == "plan_ready")
    task_id = plan_ev["data"]["task_id"]
    print(f"[装配] 材料 {len(ctx['data']['ledger'])} 条，"
          f"tokens={ctx['data']['ledger'] and sum(i['tokens'] for i in ctx['data']['ledger'])}")
    print(f"[细纲]\n{plan_ev['data']['plan']}\n")

    # ---- 3. 确认细纲 → 扩写 → 评审 ----
    print("===== 阶段B：扩写（流式）=====")
    events = await collect_events(pipe.expand(task_id))
    review = next(e for e in events if e["event"] == "review")["data"]["review"]
    print(f"\n[评审] overall={review.get('overall')} scores={review.get('scores')}")
    for issue in review.get("issues", [])[:3]:
        print(f"  - [{issue.get('level')}] {issue.get('type')}: {issue.get('detail')}")

    # ---- 4. 接受 → 后处理 ----
    print("\n===== 阶段C：接受 + 后处理 =====")
    out = pipe.decide(task_id, "accept")
    print(f"[决策] {out}")

    with UnitOfWork(app.state.session_factory) as uow:
        c = uow.session.get(Chapter, ch["id"])
        print(f"[定稿] status={c.status} word_count={c.word_count}")
        print(f"[摘要] {c.summary}")

    suggestions = client.get("/suggestions", params={"session_id": _sug_session(client, pid)}) \
        if _sug_session(client, pid) else None
    if suggestions is not None:
        pend = suggestions.json()
        print(f"[建议] AI 提议 {len(pend)} 条：" +
              "、".join(p["suggestion"]["type"] for p in pend))

    print("\n===== 冒烟通过 =====")


def _sug_session(client, pid):
    sessions = client.get(f"/projects/{pid}/sessions").json()
    row = next((s for s in sessions if s["title"] == "AI 提议"), None)
    return row["id"] if row else None


if __name__ == "__main__":
    asyncio.run(main())
