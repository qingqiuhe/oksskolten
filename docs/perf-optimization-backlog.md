# 性能待优化清单

最后更新：2026-06-10

本文记录本轮通过代码审计发现的性能优化点。它是待办清单，不代表已经排期。

## 范围与前提

- 本轮以静态代码审查为主；部分索引改动用 `ssh thinkpad` 临时 SQLite 合成库做了微基准复测。
- 优先级按“预期收益 + 影响范围”排序，不单独按实现难度排序。
- `docs/spec/90_perf_retry_backoff.md`、`docs/spec/91_perf_score_recalculation.md`、`docs/spec/92_perf_chat_scope_implementation.md` 已覆盖的已落地优化不在这里重复展开。

## P0

### 1. 降低 `/api/articles` 的单次请求查询扇出

进展：

- 2026-06-08：已完成第一步小优化。非首屏分页不再重复计算 `total_without_floor`，`limit=0` 的总数查询会跳过主列表查询，并增加 `ARTICLES_PERF_LOG=1` 下的轻量 query count / elapsed 日志。
- 2026-06-10：已完成第二步 smart floor 短缓存。`getArticles()` 对同一筛选 scope 的 smart floor 元数据做 15 秒内存缓存，连续翻页/重复请求可跳过第 N 新文章时间和最早未读时间两条 floor 查询；测试用 `perfStats.queryCount` 验证缓存命中后查询数从 4 降到 2。
- 2026-06-10：已完成第三步 offset 页 count 跳过。`GET /api/articles` 只在首屏请求精确 `total` 和 `total_without_floor`，后续分页改为 `limit + 1` 探测 `has_more`，避免无限滚动每页都跑精确 `COUNT(*)`；DB 层测试验证 `includeTotal: false` 时只执行主分页查询，路由测试验证 offset 页仍返回正确 `has_more`。
- 2026-06-10：已完成第四步 feed 最新页索引优化。新增 `(user_id, feed_id, published_at DESC)` 索引，让单 feed 默认最新列表和对应 smart floor 查询从“按用户全局发布时间扫描再过滤 feed”变成直接按 user/feed 范围读取最新文章；测试用 `EXPLAIN QUERY PLAN` 锁定 `idx_articles_user_feed_published`。
- 2026-06-10：已完成第五步未读列表 partial index。新增 active unread partial index `(user_id, published_at DESC, feed_id) WHERE purged_at IS NULL AND seen_at IS NULL`，让 user-scoped 未读最新列表从用户全量文章时间索引扫描收窄到 active/unread 子集；测试用 `EXPLAIN QUERY PLAN` 锁定 `idx_articles_user_unread_published_active`。
- 2026-06-10：`ssh thinkpad` 临时 SQLite 合成库（300k articles / 15k unread）微基准显示，user-scoped 未读首屏 median 约从 0.036ms 降到 0.009ms，`OFFSET 5000 LIMIT 21` median 约从 8.337ms 降到 0.503ms；查询计划从 `idx_articles_user_published_at` 切到 `idx_articles_user_unread_published_active`。
- 2026-06-10：已完成第六步 Inbox summary 扫描范围优化。`getInboxSummary()` 显式使用 active unread partial index，并保留 `purged_at IS NULL` / `seen_at IS NULL` / clip feed 排除语义，让 unread summary 聚合从 active 全量文章扫描收窄到 active/unread 子集；DB 测试同时验证 summary 结果和查询计划。本地 SQLite 合成微基准（300k articles / 15k unread）显示 summary median 约从 47.669ms 降到 4.940ms。
- 2026-06-10：已完成第七步 backlog oldest-unread 排序优化。新增 active unread expression index `(user_id, COALESCE(published_at, fetched_at), feed_id) WHERE purged_at IS NULL AND seen_at IS NULL`，并在 `unread=1&sort=oldest_unread` 时去掉恒为 0 的 `CASE WHEN seen_at IS NULL` 排序项，让 SQLite 可直接按最旧时间走索引；30 万 articles 合成库微基准约 `18.980ms -> 2.463ms`，约 `7.7x`。

代码证据：

- `server/routes/articles.ts:315-373`
- `server/db/articles.ts:812-936`
- `migrations/0021_article_feed_published_index.sql`

现状：

- 一次列表请求在返回分页数据前，可能触发多次 SQLite 查询：
  - smart floor 的第 N 新文章时间查询
  - smart floor 的最早未读文章时间查询
  - 首屏总数统计查询
  - 首屏可选的 `total_without_floor` 统计查询
  - 主列表查询
- 当未读结果为空时，路由还会额外再跑一次 `getArticles()` 计算 `total_all`。
- `inbox_score` 排序下还会叠加 feed/category 历史 CTE 和相似度聚合。

为什么值得优先做：

- 这是应用最热的接口之一，但当前每次翻页都在重复做统计和排序准备。
- 无限滚动会把这部分成本带到第 2、3、4 页，而这些页通常不需要重新算总数和 smart floor。

建议方向：

- 把首屏元数据与后续分页拆开，或者改成 cursor 分页。
- 对当前筛选条件下的 smart floor 和 count 结果做短 TTL 缓存。
- 对 `inbox_score` 的 feed/category 亲和度输入做按窗口预计算，而不是每页现算。

验证方式：

- 对 `GET /api/articles` 记录 p50/p95 延迟。
- 统计单请求 SQL 语句数量。
- 对比首屏与后续分页的平均耗时。

### 2. 避免小文章操作反复触发整份 feed 聚合

进展：

