# M6 Web API 层 — 模块 Spec

> 版本：v0.1（待审批）｜ 依赖：M1~M5 的服务与 Repository ｜ 被依赖：M7（前端）
> 职责：REST 路由装配、SSE 端点挂载、本机鉴权、错误规范、OpenAPI 文档、静态托管、启动入口
> 对外契约：◆ OpenAPI（本文 §2 路由表为底稿，P0 冻结项）

---

## 1. 目标与边界

### 1.1 目标
1. 把 M1~M5 的能力装配为统一的 HTTP 面：REST（CRUD 与操作）+ SSE（三个流式端点）
2. 产出 OpenAPI 文档——M7 前端开发的唯一接口依据（前期 Mock 照此捏）
3. 提供启动入口与部署形态：单命令起服务 + 前端静态托管 + 数据目录管理

### 1.2 边界：M6 是**薄装配层**
- 路由层不写业务逻辑：不出现 SQL/ORM 查询、不出现流水线编排、不出现 prompt——一切下沉到 M1~M5，M6 只做"参数校验 → 调服务 → 返回 DTO/事件流"
- 数据出入一律 M1 的 Pydantic DTO，路由层不手捏 dict
- 验收 D6 用静态检查盯这条

---

## 2. 路由装配（◆ 冻结契约）

> 约定：列表支持 `limit/offset` 分页与 `sort`；写操作返回变更后的完整 DTO；路径与动词映射如下。

### 2.1 项目与统计
```
GET    /projects                                  列表（含软删标记过滤）
POST   /projects                                  新建
GET    /projects/{id}                             详情
PATCH  /projects/{id}                             更新（含 phase 切换）
DELETE /projects/{id}                             软删除（进入 5 秒撤销窗口）
POST   /projects/{id}/restore                     撤销恢复（原位）
GET    /projects/{id}/stats                       看板/角标统一数据源（M1 StatsService）
```

### 2.2 大纲树
```
GET    /projects/{id}/outline                     全量节点（前端自组树）
POST   /outline                                   建节点（level 校验，最多三级）
PATCH  /outline/{node_id}                         改（title/summary/status/tension）
DELETE /outline/{node_id}                         级联软删子树
POST   /outline/{node_id}/move                    移动（parent_id + sort，自动重排）
```

### 2.3 章节
```
GET    /projects/{id}/chapters                    列表
POST   /chapters                                  建章（中间插入自动重编章号，M1 A4）
GET    /chapters/{id}                             详情
PATCH  /chapters/{id}                             改（title/status/outline_node_id 挂载）
DELETE /chapters/{id}                             软删除
POST   /chapters/{id}/commit                      提交草稿（版本留档，M1 ChapterRepo.commit_draft）
GET    /chapters/{id}/versions                    版本列表
POST   /chapters/{id}/accept                      接受定稿（发 chapter_accepted）
```

### 2.4 实体与内容资产（标准 CRUD 同构）
```
/characters          GET|POST      /characters/{id}  GET|PATCH|DELETE
/relations           GET|POST      /relations/{id}   GET|PATCH|DELETE
/foreshadows         GET|POST      /foreshadows/{id} GET|PATCH|DELETE
/foreshadows/{id}/resolve | /unresolve            伏笔回收操作（用户驱动）
/world-entries       GET|POST      /world-entries/{id} GET|PATCH|DELETE
/timeline-events     GET|POST      /timeline-events/{id} GET|PATCH|DELETE
/annotations         GET|POST      /annotations/{id} GET|PATCH|DELETE
```

### 2.5 Skill
```
GET    /skills                                    列表（scope 过滤）
POST   /skills                                    新建（含包校验）
GET    /skills/{id}                               详情
PUT    /skills/{id}                               全量更新
DELETE /skills/{id}                               删除
POST   /skills/{id}/enable                        启用/停用（enabled 开关）
```

### 2.6 对话与生成（SSE 三端点）
```
GET    /projects/{id}/sessions                    会话列表
POST   /sessions                                  建会话
DELETE /sessions/{id}                             软删除
GET    /sessions/{id}/messages                    消息列表

POST   /sessions/{id}/chat                        → SSE（对话 Agent，M3 ChatAgent）
POST   /chapters/{id}/generate                    → SSE（单章流水线，M3 ChapterPipeline）
POST   /chapters/{id}/rewrite                     → SSE（划选改写，M3 RewriteService）

GET    /tasks                                     任务列表（chapter_id/状态过滤）
GET    /tasks/{id}                                任务详情（含 context_snapshot 账本）
POST   /tasks/{id}/confirm-plan                   确认/修改细纲
POST   /tasks/{id}/decide                         接受/驳回（tags + note）
POST   /tasks/{id}/cancel                         停止生成
POST   /tasks/{id}/resume                         失败/中断续跑
GET    /tasks/{id}/stream                         SSE 重连（先推 snapshot 再续流）
```

