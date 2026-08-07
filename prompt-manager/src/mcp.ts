import type { PromptRepository } from "./repository";
import { TOOL_DEFINITIONS, TOOL_NAMES, callTool } from "./tools";
import { ToolError } from "./types";

export const SERVER_INFO = {
  name: "prompt-manager",
  title: "プロンプト管理ツール",
  version: "0.1.0",
} as const;

export const LATEST_PROTOCOL_VERSION = "2025-06-18";
const SUPPORTED_PROTOCOL_VERSIONS = new Set([
  LATEST_PROTOCOL_VERSION,
  "2025-03-26",
  "2024-11-05",
]);

export const ERROR_CODES = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internalError: -32603,
} as const;

type JsonRpcId = string | number | null;

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result?: unknown;
  error?: { code: number; message: string };
}

function ok(id: JsonRpcId, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

export function rpcError(id: JsonRpcId, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 単一の JSON-RPC メッセージを処理する。
 * 通知（id なし）には応答を返さないため null を返す。
 */
export async function handleMessage(
  message: unknown,
  repository: PromptRepository,
): Promise<JsonRpcResponse | null> {
  if (!isRecord(message) || message["jsonrpc"] !== "2.0" || typeof message["method"] !== "string") {
    return rpcError(null, ERROR_CODES.invalidRequest, "JSON-RPC 2.0 のリクエストではありません。");
  }

  const method = message["method"];
  const rawId = message["id"];
  const isNotification = rawId === undefined;
  const id: JsonRpcId =
    typeof rawId === "string" || typeof rawId === "number" ? rawId : null;
  const params = message["params"];

  // 通知は結果を返さない（notifications/initialized など）
  if (isNotification) return null;

  switch (method) {
    case "initialize":
      return ok(id, initialize(params));

    case "ping":
      return ok(id, {});

    case "tools/list":
      return ok(id, { tools: TOOL_DEFINITIONS });

    case "tools/call":
      return await toolsCall(id, params, repository);

    default:
      return rpcError(id, ERROR_CODES.methodNotFound, `未対応のメソッドです: ${method}`);
  }
}

function initialize(params: unknown): Record<string, unknown> {
  const requested = isRecord(params) ? params["protocolVersion"] : undefined;
  const protocolVersion =
    typeof requested === "string" && SUPPORTED_PROTOCOL_VERSIONS.has(requested)
      ? requested
      : LATEST_PROTOCOL_VERSION;

  return {
    protocolVersion,
    capabilities: { tools: { listChanged: false } },
    serverInfo: SERVER_INFO,
    instructions:
      "保存済みプロンプトの検索・取得・保存・削除ができます。" +
      "プロンプトを探すときは search_prompts、全件を眺めるときは list_prompts を使ってください。",
  };
}

async function toolsCall(
  id: JsonRpcId,
  params: unknown,
  repository: PromptRepository,
): Promise<JsonRpcResponse> {
  if (!isRecord(params) || typeof params["name"] !== "string") {
    return rpcError(id, ERROR_CODES.invalidParams, "params.name は必須です。");
  }

  const name = params["name"];
  if (!TOOL_NAMES.has(name)) {
    return rpcError(id, ERROR_CODES.invalidParams, `未知のツールです: ${name}`);
  }

  try {
    const result = await callTool(repository, name, params["arguments"]);
    return ok(id, toolContent(result, false));
  } catch (error) {
    // 想定内の失敗はプロトコルエラーではなく isError 付きの結果として返す（MCP 仕様）
    if (error instanceof ToolError) {
      return ok(id, toolContent({ error: error.message }, true));
    }
    console.error("tools/call failed", { name, error });
    return rpcError(id, ERROR_CODES.internalError, "サーバー内部エラーが発生しました。");
  }
}

function toolContent(payload: unknown, isError: boolean): Record<string, unknown> {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    isError,
  };
}

/**
 * リクエストボディ全体（単一メッセージ、または JSON-RPC バッチ）を処理する。
 * すべてが通知だった場合は null（HTTP 202 を返す想定）。
 */
export async function handlePayload(
  payload: unknown,
  repository: PromptRepository,
): Promise<JsonRpcResponse | JsonRpcResponse[] | null> {
  if (Array.isArray(payload)) {
    if (payload.length === 0) {
      return rpcError(null, ERROR_CODES.invalidRequest, "空のバッチは処理できません。");
    }
    const responses: JsonRpcResponse[] = [];
    for (const message of payload) {
      const response = await handleMessage(message, repository);
      if (response !== null) responses.push(response);
    }
    return responses.length > 0 ? responses : null;
  }

  return await handleMessage(payload, repository);
}
