// LLM プロバイダのファクトリ。

import { createClaudeClient } from "./claude.js";

export function createLLMClient(settings) {
  switch (settings.llmProvider) {
    case "claude":
    default:
      return createClaudeClient(settings);
  }
}
