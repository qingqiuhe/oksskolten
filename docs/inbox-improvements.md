# Inbox 非 AI 改造 / 修订实施计划

## 背景

`Inbox`（`/inbox`）当前仍由通用 `ArticleListPage` 通过 `unreadOnly=true` 渲染，本质上还是“未读聚合列表”：

- 没有 Inbox 专属组件
- 没有摘要信息
- 没有行内快捷操作
- 移动端手势能力有限

目标是把它改造成“分拣工作台”，并按三个阶段推进。每个阶段都应可独立交付、收集反馈并验证，不把后续复杂能力提前耦合进第一阶段。

本文覆盖 `docs/inbox-improvements.md` 原草稿里的所有非 AI 项目，并将其整理为可执行的分阶段实施计划。

## 任务进度（2026-04-06）

当前实现状态：

- `P0` 已完成
- `P1` 已完成：
  - `2.1 分组视图`
  - `2.2 积压模式`
  - `2.3 移动端滑动手势`
  - `2.4 自动已读撤销`
- `P1 2.5 轻量筛选条` 尚未开始
- `P2` 尚未开始

已落地能力摘要：

- Inbox 专属摘要页头、排序切换、页头 Chat 入口
- 行内快捷动作与 Inbox 专属空态
- `GET /api/inbox/summary`
- `GET /api/articles?sort=oldest_unread`
- Inbox 分组视图：`none / day / feed`
- 移动端左滑打开、右滑标已读、长右滑收藏
- `DELETE /api/articles/:id/seen`
- 自动已读 / 手势已读后的撤销队列与 Undo toast

## 当前实现基线

当前代码里已经存在一批可复用基础设施，P0 应尽量建立在这些能力之上：

- 通用文章列表渲染与分页：`src/components/article/article-list.tsx`
- 列表级 Chat 入口：`src/components/chat/list-chat-fab.tsx`
- 单篇已读 / 收藏 / 喜欢接口
- 批量已读接口：`POST /api/articles/batch-seen`
- 相似文章基础数据：`similar_count`、`article_similarities`
- `sort=score` 排序能力
- 移动端卡片滑动容器：`SwipeableArticleCard`

与计划直接相关的当前接口现状：

- 单篇已读切换当前是 `PATCH /api/articles/:id/seen`，body 为 `{ seen: boolean }`
- 单篇收藏切换：`PATCH /api/articles/:id/bookmark`
- 单篇喜欢切换：`PATCH /api/articles/:id/like`
- 单 feed 抓取：`POST /api/feeds/:id/fetch`
- 全量抓取现状是管理接口：`POST /api/admin/fetch-all`

因此，下面的计划默认优先复用现有接口风格；只有确有必要时才新增路由。

## 分阶段目标

### P0：Inbox 工作台化

优先交付。目标周期约 1 到 2 周。重点是低风险、高感知收益。

### P1：批量处理效率

目标周期约 2 到 3 周。重点是加快扫读、回看与清理 Inbox 的路径。

### P2：差异化能力

目标周期约 2 到 3 周。复杂度更高，应等 P0 和 P1 的交互模型稳定后再做。

## 第一阶段（P0）：Inbox 工作台化

### 1.1 Inbox 摘要接口

新增 `GET /api/inbox/summary`，返回：

- `unread_total`：`seen_at IS NULL` 的文章数，排除 clip feed
- `new_today`：`published_at >= date('now', 'start of day')` 且 `seen_at IS NULL` 的数量
- `oldest_unread_at`：未读文章中的 `MIN(published_at)`
- `source_feed_count`：至少有一篇未读文章的不同 `feed_id` 数

原因：

- `new_today` 和 `oldest_unread_at` 无法从现有 `/api/feeds` 响应可靠推导
- 客户端聚合会多拿很多不必要数据
- 这类摘要数据更适合服务端一次查询返回

文件：

- `server/routes/articles.ts`：新增路由
- `server/db/articles.ts`：新增聚合查询
- `shared/types.ts`：新增响应类型

