import type { Prompt } from "./types";

const COLUMNS = "id, title, content, tags, created_at, updated_at";

/** LIKE のワイルドカード（% _）と escape 文字自身を無効化する */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

export interface CreateInput {
  title: string;
  content: string;
  tags: string | null;
}

export interface UpdateInput {
  title?: string;
  content?: string;
  tags?: string | null;
}

export interface SearchInput {
  query?: string;
  tag?: string;
  limit: number;
  offset: number;
}

/**
 * prompts テーブルへのアクセスを閉じ込める層。
 * 日時は呼び出し側から渡さず、ここで ISO 8601 文字列として付与する。
 */
export class PromptRepository {
  constructor(
    private readonly db: D1Database,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly newId: () => string = () => crypto.randomUUID(),
  ) {}

  async create(input: CreateInput): Promise<Prompt> {
    const timestamp = this.now();
    const prompt: Prompt = {
      id: this.newId(),
      title: input.title,
      content: input.content,
      tags: input.tags,
      created_at: timestamp,
      updated_at: timestamp,
    };

    await this.db
      .prepare(
        `INSERT INTO prompts (${COLUMNS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
      )
      .bind(
        prompt.id,
        prompt.title,
        prompt.content,
        prompt.tags,
        prompt.created_at,
        prompt.updated_at,
      )
      .run();

    return prompt;
  }

  /** 指定 ID を部分更新する。存在しなければ null。 */
  async update(id: string, patch: UpdateInput): Promise<Prompt | null> {
    const current = await this.get(id);
    if (current === null) return null;

    const next: Prompt = {
      ...current,
      title: patch.title ?? current.title,
      content: patch.content ?? current.content,
      tags: patch.tags === undefined ? current.tags : patch.tags,
      updated_at: this.now(),
    };

    await this.db
      .prepare(
        `UPDATE prompts SET title = ?2, content = ?3, tags = ?4, updated_at = ?5 WHERE id = ?1`,
      )
      .bind(next.id, next.title, next.content, next.tags, next.updated_at)
      .run();

    return next;
  }

  async get(id: string): Promise<Prompt | null> {
    return await this.db
      .prepare(`SELECT ${COLUMNS} FROM prompts WHERE id = ?1`)
      .bind(id)
      .first<Prompt>();
  }

  /** 新しい順（created_at 降順）で一覧する。 */
  async list(limit: number, offset: number): Promise<Prompt[]> {
    const { results } = await this.db
      .prepare(
        `SELECT ${COLUMNS} FROM prompts ORDER BY created_at DESC, id DESC LIMIT ?1 OFFSET ?2`,
      )
      .bind(limit, offset)
      .all<Prompt>();

    return results;
  }

  /**
   * キーワード（title / content / tags への LIKE）とタグ（カンマ区切りの完全一致）で検索する。
   * 両方指定された場合は AND 条件。
   */
  async search(input: SearchInput): Promise<Prompt[]> {
    const conditions: string[] = [];
    const bindings: unknown[] = [];

    if (input.query !== undefined) {
      const index = bindings.push(`%${escapeLike(input.query)}%`);
      conditions.push(
        `(title LIKE ?${index} ESCAPE '\\'` +
          ` OR content LIKE ?${index} ESCAPE '\\'` +
          ` OR IFNULL(tags, '') LIKE ?${index} ESCAPE '\\')`,
      );
    }

    if (input.tag !== undefined) {
      const index = bindings.push(`%,${escapeLike(input.tag)},%`);
      conditions.push(
        `(',' || IFNULL(tags, '') || ',') LIKE ?${index} ESCAPE '\\'`,
      );
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limitIndex = bindings.push(input.limit);
    const offsetIndex = bindings.push(input.offset);

    const { results } = await this.db
      .prepare(
        `SELECT ${COLUMNS} FROM prompts ${where} ORDER BY created_at DESC, id DESC LIMIT ?${limitIndex} OFFSET ?${offsetIndex}`,
      )
      .bind(...bindings)
      .all<Prompt>();

    return results;
  }

  /** 削除できたら true、対象が無ければ false。 */
  async delete(id: string): Promise<boolean> {
    const result = await this.db
      .prepare(`DELETE FROM prompts WHERE id = ?1`)
      .bind(id)
      .run();

    return (result.meta?.changes ?? 0) > 0;
  }
}
