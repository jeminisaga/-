#!/usr/bin/env bash
# ローカル1コマンド運用。Claude Code のサブスクリプションでLLM腕を回す。
set -euo pipefail
R=${1:?"使い方: ./run_week.sh <節番号> [arms...]"}
shift || true
ARMS=${*:-"A B C"}

python -m src.fetch --round "$R"
python -m src.predict --round "$R" --arms $ARMS

mkdir -p "data/predictions/round_$(printf %02d "$R")"
for A in $ARMS; do
  D="data/predictions/round_$(printf %02d "$R")"
  cat "prompts/round_$(printf %02d "$R")/arm_$A.md" | claude -p > "$D/llm_$A.raw"
  python -m src.ingest --round "$R" --arm "$A"
done

git add -A
git commit -m "predict round $R (arms: $ARMS)"
git push
echo "予測をキックオフ前に確定・push しました。"
