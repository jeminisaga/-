# ---- builder: ネイティブモジュール(@discordjs/opus 等)をビルド ----
FROM node:20-bookworm-slim AS builder
WORKDIR /app

# node-gyp に必要なビルドツール。
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY package.json ./
RUN npm install --omit=dev

# ---- runtime: 実行用の軽量イメージ ----
FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

# ffmpeg は将来の文字起こし/変換用の保険（録音自体には不要）。
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/node_modules ./node_modules
COPY . .

# 録音出力先。ホスト側ボリュームをマウントして永続化する。
VOLUME ["/app/recordings"]

CMD ["node", "src/index.js"]
