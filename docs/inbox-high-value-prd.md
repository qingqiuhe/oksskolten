# Inbox High-Value v1 PRD / 实施拆解

状态：Draft  
日期：2026-04-12  
适用范围：个人方向，直接替换当前 Inbox 中的 `高价值` 模式  
相关文档：

- [docs/inbox-improvements.md](/Users/te/workspace/codex/oksskolten/docs/inbox-improvements.md)：Inbox 非 AI 工作台改造
- [docs/spec/83_feature_similarity.md](/Users/te/workspace/codex/oksskolten/docs/spec/83_feature_similarity.md)：现有相似文章检测
- [docs/spec/50_frontend.md](/Users/te/workspace/codex/oksskolten/docs/spec/50_frontend.md)：Inbox / ArticleList 前端基线
- [server/db/articles.ts](/Users/te/workspace/codex/oksskolten/server/db/articles.ts:116)：当前 `inbox_score` 实现

## 1. 背景

当前 Inbox 已经具备一个 `sort=inbox_score` 的“高价值”排序能力，但它本质上仍然是：

- 一个对整页未读文章生效的扁平排序
- 主要依赖历史行为、内容就绪度、相似文章数、时间新鲜度
- 不支持用户手动指定订阅源优先级
- 不会把相似报道折叠成更适合决策的组
- 缺少“为什么这条排在前面”的解释
- 缺少对来源和话题的快速纠偏入口

这导致当前 `高价值` 更像“算法排序”，而不是“帮助用户更快决定现在先看什么”的决策区。

本 PRD 的目标是把 `高价值` 从一个扁平排序选项，升级为一个短榜单式的决策区。

## 2. 产品目标

### 2.1 目标

新版 `高价值` 的目标只有一个：

`用户打开 Inbox 后，应能更快决定现在先看什么。`

### 2.2 成功标准

- 重点优化窗口是 `前 10 条`
- 新版 `高价值` 应该更像一个“今日决策面”，而不是一套试图接管整个 Inbox 的永久排序哲学
- 用户应该能快速理解：
  - 为什么这条在前面
  - 为什么这组文章被折叠
  - 如果排错了，怎么快速纠偏

### 2.3 产品定位

`高价值 = 一个短榜单式的决策区`

不是：

- 整个 Inbox 的新全局排序
- 搜索排序改造
- feed/category 页的排序改造
- chat / 通知系统的排序改造

## 3. 非目标

本期明确不做：

- 不改普通 Inbox 默认时间流
- 不影响 `/feeds/:id`、`/categories/:id`、`/bookmarks`、`/likes`、`/history`
- 不把 `feed_priority` 应用到搜索、chat 推荐、通知排序
- 不新增持久化 `articles.inbox_score` 字段，仍保持查询时动态计算
- 不引入持久化“相似组 / 话题组”模型
- 不做 embedding / LLM 聚类
- 不在侧边栏常显优先级档位
- 不在新增订阅源时要求设置优先级

## 4. 已确认产品决策

以下决策已在讨论中确认，本文直接以其为实现前提。

### 4.1 作用域

- 只面向个人阅读场景
- 只影响 `Inbox -> 高价值`
- 直接替换现有 `高价值` 模式，不做实验开关，不保留双轨对照

### 4.2 排序与评分

- 继续沿用动态 `inbox_score`
- 但需要重写其组成逻辑，不再简单沿用当前版本
- 新增 `feed_priority`，共 5 档，默认中档
- `feed_priority` 是软权重，不做硬分桶
- `feed_priority` 权重大于历史行为学习出来的 `feed affinity`
- 权重体感应为“中等明显”

### 4.3 高频源惩罚

- 使用 `articles_per_week` 作为高频源信号
- `articles_per_week` 为 feed 表缓存字段，feed refresh 时顺带更新，后台每 6 小时全量刷新一次
- 惩罚采用”混合 + 分段”策略
- 固定下限：`articles_per_week <= 20` 不惩罚
- 超过 `20/week` 后进入惩罚区
- 叠加相对分位校正，区分普通高频和极高频源
- 若某 feed 被手动调到最高优先级，高频惩罚可被明显抵消，但不能完全免疫

### 4.4 相似文章

- 不再将“相似文章多”直接视为坏事
- 当一组相似文章里你一篇都没读过时：
  - 不做整组默认降权
  - 而是保留一个代表文章作为主卡片
  - 其余文章折叠进组
