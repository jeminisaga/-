import { describe, expect, it } from "vitest";
import worker from "../src/index";
import type { Env } from "../src/types";
import { createTestDb } from "./helpers/d1";

function env(): Env {
  return { DB: createTestDb() };
}

async function post(body: unknown, environment: Env = env()): Promise<Response> {
  return await worker.fetch(
    new Request("https://example.com/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    environment,
    {} as ExecutionContext,
  );
}

describe("Worker のルーティング", () => {
  it("GET / でヘルスチェックを返す", async () => {
    const response = await worker.fetch(
      new Request("https://example.com/"),
      env(),
      {} as ExecutionContext,
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { status: string; endpoint: string; tools: string[] };
    expect(body.status).toBe("ok");
    expect(body.endpoint).toBe("/mcp");
    expect(body.tools).toHaveLength(5);
  });

  it("POST /mcp が JSON-RPC を処理する", async () => {
    const response = await post({ jsonrpc: "2.0", id: 1, method: "tools/list" });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    const body = (await response.json()) as { result: { tools: unknown[] } };
    expect(body.result.tools).toHaveLength(5);
  });

  it("保存した内容が同じ DB から読み出せる", async () => {
    const environment = env();
    await post(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "save_prompt", arguments: { title: "t", content: "c" } },
      },
      environment,
    );

    const response = await post(
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "list_prompts" } },
      environment,
    );
    const body = (await response.json()) as { result: { content: { text: string }[] } };
    expect(JSON.parse(body.result.content[0]!.text).count).toBe(1);
  });

  it("通知のみのリクエストは 202 でボディ無し", async () => {
    const response = await post({ jsonrpc: "2.0", method: "notifications/initialized" });

    expect(response.status).toBe(202);
    expect(await response.text()).toBe("");
  });

  it("壊れた JSON は parseError", async () => {
    const response = await worker.fetch(
      new Request("https://example.com/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{ broken",
      }),
      env(),
      {} as ExecutionContext,
    );

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: number } };
    expect(body.error.code).toBe(-32700);
  });

  it("GET /mcp は 405（SSE 非対応のステートレス運用）", async () => {
    const response = await worker.fetch(
      new Request("https://example.com/mcp"),
      env(),
      {} as ExecutionContext,
    );

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toContain("POST");
  });

  it("OPTIONS に CORS ヘッダーを返す", async () => {
    const response = await worker.fetch(
      new Request("https://example.com/mcp", { method: "OPTIONS" }),
      env(),
      {} as ExecutionContext,
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("未知のパスは 404", async () => {
    const response = await worker.fetch(
      new Request("https://example.com/unknown"),
      env(),
      {} as ExecutionContext,
    );

    expect(response.status).toBe(404);
  });
});