- 2026-06-09：已完成第一步前端 cache 优化。文章列表/详情里的收藏、喜欢、删除、已读批处理和首次阅读，不再用重拉 `/api/feeds` 更新侧边栏计数，改为按已知 article/feed delta 局部修正 SWR cache；失败时仍保留原有文章数据回滚/重拉路径。
- 2026-06-10：已完成第七十八步 Inbox 全部订阅刷新前端削峰。Inbox 全部已读空状态的“抓取更新”不再对所有 active feeds 直接 `Promise.all` 同时调用 `startFeedFetch()`，改为前端最多 4 个并发并保序汇总结果；保留每个 feed 的现有刷新进度语义。8 个 active feeds 的测试形态中刷新请求峰值并发从 8 降到 4，减少 50%。
- 2026-06-10：已完成第七十九步 feed 批量操作前端并发整形。`useFeedBulkActions()` 里的批量 mark-all-read、批量删除从无限 `Promise.all` 改为最多 4 个请求并发，避免选中大量 feeds 时瞬间打出 N 个写请求；批量抓取从原串行逐个 feed 改为同样最多 4 个并发，在不放大峰值到 N 的前提下提升吞吐。8 个 feeds 的测试形态中 mark-all-read/delete 峰值并发从 8 降到 4，减少 50%；bulk fetch 峰值从 1 提升到 4。
- 2026-06-10：已完成第八十步 category 刷新前端并发削峰。`useFeedActions().handleFetchCategory()` 不再对分类下所有 enabled feeds 直接 `Promise.all` 调用 `startFeedFetch()`，改为最多 4 个并发并保序汇总分类刷新结果。8 个 feeds 的测试形态中分类刷新峰值并发从 8 降到 4，减少 50%，同时保留 totalNew/error 汇总语义。
- 2026-06-09：已完成第二步后端聚合优化。`getFeeds(userId)` 在计算 feed article/unread/articles_per_week 聚合时，将 `user_id` 过滤下推到 `active_articles` 子查询，避免多用户实例里先聚合所有用户文章；测试用 `EXPLAIN QUERY PLAN` 确认 scoped 聚合能走 user/feed 前缀索引。
- 2026-06-09：已完成第三步路由扇出优化。`GET /api/feeds` 用一条包含两个标量子查询的 SQL 同时计算 bookmark/like collection counts，保留 bookmark/like 各自的索引路径；同时从已返回的 feeds 列表推导 `clip_feed_id`，避免额外的 clip feed 查询。
- 2026-06-10：已完成第四步侧边栏聚合覆盖索引。新增 `(user_id, purged_at, feed_id, seen_at, published_at, fetched_at)` 索引，让 `getFeeds(userId)` 的 active article count / unread count / articles_per_week / latest_published_at 聚合走覆盖索引；30 万 articles / 1000 feeds 合成库微基准约 `57.885ms -> 18.112ms`，约 `3.2x`。
- 2026-06-10：已完成第五步 collection count active partial index。新增 active bookmark/like partial indexes，让 `/api/feeds` 和 `/api/stats` 附带的 bookmark/like count 避免在旧 `(user_id, bookmarked_at/liked_at)` 索引命中后再回表过滤 `purged_at`；30 万 articles 合成库微基准约 `9.696ms -> 2.830ms`，约 `3.4x`。
- 2026-06-10：已完成第六步批量已读搜索同步收窄。`markArticlesSeen()` 改用 `UPDATE ... RETURNING id`，只把实际从 unread 变 seen 的 article ids 同步到 Meilisearch filter，不再把已 seen、用户不匹配或不存在的输入 id 一并发送；测试覆盖 4 个输入 id 只同步 2 个真实更新 id。若 100 个输入 id 中只有 20 个实际变更，搜索 filter update 文档数从 100 降到 20，减少 80%。
- 2026-06-10：已完成第七步 feed 全部已读路径收窄。`markAllSeenByFeed()` 从 `SELECT affected ids` + `UPDATE` 两条 SQLite 语句改为单条 `UPDATE ... RETURNING id`，并只同步真实变更的本 feed article ids；测试覆盖 4 篇相关/无关文章中只同步 2 个真实更新 id。该路径 DB 语句数从 2 降到 1，减少 50%。
- 2026-06-10：已完成第八步 category 全部已读路径收窄。`markAllSeenByCategory()` 同样从预查询 affected ids 再更新，改为单条 `UPDATE ... RETURNING id`，并只同步真实变更的本 category article ids；测试覆盖跨 category、已读/未读混合场景中只同步 2 个真实更新 id。该路径 DB 语句数从 2 降到 1，减少 50%。
- 2026-06-10：已完成第九步 feed 分类变更搜索同步收窄。`updateFeed(..., { category_id })` 从“更新后再 SELECT 本 feed 全部 active articles 并全量 upsert”改为 `UPDATE articles ... RETURNING`，只同步分类真实变化且未 purge 的文章；分类不变时 Meilisearch upsert 从 N 篇 active articles 降到 0，测试覆盖 no-op 不同步，以及 2 篇变更文章中只同步 1 篇 active doc。
- 2026-06-10：已完成第十步批量 feed 分类移动搜索同步收窄。`bulkMoveFeedsToCategory()` 避免更新后对所有输入 feed 做一次 full active-article SELECT，改为只返回分类真实变化的文章并过滤 purge 文档；测试形态里 3 行文章只同步 1 个 active changed doc。
- 2026-06-10：已完成第十一步 feed 删除路径收窄。`deleteFeed()` 从 `SELECT article ids` + `DELETE feed` 依赖 cascade，改为 `DELETE articles ... RETURNING id` + `DELETE feed`，把待同步搜索删除 id 的收集与文章删除合成一次 SQLite 写语句；测试覆盖只把被删除 feed 的 article ids 发送给 Meilisearch，保留其他 feed 文章。
- 2026-06-10：已完成第十二步 retention purge 批内查询收窄。`purgeExpiredArticles()` 在最初筛选待 purge id 时顺手带出 `images_archived_at`，不再每 500 篇 batch 额外查询一次“哪些文章有归档图片”；每批 SQLite 语句数减少 1 条，外部图片清理和软删除语义保持不变。
- 2026-06-10：已验证但未采用 retention read/unread OR 合并。30 万行 SQLite 合成库微基准显示，两条 read/unread 查询可分别利用索引，合并成 OR 条件反而变慢：stats median 约 `27.793ms -> 38.049ms`，candidate scan median 约 `34.135ms -> 42.566ms`；因此保留分开扫描，避免为了减少 SQL 条数牺牲实际耗时。
- 2026-06-10：已完成第十二步 `/api/stats` 阅读统计扫描合并。`getReadingStats()` 不再先跑 totals 再跑 by_feed 两次 active_articles 扫描，而是从 by_feed 聚合结果汇总 totals；30 万 articles / 1000 feeds 合成库微基准约 `25.183ms -> 14.370ms`，约 `1.75x`，空结果仍保持原来的 `read/unread: null` 语义。
- 2026-06-10：已完成第八十三步 `/api/stats` 辅助统计查询合并。路由层把 feed/category metadata counts 与 bookmark/like collection counts 合到同一条标量 SQL，不再先读 metadata 再调用 `getArticleCollectionCounts()` 做第二条辅助 SQL；响应字段保持不变。该接口辅助统计 SQL 从 2 条降到 1 条，减少 50% DB 往返；API key 路由测试验证一条 SQL 同时包含 `feed_count/category_count/bookmark_count/like_count`。
- 2026-06-10：已完成第十三步单篇文章动作 no-op 收窄。`markArticleSeen()` / `markArticleLiked()` / `markArticleBookmarked()` 改用 `UPDATE ... RETURNING` 读取真实变更后的状态；真实变更路径从 `UPDATE + SELECT` 降到单条写语句，减少 50% DB 往返；重复设置同一状态时只读当前状态返回，不再触发 Meilisearch filter/score 同步。测试覆盖已读、喜欢、收藏重复设置均不调用 `updateDocuments`。
- 2026-06-10：已验证但未采用 retention 专用 partial index。30 万 articles 合成库中，read retention candidate scan 强制旧/新索引约 `2.41s -> 2.21s`（50 次，约 1.09x），unread retention 强制新索引反而略慢约 `2.98s -> 3.06s`；收益不足以抵消额外写入索引维护成本，保留现状。
- 2026-06-10：已验证但未采用 notification pending recent expression index。30 万 articles / 300 feeds 合成库中，`(feed_id, COALESCE(published_at, fetched_at) DESC, id DESC) WHERE purged_at IS NULL` 强制使用时 list 查询约 `2.03s -> 1.32s`（500 次，约 1.5x），但 SQLite 默认仍选择 `idx_articles_feed_id`，且单 feed 候选排序成本不高；暂不增加该写入索引。
- 2026-06-10：已验证但未采用恢复 `chat_messages(conversation_id, id)`。20k conversations / 200k messages 合成库显示计划可去掉 skip-scan 和临时排序，但 100 次会话列表查询仅约 `0.38s -> 0.32s`，收益约 1.2x；长会话形态下也未显示足够强收益，暂不增加重复索引。
- 2026-06-10：已完成第十四步文章阅读记录写路径收窄。`recordArticleRead()` 保留每次阅读刷新 `read_at` 的原语义，但改用 `UPDATE ... RETURNING seen_at, read_at`，把 DB 往返从 `UPDATE + SELECT` 降为 1 条语句，减少 50%；测试用 SQL prepare spy 验证该路径不再准备后续 `SELECT seen_at, read_at`。
- 2026-06-10：已完成第十五步正文更新搜索同步收窄。`updateArticleContent()` 改用 `UPDATE ... RETURNING` 直接生成 Meilisearch 文档，命中更新路径从 `UPDATE + SELECT buildMeiliDoc` 降为 1 条 SQL，减少 50%；user scope 不命中时不再额外查询文章并尝试同步搜索。测试覆盖 returning 行直接用于 `addDocuments`，以及 scoped miss 不触发同步。
- 2026-06-10：已完成第十六步新文章插入搜索同步收窄。`insertArticle()` 改用 `INSERT ... RETURNING` 直接生成 Meilisearch 文档，插入成功路径从 `INSERT + SELECT buildMeiliDoc` 降为 1 条 SQL，减少 50%；测试用 SQL prepare spy 验证插入后不再准备 `FROM articles WHERE id = ?` 的后续文档查询，且同步文档来自 returning 行。
- 2026-06-10：已完成第十七步 retry-only 元数据更新同步收窄。`updateArticleContent()` 现在只在更新影响 Meilisearch 文档字段时才 `RETURNING` 文档并同步搜索；只改 `last_error` / `retry_count` / `last_retry_at` / notification preview 等非搜索字段时直接 `UPDATE`，Meili upsert 从 1 次降为 0。测试覆盖 retry metadata 更新不准备 `RETURNING`，且不调用 `addDocuments`。
- 2026-06-10：已完成第十八步 article-kind-only 更新同步收窄。`article_kind` 不在当前 Meilisearch 文档字段中，因此单独更新 `article_kind` 时不再触发搜索 upsert；该路径 Meili upsert 从 1 次降为 0。测试覆盖 `updateArticleContent(id, { article_kind })` 更新 DB 但不调用 `addDocuments`。
- 2026-06-10：已完成第十九步 existing article kind 批量回填。RSS fetch 对已有文章补 `article_kind` 时不再逐条调用 `UPDATE`，改为按 `article_kind` 分组批量 `UPDATE ... WHERE id IN (...)`；单个 feed 周期里 N 条待回填最多降到 3 条 UPDATE。测试覆盖 4 个候选、2 种 kind 时只准备 2 条 UPDATE，并保持已有 kind 不被覆盖。
- 2026-06-10：已完成第二十步 feed 成功抓取状态写入合并。`fetchSingleFeed()` / `fetchAllFeeds()` 成功路径不再依次调用清错误、写缓存头、写调度 3 条 `feeds` UPDATE，改为 `markFeedFetchSuccess()` 一条 UPDATE 同时写 `last_error/error_count/etag/last_modified/last_content_hash/next_check_at/check_interval`；成功抓取路径 DB 写语句从 3 条降到 1 条，减少 66.7%。DB 测试验证该 helper 一条 UPDATE 同时更新所有成功抓取元数据，fetcher 回归覆盖 RSS/JSON 抓取入口。
- 2026-06-10：已完成第二十一步 feed 错误计数写路径收窄。`updateFeedError()` 的错误路径改用 `UPDATE ... RETURNING error_count`，避免更新后再 `SELECT error_count`；普通错误记录从 2 条 SQL 降到 1 条，减少 50%，触发 backoff 时从 `UPDATE + SELECT + UPDATE next_check_at` 降到 `UPDATE RETURNING + UPDATE next_check_at`，减少 33.3%。DB 测试用 prepare spy 验证不再准备后续 `SELECT error_count FROM feeds`。
- 2026-06-10：已完成第二十二步 feed/category 创建回读收窄。`createFeed()` 和 `createCategory()` 改用 `INSERT ... RETURNING *`，避免插入后再按 `lastInsertRowid` 查询完整行；每次创建路径 SQLite 语句数从 `INSERT + SELECT` 降到 `INSERT RETURNING`，减少 50%。DB 测试用 prepare spy 验证不再准备后续 `SELECT * FROM feeds/categories WHERE id = ?`。
- 2026-06-10：已完成第二十三步 `/api/stats` 元数据计数合并。接口里 `total_feeds` 和 `total_categories` 不再分别准备两条 `COUNT(*)` 查询，改为一条包含两个标量子查询的 metadata SQL；该段 SQLite 往返从 2 次降到 1 次，减少 50%。路由测试用 prepare spy 验证不再准备旧的 feed/category 独立 count SQL。
- 2026-06-10：已完成第二十四步单篇 score 即时同步回读收窄。`updateScore()` 改用 `UPDATE articles SET score = (...) RETURNING score`，把文章已读/喜欢/收藏/阅读记录触发的单篇分数更新从 `UPDATE score + SELECT score` 降为一条 SQL，减少 50%；测试用 prepare spy 覆盖 `markArticleLiked()` 触发路径，验证 Meilisearch score 同步直接使用 returning score。
- 2026-06-10：已完成第二十五步聊天消息插入回读收窄。`insertChatMessage()` 改用 `INSERT ... RETURNING *`，避免每条消息插入后再按 `lastInsertRowid` 查询完整消息；每条聊天消息写入路径从 `INSERT + SELECT` 降到 `INSERT RETURNING`，减少 50%，同时保留更新 conversation `updated_at` 的语义。DB 测试用 prepare spy 验证不再准备后续 `SELECT * FROM chat_messages WHERE id = ?`。
- 2026-06-10：已完成第二十六步 conversation/category 单行写后回读收窄。`createConversation()` 改用 `INSERT ... RETURNING *`，创建路径从 `INSERT + SELECT` 降到 1 条 SQL，减少 50%；`updateConversation()` 和 `updateCategory()` 改用 `UPDATE ... RETURNING *`，命中更新路径从 `SELECT existing + UPDATE + SELECT updated` 降到 1 条 SQL，减少 66.7%。DB 测试用 prepare spy 覆盖不再准备旧的完整行回读查询。
- 2026-06-10：已完成第二十七步剪藏 force-move 搜索同步回读收窄。`POST /api/articles/from-url` 的 `force=true` 路径移动 RSS 文章到 clip feed 时，Meilisearch 同步文档直接来自 `UPDATE articles ... RETURNING`，不再更新后额外查询 `active_articles` 生成搜索文档；该同步文档读取从 `UPDATE + SELECT doc` 降到 `UPDATE RETURNING doc`，减少 50%。路由测试用 prepare spy 验证不再准备旧的 `FROM active_articles WHERE id = ?` 查询。
- 2026-06-10：已完成第二十八步 feed 更新回读收窄。`updateFeed()` 的命中更新路径改用 `UPDATE feeds ... RETURNING *` 返回更新后的 feed，不再先查 existing，也不再更新后额外 `SELECT * FROM feeds WHERE id = ?`；空更新仍走原 no-op 读路径。普通字段更新路径从 `SELECT existing + UPDATE + SELECT updated` 降到 `UPDATE RETURNING`，减少 66.7%。DB 测试用 prepare spy 验证命中更新不再准备完整行查询，并覆盖 feed miss 时不会误更新 article category。
- 2026-06-10：已完成第二十九步聊天消息删除回读收窄。`deleteChatMessage()` 改用 `DELETE ... RETURNING conversation_id`，删除命中路径不再先 `SELECT conversation_id` 再删除；保留删除后更新 conversation `updated_at` 语义。该路径 SQLite 语句数从 `SELECT message + DELETE + UPDATE conversation` 降到 `DELETE RETURNING + UPDATE conversation`，减少 33.3%。DB 测试用 prepare spy 验证不再准备旧的 `SELECT conversation_id FROM chat_messages`。
- 2026-06-10：已验证但未采用会话列表 message 聚合改写。`getConversations()` 目前每个 conversation 用相关子查询按 `(conversation_id, id)` 索引点查 message count / preview；尝试改成先 `LIMIT conversations` 再聚合 `chat_messages` 的 CTE，在 10k conversations / 200k messages 合成库中反而让 SQLite `SCAN m USING INDEX idx_chat_messages_conversation` 扫整张消息索引。200 次查询微基准约 `45.76ms -> 3230.70ms`，因此保留当前相关子查询形态。
- 2026-06-10：已完成第三十步通知 channel 写后回读收窄。`createNotificationChannel()` 改用 `INSERT ... RETURNING *`，创建路径从 `INSERT + SELECT` 降到 1 条 SQL，减少 50%；`updateNotificationChannel()` 改用 `UPDATE ... RETURNING *`，有字段更新路径从 `SELECT existing + UPDATE + SELECT updated` 降到 1 条 SQL，减少 66.7%。设置路由测试用 prepare spy 验证创建和更新入口不再准备旧的完整行回读查询。
- 2026-06-10：已完成第三十一步通知规则 upsert 中间回读收窄。`upsertFeedNotificationRule()` 的规则创建和更新分支改用 `INSERT/UPDATE ... RETURNING *`，不再写完规则本体后通过 `SELECT * FROM feed_notification_rules WHERE id = ?` 回读；保留最终 `getFeedNotificationRule()` 以拼装最新 `channel_ids` 响应。新规则创建分支的规则本体写入从 `INSERT + SELECT rule` 降到 `INSERT RETURNING`，减少 50%；已有规则更新分支的规则本体写入从 `UPDATE + SELECT rule` 降到 `UPDATE RETURNING`，减少 50%。通知 runner 测试用 prepare spy 覆盖创建和更新分支。
- 2026-06-10：已完成第三十二步自定义 LLM provider 写后回读收窄。`createCustomLLMProvider()` 改用 `INSERT ... RETURNING`，创建路径从 `INSERT + SELECT provider` 降到 1 条 SQL，减少 50%；`updateCustomLLMProvider()` 改用 `UPDATE ... RETURNING` 返回公开 provider 行，保留更新前读取 secret 以支持未传 `api_key` 时沿用旧值，因此更新路径从 `SELECT secret + UPDATE + SELECT provider` 降到 `SELECT secret + UPDATE RETURNING`，减少 33.3%。设置路由测试覆盖创建/更新入口仍不暴露 API key，并用 prepare spy 验证不再做旧的公开行回读。
- 2026-06-10：已完成第三十三步用户账号写后回读收窄。`createUser()` / `createInitialOwner()` 改用 `INSERT ... RETURNING *`，创建路径从 `INSERT + SELECT user` 降到 1 条 SQL，减少 50%；`updateUser()` / `updateUserPassword()` 改用 `UPDATE ... RETURNING *`，命中更新路径从 `UPDATE + SELECT user` 降到 1 条 SQL，减少 50%。新增 DB 测试用 prepare spy 覆盖创建、初始 owner、用户资料更新和密码更新均不再准备旧的 `SELECT * FROM users WHERE id = ?`。
- 2026-06-10：已完成第三十四步邀请创建回读收窄。`issueInvitation()` 在删除旧未使用邀请后，改用 `INSERT INTO invitations ... RETURNING *` 返回新邀请，不再插入后按 token 调 `getInvitationByToken()` 回读；发邀请路径从 `DELETE old invites + INSERT + SELECT invitation` 降到 `DELETE old invites + INSERT RETURNING`，减少 33.3%。用户 DB 测试用 prepare spy 验证不再准备旧的 `SELECT * FROM invitations WHERE token = ?`。
- 2026-06-10：已完成第三十五步用户级 Inbox topic cooldown upsert 回读收窄。`upsertInboxTopicCooldown()` 的 user-scoped 分支改用 `INSERT ... ON CONFLICT DO UPDATE ... RETURNING`，不再 upsert 后按 `(user_id, anchor_article_id)` 查询 cooldown 行；该分支从 `UPSERT + SELECT cooldown` 降到 `UPSERT RETURNING`，减少 50%。新增 DB 测试覆盖首次创建和冲突更新都走 `RETURNING`，并验证不再准备旧的 user/anchor 回读查询。
- 2026-06-10：已完成第三十六步匿名 Inbox topic cooldown 写后回读收窄。`upsertInboxTopicCooldown()` 的 `user_id IS NULL` 分支因缺少可用于 `ON CONFLICT` 的唯一约束，仍保留先查 existing 的语义，但创建改为 `INSERT ... RETURNING`，更新改为 `UPDATE ... RETURNING`；匿名创建路径从 `INSERT + SELECT cooldown` 降到 `INSERT RETURNING`，减少 50%，匿名更新路径从 `SELECT existing + UPDATE + SELECT cooldown` 降到 `SELECT existing + UPDATE RETURNING`，减少 33.3%。新增 DB 测试覆盖匿名首次创建和二次更新均不再准备旧的 `WHERE id = ?` 完整行回读查询。
- 2026-06-10：已完成第三十七步 API key 认证审计写入节流。`validateApiKey()` 仍每次按 hash 查库认证，因此删除/禁用仍即时生效，但成功认证后的 `last_used_at` 写入按 key hash 在进程内 60 秒合并；同一 API key 的连续请求从每次认证 1 条 `UPDATE api_keys SET last_used_at` 降到每分钟最多 1 条，若客户端 60 秒内发起 N 次请求，该审计写入减少约 `(N-1)/N`。DB 测试覆盖连续两次校验只写 1 次，超过 60 秒后再次写入。
- 2026-06-10：已完成第三十八步聊天历史替换批量 prepare 收窄。`replaceChatMessages()` 不再在每条消息循环里通过 `runNamed()` 重新 prepare 相同的 `INSERT INTO chat_messages`，改为单次 prepare 后复用 statement；替换 N 条消息时 INSERT statement prepare 次数从 N 降到 1，减少 `(N-1)/N`，5 条消息测试形态中从 5 次降到 1 次，减少 80%。DB 测试覆盖替换 5 条消息仍写入完整历史且 INSERT 只 prepare 一次。
- 2026-06-10：已完成第三十九步通知规则 channel 绑定批量 prepare 收窄。`upsertFeedNotificationRule()` 和 `updateNotificationTaskById()` 不再在每个 channel 绑定新增/删除循环里重复 prepare 相同 INSERT/DELETE，改为每类变更单次 prepare 后复用；删除 R 个旧绑定、新增 A 个新绑定时 prepare 次数从 `R + A` 降到最多 2。测试形态中删除 2 个、插入 2 个，prepare 从 4 次降到 2 次，减少 50%；纯删除或无新增时也不再提前查询最新文章 id 作为新增绑定游标。
- 2026-06-10：已完成第四十步通知规则写后最终回读收窄。`upsertFeedNotificationRule()` 已有规则本体的 `INSERT/UPDATE ... RETURNING *` 和目标 channel id 集合，不再在事务末尾再调用 `getFeedNotificationRule()` 读取规则行和 channels；创建/更新规则路径各减少 2 条最终响应回读 SQL。`updateNotificationTaskById()` 改用 `UPDATE ... RETURNING *`，保留更新前读取 existing 以支持 partial patch，但不再更新后调用 `getFeedNotificationRuleRecordByRuleId()` 二次读取规则和 channels；任务更新路径减少 2 条 SQL。通知 runner 测试验证规则 upsert 不准备旧规则回读，task update 只保留 1 次更新前规则读取且 UPDATE 使用 `RETURNING *`。
- 2026-06-10：已完成第四十一步单条通知任务读取收窄。`getNotificationTaskById(ruleId)` 不再调用 `listNotificationTasks(null)` 后在 JS 里查找目标任务，改为 `WHERE r.id = ?` 读取单条任务并只查询该规则的 channel 列表；单条任务读取从“扫描所有 notification rules + 查询所有匹配 rules 的 channels”收窄为“点查 1 条 rule + 查询 1 条 rule 的 channels”。通知 runner 测试验证单条读取命中 `WHERE r.id = ?`，不再准备带 `lower(f.name)` 排序的全量列表查询。
- 2026-06-10：已完成第四十二步偏好设置批量读取。新增 `getSettings(keys, userId)`，`GET /api/settings/preferences` 不再对 32 个 `PREF_KEYS` 逐个调用 `getSetting()`，改为一次批量 `key IN (...)` 读取当前 scope 的设置；偏好更新接口的 provider/model 校验也复用同一份当前偏好快照，最终响应再批量读取更新后的偏好。默认无 instance preference 的设置页 GET 从约 32 条单 key legacy/user SELECT 降到 1 条批量 SELECT；路由测试验证不再准备旧的 `SELECT value FROM settings WHERE key = ?`。
- 2026-06-10：已完成第四十三步图片存储设置批量读取。`GET/PATCH /api/settings/image-storage` 不再连续调用 9 次 `getSetting('images.*')` 拼响应，改为复用 `getSettings(IMAGE_STORAGE_KEYS)` 批量读取 instance settings；图片存储设置响应查询从 9 条单 key SELECT 降到最多 2 条批量 SELECT（instance + legacy fallback），减少约 77.8%。image-storage 路由测试验证 GET 命中 `key IN (...)`，不再准备旧的 `SELECT value FROM instance_settings WHERE key = ?`。
- 2026-06-10：已完成第四十四步图片上传测试配置批量读取。`POST /api/settings/image-storage/test` 不再分别读取 `images.storage/upload_url/upload_headers/upload_field/upload_resp_path` 5 个配置 key，改为 `getSettings(IMAGE_STORAGE_TEST_KEYS)` 批量读取；远程上传测试入口配置读取从 5 条单 key SELECT 降到最多 2 条批量 SELECT，减少约 60%。image-storage 路由测试验证该入口命中 `key IN (...)`，不再准备旧的单 key instance setting 查询。
- 2026-06-10：已完成第四十五步 Profile 设置批量读取。`GET/PATCH /api/settings/profile` 不再分别读取 `profile.account_name` / `profile.avatar_seed` / `general.language` 3 个 key，改为 `getSettings(PROFILE_SETTING_KEYS)` 一次批量读取；profile 响应读取从 3 条单 key SELECT 降到 1 条批量 SELECT，减少 66.7%。首次访问自动初始化 account name 仍保留，初始化后直接复用当前内存快照返回。settings 路由测试验证 profile GET 命中 `key IN (...)`，不再准备旧的单 key legacy setting 查询。
- 2026-06-10：已完成第四十六步文章图片归档配置读取收窄。`archiveArticleImages()` 不再分别调用 `getSetting()` 读取 `images.storage_path/max_size_mb/storage/upload_url/upload_resp_path/upload_field/upload_headers`，改为每篇文章一次 `getSettings(ARTICLE_IMAGE_SETTING_KEYS)` 配置快照；本地模式还复用同一个 `imagesDir`，多图文章不再每张图重复读取 storage path。单篇图片归档配置读取从至少 4 条、远程模式最多 7 条单 key SELECT 降到最多 2 条批量 SELECT；本地多图场景额外避免每张图 1 次 storage path 查询。article-images 测试验证归档时只调用一次批量设置读取。
- 2026-06-10：已完成第四十七步 LLM task 配置批量读取。`resolveLLMTaskConfig()` 不再分别读取 provider/model/provider_instance 三个偏好 key，改为一次 `getSettings([providerKey, modelKey, providerInstanceKey], userId)`；聊天、摘要、翻译模型调用前的配置读取从 3 条单 key SELECT 降到 1 条批量 SELECT，减少 66.7%。LLM task config 测试验证命中 `key IN (...)`，不再准备旧的 user-scoped 单 key setting 查询。
- 2026-06-10：已完成第四十八步翻译目标语言配置批量读取。`getResolvedTranslateTargetLang()` 在未显式传入 `targetLang` 时，不再分别读取 `translate.target_lang` 和 `general.language`，改为一次 `getSettings(['translate.target_lang', 'general.language'], userId)`；翻译任务目标语言配置读取从最多 2 条单 key SELECT 降到 1 条批量 SELECT，减少 50%。fetcher AI 测试验证翻译任务只调用一次批量设置读取，显式 targetLang 仍可直接短路。
- 2026-06-10：已完成第四十九步文章路由目标语言配置批量读取。`POST /api/articles/translate-titles` 和单篇翻译入口的 `getTranslateTargetLang()` 不再分别读取 `translate.target_lang` 与 `general.language`，改为一次 `getSettings(['translate.target_lang', 'general.language'], userId)`；标题批量翻译和单篇翻译入口的目标语言配置读取从最多 2 条单 key SELECT 降到 1 条批量 SELECT，减少 50%。articles 路由测试验证 translate-titles 命中 `key IN (...)`，不再准备旧的单 key setting 查询。
- 2026-06-10：已完成第五十步 retention 配置批量读取。`GET /api/settings/retention/stats`、`POST /api/settings/retention/purge` 和 retention cron 不再分别读取 `retention.enabled/read_days/unread_days`，改为 `getSettings(['retention.enabled', 'retention.read_days', 'retention.unread_days'])` 一次批量读取；stats 路径读取 read/unread days 从 2 条单 key SELECT 降到 1 条批量 SELECT，purge/cron 路径从 3 条降到 1 条，分别减少 50% 和 66.7%。settings 路由测试验证 retention stats/purge 命中 `key IN (...)`，不再准备旧的单 key setting 查询。
- 2026-06-10：已完成第五十一步 GitHub OAuth 配置批量读取。`/api/oauth/github/authorize`、`GET/POST /api/oauth/github/config` 和 toggle 的 GitHub OAuth 配置判断复用同一份 `getSettings(['auth.github_enabled', 'auth.github_client_id', 'auth.github_client_secret', 'auth.github_allowed_users', 'auth.password_enabled'])` 快照；authorize 成功路径从 enabled 检查 + client 创建的 5 条单 key SELECT 降到最多 2 条批量 SELECT，config GET 从最多 5 条单 key SELECT 降到最多 2 条批量 SELECT，config POST 还避免保存后的最终配置回读，测试验证命中 `key IN (...)` 且不再准备旧的单 key instance setting 查询。
- 2026-06-10：已完成第五十二步认证方法配置读取收窄。`GET /api/auth/methods` 不再单独读取 `auth.password_enabled` 后再调用会重新读 3 个 GitHub OAuth key 的 helper，改为复用同一份 OAuth settings 快照；该公开启动接口的 auth 配置读取从最多 4 条单 key SELECT 降到最多 2 条批量 SELECT。`POST /api/auth/password/toggle` 在已有 passkey 可防锁定时短路 GitHub OAuth 配置读取，关闭密码路径的 OAuth setting SELECT 从最多 3 条降到 0。passkey 路由测试验证 methods 命中 `key IN (...)`，passkey 已存在时 toggle 不再读取 instance settings。
- 2026-06-10：已完成第五十三步翻译 provider 月用量配置批量读取。DeepL 和 Google Translate 的 `usage_month` / `usage_chars` 不再分别调用两次 `getSetting()`，改为一次 `getSettings([...], userId)`；每次翻译后的月用量累计读取，以及设置页读取月用量状态，均从 2 条单 key SELECT 降到 1 条批量 SELECT，减少 50%。provider 单测验证 usage 读取调用批量 helper，且不再逐 key 读取 usage month/chars。
- 2026-06-10：已完成第五十四步 Ollama provider 配置读取收窄。`getOllamaClient()` 不再分别读取 `ollama.base_url` 和 `ollama.custom_headers`，也不再在 headers 存在时为了 JSON parse 再次调用 `getOllamaCustomHeaders()` 读取同一 key；改为一次 `getSettings(['ollama.base_url', 'ollama.custom_headers'], userId)` 并复用当前 headers JSON。Ollama client 创建/缓存检查路径从 2 条单 key SELECT（有 headers 时最多 3 条）降到 1 条批量 SELECT，减少 50%-66.7%。Ollama provider 单测验证 client 创建只调用一次批量 helper且不调用旧单 key读取。
- 2026-06-10：已完成第八十七步 Ollama status 配置快照复用。`/api/settings/ollama/status` 先通过 `getOllamaConnectionConfig()` 批量读取一次 `ollama.base_url` / `ollama.custom_headers`，再把同一份 base URL 和 headers 传给 `/api/version`、`/api/tags` 两个并发探测；不再让每个探测各自读取 base URL 和 headers。该接口配置读取从 4 条单 key SELECT 降到 1 条批量 SELECT，减少 75%。settings 路由测试验证 status 成功响应、两个 fetch 共用 headers、配置查询只命中 1 条 `key IN` 且不再准备旧的单 key settings 查询。
- 2026-06-10：已完成第九十步 Ollama models 配置读取补强。`/api/settings/ollama/models` 复用同一个 `getOllamaConnectionConfig()` 快照读取 base URL 和 custom headers，不再分别调用 `getOllamaBaseUrl()` / `getOllamaCustomHeaders()`；模型列表接口配置读取从 2 条单 key SELECT 降到 1 条批量 SELECT，减少 50%。settings 路由测试验证 `/api/tags` 请求使用配置 headers，且只准备 1 条 `key IN` settings 查询，不再准备旧的单 key settings 查询。
- 2026-06-10：已完成第五十五步 RSS-Bridge LLM provider 探测批量读取。`getAvailableProvider()` 不再按 Anthropic/Gemini/OpenAI 优先级逐个调用 `getSetting(api_key.*)`，改为一次 `getSettings(['api_key.anthropic', 'api_key.gemini', 'api_key.openai'])` 后在内存里按优先级选择；无 key 或只有低优先级 key 时配置读取从最多 3 条单 key SELECT 降到 1 条批量 SELECT，减少 66.7%。RSS-Bridge 测试验证命中 `key IN (...)`，且不再准备旧的单 key settings 查询。
- 2026-06-10：已完成第五十六步 LLM API key 校验结果复用。`LLMProvider.requireKey()` 现在返回已校验的 API key，`runAiTask()`、全文翻译 LLM 分支、JSON API transform 生成和 RSS-Bridge CSS selector 生成会把该 key 传入同一次 `createMessage()` / `streamMessage()`；Anthropic/Gemini/OpenAI provider 在收到 `params.apiKey` 时直接复用，不再再次读取 `api_key.*` setting。常见 LLM 调用路径的 API key DB 读取从 `requireKey + client 构造` 两次降到一次，减少 50%；RSS-Bridge 的 provider key 批量探测结果也直接传入 LLM 请求，避免探测后 provider 内再次查 key。provider 与 fetcher 测试验证传入 `apiKey` 后不再读取 settings。
- 2026-06-10：已完成第五十七步前端 memo 依赖稳定性修复。通知 channel/task 设置页不再用内联 `[]` 作为未加载数据 fallback，避免数据未加载时每次 render 都让 `useMemo` 依赖变化并重复排序/过滤；`useUndoSeen()` 卸载清理时捕获当前 timer map，避免 cleanup 读取变化后的 ref。`npm run lint` 从 3 个 React hooks warning 降到 0 个 warning；相关 hook/设置页测试通过。
- 2026-06-10：已完成第五十八步 chat 用户语言配置复用。`POST /api/chat` 进入一次 turn 时先解析 `general.language`，同一份语言快照同时用于 system prompt 和 tool-loop context；`translate_article` 在收到 context userLanguage 时不再额外读取 setting，缺省直接回退旧的 `getSetting('general.language')` 行为。调用翻译工具的聊天 turn 中语言配置读取从 2 次降到 1 次，减少 50%。chat tool/adapter 测试验证 context 语言不会触发 settings 读取。
- 2026-06-10：已完成第五十九步 chat 摘要语言配置复用。`summarize_article` tool 现在把 tool-loop context 里的 `userLanguage` 传给 `summarizeArticle()`，摘要 prompt 构造可直接使用该语言，不再在同一次聊天 turn 中额外读取 `general.language`；非 chat 摘要入口仍保持旧的默认读取行为。调用摘要工具的聊天 turn 中语言配置读取从 2 次降到 1 次，减少 50%。chat tool 测试验证 context 语言会传入摘要调用且不会准备包含 `general.language` 的 settings 查询。
- 2026-06-10：已完成第六十步 chat adapter API key 复用。Anthropic/Gemini/OpenAI chat adapter 预检查 API key 后，把同一个 key 传给对应 SDK client factory，避免 adapter 先读 setting、client 构造再读 setting；错误语义和外部 client/Ollama 转接行为保持不变。三条在线 chat provider 路径的 API key setting 读取从 2 次降到 1 次，减少 50%。adapter 测试验证 client lookup 收到已读取 key，provider 测试继续覆盖传入 `apiKey` 时不读 settings。
- 2026-06-10：已完成第八十五步 chat 建议入口统计查询合并。`generateSuggestions()` 不再分别为 unread count 和 top category 准备两条 SQLite 查询，改为单条包含两个标量子查询的 stats SQL；打开聊天建议时该段 DB prepare/往返从 2 次降到 1 次，减少 50%。chat suggestions 测试验证 seeded unread/top category 语义不变，且 `generateSuggestions()` 本身只 prepare 1 条包含 `unread_count/top_category_name` 的查询。
- 2026-06-10：已完成第八十六步 chat 用户偏好 collection 查询合并。`get_user_preferences` tool 不再分别查询 recent likes 和 recent bookmarks，改用一条 `UNION ALL` collection 查询取回后在内存中拆分；该工具的 SQLite 查询段从 6 条降到 5 条，减少 16.7%，其中 recent collections 子段从 2 条降到 1 条，减少 50%。chat tools 测试验证 likes/bookmarks 响应形状不变，并用 prepare spy 锁定总 prepare 数为 5 且 collection 查询只准备 1 次。
- 2026-06-10：已完成第八十八步 chat 用户偏好分类聚合复用。`get_user_preferences` tool 不再分别查询 top categories 和 30 天 category read rates，改为单条 category stats SQL 同时产出全量 engagement 与最近 30 天阅读率，再在内存中派生两份响应；该工具 SQLite 查询段从 5 条降到 4 条，较第八十六步再减少 20%，较优化前 6 条减少 33.3%。chat tools 测试验证 `top_categories`、`category_read_rates` 响应语义不变，并用 prepare spy 锁定总 prepare 数为 4 且 category stats 查询只准备 1 次。
- 2026-06-10：已完成第八十九步 chat 用户偏好 feed 聚合复用。`get_user_preferences` tool 不再分别查询 top feeds 和 ignored feeds，改为单条 feed stats SQL 同时产出 engagement、article/read rate 和最近 30 天 unread count，再在内存中派生两份响应；该工具 SQLite 查询段从 4 条降到 3 条，较第八十八步再减少 25%，较优化前 6 条减少 50%。chat tools 测试验证 `top_feeds`、`ignored_feeds`、recent collections 和 category stats 响应语义不变，并用 prepare spy 锁定总 prepare 数为 3，三类聚合查询各只准备 1 次。
- 2026-06-10：已完成第六十一步归档图片静态服务路径短缓存。`GET /api/articles/images/:filename` 不再每张图片都读取 `images.storage_path` setting，而是用 5 秒进程内短缓存解析归档目录；`PATCH /api/settings/image-storage` 修改 storage path 时显式失效缓存。连续请求 N 张归档图片时 storage path DB 读取从 N 次降到 1 次，减少 `(N-1)/N`，两张图片测试形态中减少 50%。clip article 路由测试验证连续图片请求只准备 1 次 instance setting 读取。
- 2026-06-10：已完成第六十二步图片归档入口配置快照复用。`POST /api/articles/:id/archive-images` 现在先批量读取一次图片归档配置快照，同一份快照同时用于 `images.enabled` 判断和后台 `archiveArticleImages()`，避免入口单 key enabled 读取后后台再批量读取 storage/max/upload 配置。该入口图片配置读取从 1 次单 key SELECT + 1 次批量 SELECT 降到 1 次批量 SELECT，配置读取往返减少 50%。clip article 路由测试验证 enabled 判断和归档任务共用同一份 settings 快照。
- 2026-06-10：已完成第六十三步抓取调度最小间隔配置短缓存。`getFetchScheduleConfig()` 对 `system.feed_min_check_interval_minutes` 做 5 秒进程内短缓存，`PATCH /api/settings/fetch-schedule` 更新配置后显式失效；`fetchSingleFeed()` / `fetchAllFeeds()` 和设置页 GET 的连续读取不再每次都查 settings。连续 N 次读取调度配置时 DB 读取从 N 次降到 1 次，减少 `(N-1)/N`，两次读取测试形态中减少 50%。schedule 测试验证缓存窗口内只准备 1 次 instance setting 读取。
- 2026-06-10：已完成第六十四步 RSSHub social source base URL 短缓存。`getSocialRssHubBaseUrl()` 对 `social.rsshub_base_url` 做 5 秒进程内短缓存，`PATCH /api/settings/social-sources` 更新或清空配置后显式失效；连续创建/解析多个 X social feed 时不再每次都读 settings。连续 N 次解析 social feed 时 base URL DB 读取从 N 次降到 1 次，减少 `(N-1)/N`，两次解析测试形态中减少 50%。social-feeds 测试验证缓存窗口内只准备 1 次 instance setting 读取。
- 2026-06-10：已完成第六十五步 Google/DeepL 翻译配置读取合并。`runTranslateTask()` 在选择 `google-translate` 或 `deepl` provider 时，把目标语言配置和对应 provider API key 放进同一次 `getSettings()` 批量读取，并把已读取 key 传给 provider 执行函数，避免 provider 内部再次单 key 读取。未显式传 targetLang 的 Google/DeepL 翻译任务配置读取从 1 次目标语言批量 SELECT + 1 次 API key 单 key SELECT 降到 1 次批量 SELECT，读取往返减少 50%。fetcher AI 测试验证目标语言和 API key 同批读取，provider 测试验证传入 API key 时不再读 settings。
- 2026-06-10：已完成第六十六步密码登录配置短缓存。`POST /api/login` 不再每次请求都读取 `auth.password_enabled`，改为 5 秒进程内短缓存，并在 `POST /api/auth/password/toggle` 修改密码登录开关后显式失效。连续 N 次密码登录请求的 password auth setting DB 读取从 N 次降到 1 次，减少 `(N-1)/N`，两次登录测试形态中减少 50%。auth 路由测试验证连续登录只准备 1 次 instance setting 读取，passkey 路由测试覆盖开关入口。
- 2026-06-10：已完成第六十七步社交源设置页复用 RSSHub base URL 短缓存。`GET /api/settings/social-sources` 不再直接读取 `social.rsshub_base_url`，改为复用 `getSocialRssHubBaseUrl()` 的 5 秒短缓存；同一个 PATCH 失效点同时覆盖设置页和社交 feed 解析入口。连续 N 次设置页读取的 RSSHub base URL DB 读取从 N 次降到 1 次，减少 `(N-1)/N`，两次 GET 测试形态中减少 50%。settings 路由测试验证重复 GET 只准备 1 次 instance setting 读取。
- 2026-06-10：已完成第六十八步任务模型设置页 API key 状态批量读取。新增 `GET /api/settings/api-keys` 一次返回 Anthropic/Gemini/OpenAI/Google Translate/DeepL 的 configured 状态，`TaskModelSection` 不再并发请求 5 个 `/api/settings/api-keys/:provider`。该页面 API key 状态 HTTP/SWR 请求从 5 个降到 1 个，减少 80%；服务端 settings 读取从 5 条单 key SELECT 降到 1 条批量 `key IN (...)` SELECT，减少 80%。settings 路由测试验证批量接口命中 `key IN (...)` 且不准备旧单 key查询，前端测试验证组件只使用批量 SWR key。
- 2026-06-10：已完成第六十九步 Provider 配置区 API key 状态批量读取。`ProviderConfigSection` 复用同一个 `GET /api/settings/api-keys` 批量接口，把内置 LLM provider 与翻译 provider 的 5 张配置卡从“每卡一个 SWR 状态请求”改为父组件一次读取后下发 configured 状态；保存/删除单个 key 仍保留原单 provider POST 语义，完成后刷新批量状态。该配置区 API key 状态 HTTP/SWR 请求从 5 个降到 1 个，减少 80%；与批量接口配合，服务端状态读取同样从 5 条单 key SELECT 降到 1 条 `key IN (...)`。provider 配置区测试验证不再使用单 provider 状态 SWR key，demo mock 也支持批量接口。
- 2026-06-10：已完成第七十步 Integration 设置页共享数据提升。`IntegrationTab` 现在统一读取 API key 状态、Claude Code 状态、preferences、自定义 LLM providers 四份共享数据，并传给 `ProviderConfigSection` / `TaskModelSection`；两个 section 在收到共享数据时不再各自触发 fallback SWR 请求。该 tab 内共享数据请求从两个 section 各自读取的 8 个请求形态降到父级 4 个请求，减少 50%；其中 `/api/settings/preferences`、`/api/settings/custom-llm-providers` 和 `/api/chat/claude-code-status` 从重复 2 次降到 1 次。新增 integration-tab 测试验证四个共享 SWR key 各只出现 1 次。
- 2026-06-10：已完成第七十一步 Security 设置页认证状态共享。`SettingsPage` 在 security tab 统一读取 `/api/auth/methods` 并下发给 `PasswordSettings`、`PasskeySettings`、`GitHubOAuthSettings`，同时复用页面已有 `/api/me` 结果给 `PasswordSettings`；三个组件在收到共享数据时不再各自触发 fallback SWR 请求。security tab 中 `/api/auth/methods` 请求从 3 次降到 1 次，减少 66.7%；`/api/me` 从页面 + 密码设置两次降到 1 次，减少 50%；两类共享读取合计从 5 个请求降到 2 个，减少 60%。SettingsPage 测试验证 security tab 下两个 SWR key 分别只出现 1 次。
- 2026-06-10：已完成第七十二步 Notifications 设置页共享 channel/me 数据。`NotificationsTab` 统一读取 `/api/settings/notification-channels` 并传给 channels/tasks 两个 section，`SettingsPage` 复用已有 `/api/me` 结果传给 `NotificationTasksSection`；两个 section 在收到共享数据时不再触发 fallback SWR 请求。notifications tab 中 notification channels 请求从 2 次降到 1 次，减少 50%；`/api/me` 从页面 + tasks section 两次降到 1 次，减少 50%；两类共享读取合计从 4 个请求降到 2 个，减少 50%。SettingsPage 测试验证 notifications tab 下两个 SWR key 分别只出现 1 次，通知 section 测试继续覆盖原编辑行为。
- 2026-06-10：已完成第七十三步 Data 设置页复用当前用户数据。`DataTab` 支持从 `SettingsPage` 接收已有 `/api/me` 结果来判断管理员权限，收到共享数据时不再触发内部 `/api/me` fallback 请求。data tab 中 `/api/me` 请求从 SettingsPage + DataTab 两次降到 1 次，减少 50%。SettingsPage 测试验证 data tab 下 `/api/me` SWR key 只出现 1 次。
- 2026-06-10：已完成第七十四步管理员通知任务初始 scope 去重。`NotificationTasksSection` 在收到共享的 admin/owner 当前用户数据时，初始 scope 直接设为 `all`，避免先按默认 `self` 请求任务列表、再由 effect 切到 `all` 触发第二次请求。管理员打开 notifications tab 的任务列表请求从 `self + all` 两次降到 `all` 一次，减少 50%；普通用户仍默认 `self`。notification-tasks 测试验证 shared admin 路径只出现 `/api/settings/notification-tasks?scope=all`，不会先请求 `scope=self`。
- 2026-06-10：已完成第七十五步通知任务 PATCH 更新后回读收窄。`PATCH /api/settings/notification-tasks/:id` 更新成功后不再再次调用 `getNotificationTaskById()` 回读完整任务，而是复用授权检查阶段已读取的 task、`updateNotificationTaskById()` 返回的更新字段，以及本次已验证的 channel 列表在内存中拼回原响应形状。命中更新路径的任务详情 SQL 从 2 次降到 1 次，减少 50%，同时保持 `channels` 等响应字段不变。settings 路由测试用 prepare spy 验证 `WHERE r.id = ?` 任务详情查询只准备 1 次，runner 测试继续覆盖 update helper 返回结构。
- 2026-06-10：已完成第七十六步 Members 设置页订阅导入数据懒加载。`MembersTab` 初始只加载 `/api/users`，`/api/feeds` 和 `/api/categories` 改为用户第一次打开订阅选择器时按需加载，加载后保留数据以维持选择计数和 invite reset 语义。成员页初始 SWR/HTTP 请求从 3 个降到 1 个，减少 66.7%。members-tab 测试验证初始不请求 feeds/categories，打开选择器后再请求并默认选中非 clip feeds。
- 2026-06-10：已完成第九十一步添加社交源弹窗复用 RSSHub 配置。`FeedList` 已经读取 `/api/settings/social-sources` 用于判断是否展示社交源入口，现在会把同一份 `rsshub_base_url` 传给 `FeedModal` / `SocialFeedStep`；`SocialFeedStep` 仅在独立使用且没有共享配置时才 fallback 请求设置。打开 FeedList 并进入添加 X feed 表单时 social-sources SWR/HTTP 请求从 2 次降到 1 次，减少 50%。feed-list 和 social-feed-step 测试验证父级传递共享 URL，且共享路径下子组件 SWR key 为 `null`。
- 2026-06-10：已完成第九十二步文章聊天面板复用已发现会话。`ChatFab` 和普通文章详情页的 `useChatInline()` 已经读取 `/api/chat/conversations?article_id=...` 用于展示已有对话和自动打开面板，现在会把已发现的第一条 conversation id 传给 `ChatPanel`；`ChatPanel` 在已有 `conversationId` 时不再重复请求同一个 article conversation discovery。对已有对话的文章，打开聊天面板时该 discovery 请求从 2 次降到 1 次，减少 50%。chat-panel 测试验证无 conversation id 时保留 fallback 查询，已有 id 时不再使用 article discovery SWR key 并直接加载已知会话。
- 2026-06-10：已完成第九十三步 Command Palette 复用侧栏列表数据并懒加载。`CommandPalette` 支持接收 `FeedList` 已有的 feeds/categories 数据，侧栏内常驻渲染时不再自己订阅 `/api/feeds` 和 `/api/categories`；独立使用且打开时仍 fallback 加载列表数据，关闭态无共享数据时也跳过内部 SWR。FeedList 场景中 CommandPalette 额外 list endpoint SWR 订阅从 2 个降到 0；独立关闭态从 2 个降到 0，减少 100%。command-palette 测试验证共享路径和关闭态 SWR key 都为 `null`，独立打开态仍加载两个 endpoint。
- 2026-06-10：已完成第九十四步 FeedList 复用 `/api/feeds` 里的 clip feed id。`FeedList` 原本已经通过主 `/api/feeds` 响应拿到 `clip_feed_id`，但仍调用 `useClipFeedId()` 再建立一个同 key SWR 订阅；现在 clip nav 直接使用 `feedsData.clip_feed_id`。侧栏常驻 `/api/feeds` SWR 订阅从 2 个降到 1 个，减少 50%；现有 feed-list clip nav 测试覆盖 `clip_feed_id` 存在/为空/未读 badge 语义。
- 2026-06-10：已完成第九十五步 fab 聊天模式停用 inline conversation discovery。普通文章详情页原本无论 `chatPosition` 是 `inline` 还是 `fab` 都会调用 `useChatInline()` 并订阅 `/api/chat/conversations?article_id=...`；`fab` 模式下 `ChatFab` 自己已经负责已有对话 badge 和自动打开，因此现在 `useChatInline()` 支持 `enabled=false`，文章详情仅在 inline 模式启用。fab 模式下 article conversation discovery SWR 订阅从 inline hook + ChatFab 两个降到 ChatFab 一个，减少 50%。chat-inline 测试验证 disabled 时 SWR key 为 `null`，enabled 时保留原查询。
- 2026-06-10：已完成第九十六步 ChatPanel 外部状态路径跳过内部 chat hook。`ChatPanel` 在 HomePage 和 ListChatFab 等场景会收到外部 `chatState`，但优化前仍无条件调用内部 `useChat(scope)` 初始化一套未使用的消息、streaming、tool 状态和回调；现在拆成 `InternalChatPanel` / `ChatPanelContent`，只有没有外部状态时才调用 `useChat()`。外部 chatState 路径的内部 chat hook 初始化从 1 次降到 0，减少 100%；chat-panel 测试验证传入外部状态时不调用 `useChat`，无外部状态时仍按 scope 创建内部状态。
- 2026-06-10：已完成第九十七步空 feed 跳过活动指标请求。`FeedMetricsBar` 的平均正文长度来自 `/api/feeds/:id/metrics`，但 `article_count=0` 时必然没有可展示的平均长度；现在空 feed 的 metrics SWR key 为 `null`，只展示本地已有的文章数/活跃状态。空 feed 顶部活动条的 metrics HTTP/SWR 请求从 1 次降到 0，减少 100%。feed-metrics-bar 测试验证空 feed 不请求 metrics endpoint。
- 2026-06-10：已完成第九十八步邀请导入订阅后台抓取并发削峰。`POST /api/users` 创建邀请并导入订阅后，原先会对所有可抓取 imported feeds 立即循环 `fetchSingleFeed(...).catch(...)`，导入 N 个订阅时同步启动 N 个后台抓取任务；现在改为 fire-and-forget worker pool，复用 `FETCH_CONCURRENCY` 默认 5 的上限。8 个导入 feed 的测试形态中初始后台抓取启动峰值从 8 降到 5，减少 37.5%；请求响应仍不等待抓取完成，导入结果语义不变。
- 2026-06-10：已完成第九十九步通知规则 channel binding 批量写入。`upsertFeedNotificationRule()` 和 `updateNotificationTaskById()` 在变更多个通知 channel 时，删除绑定改为一条 `DELETE ... channel_id IN (...)`，新增绑定改为一条多 `VALUES` INSERT，不再对每个 channel 循环执行单行写。测试形态中 2 个 removed + 2 个 added 从 4 次 binding 写 SQL 降到 2 次，减少 50%；一般形态从 removed N + added M 次写降到最多 2 次写。runner 测试验证删除 SQL 使用 `IN (?, ?)`，插入 SQL 包含 2 组 values。
- 2026-06-10：已完成第一百步通知 channel 校验读取收窄。`PUT /api/feeds/:id/notification-rule` 保存规则时不再先读取当前用户全部 notification channels 再内存过滤，而是按请求里的 `channel_ids` 做一条 scoped `id IN (...)` 查询；`PATCH /api/settings/notification-tasks/:id` 变更多个 channels 时也从逐个 `getNotificationChannelById()` 改为一条批量查询。settings 测试形态中 2 个 channel id 的校验查询从 2 条降到 1 条，减少 50%；feed 规则保存从 O(用户全部 channels) 读取收窄到 O(请求 channel_ids)，测试验证不会准备全量 `ORDER BY created_at` channel 列表查询。