- 当你已经读过组内一篇，尤其是主文章时：
  - 组内其他文章明显降权
  - 但仍可展开查看

### 4.5 分组模型

- 相似组只在 `Inbox -> 高价值` 中出现
- 相似组采用“星型组”而非传递闭包组
- 先按统一总分选主文章
- 组内只吸纳“直接与主文章相似”的文章
- 主文章、列表顺序、组内顺序使用同一套总分
- 组主文章允许在未来被更优文章替换，但加微小的 incumbent bonus 让已展示的主文章不轻易被替换
- 话题冷却的锚点保持不变

### 4.6 交互与解释

- 默认展示：主文章 + `还有 N 篇相似报道` + 来源名摘要
- 每个主卡片最多展示 2 条解释理由
- 解释理由应采用可验证的规则信号，而不是黑箱总结
- 相似组展开状态只记本次会话

### 4.7 纠偏

提供两类轻量反馈：

1. 降低订阅源优先级
   - 每次只降 1 档
   - 操作后 toast 带 undo 按钮（3~5 秒内可撤销）
2. 这组相似文章别排这么前
   - 持续 14 天
   - 影响当前组以及之后新来的同题文章
   - 冷却锚定在触发反馈时的主文章

## 5. 用户体验设计

## 5.1 总体形态

当用户在 Inbox 页点击 `高价值` 时，不再把整页文章简单按 `inbox_score` 扁平排序，而是切换到：

1. `高价值决策区`
   - 顶部固定显示
   - 只包含前 10 个决策项
   - 每个决策项可以是单篇文章，也可以是折叠组
   - 在页面打开（进入高价值模式）时一次性获取，不随下方分页刷新
2. `剩余时间流`
   - 展示未进入前 10 决策区的其他未读文章
   - 按普通 Inbox 时间流展示（建议沿用 `published_at DESC`）

这意味着”高价值模式”从”整页重排”变成”前 10 决策区 + 后续普通流”的混合视图。

## 5.2 决策区规则

- 目标是帮助用户在前几十秒内完成阅读决策
- 前 10 个决策项优先保证质量，而不是试图给全部文章做完美排序
- 若候选不足 10 个，则展示实际数量

## 5.3 相似组展示

默认折叠态：

- 显示主文章卡片
- 显示 `还有 N 篇相似报道`
- 显示 2 到 3 个来源名摘要
- 显示最多 2 条解释理由

展开态：

- 组内文章按统一总分降序展示
- 仅在当前会话有效
- 不持久记忆展开状态

## 5.4 解释理由

第一版理由来源建议限制在以下信号中：

- 高优先级订阅源
- 你常读这个来源
- 本周发文较少
- 该话题有 N 个相似来源，已为你折叠
- 你已读过该话题的其他报道
- 原始报道优先
- 近期发布

第一版不建议显示模型内部数值，不建议显示超过 2 条理由。

## 5.5 优先级配置入口

`feed_priority` 的设置入口：

- 订阅源编辑弹窗
- 侧边栏右键菜单 / 下拉菜单

但：

- 侧边栏默认不常显当前档位
- 新增订阅源时不要求用户当场设置，默认中档

## 6. 评分与分组模型 v1

## 6.1 总分原则

推荐将新版 `inbox_score` 定义为一个有界、可解释的候选分数，用于：

- 决定哪些文章进入前 10 决策区
- 决定相似组的展示主文章
- 决定相似组展开后的组内顺序

推荐公式：

```text
candidate_score
  = source_score
  + article_quality_score
  + freshness_score
  - high_frequency_penalty
  - already_covered_penalty
  - topic_cooldown_penalty

source_score
  = manual_feed_priority_score(priority_level)
  + learned_feed_affinity_score
  + learned_category_affinity_score
```

其中：

- `manual_feed_priority_score` 必须强于 `learned_feed_affinity_score`
- “高频源惩罚”只在 `>20/week` 后生效
- “相似文章多”本身不自动扣分
- 若当前话题里已经有你读过的文章，则触发 `already_covered_penalty`
- 若命中 14 天冷却锚点，则触发更强的 `topic_cooldown_penalty`
- 当一组相似文章里你一篇都没读过时，不因为组大而惩罚主文章；“分组”解决重复展示，“惩罚”只解决已覆盖话题或被用户显式压制的话题

建议把各分量控制在如下量级：

