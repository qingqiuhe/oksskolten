# Oksskolten 実装仕様書 — フロントエンド

> [概要に戻る](./01_overview.ja.md)

## フロントエンド

### ルート定義

```
/                              → /inbox にリダイレクト
/inbox                         → 未読記事一覧
/bookmarks                     → ブックマーク記事一覧
/likes                         → いいね記事一覧
/history                       → 閲読済み記事一覧（read_at IS NOT NULL）
/clips                         → クリップ記事一覧
/feeds/:feedId                 → フィード別記事一覧（クリップフィードもこのルートで表示）
/categories/:categoryId        → カテゴリ別記事一覧
/settings                      → /settings/general にリダイレクト
/settings/:tab                 → 設定画面（general / appearance / ai / security / plugins / viewer / about）
/chat                          → チャットページ（新規会話）
/chat/:conversationId          → チャットページ（会話詳細）
/*                             → 記事詳細（catch-all、元記事URLからスキームを除いた形）
```

記事の表示URLは元記事URLからスキームを除いた形:
```
https://blog.cloudflare.com/new-features-2025
→ /blog.cloudflare.com/new-features-2025
```

フロントエンドは splat パスに `https://` を付与して元記事URLを復元し、`GET /api/articles/by-url?url=...` で記事データを取得する。

`.md` で終わるパスは Markdown ソース表示ページとして扱う（`ArticleRawPage`）。


### データフェッチ

| 項目 | 方針 |
|---|---|
| ライブラリ | SWR |
| ページング | 無限スクロール（`useSWRInfinite`、`limit=20`ずつ） |
| 表示範囲制限 | Smart Floor — フィード・カテゴリビューでは「直近1週間」「最新20件」「最古未読まで」の3候補のうち最も多くの記事を含む範囲を採用。20件未満の場合はスキップ。Inbox/Bookmarks/Likes/History/Clipsには適用しない |
| もっと読む | Smart Floorで非表示の記事がある場合、リスト末尾に「もっと読む（N件）」ボタンを表示。クリックで `no_floor=1` を付けて全件を再取得 |
| スクロール停止条件 | レスポンスの `has_more === false` で停止 |
| ローディング | スケルトン UI |
| エラー | インラインでメッセージ + リトライボタン |
| 空状態 | 「記事がありません」（`text-muted` で中央表示） |

**フェッチ完了トースト**: 手動フェッチ（リフレッシュボタン・右クリック→Fetch）およびPull-to-refresh（個別フィードページのみ）の完了時に `sonner` トーストで結果を表示する。

| 条件 | トースト |
|---|---|
| 新着あり | `{count}件の新しい記事を取得`（success） |
| 新着なし | `新着なし`（default） |
| エラー | `フェッチに失敗しました`（error） |

Pull-to-refresh は個別フィードページでは `startFeedFetch(feedId)` を呼んでRSSソースからフェッチする。全記事ページ（Inbox等）では従来通り SWR `mutate()` のみ。

**フェッチ進捗の共有**: `useFetchProgress` フックを `FetchProgressContext` で共有し、サイドバーと記事リストで同一の進捗状態を参照する。

**キャッシュ無効化**: ミューテーション後に `mutate()` で関連キャッシュを再検証する。

| 操作 | 再検証対象 |
|---|---|
| フィード追加 (`POST /api/feeds`) | `/api/feeds` |
| フィード削除 (`DELETE /api/feeds/:id`) | `/api/feeds`, `/api/articles` |
| フィード更新 (`PATCH /api/feeds/:id`) | `/api/feeds` |
| 認知/既読更新 (`PATCH .../seen`, `POST .../read`) | `/api/feeds`（unread_count 更新のため） |


### フィードメトリクス

フィードの更新頻度・活性度を表示する機能。

**サイドバー（Inactive表示）**
- `showFeedActivity === 'on'` かつフィードが inactive の場合、フィード名の横に `inactive` ラベルを表示
- Inactive判定: `latest_published_at` が90日以上前、または記事ありで `latest_published_at` が null
- `disabled`（fetchエラーによる自動無効化）とは別概念
- 設定 `reading.show_feed_activity`（on/off、デフォルト: on）で表示を制御

**記事一覧ヘッダー下（メトリクスバー）**
- フィード単体表示時（`/feeds/:feedId`）のみ表示。Inbox やカテゴリ表示時は非表示
- 表示項目: 総記事数、更新頻度（X.X/wk）、最終更新日（相対表示）、平均記事長
- 軽量データ（記事数、更新頻度、最終更新日）は `/api/feeds` の SWR キャッシュから取得
- 重量データ（平均記事長）は `/api/feeds/:id/metrics` からオンデマンド取得
- クリップフィードには表示しない

