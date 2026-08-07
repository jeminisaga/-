import { ERROR_CODES, SERVER_INFO, handlePayload, rpcError } from "./mcp";
import { PromptRepository } from "./repository";
import { TOOL_DEFINITIONS } from "./tools";
import type { Env } from "./types";

/** ブラウザ上のエージェント（WebMCP）から呼べるように CORS を許可する */
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, accept, mcp-protocol-version",
  "Access-Control-Max-Age": "86400",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...CORS_HEADERS },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (url.pathname === "/mcp") {
      return await handleMcp(request, env);
    }

    if (url.pathname === "/" && request.method === "GET") {
      return json({
        status: "ok",
        server: SERVER_INFO,
        endpoint: "/mcp",
        tools: TOOL_DEFINITIONS.map((tool) => tool.name),
      });
    }

    return json({ error: "Not Found" }, 404);
  },
} satisfies ExportedHandler<Env>;

async function handleMcp(request: Request, env: Env): Promise<Response> {
  // ステートレス運用のため SSE ストリーム（GET）とセッション終了（DELETE）は提供しない
  if (request.method !== "POST") {
    return new Response(
      JSON.stringify(rpcError(null, ERROR_CODES.invalidRequest, "POST のみ対応しています。")),
      {
        status: 405,
        headers: { "content-type": "application/json", allow: "POST, OPTIONS", ...CORS_HEADERS },
      },
    );
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json(rpcError(null, ERROR_CODES.parseError, "JSON を解析できませんでした。"), 400);
  }

  const repository = new PromptRepository(env.DB);
  const response = await handlePayload(payload, repository);

  // 通知のみのリクエストにはボディを返さない
  if (response === null) {
    return new Response(null, { status: 202, headers: CORS_HEADERS });
  }

  return json(response);
}