代码证据：

- `server/db/feeds.ts:11-32`
- `server/db/articles.ts:1322-1334`
- `server/db/categories.ts:84-110`
- `server/db/notifications.ts`
- `server/routes/feeds.ts`
- `server/routes/settings.ts`
- `src/components/article/article-list.tsx`
- `src/components/article/article-detail.tsx`
- `src/hooks/use-article-actions.ts`
- `src/lib/feeds-cache.ts`

现状：

- `/api/feeds` 会基于全量 `active_articles` 聚合 unread、article_count、articles_per_week、latest_published_at。
- 书签、喜欢、已读批量刷新、删除等很多细粒度动作，都会全局 invalidation `/api/feeds` 相关 SWR key。

为什么值得优先做：

- 一个很轻的单文章操作，会触发一次偏重的侧边栏全量重算。
- 连续阅读时，这会造成重复数据库工作和不必要的 rerender。

建议方向：

- 常见文章动作先在本地 cache 里乐观更新 feed 计数。
- 为侧边栏拆更轻的接口或更轻的数据模型，减少整份 `/api/feeds` 重拉。
- 如果大库规模下重算开始明显变慢，可以考虑 feed 级别的反规范化计数。

验证方式：

- 统计连续 10 次文章操作会触发多少次 `/api/feeds`。
- 比较优化前后的侧边栏 rerender 次数与 DB 耗时。