### 記事リスト表示レイアウト

記事一覧の表示レイアウトを4種類から選択可能。テーマ（カラー）とは独立した軸で、組み合わせ自由。

| レイアウト | キー | 説明 |
|---|---|---|
| List | `list` | クラシックな単一列リスト。抜粋・ドメイン・サムネイルを表示。デフォルト |
| Card | `card` | 2列グリッド。大きなサムネイル（aspect-video）を上部に配置。ビジュアル重視 |
| Magazine | `magazine` | 先頭記事をヒーロー（大きいカード）、残りを小型カードで表示する混合レイアウト |
| Compact | `compact` | タイトルと日付のみの高密度リスト。サムネイル非表示 |

- 設定キー: `appearance.list_layout`（許可値: `list` / `card` / `magazine` / `compact`）
- 設定画面: `/settings/appearance` のレイアウトセクションでプレビュー付きで選択
- 永続化: `localStorage`（即時反映）+ DB同期（500msデバウンス PATCH）
- レイアウト定義: `src/data/layouts.ts`
- フック: `src/hooks/useLayout.ts`（`createLocalStorageHook` ベース）
- スケルトンUI: 各レイアウトに対応した専用スケルトンを表示

### PWA対応

`vite-plugin-pwa` によるProgressive Web App対応。

| 項目 | 設定 |
|---|---|
| 登録方式 | `autoUpdate` |
| 表示モード | `standalone` |
| 開始URL | `/inbox` |
| キャッシュ戦略（Favicon） | CacheFirst（30日） |
| キャッシュ戦略（記事詳細API） | StaleWhileRevalidate（7日） |
| キャッシュ戦略（API全般） | NetworkFirst（24時間、タイムアウト5秒） |
| キャッシュ戦略（画像） | CacheFirst（30日） |
| オフラインキュー | IndexedDB（`reader-offline` DB）で未同期の既読IDを蓄積し、オンライン復帰時に `POST /api/articles/batch-seen` で一括同期 |
| 更新通知 | 新しいService Workerが利用可能な場合、`sonner` で永続トースト（「新しいバージョンがあります」）とリロードボタンを表示。クリックで新ワーカーを有効化しページをリフレッシュ |

### カスタムテーマインポート

`/settings/appearance` でJSONによるカスタムカラーテーマのインポートが可能。

| 項目 | 詳細 |
|---|---|
| インポート方法 | シンタックスハイライト付きエディタダイアログにJSON貼り付け、またはファイル読み込み |
| サンプルテーマ | 「サンプル」ボタンでEverforestテーマを参考として読み込み |
| 編集 | インポート済みカスタムテーマは同ダイアログで編集可能 |
| バリデーション | テーマ名は `[a-z0-9_-]+`、ビルトインテーマ名との重複不可、`light` と `dark` 両バリアントと全必須カラーキーが必要 |
| カスタムテーマ上限 | 20件 |
| 永続化 | localStorage + DB同期 |
| 必須カラーキー | `background`, `background.sidebar`, `background.subtle`, `background.avatar`, `text`, `text.muted`, `accent`, `accent.text`, `error`, `border`, `hover`, `overlay` |
| 任意フィールド | `indicatorStyle`（`'line'` / `'dot'`）、`highlight`（コードブロックテーマ、デフォルト: `'github'`） |

### フィード複数選択と一括操作

サイドバーで複数フィードを選択し、一括操作が可能。

| 項目 | 詳細 |
|---|---|
| 選択 | Cmd/Ctrl + クリックで個別トグル、Shift + クリックで範囲選択 |
| 選択解除 | Escapeキーで全解除 |
| 除外 | クリップフィードは複数選択の対象外 |
| コンテキストメニュー | 選択状態で右クリックして一括操作メニューを表示 |

一括操作:

| 操作 | 動作 |
|---|---|
| カテゴリ移動 | `POST /api/feeds/bulk-move` — 選択フィードをカテゴリに移動 |
| 全件既読 | 各フィードに `POST /api/feeds/:id/mark-all-seen` を実行 |
| フェッチ | 選択された有効フィードを順次フェッチ |
| 削除 | 確認ダイアログ後、各フィードを `DELETE /api/feeds/:id` で削除 |