- `source_score`：约 `-3 ~ +9`
- `article_quality_score`：约 `-0.5 ~ +2.6`
- `freshness_score`：约 `0 ~ +2.4`
- `high_frequency_penalty`：约 `0 ~ 6`
- `already_covered_penalty`：约 `0 ~ 3`
- `topic_cooldown_penalty`：固定 `4`

这样最终 `candidate_score` 的常见范围大致会落在 `-5 ~ +12`，便于解释和调参。

### 6.1.1 手动优先级分

推荐直接用离散映射，而不是线性插值。这样更容易保证“高优先级明显更强，但又不是生硬分桶”。

```text
manual_feed_priority_score(priority_level)
  = {
      1: -3.0,
      2: -1.5,
      3:  0.0,
      4: +2.5,
      5: +5.0
    }
```

设计意图：

- `5` 档的手动加分显著高于单独的行为 affinity
- `1` 档会明显拉低进入前 10 的概率
- `3` 档是完全中性，不给额外推力也不施加额外压制

### 6.1.2 学习到的来源 / 分类偏好分

建议保留当前“读 / 收藏 / 喜欢”的思想，但改成有上限的分数，避免它无限抬升。

```text
feed_affinity_ratio
  = (1 * read_count + 3 * bookmark_count + 5 * like_count)
    / (article_count + 12)

learned_feed_affinity_score
  = min(3.0, 6.0 * feed_affinity_ratio)

category_affinity_ratio
  = (1 * read_count + 2 * bookmark_count + 3 * like_count)
    / (article_count + 20)

learned_category_affinity_score
  = min(1.5, 3.0 * category_affinity_ratio)
```

设计意图：

- `feed` 的历史偏好强于 `category`
- 两者上限都低于最高档手动优先级
- 足够缓冲低样本 feed，避免几次偶然点击就把新源顶上去

### 6.1.3 文章质量分

建议将质量分保持为轻量修正，不让它压过来源偏好。

```text
article_quality_score
  = (full_text ? 1.0 : 0)
  + ((summary OR excerpt) ? 0.6 : 0)
  + (notification_body_text ? 0.2 : 0)
  + kind_bonus

kind_bonus
  = {
      original: +0.8,
      quote:    +0.2,
      repost:   -0.5,
      null:      0.0
    }
```

### 6.1.4 新鲜度分

沿用分段奖励即可，不需要做连续函数。

```text
freshness_score
  = {
      published_within_12h: +2.4,
      published_within_48h: +1.4,
      published_within_7d:  +0.6,
      otherwise:             0.0
    }
```

### 6.1.5 高频源惩罚

这是本期最关键的交互项。推荐把“原始惩罚”和“优先级折扣后的有效惩罚”分开写清楚。

先定义原始高频惩罚：

```text
raw_frequency_penalty
  = clamp(
      1.4 * log2(1 + max(0, articles_per_week - 20) / 10)
      + 1.2 * max(0, feed_frequency_quantile - 0.80) / 0.20,
      0,
      6.0
    )
```

说明：

- `articles_per_week <= 20` 时，第一项自然为 `0`
- 超过 20/week 后，采用对数增长，避免高频源惩罚无限膨胀
- `feed_frequency_quantile` 表示该 feed 在当前用户非 clip 订阅池中的发文频率分位，范围 `0.0 ~ 1.0`
- 第二项用于拉开“略高于 20/week”和“整个订阅池里最吵的源”

再定义“优先级如何削弱高频惩罚”：

```text
priority_discount(priority_level)
  = {
      1: 0.00,
      2: 0.10,
      3: 0.20,
      4: 0.40,
      5: 0.65
    }

high_frequency_penalty
  = max(
      raw_frequency_penalty * (1 - priority_discount(priority_level)),
      raw_frequency_penalty * 0.35
    )
```

这条公式是 v1 的关键设计点：

- `priority_level=5` 时，高频惩罚最多只被削弱到原始值的 `35%`
- `priority_level=4` 时，保留 `60%` 惩罚
- `priority_level=3` 时，保留 `80%` 惩罚
- 因此手动高优先级可以明显抵消惩罚，但绝不完全免疫

换句话说：

- `feed_priority` 同时提供：
  - 显式加分：`manual_feed_priority_score`
  - 惩罚折扣：`priority_discount`
- 但惩罚折扣始终有 `35%` 下限，避免“完全抵消”

### 6.1.6 已覆盖惩罚与冷却惩罚

