export interface Env {
  DB: D1Database;
}

/** prompts テーブルの 1 行（要件定義書 5. データ設計） */
export interface Prompt {
  id: string;
  title: string;
  content: string;
  tags: string | null;
  created_at: string;
  updated_at: string;
}

/** ツール実行時に想定内で失敗したことを表す。tools/call の isError レスポンスになる。 */
export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolError";
  }
}
