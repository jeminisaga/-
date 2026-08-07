import { describe, expect, it } from "vitest";
import { PromptRepository } from "../src/repository";
import { TOOL_DEFINITIONS, callTool, normalizeTags } from "../src/tools";
import { ToolError } from "../src/types";
import { createTestDb, fixedClock, sequentialIds } from "./helpers/d1";

function repo(): PromptRepository {
  return new PromptRepository(createTestDb(), fixedClock(), sequentialIds());
}

interface SavedPrompt {
  id: string;
  title: string;
  content: string;
  tags: string[];
  created_at: string;
  updated_at: string;
}

async function save(
  repository: PromptRepository,
  args: Record<string, unknown>,
): Promise<SavedPrompt> {
  const result = await callTool(repository, "save_prompt", args);
  return result["prompt"] as SavedPrompt;
}

describe("ツール定義", () => {
  it("要件定義書の 5 ツールを公開している", () => {
    expect(TOOL_DEFINITIONS.map((tool) => tool.name)).toEqual([
      "save_prompt",
      "list_prompts",
      "get_prompt",
      "search_prompts",
      "delete_prompt",
    ]);
  });

  it("すべてのツールに説明と入力スキーマがある", () => {
    for (const tool of TOOL_DEFINITIONS) {
      expect(tool.description.length).toBeGreaterThan(0);
      expect(tool.inputSchema["type"]).toBe("object");
    }
  });
});

describe("normalizeTags", () => {
  it("カンマ区切り文字列を正規化する", () => {
    expect(normalizeTags(" X投稿, 分析 ,Claude ")).toBe("X投稿,分析,Claude");
  });

  it("配列も受け付ける", () => {
    expect(normalizeTags(["X投稿", "分析"])).toBe("X投稿,分析");
  });

  it("重複と空要素を除去する", () => {
    expect(normalizeTags("a,,a, b ,")).toBe("a,b");
  });

  it("空になった場合は null", () => {
    expect(normalizeTags(" , ")).toBeNull();
    expect(normalizeTags([])).toBeNull();
  });

  it("未指定は undefined のまま", () => {
    expect(normalizeTags(undefined)).toBeUndefined();
  });

  it("文字列でも配列でもなければ ToolError", () => {
    expect(() => normalizeTags(42)).toThrow(ToolError);
    expect(() => normalizeTags([1])).toThrow(ToolError);
  });
});