### 1.2 Inbox 页头栏

新增 `InboxHeader` 组件，仅在 `/inbox` 渲染于列表上方，展示：

- 来自 `GET /api/inbox/summary` 的摘要芯片
- 排序切换：
  - `最新`：默认，`published_at DESC`
  - `积压优先`：P0 先仅提供 UI 占位或沿用最旧时间升序；真正的 `oldest_unread` 排序在 P1 落地
  - `高价值`：使用 Inbox 专用 `sort=inbox_score`

交互要求：

- 排序偏好保存在 `localStorage`
- 仅对 Inbox 生效，不进入全局设置

文件：

- 新增 `src/components/article/inbox-header.tsx`
- 修改 `src/components/article/article-list.tsx`

### 1.3 行内快捷动作

在 `ListCard` / `CompactCard` / `GridCard` 上添加快捷操作：

- 标已读 / 未读
- 收藏 / 取消收藏
- 喜欢 / 取消喜欢
- 在 overlay 中打开

交互要求：

- 桌面端在 `hover` / `focus` 时显示
- 触屏设备提供常驻紧凑操作行，不依赖 `hover`
- 使用乐观更新，直接修改 SWR 缓存
- 请求失败时回滚

服务端：

- 复用现有单篇接口，不新增服务端代码
- 已读切换应沿用当前 `PATCH /api/articles/:id/seen`

文件：

- 新增 `src/components/article/article-inline-actions.tsx`
- 修改 `src/components/article/article-card.tsx`
- 如拆分更细，也可引入 `list-card.tsx` / `grid-card.tsx` / `compact-card.tsx`

### 1.4 Chat 入口前置

在 `InboxHeader` 中增加 Chat 按钮或图标，打开列表范围 Chat。

实现策略：

- 复用现有 `ListChatFab` 和列表作用域逻辑
- P0 先共享同一套 scope preset 逻辑，避免复制 Chat 状态机
- 非 Inbox 页面继续保留 FAB
- Inbox 页面由页头入口主导，FAB 可隐藏

文件：

- `src/components/article/inbox-header.tsx`
- `src/components/article/article-list.tsx`
- 如需要，可抽取 `ListChatFab` 内的 scope / session 逻辑到共享 hook

### 1.5 空态 / 全部读完状态重做

仅在 Inbox 页面改造空态。

场景一：Inbox 为空但 `total_all > 0`，表示“全部已读”

展示操作：

- `抓取更新`
- `查看书签`
- `浏览历史`
- `打开 Chat`

接口说明：

- 如果只是刷新当前来源，复用已有单 feed `POST /api/feeds/:id/fetch`
- 如果产品需要在 Inbox 直接“抓取全部订阅源”，需要明确是否开放当前管理接口 `POST /api/admin/fetch-all`，或新增普通用户可用的 `/api/feeds/fetch-all`

场景二：Inbox 为空且 `total_all === 0`，表示“完全没有文章”

展示：

- 添加订阅源 / 开始使用引导

非 Inbox 页面保持现有简洁空态。

文件：

- `src/components/article/article-list.tsx`

## 第二阶段（P1）：批量处理效率

### 2.1 分组视图

支持分组模式：

- `none`：默认
- `day`
- `feed`

要求：

- 在 `InboxHeader` 中添加分组切换
- 分组标题轻量、可吸顶
- 每组显示未读数
- 无限滚动跨页时，若下一页页首组键与上一页末项相同，抑制重复分组标题

实现方式：

- 客户端基于已获取结果分组
- 无需服务端改动
- 与排序偏好一起持久化到 `localStorage`

文件：

- 新增 `src/components/article/inbox-group-header.tsx`
- 修改 `src/components/article/article-list.tsx`

### 2.2 积压模式（`sort=oldest_unread`）

在 `GET /api/articles` 中新增 `sort=oldest_unread`：

- SQL：`ORDER BY CASE WHEN seen_at IS NULL THEN 0 ELSE 1 END, published_at ASC`
- 语义：优先处理最旧未读，再退回已读老文章