### 3. 把搜索维护从“全量定时活”改成更增量的方式

进展：

- 2026-06-09：已完成第一步内存峰值优化。`rebuildSearchIndex()` 和 `syncAllScoredArticlesToSearch()` 改为按 `id` keyset 分批读取 SQLite，每批 1000 条直接写入 Meilisearch，避免一次性加载全量 `rows` 并映射成第二份 `docs` 数组；补了 1001 条数据的批处理测试覆盖 rebuild 和 score sync。
- 2026-06-09：已完成第二步扫描范围优化。`recalculateScores()` 改为分批返回参与重算的 article ids，cron 后续调用 `syncArticleScoresToSearch(ids)` 只同步这些 ids 的分数，避免重算后再对所有 scored articles 做一次全量搜索同步扫描；保留 `syncAllScoredArticlesToSearch()` 作为手动/兜底全量同步。
- 2026-06-10：已完成第三步批内往返优化。`recalculateScores()` 从每批 `SELECT id` + `UPDATE ... WHERE id IN (...)` 改为单条 `UPDATE ... RETURNING id`，保持同一 WHERE 与分批语义，同时把批内 SQLite 语句数减半；1001 条 qualifying articles 的测试覆盖为 3 个更新批次加 1 个空批次。
- 2026-06-10：已完成第四步搜索同步查库优化。`recalculateScores()` 的 `RETURNING` 现在同时返回 `id, score`，score cron 直接调用 `syncArticleScoreUpdatesToSearch(scoreUpdates)` 推给 Meilisearch，不再用 ids 回 SQLite 二次查询当前分数；旧的 `syncArticleScoresToSearch(ids)` 保留为手动/兜底路径。

