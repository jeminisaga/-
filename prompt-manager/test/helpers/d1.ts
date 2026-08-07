import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// vite が node:sqlite を解決できないため実行時に読み込む
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as {
  DatabaseSync: new (path: string) => DatabaseSync;
};

interface DatabaseSync {
  exec(sql: string): void;
  prepare(sql: string): {
    all(...params: never[]): Record<string, unknown>[];
    get(...params: never[]): Record<string, unknown> | undefined;
    run(...params: never[]): { changes: number | bigint };
  };
}

const SCHEMA = readFileSync(
  fileURLToPath(new URL("../../schema.sql", import.meta.url)),
  "utf8",
);

/**
 * node:sqlite を D1Database 互換のインターフェースで包んだテスト用スタブ。
 * 実際の SQL をそのまま実行するため、クエリの誤りをテストで検出できる。
 */
class TestStatement {
  constructor(
    private readonly db: DatabaseSync,
    private readonly sql: string,
    private readonly values: unknown[] = [],
  ) {}

  bind(...values: unknown[]): TestStatement {
    return new TestStatement(this.db, this.sql, values);
  }

  private params(): unknown[] {
    return this.values.map((value) => (value === undefined ? null : value));
  }

  async all<T>(): Promise<{ results: T[]; success: true }> {
    const rows = this.db.prepare(this.sql).all(...(this.params() as never[]));
    return { results: rows.map((row) => ({ ...row }) as T), success: true };
  }

  async first<T>(): Promise<T | null> {
    const row = this.db.prepare(this.sql).get(...(this.params() as never[]));
    return row === undefined ? null : ({ ...row } as T);
  }

  async run(): Promise<{ success: true; meta: { changes: number } }> {
    const info = this.db.prepare(this.sql).run(...(this.params() as never[]));
    return { success: true, meta: { changes: Number(info.changes) } };
  }
}

export class TestD1 {
  private readonly db = new DatabaseSync(":memory:");

  constructor() {
    this.db.exec(SCHEMA);
  }

  prepare(sql: string): TestStatement {
    return new TestStatement(this.db, sql);
  }
}

/** schema.sql を適用済みのインメモリ DB を返す */
export function createTestDb(): D1Database {
  return new TestD1() as unknown as D1Database;
}

/** 呼ぶたびに 1 秒進む決定的なクロック */
export function fixedClock(start = "2026-08-08T00:00:00.000Z"): () => string {
  let tick = 0;
  const base = Date.parse(start);
  return () => new Date(base + tick++ * 1000).toISOString();
}

/** 連番の ID 生成器 */
export function sequentialIds(prefix = "id"): () => string {
  let n = 0;
  return () => `${prefix}-${++n}`;
}