说明：

- 当 `unread=1` 时，它与 `published_at ASC` 接近，但保留统一语义仍有价值
- Inbox 页头中的“积压优先”在这一阶段切到真实后端排序

文件：

- `server/db/articles.ts`
- `server/routes/articles.ts`
- `shared/types.ts`

### 2.3 移动端滑动手势

扩展 `SwipeableArticleCard`：

- 左滑：打开文章，保持现有行为
- 右滑短距离（`>80px`）：标已读
- 右滑长距离（`>160px`）：收藏

要求：

- 滑动过程中在卡片背后显示操作图标
- 已读使用对勾图标，收藏使用书签图标
- 操作后直接更新本地缓存

文件：

- `src/components/article/swipeable-article-card.tsx`

### 2.4 自动已读撤销

新增撤销未读能力：

- 新接口：`DELETE /api/articles/:id/seen`
- 语义：将当前用户该文章 `seen_at` 设为 `NULL`

备注：

- 当前 `PATCH /api/articles/:id/seen { seen: false }` 已能表达“取消已读”
- 但为撤销场景增加 `DELETE` 更直观，也便于客户端实现“Undo”语义

客户端要求：

- 自动标已读或滑动标已读后，显示带 `撤销` 按钮的 toast
- 客户端维护一个最近 20 项的撤销队列
- 每项撤销窗口 10 秒
- 撤销时调用 unseen 接口并恢复 SWR 缓存

文件：

- `server/routes/articles.ts`
- `server/db/articles.ts`
- 新增 `src/hooks/use-undo-seen.ts`

### 2.5 轻量筛选条

在 Inbox 页头下方添加可折叠筛选条，支持：

- 来源筛选：多选 feed
- 时间范围：今天 / 本周 / 自定义
- 包含已收藏
- 包含已喜欢

参数映射：

- `feed_ids`
- `since`
- `until`
- `bookmarked`
- `liked`

后端扩展：

- `GET /api/articles` 新增 `feed_ids`，接受逗号分隔多个 feed id
- `since` / `until` 复用现有 `ListChatScopeFilters` 语义

复杂搜索仍然保留在现有搜索弹窗中。

文件：

- 新增 `src/components/article/inbox-filter-bar.tsx`
- 修改 `server/routes/articles.ts`
- 修改 `server/db/articles.ts`
- `shared/types.ts`

## 第三阶段（P2）：差异化能力

### 3.1 重复报道折叠

在 `GET /api/articles` 中新增 `collapse_similar=1`，服务端执行相似分组。

分组算法：

- 读取当前结果集内文章的 `article_similarities` 边
- 使用 union-find 做传递闭包
- 每组选主文章，优先级：
  - 未读
  - 已收藏 / 已喜欢
  - 更高 `score`
  - 更新的 `published_at`

返回结构：

- 列表中仅返回主文章
- 额外附带 `similar_group`
  - `count`
  - `articles: SimilarArticleSummary[]`

分页策略：

- 分组后按“组”计数
- 为避免 SQL 分页后分组不足，需要先放大 SQL `LIMIT`，例如 `limit * 2`
- 后处理分组后再裁剪到最终 `limit`

交互：

- Inbox 默认开启折叠
- v1 不扩展到其他列表页
- 客户端支持展开 / 折叠子文章

文件：

- `server/db/articles.ts`
- `server/routes/articles.ts`
- `shared/types.ts`
- 新增 `src/components/article/similar-group.tsx`

### 3.2 显式选择模式 + 批量操作

在 Inbox 页头添加“选择”按钮，进入选择模式。

选择模式要求：

- 每行显示复选框
- 底部吸顶批量操作栏
- 提供 `取消` / `全选可见`

批量操作 v1：

- 标已读：复用 `POST /api/articles/batch-seen`
- 收藏：新增 `PATCH /api/articles/batch-bookmark`，body 为 `{ ids: number[] }`

说明：

- “移到 Clips”已移除
- Clips 适合用户外部收藏，不适合 RSS 文章重新分类
- “收藏”已经足够覆盖“稍后再看”