代码证据：

- `server/index.ts`
- `server/db/articles.ts`
- `server/search/sync.ts`
- `server/db/articles.test.ts`
- `server/search/sync.test.ts`

现状：

- score 重算默认仍是每 5 分钟一次；目前重算后只按本轮参与重算的 ids 同步 Meilisearch score，不再额外全量扫描 scored articles。
- 优化前搜索重建会先把所有文章一次性读入内存，再映射成第二份数组后分批写入索引；目前已改为分批读取，但全量 rebuild 本身仍然跟文章总量绑定。
- 此外还配置了每 6 小时一次的全量 rebuild。

为什么值得优先做：

- 这些任务的成本跟“文章总量”绑定，而不是“本次发生变化的文章量”绑定。
- 它们和正常 API、抓取流程运行在同一台宿主机上，会争抢 CPU 与内存。
- `rows -> docs` 的双份内存占用会抬高 rebuild 峰值内存。

建议方向：

- 进一步把“参与重算的 ids”收窄为真实 dirty article ids，减少 score 重算本身的扫描范围。
- 全量 rebuild 降为恢复性操作，或至少把默认频率调得更低。
- 继续减少全量 rebuild / score sync 的触发频率与扫描范围。

验证方式：

- 记录 rebuild 总时长、峰值 RSS、Meilisearch task 耗时。
- 对比分数同步窗口内的 CPU 占用。