```text
already_covered_penalty
  = {
      no_read_similar:        0.0,
      has_read_similar:       2.0,
      read_group_display_one: 3.0
    }

topic_cooldown_penalty
  = active_topic_cooldown ? 4.0 : 0.0
```

说明：

- 当一个话题里你一篇都没读过时，不因“组大”惩罚主文章
- 当该话题你已经读过别的来源时，才开始明显下压
- 当你手动点了“这组别排这么前”后，14 天内直接再压一个固定的大惩罚

### 6.1.7 调参空间

v1 允许调的参数建议明确写出来，避免后续隐藏魔法常数：

- `manual_feed_priority_score` 的 5 档映射
- `feed_affinity` / `category_affinity` 的 cap
- `raw_frequency_penalty` 的对数系数和上限
- `priority_discount` 的 5 档映射
- `high_frequency_penalty` 的最低保留比例，当前建议 `35%`
- `already_covered_penalty` / `topic_cooldown_penalty` 的固定值

如果后续发现排序过于依赖来源，可优先下调：

- `manual_feed_priority_score(4/5)`
- `priority_discount(4/5)`

如果后续发现高频源仍然刷屏，可优先上调：

- `raw_frequency_penalty` 的对数系数
- `already_covered_penalty`
- `topic_cooldown_penalty`

## 6.2 feed_priority 建议映射

建议使用整数 1 到 5：

- `1`：忽略
- `2`：低
- `3`：中
- `4`：高
- `5`：必读

建议默认值：

- 所有新老订阅源默认为 `3`

建议实现原则：

- `5` 档应明显提升进入前 10 的概率
- `1` 档应明显降低进入前 10 的概率
- 但文章本身仍允许翻盘
- 该映射既参与正向加分，也参与高频惩罚折扣

## 6.3 高频源惩罚建议

`articles_per_week` 为 feed 表缓存字段（见 7.1），feed refresh 时顺带更新，后台每 6 小时全量刷新一次。

建议把高频惩罚拆成两步：

1. 先算 `raw_frequency_penalty`
   - 只在 `>20/week` 后开始增长
   - 用对数函数避免极高频源把分数直接打穿
   - 再叠加用户订阅池里的相对分位校正
2. 再用 `priority_discount` 去削弱惩罚
   - 但至少保留 `35%` 原始惩罚

这比简单做：

```text
+manual_feed_priority_score - high_frequency_penalty
```

更稳，因为它明确规定了二者的交互方式：

- 高优先级既能加分，也能削弱惩罚
- 但永远不可能把惩罚完全抹掉

## 6.4 相似组组装算法

第一版建议保持简单和稳定：

1. 先在当前 Inbox 作用域下取近一周的前 3000 条候选未读文章（按 `high_value_score` DESC）
2. 对每篇候选文章计算 `high_value_score`
3. 按总分降序遍历，逐个构建决策项
4. 若某篇文章尚未被分配：
   - 以它为候选主文章
   - 查找“直接与它相似”的未分配文章
   - 形成一个星型组
5. 在该组内用同一套总分重新选出展示主文章（已展示的主文章获得 +0.5 的 incumbent bonus，避免两次请求间主文章频繁切换）
6. 将该组或单篇文章放入决策区
7. 直到凑满前 10 个决策项或耗尽候选

注意：

- 不做传递闭包扩张
- 不引入持久化 group id
- 只使用当前已存在的 `article_similarities`

## 6.5 已读覆盖逻辑

若组内存在已读文章：

- 若当前用户已读的是主文章：
  - 其余成员明显降权
- 若当前用户已读的是组内非主文章：
  - 当前组应显示“你已读过该话题的其他报道”理由
  - 当前主文章仍可保留，但整组得分下降

## 6.6 冷却逻辑

当用户点击“这组别排这么前”：

- 记录当前主文章为冷却锚点
- 生成 14 天冷却记录
- 后续新文章只要与该锚点直接相似，也继承冷却惩罚

冷却锚点与展示主文章分离：

- 展示主文章未来可以替换
- 冷却锚点保持为触发反馈时的那篇文章

## 7. 数据模型与存储方案

## 7.1 Feed 优先级

建议新增字段：

```sql
ALTER TABLE feeds ADD COLUMN priority_level INTEGER NOT NULL DEFAULT 3;
ALTER TABLE feeds ADD COLUMN articles_per_week REAL NOT NULL DEFAULT 0;
```

约束建议：

