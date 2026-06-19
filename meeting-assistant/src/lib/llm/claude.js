// Claude API（/v1/messages）をブラウザから直叩きしてストリーミング。
//
// 注意:
//  - ブラウザ origin からの呼び出しには anthropic-dangerous-direct-browser-access: true が必須。
//  - Opus 4.8 では temperature/top_p/budget_tokens は送らない（400 になる）。
//    低レイテンシ優先で thinking は付けず、プロンプトで「前置きなし・JSONのみ」を指示。
//  - 構造化出力は output_config.format（旧 output_format ではない）。

import { buildSystemPrompt, buildUserContent, suggestionSchema } from "./prompt.js";

const ENDPOINT = "https://api.anthropic.com/v1/messages";

export function createClaudeClient(settings) {
  return new ClaudeClient(settings);
}

class ClaudeClient {
  constructor(settings) {
    this.apiKey = settings.llmApiKey;
    this.model = settings.llmModel || "claude-opus-4-8";
    this.settings = settings;
  }

  hasKey() {
    return !!this.apiKey;
  }

  // transcript: [{text}], signal: AbortSignal, onDelta: (partialText)=>void
  // 返り値: { suggestions: [...] }
  async suggest({ transcript, signal, onDelta }) {
    const body = {
      model: this.model,
      max_tokens: 1024,
      stream: true,
      system: buildSystemPrompt(this.settings),
      messages: [{ role: "user", content: buildUserContent(transcript) }],
      output_config: {
        format: { type: "json_schema", schema: suggestionSchema() },
      },
    };

    const text = await this._streamText(body, signal, onDelta);
    return safeParse(text);
  }

  // 鍵の疎通確認（options のテスト接続用）
  async ping() {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: this._headers(),
      body: JSON.stringify({
        model: this.model,
        max_tokens: 1,
        messages: [{ role: "user", content: "hi" }],
      }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`Claude ${res.status}: ${t.slice(0, 200)}`);
    }
    return true;
  }

  _headers() {
    return {
      "x-api-key": this.apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
      "content-type": "application/json",
    };
  }

  async _streamText(body, signal, onDelta, _retried = false) {
    let res;
    try {
      res = await fetch(ENDPOINT, {
        method: "POST",
        headers: this._headers(),
        body: JSON.stringify(body),
        signal,
      });
    } catch (err) {
      if (err && err.name === "AbortError") throw err;
      throw new Error(`ネットワークエラー: ${err && err.message}`);
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      if (res.status === 401) throw new Error("APIキーが無効です");
      if (res.status === 429) {
        // 1回だけバックオフして再試行
        if (!_retried) {
          await delay(1500, signal);
          return this._streamText(body, signal, onDelta, true);
        }
        throw new Error("レート制限です。しばらく待ってください");
      }
      if (res.status >= 500 && !_retried) {
        await delay(800, signal);
        return this._streamText(body, signal, onDelta, true);
      }
      throw new Error(`Claude ${res.status}: ${errText.slice(0, 200)}`);
    }

    return this._readSse(res.body, onDelta);
  }

  async _readSse(stream, onDelta) {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let acc = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let idx;
      while ((idx = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;

        let event;
        try {
          event = JSON.parse(payload);
        } catch {
          continue;
        }
        if (
          event.type === "content_block_delta" &&
          event.delta &&
          event.delta.type === "text_delta"
        ) {
          acc += event.delta.text;
          if (onDelta) onDelta(acc);
        }
      }
    }
    return acc;
  }
}

function safeParse(text) {
  try {
    const obj = JSON.parse(text);
    if (obj && Array.isArray(obj.suggestions)) return obj;
  } catch {
    /* fallthrough */
  }
  return { suggestions: [] };
}

function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    if (signal) {
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(t);
          reject(new DOMException("Aborted", "AbortError"));
        },
        { once: true }
      );
    }
  });
}