### 2.7 建议与偏好
```
GET    /suggestions                               建议消息列表（project + status 过滤）
POST   /suggestions/{id}/approve                  采纳（事务内应用 payload）
POST   /suggestions/{id}/dismiss                  驳回标记

GET    /preferences/{project_id}                  画像读取
PUT    /preferences/{project_id}                  画像手动修正（source=manual）
GET    /preferences/{project_id}/events           事件时间线
POST   /preferences/{project_id}/rollback         画像回滚（按 snapshots 版本）
```

### 2.8 检索与系统
```
GET    /projects/{id}/search?query=&types=&k=     检索（命令面板与调试用，M2 SearchService）
GET    /health                                    健康检查（DB/模型配置就绪状态）
GET    /config                                    前端可读的配置摘要（模型角色是否已配置等）
```

---

## 3. SSE 挂载规范
- 三个流式端点把 M3 的 `AsyncIterator[SseEvent]` 直接转 SSE 响应，事件格式逐字对齐 M3 §5 契约（progress/context_ready/thinking/tool_call/tool_result/plan_ready/token/review/snapshot/done/error）
- 重连：客户端带 task_id 访问 `/tasks/{id}/stream` → 先收 `snapshot` 事件再续流（不重复已送达内容，M3 B4）
- 路由层不对事件做任何加工/缓冲（除 SSE 帧格式化）

## 4. 通用规范
### 4.1 错误模型
```json
{ "code": "string_token", "message": "可读描述", "details": {} }
```
| HTTP | 场景 | code 示例 |
|---|---|---|
| 404 | 资源不存在 | not_found |
| 409 | 状态冲突（对已接受的任务再驳回；大纲建第 4 级） | state_conflict |
| 422 | 入参校验失败 | validation_error |
| 502 | 上游模型服务不可用（M3 provider_error 透出） | provider_error |
| 500 | 未分类内部错误 | internal |

### 4.2 鉴权与网络
- 服务只绑定 `127.0.0.1`（默认不对外网暴露）
- 启动时生成本机 token，注入前端页面请求头；`--no-token` 开关供调试
### 4.3 OpenAPI
- FastAPI 自动生成，Schema 全部来自 M1 `schemas.py`；文档挂 `/docs`

## 5. 部署与启动
```
python -m novelstudio
  → 1. 迁移（Alembic upgrade head）
  → 2. 装配服务：M1 Repositories → M2 SearchService（注入 rewriter）
       → M3 Pipeline/ChatAgent/RewriteService（注入 Provider）→ M4/M5
  → 3. 挂载路由 + 前端 dist/ 静态托管（SPA fallback 到 index.html）
  → 4. uvicorn 起 127.0.0.1:8000 → 拉起浏览器
```
- 数据目录：`~/.novelstudio/`（novel.db + skills/ + logs/），可整体拷走迁移
- 配置：配置文件 + 环境变量两层（模型三角色、预算、护栏参数见 M3 §7）

## 6. 关于 AG-UI 协议（已评估：暂不采用）
- AG-UI 的价值在跨系统 agent↔前端互操作与组件生态；本项目是单机闭环，前端后端自成体系，互操作收益低，且 review/plan_ready/progress 等领域事件只能走其自定义通道，标准化收益有限
- 决策：保持自研 SSE 协议（M3 §5）；事件命名保持语义化，将来若需接入 CopilotKit 生态或对外暴露 agent，增加 AG-UI 适配端点即可，不动核心
- 重议条件：前端需要复用外部 agent UI 组件，或产品需要对接第三方 agent

## 7. 验收标准

> D 系列；以 FastAPI TestClient + M1~M5 的 Fake/Mock 实现驱动。

| # | 指标 | 判定 |
|---|---|---|
| D1 | **路由覆盖**：OpenAPI 路径清单与本文 §2 逐条一致，无多无少 | 脚本比对 |
| D2 | **DTO 契约**：所有请求/响应经 M1 Pydantic Schema，路由层无手写 dict | 静态检查 |
| D3 | **错误规范**：404/409/422/502 各有用例，响应体符合错误模型 | 用例 |
| D4 | **SSE 挂载**：三端点事件序列逐字符合 M3 §5；重连先 snapshot 后续流、内容不重复 | 用例 |
| D5 | **网络面**：服务绑定 loopback；外部地址请求被拒；token 校验生效 | 用例 |
| D6 | **薄层检查**：路由层无 SQL/ORM 直查、无 prompt、无流水线逻辑 | 静态检查 + 评审 |
| D7 | **一键启动**：干净环境单命令起服，/health 通过，前端页面可加载 | 冒烟脚本 |
| D8 | **静态托管**：dist/ 挂载正确，SPA 深链刷新 fallback 正常 | 用例 |
| D9 | **撤销联动**：删除项目 → restore → 原位还原（与 M1 A2 联调一致） | 集成用例 |

---

## 附：与架构 SPEC 的对应关系
- 路由底稿：架构 §8.1（本文 §2 扩写为完整契约）
- SSE 事件协议：架构 §8.2 → M3 §5（本文 §3 负责挂载）
- 部署形态：架构 §3.3（本文 §5 落地）
