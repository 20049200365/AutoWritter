# M2 索引与检索服务 — 模块 Spec

> 版本：v0.1（待审批）｜ 依赖：M1 ｜ 被依赖：M3（上下文装配 P3/P4、对话工具）、M8（索引入口）
> 职责：切块、jieba/FTS5 索引维护、实体共现索引消费、实体+关键词混合检索、LLM 查询改写、索引重建
> 对外契约：◆ `SearchService`（§5，P0 冻结项）

---

## 1. 目标与边界

### 1.1 目标
1. 落地架构 SPEC §5.5 的检索算法：**实体路（主路）+ 关键词路 + LLM 查询改写**，全程不依赖向量库（已决策）
2. 维护章节/词条/大纲/人物卡的切块与 FTS5 索引（jieba 预分词），支持事件驱动增量更新与全量重建
3. 向 M3 提供冻结契约 `SearchService`，支撑上下文装配 P3/P4 与对话工具 `search_world` / `search_chunks`

### 1.2 边界（不做的事）
- **不做实体抽取**：chunk_entities 的写入方是 M8（LLM 抽取），M2 只消费
- **不做章摘要生成**：chapters.summary 的生成归 M8（架构 §5.2 简化后无卷/全局摘要）
- **不做上下文装配**：检索结果的取舍与预算归 M3 编排层
- 不引入任何向量库/embedding 依赖（验收 C10 静态检查）

---

## 2. 切块策略

| 源 | source_type | 切块规则 |
|---|---|---|
| 章节正文 | chapter | 按自然段落切分，合并为 200~600 字的块；尾部不足 200 字并入前块；ord 从 0 递增 |
| 世界观词条 | world | 一条词条一块；content > 800 字时按段落拆 |
| 大纲节点摘要 | outline | 一个节点一块（含卷/篇章概要） |
| 人物档案 | char | 一人一块（结构化字段拼为文本） |

- 块元数据：`{source_type, source_id, ord, text, tokens, entities}`，存 chunks 表（M1）
- 章号邻近度信息：chapter 类块经 source_id 可反查 chapters.seq，供检索排序用

## 3. 索引维护

### 3.1 三张索引载体的分工（表由 M1 建，维护归 M2/M8）
| 载体 | 内容 | 写入方 |
|---|---|---|
| chunks | 块文本与元数据 | **M2**（切块产出） |
| chunks_fts | jieba 空格分词文本（FTS5 虚拟表） | **M2**（与 chunks 同事务同步） |
| chunk_entities | 实体↔块共现 | **M8**（LLM 实体抽取后经 ChunkRepo 写入） |

### 3.2 jieba 用户词典（专名保护）
- 项目内所有 `characters.name/aliases` 与 `world_entries.name` 自动注册为用户词，防止"沈听澜"被切成"沈/听/澜"导致检索漏命中
- 实体数据变化（character_changed / world_entry_changed 事件）时增量刷新词典

### 3.3 增量更新（订阅 M1 事件总线）
| 事件 | M2 动作 |
|---|---|
| chapter_text_committed | 该章重切块：删旧 chunks/FTS 行 → 重写（chunk_entities 由 M8 随后刷新） |
| chapter_deleted | 删除该章全部索引行 |
| world_entry_changed / outline_changed / character_changed | 对应源重切块重写 |

### 3.4 全量重建
`rebuild(project_id)`：清空项目索引 → 全量切块 → 重写 FTS → 幂等可重复执行；用于数据修复与分词策略升级。chunk_entities 重建需触发 M8 实体抽取（作为重建任务的一部分）。

## 4. 检索算法（架构 §5.5 落地）

`search(query, source_types, project_id, k, chapter_range)` 执行步骤：

