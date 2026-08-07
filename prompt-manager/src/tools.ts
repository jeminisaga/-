import { PromptRepository } from "./repository";
import { ToolError, type Prompt } from "./types";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** MCP として公開する 5 つのツール（要件定義書 4. 機能要件） */
export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "save_prompt",
    title: "プロンプトを保存",
    description:
      "プロンプトを新規保存または更新する。id を指定した場合はそのプロンプトを更新し、" +
      "省略した場合は新しい ID を採番して保存する。新規保存では title と content が必須。",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "更新する場合のみ指定する既存プロンプトの ID。省略時は新規保存。",
        },
        title: { type: "string", description: "プロンプトのタイトル" },
        content: { type: "string", description: "プロンプト本文" },
        tags: {
          anyOf: [
            { type: "string", description: "カンマ区切りのタグ（例: \"X投稿,分析,Claude\"）" },
            { type: "array", items: { type: "string" } },
          ],
          description: "タグ。カンマ区切り文字列または文字列配列。",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "list_prompts",
    title: "プロンプト一覧",
    description: "保存済みプロンプトを新しい順（作成日時の降順）で取得する。",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "integer",
          minimum: 1,
          maximum: MAX_LIMIT,
          description: `取得件数（既定 ${DEFAULT_LIMIT}、最大 ${MAX_LIMIT}）`,
        },
        offset: { type: "integer", minimum: 0, description: "スキップする件数（既定 0）" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_prompt",
    title: "プロンプト取得",
    description: "ID を指定して 1 件のプロンプトを取得する。",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "プロンプトの ID" },
      },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "search_prompts",
    title: "プロンプト検索",
    description:
      "キーワードまたはタグでプロンプトを検索する。query は title / content / tags の部分一致、" +
      "tag はカンマ区切りタグの完全一致。両方指定した場合は AND 条件。",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "検索キーワード（部分一致）" },
        tag: { type: "string", description: "タグ名（完全一致）" },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: MAX_LIMIT,
          description: `取得件数（既定 ${DEFAULT_LIMIT}、最大 ${MAX_LIMIT}）`,
        },
        offset: { type: "integer", minimum: 0, description: "スキップする件数（既定 0）" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "delete_prompt",
    title: "プロンプト削除",
    description: "ID を指定してプロンプトを削除する。",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "削除するプロンプトの ID" },
      },
      required: ["id"],
      additionalProperties: false,
    },
  },
];

export const TOOL_NAMES = new Set(TOOL_DEFINITIONS.map((tool) => tool.name));

type Args = Record<string, unknown>;

function requiredString(args: Args, key: string): string {
  const value = optionalString(args, key);
  if (value === undefined) throw new ToolError(`${key} は必須です。`);
  return value;
}

function optionalString(args: Args, key: string): string | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new ToolError(`${key} は文字列で指定してください。`);
  const trimmed = value.trim();
  if (trimmed === "") throw new ToolError(`${key} が空です。`);
  return trimmed;
}

function optionalInteger(
  args: Args,
  key: string,
  { min, max }: { min: number; max: number },
): number | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new ToolError(`${key} は整数で指定してください。`);
  }
  if (value < min || value > max) {
    throw new ToolError(`${key} は ${min} 以上 ${max} 以下で指定してください。`);
  }
  return value;
}

/**
 * タグを「カンマ区切りの単純な文字列」に正規化する（要件定義書 5. 補足）。
 * 文字列配列も受け付ける。空になった場合は null。
 */
export function normalizeTags(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;

  const parts =
    typeof value === "string"
      ? value.split(",")
      : Array.isArray(value)
        ? value.map((item) => {
            if (typeof item !== "string") {
              throw new ToolError("tags の配列要素は文字列で指定してください。");
            }
            return item;
          })
        : (() => {
            throw new ToolError("tags は文字列またはその配列で指定してください。");
          })();

  const tags: string[] = [];
  for (const part of parts) {
    const tag = part.trim();
    if (tag !== "" && !tags.includes(tag)) tags.push(tag);
  }

  return tags.length > 0 ? tags.join(",") : null;
}

