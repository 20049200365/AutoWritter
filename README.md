# Novel Studio · AI 小说写作助手

一个 AI 辅助人类创作长篇小说的 Agent 工作台。**人类作者是创作主导者**：AI 负责上下文检索、生成、评审与建议，所有 AI 产出必须经人工接受才进入正典。

## 功能一览

### 筹备阶段
- **世界观设定库**：分类词条（地理/势力/力量体系/器物…），对话式生成 + 所见即所得编辑
- **三级大纲树**：卷 → 篇章 → 节拍，随时增删、中间插章自动重编号、章节挂载大纲节点

### 写作阶段（单章流水线）
```
上下文装配 → 细纲生成 → 人工确认细纲 → 扩写（流式）→ AI 评审打分 → 接受/驳回
```
- **两阶段生成**：AI 先出细纲（情节节拍 + 涉及实体 + 伏笔提醒），作者确认/修改后才扩写正文，方向错误在细纲阶段就能纠正
- **评审 Agent**：五维打分（情节连贯/人物一致性/伏笔照应/节奏/文风贴合）+ 分级问题清单 + 修改建议
- **驳回迭代**：驳回带标签反馈重新生成；「情节方向不对」回退细纲、「文笔问题」直接重扩
- **划选改写**：正文中选中一段 → 润色 / 精简 / 扩写 / 改人称 → 前后对照卡片（采纳/放弃/再来一次）

### 数据资产
- **人物实体图**：人物 + 世界观实体（势力/地点/器物）混合实体图，边类型自由文本，力导向布局可拖拽
- **伏笔追踪**：四态流转（已埋设/部分揭示/已回收/悬空），回收完全由作者指定，AI 只提建议
- **时间线 + 看板**：多轨时间线、字数柱状图、进度环，全部实时计算

### AI 能力
- **Skill 技能包**：题材写作惯例包（玄幻网文/情感/悬疑预置），Markdown 可编辑，注入生成与评审提示词
- **偏好学习**：接受/驳回自动蒸馏用户画像（喜好/雷区/评审权重），连续驳回同类问题升级为硬约束；手动修正优先
- **建议消息制**：AI 的一切推断（新关系/新伏笔/时间线事件/大纲偏差）只进「AI 提议」会话，采纳才落库

## 架构与模块

| 模块 | 职责 | 技术 |
|---|---|---|
| M1 数据与领域层 | 19 张表 + Repository + 事件总线 | SQLite(WAL) + SQLAlchemy + Alembic |
| M2 索引与检索 | 实体路+关键词路混合检索（**无向量库**） | FTS5 + jieba + RRF 融合 + LLM 查询改写 |
| M3 Agent 编排引擎 | Provider 三层内核 + 两阶段流水线 + SSE 流式 | LiteLLM + 自研 tool loop |
| M4 Skill 系统 | 技能包加载/校验/注入 | Markdown 包 + frontmatter |
| M5 偏好学习 | 事件 → 蒸馏 → 画像注入 | LLM 蒸馏 + 版本快照 |
| M6 Web API 层 | 53 路由 + 错误模型 + 一键起服 | FastAPI |
| M7 前端工作台 | 10 页面工作台 | React + TS + Tiptap + d3-force |
| M8 章节后处理 | 摘要/实体抽取/建议流水线 | 事件驱动 + 建议消息 |

完整设计见 `docs/SPEC.md`（架构总纲）与 `docs/specs/M1~M8/`（模块 spec，含 94 条验收标准）。

## 目录结构

```
├── backend/            # Python 后端
│   ├── app/
│   │   ├── data/       # M1：模型/仓储/事件/统计
│   │   ├── search/     # M2：切块/索引/检索
│   │   ├── agent/      # M3/M4/M5/M8：Provider/流水线/Skill/偏好/后处理
│   │   ├── api/        # M6：路由层
│   │   └── main.py     # 应用装配与启动入口
│   ├── alembic/        # 数据库迁移
│   ├── tests/          # 90 项验收测试（A/B/C/D/F/G/H 系列）
│   └── tools/real_smoke.py   # 真模型端到端联调脚本
├── frontend/           # React 前端（M7）
│   └── src/pages/      # 10 个页面
└── docs/               # 架构 SPEC + 八份模块 spec
```

## 快速开始

### 1. 配置 LLM

复制并编辑项目根目录 `.env`（已被 gitignore，不会上传）：

```env
DEEPSEEK_API_KEY=sk-xxxx
DEEPSEEK_BASE_URL=https://api.deepseek.com
LLM_WRITER_MODEL=deepseek-v4-flash      # 写手
LLM_REVIEWER_MODEL=deepseek-v4-flash    # 评审
LLM_DISTILLER_MODEL=deepseek-v4-flash   # 蒸馏（可换更便宜的模型）
```

### 2. 启动后端

```powershell
cd backend
python -m venv .venv                      # 首次
.venv\Scripts\pip install -r requirements.txt
.venv\Scripts\python -m app               # 启动：http://127.0.0.1:8000
```

后端会自动执行数据库迁移并托管前端构建产物；API 文档在 http://127.0.0.1:8000/docs。

### 3. 前端

```powershell
cd frontend
npm install                               # 首次
npm run build                             # 构建（产物由后端托管）
# 或开发模式：npm run dev（http://127.0.0.1:5173，自动代理后端）
```

打开 http://127.0.0.1:8000 → 「开一本书」→ 建大纲与世界观 → 「生成」页写第一章。

## 测试

```powershell
# 仓库根目录
backend\.venv\Scripts\python -m pytest backend\tests -q        # 90 项全绿
backend\.venv\Scripts\python backend\tools\real_smoke.py       # 真模型全链路冒烟（消耗少量 token）
```

测试全部使用 FakeProvider（预录回复），零 API 成本；真模型验证通过 `real_smoke.py` 单独执行。

## 关键设计决策

- **无向量检索**：小说检索以专名为锚点，实体路（块×实体共现表）+ FTS5 关键词 + LLM 查询改写即可覆盖，免去向量库运维与 embedding 成本
- **自研薄内核**：Provider（LiteLLM 三角色路由）→ 循环层 → 确定性编排，三层隔离可独立替换
- **预算软上限**：上下文默认 128k，P0~P4 分层按相关性装配，账本全程可视（「本章 AI 看到了什么」）
- **人机边界**：伏笔回收纯用户驱动；AI 推断一律走建议消息采纳制；全部内容所见即所得可编辑