describe("save_prompt", () => {
  it("新規保存で ID と日時が付与される", async () => {
    const repository = repo();
    const result = await callTool(repository, "save_prompt", {
      title: "X投稿のたたき台",
      content: "テーマに沿ってポスト案を3つ",
      tags: "X投稿,分析",
    });

    expect(result["created"]).toBe(true);
    const prompt = result["prompt"] as SavedPrompt;
    expect(prompt.id).toBe("id-1");
    expect(prompt.tags).toEqual(["X投稿", "分析"]);
    expect(prompt.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("tags 省略時は空配列で返る", async () => {
    const prompt = await save(repo(), { title: "t", content: "c" });
    expect(prompt.tags).toEqual([]);
  });

  it("id 指定で既存プロンプトを更新する", async () => {
    const repository = repo();
    const created = await save(repository, { title: "旧題", content: "本文", tags: "a" });

    const result = await callTool(repository, "save_prompt", {
      id: created.id,
      title: "新題",
    });

    expect(result["created"]).toBe(false);
    const updated = result["prompt"] as SavedPrompt;
    expect(updated.title).toBe("新題");
    expect(updated.content).toBe("本文");
    expect(updated.tags).toEqual(["a"]);
  });

  it("新規保存に title / content が無ければエラー", async () => {
    const repository = repo();
    await expect(callTool(repository, "save_prompt", { content: "c" })).rejects.toThrow(ToolError);
    await expect(callTool(repository, "save_prompt", { title: "t" })).rejects.toThrow(ToolError);
  });

  it("空文字はエラー", async () => {
    await expect(callTool(repo(), "save_prompt", { title: "  ", content: "c" })).rejects.toThrow(
      ToolError,
    );
  });

  it("更新対象が無ければエラー", async () => {
    await expect(
      callTool(repo(), "save_prompt", { id: "missing", title: "t" }),
    ).rejects.toThrow(/見つかりません/);
  });

  it("id だけで更新フィールドが無ければエラー", async () => {
    const repository = repo();
    const created = await save(repository, { title: "t", content: "c" });

    await expect(callTool(repository, "save_prompt", { id: created.id })).rejects.toThrow(ToolError);
  });
});

describe("list_prompts", () => {
  it("新しい順に件数付きで返す", async () => {
    const repository = repo();
    await save(repository, { title: "1つ目", content: "c" });
    await save(repository, { title: "2つ目", content: "c" });

    const result = await callTool(repository, "list_prompts", {});
    expect(result["count"]).toBe(2);
    expect((result["prompts"] as SavedPrompt[]).map((p) => p.title)).toEqual(["2つ目", "1つ目"]);
  });

  it("limit の範囲外はエラー", async () => {
    await expect(callTool(repo(), "list_prompts", { limit: 0 })).rejects.toThrow(ToolError);
    await expect(callTool(repo(), "list_prompts", { limit: 201 })).rejects.toThrow(ToolError);
    await expect(callTool(repo(), "list_prompts", { limit: 1.5 })).rejects.toThrow(ToolError);
  });

  it("引数なし（undefined）でも動く", async () => {
    const result = await callTool(repo(), "list_prompts", undefined);
    expect(result["count"]).toBe(0);
  });
});

describe("get_prompt", () => {
  it("ID で 1 件取得する", async () => {
    const repository = repo();
    const created = await save(repository, { title: "t", content: "c" });

    const result = await callTool(repository, "get_prompt", { id: created.id });
    expect((result["prompt"] as SavedPrompt).id).toBe(created.id);
  });

  it("見つからなければエラー", async () => {
    await expect(callTool(repo(), "get_prompt", { id: "missing" })).rejects.toThrow(/見つかりません/);
  });

  it("id が無ければエラー", async () => {
    await expect(callTool(repo(), "get_prompt", {})).rejects.toThrow(ToolError);
  });
});

describe("search_prompts", () => {
  it("キーワードで検索する", async () => {
    const repository = repo();
    await save(repository, { title: "議事録の要約", content: "5行で要約", tags: "要約" });
    await save(repository, { title: "コードレビュー", content: "差分を見て" });

    const result = await callTool(repository, "search_prompts", { query: "要約" });
    expect(result["count"]).toBe(1);
  });

  it("タグで検索する", async () => {
    const repository = repo();
    await save(repository, { title: "A", content: "c", tags: ["Claude", "要約"] });
    await save(repository, { title: "B", content: "c", tags: "Grok" });

    const result = await callTool(repository, "search_prompts", { tag: "Claude" });
    expect((result["prompts"] as SavedPrompt[]).map((p) => p.title)).toEqual(["A"]);
  });

  it("query も tag も無ければエラー", async () => {
    await expect(callTool(repo(), "search_prompts", {})).rejects.toThrow(ToolError);
  });
});

describe("delete_prompt", () => {
  it("削除できる", async () => {
    const repository = repo();
    const created = await save(repository, { title: "t", content: "c" });

    expect(await callTool(repository, "delete_prompt", { id: created.id })).toEqual({
      deleted: true,
      id: created.id,
    });
    await expect(callTool(repository, "get_prompt", { id: created.id })).rejects.toThrow(ToolError);
  });

  it("存在しなければエラー", async () => {
    await expect(callTool(repo(), "delete_prompt", { id: "missing" })).rejects.toThrow(ToolError);
  });
});

describe("callTool", () => {
  it("未知のツール名はエラー", async () => {
    await expect(callTool(repo(), "unknown_tool", {})).rejects.toThrow(ToolError);
  });

  it("arguments がオブジェクトでなければエラー", async () => {
    await expect(callTool(repo(), "list_prompts", [1, 2])).rejects.toThrow(ToolError);
  });
});
