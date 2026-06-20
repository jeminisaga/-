// LLM プロバイダのファクトリ。

import { createClaudeClient } from "./claude.js";
import { createOpenAICompatClient } from "./openai_compat.js";

export function createLLMClient(settings) {
  switch (settings.llmProvider) {
    case "claude":
      return createClaudeClient(settings);
    case "openai":
    case "deepseek":
      return createOpenAICompatClient(settings);
    default:
      // 既定は OpenAI 互換（DeepSeek）
      return createOpenAICompatClient(settings);
  }
}