### 4. 控制前端文章列表的 DOM 持续膨胀

进展：

- 2026-06-09：已完成第一步渲染窗口优化。文章列表超过 120 篇已加载文章时，默认只保留最新 120 篇在 DOM 中，顶部提供按 60 篇一组展开更早已加载文章的入口；完整 loaded article ids 仍保留给聊天 scope、键盘数据和本地状态使用。
- 2026-06-10：已完成第二步交互窗口对齐。键盘导航现在只接收当前渲染窗口内的 article ids，避免 `j/k` 聚焦到不在 DOM 中的早期文章，同时继续把完整 loaded article ids 保留给聊天 scope。
- 2026-06-10：已完成第三步翻译工作集对齐。标题翻译现在只处理当前渲染窗口内的文章，避免长列表中隐藏的早期文章先消耗翻译请求；展开更早文章后再按需翻译。

代码证据：

- `src/components/article/article-list.tsx`
- `src/components/article/article-list.test.tsx`
- `src/lib/i18n.ts`

现状：

- 无限滚动拿到的分页数据会被拍平成一个持续增长的 `articles` 数组。
- 优化前列表会一直保留所有已渲染文章节点；目前已加已加载文章渲染窗口，默认 DOM 常驻量被限制，但还不是基于滚动位置的完整 virtualization。
- IntersectionObserver 和 MutationObserver 的跟踪节点数已随渲染窗口下降，但完整滚动 virtualization 仍可继续降低长列表成本。