- `priority_level` 仅允许 `1..5`
- `articles_per_week` 为缓存字段，feed refresh 时顺带更新，后台每 6 小时全量刷新一次
- clip feed 同样可持有这些字段，但第一版在高价值决策区中不使用 clip feed

涉及文件：

- `migrations/0017_inbox_high_value_v1.sql`
- `shared/types.ts`
- `server/db/feeds.ts`
- `server/routes/feeds.ts`

## 7.2 话题冷却

建议新增表：

```sql
CREATE TABLE inbox_topic_cooldowns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  anchor_article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  UNIQUE(user_id, anchor_article_id)
);

CREATE INDEX idx_inbox_topic_cooldowns_user_expires
  ON inbox_topic_cooldowns(user_id, expires_at);
```

设计说明：

- 不新增 group id
- 只记录“用户对哪篇锚文章触发了 14 天冷却”
- 后续通过 `article_similarities` 与锚文章的关系去判断新文章是否命中冷却

可接受限制：

- 若锚文章在冷却期内被删除，冷却自然失效
- 第一版接受这个限制，不额外做 title snapshot 或 semantic fallback

推荐文件：

- `server/db/inbox-topic-cooldowns.ts`
- `server/routes/inbox.ts` 或 `server/routes/articles.ts`

## 8. API 设计建议

## 8.1 Feed 更新接口

复用现有 `PATCH /api/feeds/:id`，新增字段：

```json
{
  "priority_level": 1
}
```

约束：

- 仅允许 `1..5`
- 不新增单独的“优先级接口”

## 8.2 高价值决策区接口

建议新增独立接口，而不是继续复用 `GET /api/articles?sort=inbox_score` 返回扁平数组。

推荐：

`GET /api/inbox/high-value`

请求参数建议：

- `limit`，默认 10
- `feed_view_type`，支持 `all / article / social`

响应建议：

```json
{
  "items": [
    {
      "kind": "article",
      "display_article": {
        "id": 123,
        "title": "...",
        "inbox_score": 18.2,
        "inbox_reasons": ["feed_priority_high", "recent_story"]
      }
    },
    {
      "kind": "group",
      "anchor_article_id": 456,
      "display_article": {
        "id": 460,
        "title": "...",
        "inbox_score": 17.1,
        "inbox_reasons": ["feed_priority_high", "topic_collapsed"]
      },
      "similar_count": 3,
      "source_names": ["The Verge", "TechCrunch", "Wired"],
      "members": [
        { "id": 460, "title": "...", "feed_title": "The Verge", "inbox_score": 17.1 },
        { "id": 457, "title": "...", "feed_title": "TechCrunch", "inbox_score": 12.4 }
      ]
    }
  ],
  "represented_article_ids": [123, 456, 457, 460]
}
```

设计说明：

- 前端不需要自行拼组
- 前端直接拿 `represented_article_ids` 去排除底部普通时间流里的重复文章
- `members` 只需为前 10 决策区里的项目 eager load，规模可控

## 8.3 普通文章列表排除参数

建议在 `GET /api/articles` 上新增：

- `exclude_ids=1,2,3`

用于 `高价值` 模式下的“剩余时间流”：

- 上半区：`GET /api/inbox/high-value`
- 下半区：`GET /api/articles?unread=1&exclude_ids=...`

这样可以复用现有分页、智能 floor、手势、行内操作，不必为高价值模式重写整套下半区列表。

## 8.4 话题冷却接口

建议新增：

`POST /api/inbox/topic-cooldowns`

请求：

```json
{
  "anchor_article_id": 456
}
```

服务端行为：

- 若该锚点已有未过期冷却，返回现有记录或幂等成功
- 统一创建 `expires_at = now + 14 days`

第一版不要求单独的取消接口，因为冷却是 14 天自动过期。

## 9. 前端实现建议

## 9.1 页面结构

当 Inbox 处于 `高价值` 模式时：

- `InboxHeader` 保持现有位置和切换入口
- `ArticleList` 进入高价值专用渲染路径
- 顶部渲染 `HighValueSection`
- 下方继续复用当前 `ArticleList` 的普通列表区

推荐新增组件：

- `src/components/article/high-value-section.tsx`
- `src/components/article/high-value-group-card.tsx`
- `src/components/article/high-value-reason-chips.tsx`

## 9.2 feed_priority 入口

编辑弹窗：

