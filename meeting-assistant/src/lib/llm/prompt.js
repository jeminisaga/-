// 商談向け 日本語システムプロンプトの組み立て。

export function buildSystemPrompt(settings) {
  const industry = (settings.industry || "").trim();
  const n = settings.suggestionCount || 3;
  const industryLine = industry
    ? `あなたの担当業種・商材は「${industry}」です。これに沿った具体性のある提案をしてください。`
    : "";

  return [
    "あなたは経験豊富な法人営業のリアルタイム支援AIです。",
    "オンライン商談で「相手（顧客）」が話した内容の文字起こしが与えられます。",
    "それを読み、営業担当者（ユーザー）がすぐ口頭で使える回答候補を作成してください。",
    industryLine,
    "",
    "出力ルール:",
    `- 候補は最大 ${n} 件。`,
    "- 各候補は type が 'rebuttal'（相手の懸念・反論への切り返し）または 'proposal'（次の提案・深掘りトーク）。",
    "- title は一言の見出し、script はそのまま読み上げられる1〜3文の台本。",
    "- 日本語。簡潔・具体的・丁寧。誇張や根拠のない断定はしない。",
    "- 提示された文脈にない自社製品の事実を捏造しない。",
    "- 前置きや説明は不要。指定の JSON のみを返すこと。",
  ]
    .filter(Boolean)
    .join("\n");
}

// 相手発言の配列（{text}）を 1 つのユーザーメッセージにまとめる
export function buildUserContent(transcriptSegments) {
  const lines = transcriptSegments
    .map((s) => s.text)
    .filter(Boolean)
    .map((t) => `相手: ${t}`)
    .join("\n");
  return [
    "これまでの相手の発言:",
    lines || "(まだ発言がありません)",
    "",
    "上記、特に直近の発言に対する回答候補を JSON で出してください。",
  ].join("\n");
}

// 構造化出力スキーマ
export function suggestionSchema() {
  return {
    type: "object",
    properties: {
      suggestions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            type: { type: "string", enum: ["rebuttal", "proposal"] },
            title: { type: "string" },
            script: { type: "string" },
          },
          required: ["type", "title", "script"],
          additionalProperties: false,
        },
      },
    },
    required: ["suggestions"],
    additionalProperties: false,
  };
}