/** ツール実行結果。呼び出し側で JSON 化して MCP のレスポンスに載せる。 */
export type ToolResult = Record<string, unknown>;

export async function callTool(
  repository: PromptRepository,
  name: string,
  rawArgs: unknown,
): Promise<ToolResult> {
  if (rawArgs !== undefined && (typeof rawArgs !== "object" || rawArgs === null || Array.isArray(rawArgs))) {
    throw new ToolError("arguments はオブジェクトで指定してください。");
  }
  const args = (rawArgs ?? {}) as Args;

  switch (name) {
    case "save_prompt":
      return await savePrompt(repository, args);
    case "list_prompts":
      return await listPrompts(repository, args);
    case "get_prompt":
      return await getPrompt(repository, args);
    case "search_prompts":
      return await searchPrompts(repository, args);
    case "delete_prompt":
      return await deletePrompt(repository, args);
    default:
      throw new ToolError(`未知のツールです: ${name}`);
  }
}

async function savePrompt(repository: PromptRepository, args: Args): Promise<ToolResult> {
  const id = optionalString(args, "id");
  const title = optionalString(args, "title");
  const content = optionalString(args, "content");
  const tags = normalizeTags(args["tags"]);

  if (id === undefined) {
    if (title === undefined) throw new ToolError("新規保存では title が必須です。");
    if (content === undefined) throw new ToolError("新規保存では content が必須です。");

    const prompt = await repository.create({ title, content, tags: tags ?? null });
    return { created: true, prompt: serialize(prompt) };
  }

  if (title === undefined && content === undefined && tags === undefined) {
    throw new ToolError("更新するフィールド（title / content / tags）を 1 つ以上指定してください。");
  }

  const prompt = await repository.update(id, { title, content, tags });
  if (prompt === null) throw new ToolError(`プロンプトが見つかりません: ${id}`);

  return { created: false, prompt: serialize(prompt) };
}

async function listPrompts(repository: PromptRepository, args: Args): Promise<ToolResult> {
  const limit = optionalInteger(args, "limit", { min: 1, max: MAX_LIMIT }) ?? DEFAULT_LIMIT;
  const offset = optionalInteger(args, "offset", { min: 0, max: Number.MAX_SAFE_INTEGER }) ?? 0;

  const prompts = await repository.list(limit, offset);
  return { count: prompts.length, prompts: prompts.map(serialize) };
}

async function getPrompt(repository: PromptRepository, args: Args): Promise<ToolResult> {
  const id = requiredString(args, "id");

  const prompt = await repository.get(id);
  if (prompt === null) throw new ToolError(`プロンプトが見つかりません: ${id}`);

  return { prompt: serialize(prompt) };
}

async function searchPrompts(repository: PromptRepository, args: Args): Promise<ToolResult> {
  const query = optionalString(args, "query");
  const tag = optionalString(args, "tag");
  if (query === undefined && tag === undefined) {
    throw new ToolError("query または tag のいずれかを指定してください。");
  }

  const limit = optionalInteger(args, "limit", { min: 1, max: MAX_LIMIT }) ?? DEFAULT_LIMIT;
  const offset = optionalInteger(args, "offset", { min: 0, max: Number.MAX_SAFE_INTEGER }) ?? 0;

  const prompts = await repository.search({ query, tag, limit, offset });
  return { count: prompts.length, prompts: prompts.map(serialize) };
}

async function deletePrompt(repository: PromptRepository, args: Args): Promise<ToolResult> {
  const id = requiredString(args, "id");

  const deleted = await repository.delete(id);
  if (!deleted) throw new ToolError(`プロンプトが見つかりません: ${id}`);

  return { deleted: true, id };
}

function serialize(prompt: Prompt): Record<string, unknown> {
  return {
    id: prompt.id,
    title: prompt.title,
    content: prompt.content,
    tags: prompt.tags === null ? [] : prompt.tags.split(","),
    created_at: prompt.created_at,
    updated_at: prompt.updated_at,
  };
}