- 在 [src/components/feed/feed-edit-dialog.tsx](/Users/te/workspace/codex/oksskolten/src/components/feed/feed-edit-dialog.tsx) 中新增 5 档选择器
- 文案采用”忽略 / 低 / 中 / 高 / 必读”

侧边栏右键菜单：

- 在 [src/components/feed/feed-context-menu.tsx](/Users/te/workspace/codex/oksskolten/src/components/feed/feed-context-menu.tsx) 中新增优先级子菜单
- 同时新增轻量操作：
  - `降低优先级`

说明：

- 侧边栏列表项本身不常显优先级状态
- 右键菜单是“快速微调”入口，不是唯一入口

## 9.3 解释理由

建议前端只负责渲染理由，不自己推导理由。

推荐服务端返回：

- `inbox_reason_codes: string[]`

前端通过 i18n 映射：

- `inbox.reason.feedPriorityHigh`
- `inbox.reason.feedAffinityHigh`
- `inbox.reason.lowFrequencySource`
- `inbox.reason.topicCollapsed`
- `inbox.reason.topicAlreadyCovered`
- `inbox.reason.originalReporting`
- `inbox.reason.recentStory`

## 9.4 纠偏入口

在主卡片 / 组卡片上提供轻量操作：

- `降低该来源优先级`
- `这组别排这么前`

交互要求：

- 不弹复杂配置面板
- 操作后乐观更新
- 降低优先级操作后 toast 带 undo 按钮（3~5 秒内可撤销）
- 冷却动作不要求长期可视化入口，但建议在主卡片解释里可显示”该话题已冷却中”

## 10. 服务端实现建议

## 10.1 评分逻辑重构

当前 `server/db/articles.ts` 中的 `inboxScoreExpr()` 建议不要继续硬塞所有新逻辑。

推荐重构为：

- `buildInboxScoreComponents(...)`
- `buildInboxReasons(...)`
- `buildHighValueItems(...)`

至少把以下能力从单个 SQL 表达式中分层出来：

- 手动 feed 优先级
- 高频源惩罚
- 冷却惩罚
- 主卡片理由选择
- 高价值前 10 项组装

原则：

- 保留 SQL 计算能带来的效率
- 但不要把“组装前 10 个高价值决策项”的全部业务逻辑埋进单条超长 SQL

## 10.2 推荐实现路径

建议采用“两阶段”：

1. SQL 层取出足量候选 flat articles
   - 已包含基础 score 和所需元数据
2. Node 层完成：
   - 星型组装
   - 主文章重选
   - 解释理由截断
   - top 10 决策区生成

这样更适合后续调参与调试。

## 11. 验收标准

上线前至少满足以下验收条件：

### 11.1 产品验收

- `高价值` 模式进入后，顶部明确呈现前 10 决策区
- 相似报道不会在前 10 中平铺刷屏
- 每个决策项都能看出为什么在这里
- 用户可以在卡片上快速纠偏

### 11.2 排序验收

- 提高某个 feed 的 `priority_level` 后，其文章在前 10 中明显更容易出现
- 对高频 feed 设置高优先级后，仍存在一定降噪效果，不会完全刷屏
- 对相似组触发冷却后，接下来 14 天内同题新文章显著下沉

### 11.3 交互验收

- 相似组默认折叠，展开不刷新页面
- 展开状态仅在当前会话内生效
- 组内排序与主卡片排序逻辑一致
- 下方普通时间流不会重复展示已进入高价值决策区的文章

### 11.4 性能验收

- `GET /api/inbox/high-value` 接口 p95 响应时间 < 200ms（含组装逻辑）
- `articles_per_week` 缓存字段按时更新，不在请求路径中实时计算

## 12. 实施拆解清单

## 12.1 数据层

- [ ] 新增 migration：`feeds.priority_level INTEGER NOT NULL DEFAULT 3`
- [ ] 新增 migration：`feeds.articles_per_week REAL NOT NULL DEFAULT 0`
- [ ] 新增 migration：`inbox_topic_cooldowns`（含 `UNIQUE(user_id, anchor_article_id)` 约束）
- [ ] 更新 `shared/types.ts` 中 `Feed` / `FeedWithCounts`
- [ ] 更新 `server/db/feeds.ts` 的 `createFeed` / `updateFeed` / `getFeeds`
- [ ] 在 feed refresh 时顺带更新 `articles_per_week`
- [ ] 新增后台定时任务：每 6 小时全量刷新所有 feed 的 `articles_per_week`
- [ ] 为 `priority_level` 增加约束与测试