```
1. 专名提取：query 与 characters.name/aliases、world_entries.name 做匹配
   → 命中实体集 E
2. 实体路：SELECT chunk_id FROM chunk_entities WHERE entity_name IN E
   （world 源退化为词条名直接匹配）
   → 打分 = 共现实体数 × 章号邻近度（chapter_range 内邻近加权）
3. 关键词路：query 过 jieba → chunks_fts BM25 → top-30
4. 融合：RRF 融合两路（实体命中路权重更高），去重，取 top-k
5. 改写兜底（可配置）：若 E 为空 且 BM25 最高分低于阈值 →
   判定为描述性查询 → 调 rewriter 改写为 2~3 组关键词/实体名 → 重查合并
   （最多改写 1 次，防止套娃）
6. 返回 HitDTO：{source_type, source_id, ord, text, score, matched_by[entity|fts|rewrite]}
```

**LLM 依赖的方向问题**：改写需要 LLM，但 M2 不依赖 M3——`SearchService` 构造时注入 `rewriter: Callable[[str], list[str]] | None`（依赖倒置）：M3/M6 装配时注入走 Provider 层的实现；不注入则跳过改写（纯实体+FTS 也能工作）。测试注入 FakeRewriter。

## 5. SearchService 契约（◆ 冻结，满足 M3 §6.2 输入契约）

```python
class SearchService:
    def __init__(self, uow_factory, rewriter: Callable[[str], list[str]] | None = None)

    def search(self, query: str, source_types: list[str], project_id: int,
               k: int = 10, chapter_range: tuple[int, int] | None = None
               ) -> list[HitDTO]

    def entities_of(self, chapter_id: int) -> list[str]
        # 该章共现实体名聚合（chunk_entities），供 M3 查询展开

    def index_source(self, source_type: str, source_id: int) -> None
        # 单源重切块重写（事件处理与手工修复共用）

    def rebuild(self, project_id: int) -> RebuildReport
```

## 6. 配置项
```
chunk:     min_chars=200, max_chars=600
fts:       candidate_n=30（关键词路候选数）
rewrite:   enabled=true, max_rounds=1, bm25_floor=（触发阈值，联调定值）
```

## 7. 验收标准

> C 系列；检索类用例基于固定样本项目（3 人物 / 8 词条 / 10 章），断言可复现。

| # | 指标 | 判定 |
|---|---|---|
| C1 | **实体路命中**：以人物名/词条名查询 → 相关块必在 top-k 首位附近 | 样本断言 |
| C2 | **关键词路命中**：普通词查询 → 含该词的块被 BM25 召回 | 样本断言 |
| C3 | **融合排序**：实体命中块排序高于纯关键词命中块 | 排序断言 |
| C4 | **查询改写**：描述性查询（"主角和师父决裂那段"，样本中无字面匹配）→ 触发一次改写并命中；改写最多 1 次 | FakeRewriter 用例 |
| C5 | **增量一致**：修改章节正文 → 事件驱动重索引，1 秒内检索反映新内容；删除章节 → 检索不再命中 | 用例 |
| C6 | **专名保护**：项目人名/词条名经 jieba 分词不被拆散 | 分词抽查 |
| C7 | **重建幂等**：rebuild 前后检索结果一致；中断重跑不产生脏数据 | 用例 |
| C8 | **性能**：1000 章 / 10000 块规模，单次检索 < 200ms | 基准脚本 |
| C9 | **契约测试**：SearchService 按 M3 §6.2 契约被调用，入参过滤（source_types/chapter_range）生效 | 契约用例 |
| C10 | **无向量**：依赖清单静态检查，不含任何向量库/embedding 包 | import 检查 |

---

## 附：与架构 SPEC 的对应关系
- 检索算法总纲：架构 §5.5（本文 §4 细化为可执行步骤）
- 多库分工中 M2 的位置：架构 §5.1（chunks + chunk_entities + FTS5）
- 增量更新流水线中 M2/M8 分工：架构 §5.4（第 3 步切块/FTS 归 M2，第 4 步实体抽取归 M8）
- 对 M3 的输入契约：M3 spec §6.2（本文 §5 满足之）