文件：

- `server/routes/articles.ts`
- `server/db/articles.ts`
- `shared/types.ts`
- 新增 `src/components/article/inbox-selection-bar.tsx`
- 修改 `src/components/article/article-list.tsx`

## 公共 API 变更汇总

| 阶段 | 接口 | 方法 | 说明 |
|---|---|---|---|
| P0 | `/api/inbox/summary` | `GET` | Inbox 摘要统计 |
| P1 | `/api/articles/:id/seen` | `DELETE` | 撤销标已读 |
| P1 | `/api/articles` | `GET` | 添加 `feed_ids` |
| P1 | `/api/articles` | `GET` | 添加 `sort=oldest_unread` |
| P2 | `/api/articles` | `GET` | 添加 `collapse_similar=1` |
| P2 | `/api/articles/batch-bookmark` | `PATCH` | 批量收藏 |

补充说明：

- 现有单篇已读切换接口保持为 `PATCH /api/articles/:id/seen`
- 新参数缺省时现有接口行为必须保持不变

## 需修改的关键文件

- `server/routes/articles.ts`
- `server/db/articles.ts`
- `src/components/article/article-list.tsx`
- `src/components/article/swipeable-article-card.tsx`
- `src/components/article/article-card.tsx`
- `shared/types.ts`

## 新增文件

- `src/components/article/inbox-header.tsx`
- `src/components/article/article-inline-actions.tsx`
- `src/components/article/inbox-filter-bar.tsx`（P1）
- `src/components/article/inbox-group-header.tsx`（P1）
- `src/hooks/use-undo-seen.ts`（P1）
- `src/components/article/similar-group.tsx`（P2）
- `src/components/article/inbox-selection-bar.tsx`（P2）

## 验证计划

### 各阶段服务端测试

P0：

- `GET /api/inbox/summary` 返回正确计数
- clip feed 被正确排除
- `oldest_unread_at` 在无未读时返回 `null`

P1：

- `sort=oldest_unread` 排序正确
- `DELETE /api/articles/:id/seen` 能恢复未读状态
- `feed_ids` 多选筛选生效

P2：

- 相似折叠返回稳定分组
- `batch-bookmark` 仅更新指定文章
- 分页场景下分组结果稳定，不因边界变化而抖动

### 各阶段前端冒烟测试

P0：

- Inbox 页头正确渲染摘要
- 行内操作乐观更新且失败可回滚
- Chat 可从页头打开
- Inbox 空态 / 全部读完状态显示正确动作

P1：

- 分组标题显示正确，跨分页时不重复
- 滑动手势触发正确接口调用
- 撤销 toast 能恢复文章状态

P2：

- 相似组支持折叠 / 展开
- 选择模式支持多选、全选可见、批量标已读、批量收藏

### 回归检查

- `/bookmarks`、`/likes`、`/history` 行为保持不变
- feed / category 视图保持当前 smart floor 行为
- 键盘导航（`j` / `k` / `b` / `Enter`）保持正常
- 现有 `sort=score` 行为保持不变；Inbox 的“高价值”改走 `sort=inbox_score`
- 非 Inbox 页面不引入额外复杂交互

## 建议的实施顺序

推荐按下面顺序拆 PR，降低冲突和回归面：

1. P0.1 + P0.2：先落摘要接口和页头壳子
2. P0.3 + P0.4：接行内操作和 Chat 入口
3. P0.5：最后重做空态
4. P1.1 + P1.2：先做分组与真实 backlog 排序
5. P1.3 + P1.4：再接移动端滑动与撤销
6. P1.5：最后补轻量筛选条
7. P2.1：先做相似折叠
8. P2.2：最后做显式选择模式与批量收藏

这样拆分的原因是：

- P0 可以快速验证“工作台化”方向是否成立
- P1 主要是列表交互增强，能建立在 P0 结构上继续演进
- P2 引入新的列表模型和选择态，最适合在前两阶段稳定后进入
