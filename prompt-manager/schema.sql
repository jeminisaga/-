-- プロンプト管理ツール v0.1 スキーマ（要件定義書 5. データ設計）
DROP TABLE IF EXISTS prompts;

CREATE TABLE prompts (
  id         TEXT PRIMARY KEY,           -- UUID（生成時に付与）
  title      TEXT NOT NULL,              -- プロンプトのタイトル
  content    TEXT NOT NULL,              -- プロンプト本文
  tags       TEXT,                       -- タグ（カンマ区切り文字列）
  created_at TEXT NOT NULL,              -- 作成日時（ISO 8601）
  updated_at TEXT NOT NULL               -- 更新日時（ISO 8601）
);

-- list_prompts は新しい順で取得するため created_at に索引を張る
CREATE INDEX idx_prompts_created_at ON prompts (created_at DESC);
