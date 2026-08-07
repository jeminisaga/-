import { describe, expect, it } from "vitest";
import {
  ERROR_CODES,
  LATEST_PROTOCOL_VERSION,
  SERVER_INFO,
  handleMessage,
  handlePayload,
} from "../src/mcp";
import { PromptRepository } from "../src/repository";
import { createTestDb, fixedClock, sequentialIds } from "./helpers/d1";

function repo(): PromptRepository {
  return new PromptRepository(createTestDb(), fixedClock(), sequentialIds());
}

function request(method: string, params?: unknown, id: string | number = 1) {
  return { jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) };
}

function toolPayload(response: unknown): { text: unknown; isError: boolean } {
  const result = (response as { result: Record<string, unknown> }).result;
  const content = result["content"] as { type: string; text: string }[];
  return { text: JSON.parse(content[0]!.text), isError: result["isError"] as boolean };
}

describe("initialize", () => {
  it("サーバー情報と tools capability を返す", async () => {
    const response = await handleMessage(
      request("initialize", { protocolVersion: LATEST_PROTOCOL_VERSION, capabilities: {} }),
      repo(),
    );

    const result = (response as { result: Record<string, unknown> }).result;
    expect(result["protocolVersion"]).toBe(LATEST_PROTOCOL_VERSION);
    expect(result["serverInfo"]).toEqual(SERVER_INFO);
    expect(result["capabilities"]).toHaveProperty("tools");
  });

  it("クライアントが対応版を提示すればそれに合わせる", async () => {
    const response = await handleMessage(
      request("initialize", { protocolVersion: "2024-11-05" }),
      repo(),
    );

    expect((response as { result: { protocolVersion: string } }).result.protocolVersion).toBe(
      "2024-11-05",
    );
  });

  it("未知のバージョンには最新版を返す", async () => {
    const response = await handleMessage(
      request("initialize", { protocolVersion: "1999-01-01" }),
      repo(),
    );

    expect((response as { result: { protocolVersion: string } }).result.protocolVersion).toBe(
      LATEST_PROTOCOL_VERSION,
    );
  });
});

describe("tools/list", () => {
  it("5 つのツールを返す", async () => {
    const response = await handleMessage(request("tools/list"), repo());
    const tools = (response as { result: { tools: { name: string }[] } }).result.tools;

    expect(tools.map((tool) => tool.name)).toEqual([
      "save_prompt",
      "list_prompts",
      "get_prompt",
      "search_prompts",
      "delete_prompt",
    ]);
  });
});

describe("tools/call", () => {
  it("保存 → 検索 → 取得 → 削除が一連で動く", async () => {
    const repository = repo();

    const saved = toolPayload(
      await handleMessage(
        request("tools/call", {
          name: "save_prompt",
          arguments: { title: "X投稿", content: "案を3つ", tags: "X投稿,分析" },
        }),
        repository,
      ),
    );
    expect(saved.isError).toBe(false);
    const id = (saved.text as { prompt: { id: string } }).prompt.id;

    const searched = toolPayload(
      await handleMessage(
        request("tools/call", { name: "search_prompts", arguments: { tag: "分析" } }),
        repository,
      ),
    );
    expect((searched.text as { count: number }).count).toBe(1);

    const got = toolPayload(
      await handleMessage(
        request("tools/call", { name: "get_prompt", arguments: { id } }),
        repository,
      ),
    );
    expect((got.text as { prompt: { title: string } }).prompt.title).toBe("X投稿");

    const deleted = toolPayload(
      await handleMessage(
        request("tools/call", { name: "delete_prompt", arguments: { id } }),
        repository,
      ),
    );
    expect((deleted.text as { deleted: boolean }).deleted).toBe(true);
  });

  it("想定内の失敗は isError の結果として返す", async () => {
    const response = await handleMessage(
      request("tools/call", { name: "get_prompt", arguments: { id: "missing" } }),
      repo(),
    );

    const payload = toolPayload(response);
    expect(payload.isError).toBe(true);
    expect((payload.text as { error: string }).error).toMatch(/見つかりません/);
    expect(response).not.toHaveProperty("error");
  });

  it("未知のツール名は JSON-RPC エラー", async () => {
    const response = await handleMessage(request("tools/call", { name: "nope" }), repo());

    expect((response as { error: { code: number } }).error.code).toBe(ERROR_CODES.invalidParams);
  });

  it("name が無ければ invalidParams", async () => {
    const response = await handleMessage(request("tools/call", {}), repo());

    expect((response as { error: { code: number } }).error.code).toBe(ERROR_CODES.invalidParams);
  });

  it("予期しない例外は internalError（DB 未初期化など）", async () => {
    const broken = new PromptRepository({
      prepare() {
        throw new Error("no such table: prompts");
      },
    } as unknown as D1Database);

    const response = await handleMessage(
      request("tools/call", { name: "list_prompts", arguments: {} }),
      broken,
    );

    expect((response as { error: { code: number } }).error.code).toBe(ERROR_CODES.internalError);
  });
});

describe("プロトコル全般", () => {
  it("ping に空の結果を返す", async () => {
    const response = await handleMessage(request("ping"), repo());
    expect((response as { result: unknown }).result).toEqual({});
  });

  it("通知には応答しない", async () => {
    const response = await handleMessage(
      { jsonrpc: "2.0", method: "notifications/initialized" },
      repo(),
    );

    expect(response).toBeNull();
  });

  it("未対応メソッドは methodNotFound", async () => {
    const response = await handleMessage(request("resources/list"), repo());
    expect((response as { error: { code: number } }).error.code).toBe(ERROR_CODES.methodNotFound);
  });

  it("JSON-RPC 2.0 でないメッセージは invalidRequest", async () => {
    const response = await handleMessage({ method: "ping", id: 1 }, repo());
    expect((response as { error: { code: number } }).error.code).toBe(ERROR_CODES.invalidRequest);
  });

  it("id を応答にそのまま返す", async () => {
    const response = await handleMessage(request("ping", undefined, "abc"), repo());
    expect((response as { id: string }).id).toBe("abc");
  });
});

describe("handlePayload", () => {
  it("バッチは応答の配列を返す", async () => {
    const responses = await handlePayload([request("ping", undefined, 1), request("tools/list", undefined, 2)], repo());

    expect(Array.isArray(responses)).toBe(true);
    expect((responses as { id: number }[]).map((response) => response.id)).toEqual([1, 2]);
  });

  it("通知だけのバッチは null", async () => {
    const responses = await handlePayload(
      [{ jsonrpc: "2.0", method: "notifications/initialized" }],
      repo(),
    );

    expect(responses).toBeNull();
  });

  it("空のバッチは invalidRequest", async () => {
    const response = await handlePayload([], repo());
    expect((response as { error: { code: number } }).error.code).toBe(ERROR_CODES.invalidRequest);
  });
});