为什么值得优先做：

- 长时间阅读后，DOM 体积、observer 工作量、React diff 成本会一起上涨。
- 单次接口即便不慢，低端移动设备上也可能越来越“沉”。

建议方向：

- 继续推进基于滚动位置的 virtualization。
- 对列表窗口做真实设备上的 DOM/heap/FPS 实测，再决定是否需要更细粒度的 item height 管理。
- 把键盘导航状态和 DOM 常驻解耦，给虚拟化留空间。

验证方式：

- 分别在加载 100、300、500 篇文章后测 DOM 节点数和 JS heap。
- 检查桌面端和移动端滚动 FPS。

## P1

### 5. 列表标题翻译改为受控并发或批量处理

进展：

- 2026-06-09：已完成第一步服务端优化。`/api/articles/translate-titles` 从逐条串行翻译改为并发 4 的受控并发处理，保留单条失败回退原标题的行为，并补了并发上限测试。
- 2026-06-09：已完成第二步标题翻译缓存。服务端按 `(userId, targetLang, title)` 复用已完成或进行中的标题翻译，避免重复标题在同一批、跨页或重复开关时再次请求 provider；失败结果不会缓存。
- 2026-06-10：已完成第八十四步标题批量翻译配置复用。`/api/articles/translate-titles` 在单次请求内懒创建一次文本翻译器，复用已解析的 translate provider、model 和 API key，不再对每个未缓存标题重复解析 task/provider 配置；Google/DeepL 显式目标语言路径也改为批量 settings 读取 API key。N 个未缓存且需翻译的标题，translator/task/key 解析从 N 次降到 1 次，减少 `(N-1)/N`；6 个标题测试形态中从 6 次降到 1 次，减少 83.3%。路由测试验证批量请求只创建 1 个 translator，fetcher AI 测试验证同一 translator 多次翻译只读取一次 key。

