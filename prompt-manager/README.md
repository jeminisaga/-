# プロンプト管理ツール（v0.1）

保存したプロンプトを **AIエージェントから直接呼び出す** ための MCP サーバーです。
Cloudflare Workers + D1 で動作し、`/mcp` エンドポイントに 5 つのツールを公開します。

要件定義書 v0.1（2026-08-08）の実装です。

## 公開ツール

| ツール名 | 内容 |
| --- | --- |
| `save_prompt` | プロンプトを新規保存または更新する（`id` 省略で新規、指定で更新） |
| `list_prompts` | 保存済みプロンプトの一覧を取得する（新しい順） |
| `get_prompt` | ID を指定して 1 件のプロンプトを取得する |
| `search_prompts` | キーワード（`query`）またはタグ（`tag`）で検索する |
| `delete_prompt` | ID を指定してプロンプトを削除する |

## セットアップ

```bash
cd prompt-manager
npm install

# 1. D1 データベースを作成し、出力された database_id を wrangler.jsonc に書く
npx wrangler d1 create prompt-manager

# 2. テーブルを作成（ローカル / 本番）
npm run db:init:local
npm run db:init:remote

# 3. ローカル起動
npm run dev          # http://localhost:8787/mcp

# 4. デプロイ
npm run deploy
```

> `schema.sql` は冒頭で `DROP TABLE IF EXISTS prompts;` を実行します。
> 既存データがある状態で流し直すと消えるので注意してください。

## 動作確認

```bash
# ヘルスチェック
curl http://localhost:8787/

# ツール一覧
curl http://localhost:8787/mcp -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

# 保存
curl http://localhost:8787/mcp -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"save_prompt",
       "arguments":{"title":"X投稿のたたき台","content":"次のテーマでポスト案を3つ書いて","tags":"X投稿,分析"}}}'

# タグ検索
curl http://localhost:8787/mcp -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"search_prompts","arguments":{"tag":"分析"}}}'
```

## WebMCP の有効化

1. `npm run deploy` で Worker をデプロイする
2. Cloudflare Dashboard → 対象 Worker → Settings のスイッチで WebMCP を有効化する
3. BrowserRun など、ブラウザ上のエージェントから `https://<worker>.workers.dev/mcp` をツールとして呼び出す

ブラウザから直接呼べるよう、`/mcp` は CORS（`Access-Control-Allow-Origin: *`）を許可しています。

## MCP エンドポイントの仕様

- `POST /mcp` … JSON-RPC 2.0（Streamable HTTP のステートレス運用）。応答は `application/json`
- `GET /mcp` … 405。SSE ストリームとセッション管理は v0.1 では提供しません
- `GET /` … ヘルスチェック（サーバー情報とツール名の一覧）
- 対応メソッド：`initialize` / `ping` / `tools/list` / `tools/call` / `notifications/*`（通知は 202）
- 対応プロトコル版：`2025-06-18`（既定）/ `2025-03-26` / `2024-11-05`

ツールの実行時エラー（対象が見つからない、引数が不正 など）は JSON-RPC エラーではなく
`isError: true` の結果として返します（MCP 仕様に沿った挙動）。DB 障害などの想定外エラーのみ
`-32603` を返します。

## データ設計

テーブル `prompts`（`schema.sql`）

| カラム名 | 型 | 制約 | 説明 |
| --- | --- | --- | --- |
| `id` | TEXT | PRIMARY KEY | UUID（生成時に付与） |
| `title` | TEXT | NOT NULL | プロンプトのタイトル |
| `content` | TEXT | NOT NULL | プロンプト本文 |
| `tags` | TEXT | — | タグ（カンマ区切り文字列） |
| `created_at` | TEXT | NOT NULL | 作成日時（ISO 8601） |
| `updated_at` | TEXT | NOT NULL | 更新日時（ISO 8601） |

## 要件定義書からの補足・判断

仕様に明記が無く、実装時に決めた点です。

- **更新の指定方法**：`save_prompt` に `id` があれば更新、無ければ新規保存。更新は渡された
  フィールドだけを変更する部分更新で、`created_at` は保持し `updated_at` のみ進めます。
- **並び順**：「新しい順」は `created_at` の降順（同時刻の場合は `id` 降順で安定化）。
- **タグの受け取り**：カンマ区切り文字列に加えて文字列配列も受け付け、前後の空白除去・重複除去の
  うえでカンマ区切り文字列として保存します。空になった場合は `NULL`。レスポンスでは配列で返します。
- **検索**：`query` は `title` / `content` / `tags` への部分一致（LIKE）。`tag` はカンマ区切りの
  1 タグとしての完全一致（`分析` が `分析レポート` に一致しない）。両方指定時は AND 条件。
  検索語に含まれる `%` `_` `\` はリテラルとして扱います。
- **件数制限**：`list_prompts` / `search_prompts` は `limit`（既定 50 / 最大 200）と `offset` に対応。
  エージェントの返答が際限なく膨らむのを防ぐための既定値です。

## セキュリティ上の注意

要件定義書のとおり v0.1 では**認証を実装していません**。デプロイした Worker の URL を知っている
相手は誰でもプロンプトの読み書き・削除ができます。個人利用の前提を外れる場合は、
Cloudflare Access や簡易トークンの導入を先に検討してください。

## テスト

```bash
npm test        # vitest（67 ケース）
npm run typecheck
```

テストは `node:sqlite` を D1 互換インターフェースで包み、`schema.sql` を適用した
インメモリ DB に対して**実際の SQL を実行**します。あわせて `wrangler dev` 上でも
5 ツールすべての動作を確認済みです。

## v0.1 のスコープ外

ユーザー認証・権限管理／管理用 Web UI／バージョン管理・履歴／お気に入り／カテゴリ階層化／
他サービス連携。

## ファイル構成

```
prompt-manager/
  wrangler.jsonc        Workers 設定（D1 バインディング）
  schema.sql            prompts テーブル定義
  src/
    index.ts            fetch ハンドラ（ルーティング / CORS）
    mcp.ts              JSON-RPC・MCP プロトコル層
    tools.ts            5 ツールの定義・入力検証
    repository.ts       D1 へのクエリ
    types.ts            Env / Prompt / ToolError
  test/                 vitest（repository / tools / mcp / worker）
```
