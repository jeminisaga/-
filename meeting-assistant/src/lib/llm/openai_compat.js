// OpenAI 互換 Chat Completions クライアント（ChatGPT / DeepSeek 等）。
// どちらも /chat/completions + SSE ストリーミング + response_format:json_object に対応。
// 拡張のバックグラウンド/オフスクリーンは host_permissions により CORS を回避できる。

import { OPENAI_COMPAT } from "../constants.js";
import { buildSystemPrompt, buildUserContent, jsonShapeInstruction } from "./prompt.js";

export function createOpenAICompatClient(settings) {
  return new OpenAICompatClient(settings);
}

class OpenAICompatClient {
  constructor(settings) {
    const conf = OPENAI_COMPAT[settings.llmProvider] || OPENAI_COMPAT.openai;
    this.baseUrl = conf.baseUrl;
    this.apiKey = settings.llmApiKey;
    this.model = settings.llmModel || conf.defaultModel;
    this.settings = settings;
  }

  hasKey() {
    return !!this.apiKey;
  }

  async suggest({ transcript, signal, onDelta }) {
    const system = buildSystemPrompt(this.settings) + jsonShapeInstruction();
    const body = {
      model: this.model,
      stream: true,
      max_tokens: 1024,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: buildUserContent(transcript) },
      ],
    };
    const text = await this._streamText(body, signal, onDelta);
    return safeParse(text);
  }

  async ping() {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
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
      throw new Error(`${res.status}: ${t.slice(0, 200)}`);
    }
    return true;
  }

  _headers() {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      "content-type": "application/json",
    };
  }

  async _streamText(body, signal, onDelta, _retried = false) {
    let res;
    try {
      res = await fetch(`${this.baseUrl}/chat/completions`, {
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
      throw new Error(`${res.status}: ${errText.slice(0, 200)}`);
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
        const delta =
          event.choices &&
          event.choices[0] &&
          event.choices[0].delta &&
          event.choices[0].delta.content;
        if (delta) {
          acc += delta;
          if (onDelta) onDelta(acc);
        }
      }
    }
    return acc;
  }
}

function safeParse(text) {
  // json_object でも稀にコードフェンスが付くため除去してからパース
  const cleaned = text.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  try {
    const obj = JSON.parse(cleaned);
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