建议文件：

- `migrations/0017_inbox_high_value_v1.sql`
- `shared/types.ts`
- `server/db/feeds.ts`
- `server/db/feeds.test.ts`

## 12.2 服务端高价值接口

- [ ] 新增 `GET /api/inbox/high-value`
- [ ] 新增 `POST /api/inbox/topic-cooldowns`
- [ ] 为 `GET /api/articles` 增加 `exclude_ids`
- [ ] 抽离高价值候选查询与决策项组装逻辑
- [ ] 让返回结果携带 `represented_article_ids`
- [ ] 让返回结果携带最多 2 条解释理由 code

建议文件：

- `server/routes/articles.ts` 或新增 `server/routes/inbox.ts`
- `server/db/articles.ts`
- `server/db/inbox-topic-cooldowns.ts`
- `server/routes/articles.test.ts`
- `server/db/articles.test.ts`

## 12.3 评分逻辑重构

- [ ] 重写当前 `inbox_score` 组成
- [ ] 引入 `feed_priority` 权重
- [ ] 引入 `articles_per_week > 20` 的分段惩罚
- [ ] 加入“已读同题”降权
- [ ] 加入“14 天冷却”惩罚
- [ ] 生成解释理由 code

注意：

- 第一版不要再把 `similar_count` 当作简单加分项
- “多来源同题”应更多服务于折叠与代表选择，而不是平铺加权

## 12.4 前端渲染

- [ ] 在 `高价值` 模式下渲染顶部 `HighValueSection`
- [ ] 支持单篇卡片和组卡片两种决策项
- [ ] 组卡片默认折叠，支持当前会话内展开
- [ ] 渲染来源名摘要
- [ ] 渲染解释理由
- [ ] 下方列表排除已进入决策区的文章

建议文件：

- `src/components/article/article-list.tsx`
- `src/components/article/inbox-header.tsx`
- `src/components/article/high-value-section.tsx`
- `src/components/article/high-value-group-card.tsx`
- `src/components/article/high-value-reason-chips.tsx`
- `src/components/article/article-list.test.tsx`

## 12.5 feed_priority 入口

- [ ] 在 `FeedEditDialog` 中新增 5 档优先级选择
- [ ] 在 `FeedContextMenu` 中新增优先级子菜单
- [ ] 支持”降低优先级”一键操作（toast 带 undo 按钮）
- [ ] 完成文案与 i18n

建议文件：

- `src/components/feed/feed-edit-dialog.tsx`
- `src/components/feed/feed-context-menu.tsx`
- `src/lib/i18n.ts`
- `src/components/feed/feed-edit-dialog.test.tsx`
- `src/components/feed/feed-context-menu.test.tsx`

## 12.6 反馈与冷却

- [ ] 在组卡片上接入“这组别排这么前”
- [ ] 点击后创建 14 天冷却
- [ ] 成功后乐观更新顶部决策区
- [ ] 卡片支持显示“已冷却中”解释或状态

## 12.7 测试与校准

- [ ] 覆盖不同 `priority_level` 的排序差异
- [ ] 覆盖 `articles_per_week` 在 20 附近的分段行为
- [ ] 覆盖“最高优先级只能部分抵消惩罚”
- [ ] 覆盖星型组装而非传递闭包
- [ ] 覆盖锚点冷却对未来同题文章的影响
- [ ] 覆盖前 10 决策区与下方时间流不重复

## 13. 推荐落地顺序

虽然本期目标是“完整版本一次上线”，实现顺序仍建议分成下面 4 个 lane，减少返工：

1. 数据与接口基线
   - `priority_level`
   - `topic_cooldowns`
   - `GET /api/inbox/high-value`
2. 评分逻辑重构
   - 新版 `inbox_score`
   - 解释理由
3. 决策区 UI
   - 顶部前 10 决策区
   - 组卡片
   - 剩余时间流排除
4. 反馈闭环
   - 降低来源优先级
   - 14 天话题冷却
   - 文案与测试收口

## 14. 后续可选方向

明确放到后续，而不是塞进 v1：

- 将高价值解释理由用于通知推荐
- 把 `feed_priority` 外溢到 chat 推荐
- 做长期“你最近更常看什么”趋势面板
- 将相似组升级为持久化话题组
- 引入语义聚类而非仅基于标题相似