代码证据：

- `src/components/article/article-list.tsx`
- `server/routes/articles.ts`

现状：

- 前端会按 50 条一批请求标题翻译。
- 服务端在循环里用 `await translateText(...)` 串行翻译每一条标题。

为什么值得做：

- 整体耗时会随批量大小线性增长。
- 标题虽然短，但“整页翻译”体感上仍然可能明显偏慢。

建议方向：

- 服务端加受控并发，而不是完全串行。
- 以 `(title, target_lang)` 作为 key 做翻译缓存，避免跨页、跨 feed 重复翻。
- 如果底层 provider 支持批接口，可以进一步合并请求。

验证方式：

- 对比 50 条标题翻译的总耗时。
- 统计重复开关时的 provider 请求数。

### 6. 相似文章检测从“逐条扇出”改成批处理

进展：

- 2026-06-09：已完成第一步后台背压优化。新文章插入后不再直接无限 fire-and-forget 相似度检测，改为进入模块级队列，最多同时执行 2 个检测任务；保留原有检测、相似关系写入和相似已读文章自动标记 seen 的行为。
- 2026-06-10：已完成第二步通知 pending 查询去重。`deliverRule()` 在单个规则处理周期内按 channel id 缓存 channel record，并按 `last_notified_article_id` 缓存 pending article 查询结果；同一 feed/rule 绑定多个 channel 且通知游标相同时，pending count + list 查询从每个 channel 各 2 条降到整条规则共 2 条。测试覆盖 3 个 channel 共享游标时，pending `COUNT/MAX` 和 pending list SQL 各只准备 1 次；对应形态从 6 条 pending SQL 降到 2 条，减少约 66.7%。
- 2026-06-10：已完成第三步通知正文翻译并发削峰。`deliverRule()` 对同一条通知规则内的 pending article 正文翻译加受控并发，最多同时执行 4 个 `translateNotificationBodyText()`，避免历史积压或大批量通知时直接 `Promise.all` 把所有文章翻译请求同时打到 provider。8 篇待翻译文章测试形态中 provider 调用峰值并发从 8 降到 4，减少 50%；仍保留单篇翻译失败回退原文的行为。
- 2026-06-10：已完成第八十一步批量抓取调度内存削峰。`fetchAllFeeds()` 的 feed 抓取阶段和 article 处理阶段不再为所有 feed/article 一次性创建 `Promise.all(items.map(semaphore.run(...)))`，改为 worker-pool 按 `CONCURRENCY` 拉取任务；真实并发数不变，但大批量刷新时 promise/microtask 调度规模从 O(N) 降到 O(CONCURRENCY)。8 个 feeds 的测试形态中 RSS fetch 启动峰值从 8 降到 5（默认 `FETCH_CONCURRENCY=5`），减少 37.5%，并验证不会提前启动第 6 个 feed。
- 2026-06-10：已完成第八十二步单 feed 大批量文章处理调度削峰。`fetchSingleFeed()` 的文章处理阶段也改用同一 worker-pool，不再为单个 feed 的所有新文章一次性创建 `Promise.all(tasks.map(semaphore.run(...)))`；单个大 feed 返回大量新文章时，正文抓取启动峰值固定为 `FETCH_CONCURRENCY`。8 篇新文章测试形态中正文抓取启动峰值从 8 降到 5，减少 37.5%，并验证不会提前启动第 6 篇文章。

代码证据：

- `server/fetcher.ts:205-207`
- `server/similarity.ts:47-98`
- `server/notifications/runner.ts:40-102`
- `server/notifications/runner.test.ts`

现状：

- 每插入一篇新文章，都会 fire-and-forget 一个相似度检测任务。
- 每个任务至少会做一次 Meilisearch 查询、一次文章详情读取、本地相似度计算，以及可能的 DB 写入。

为什么值得做：

- 一次较大的 feed 刷新，会启动很多重叠的相似度任务。
- 它们会在抓取和正文抽取本来就忙的时候，再制造一波背景尖峰负载。

建议方向：

- 给相似度任务加队列和并发上限。
- 以单次 feed 刷新为单位做候选批处理，或把低优先级 feed 的相似度计算延后到空闲时段。
- 也可以落一个轻量 `similarity pending` 标记，转成异步批处理流水线。

验证方式：

- 比较开启/关闭批处理后的抓取周期耗时。
- 记录大刷新期间的并发 Meilisearch 请求数。

### 7. 收窄正文抓取 retry 队列扫描和排序

进展：

- 2026-06-10：已完成第一步 retry queue partial index。新增 `(retry_count, last_retry_at) WHERE purged_at IS NULL AND last_error IS NOT NULL AND full_text IS NULL` 索引，让 `getRetryArticles()` 可直接按 retry 优先级读取候选队列，避免先扫 `last_error` 候选再建临时 B-tree 排序；同一索引也让 `getRetryStats()` 只扫 active retry 候选子集。30 万 articles / 约 1.5 万 retry 候选的临时 SQLite 合成库中，强制旧索引的 batch 查询 500 次约 `10.84s`，新计划约 `1.64s`，约 `6.6x`；retry stats 200 次约 `5.36s -> 1.21s`，约 `4.4x`。

代码证据：

- `server/db/articles.ts:1664-1705`
- `migrations/0021_article_feed_published_index.sql`
- `server/db/articles.test.ts`

现状：

- `getRetryArticles()` 是正文抓取重试后台路径，按 `retry_count ASC, last_retry_at ASC` 拿小批量候选。
- 优化前可使用 `last_error` partial index 缩小扫描，但排序仍需要临时 B-tree，且 `full_text IS NULL` / `purged_at IS NULL` 不是索引谓词的一部分。

为什么值得做：

- 该路径由抓取后台流程反复调用，候选量变大时排序成本会持续出现。
- 新索引只覆盖失败且未成功抽正文的 active 文章，写入维护成本比全量复合索引小。

验证方式：

- 用 `EXPLAIN QUERY PLAN` 确认 `getRetryArticles()` 形状命中 `idx_articles_retry_queue_active`。
- 对比 retry 队列查询和 retry stats 的合成库耗时。

## P2

### 8. 重新评估 `inbox_score` 的特征计算方式

进展：

- 2026-06-10：已完成第一步重复请求优化。`inbox_score` 的 90 天 feed/category 历史统计改为 30 秒进程级短缓存，并在查询时通过 `VALUES` CTE 注入当前 SQL；重复打开/翻页同一用户的高价值排序时可跳过两条历史聚合扫描。阅读、收藏、喜欢、插入、删除和 retention purge 会主动失效该缓存。
- 2026-06-10：High Value Inbox 复用同一份历史统计缓存；同时把原先“先算 feed 频率分布、候选 CTE 再聚合一次 feed_frequency”的重复工作改为复用第一次 feed frequency 结果。
- 2026-06-10：`inbox_score` 列表和 High Value Inbox 的相似度特征不再先对整张 `article_similarities` 做 `GROUP BY` 聚合，改为按当前文章 id 走 `(article_id, similar_to_id)` 主键的相关查询；High Value 的已读相似主题判断也改为候选级 `EXISTS`。
- 2026-06-10：本地 SQLite 合成微基准（50k articles / 250k similarities）显示旧相似度计数计划会 `MATERIALIZE sim` 并扫描整张 `article_similarities`，新计划为 `CORRELATED SCALAR SUBQUERY` + 主键 `SEARCH article_similarities ... (article_id=?)`；同一形状查询约从 0.02s 降到 0.01s。
- 2026-06-10：High Value Inbox 的 28 天 feed frequency 也加入 30 秒进程级短缓存，并与 inbox ranking 相关写路径一起失效；重复 High Value 请求在测试计数中从 5 条核心查询降到 2 条。候选频率 quantile 计算从每个候选 `Array.filter()` 线性扫 feed 分布，改为对已排序分布做二分查找。
- 2026-06-10：High Value Inbox 候选读取拆成 `published_at` 主路径和 `published_at IS NULL` 的 `fetched_at` 兜底路径；主路径显式使用 active unread partial index，避免 `julianday(COALESCE(...))` 让 recent candidate 查询只能扫描后排序。本地 SQLite 合成微基准（300k articles / 15k unread）显示候选 ID 读取 median 约从 2.37ms 降到 0.27ms，约 8.8x。

代码证据：

- `server/db/articles.ts:558-656`
- `server/db/articles.ts:684+`
- `server/db/articles.test.ts`

现状：

- `inbox_score` 会在查询时按近期 feed/category 历史临时推导排序特征。
- high-value inbox 和列表排序都依赖这些从近期文章历史中临时拼出来的统计量。
- 目前重复请求已能复用短缓存，但特征本身仍未持久物化；进程重启或缓存失效后的首个请求仍需要扫描窗口内历史。

为什么值得做：

- 这个特性本身有价值，但“查询时现算”的成本会随着文章量和请求频率一起增加。
- 小规模时可能还好，规模上来后大概率会变成持续负担。

建议方向：

- 把近期 feed/category engagement summary 物化成定时结果或写时更新结果。
- 对每个 user/view filter 做短 TTL 的候选排序缓存。
- 保留现有实时查询路径作为兜底，而不是默认主路径。

验证方式：

- 对比物化前后的 `inbox_score` 查询耗时。
- 检查 TTL 缓存下的排序新鲜度是否还能接受。

## 建议推进顺序

1. `/api/articles` 查询扇出
2. `/api/feeds` 聚合失效范围
3. 搜索 rebuild / score sync 全量维护
4. 前端列表虚拟化
5. 标题翻译批处理
6. 相似度任务批处理
7. `inbox_score` 物化
