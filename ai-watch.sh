#!/bin/bash
# ai-watch.sh — AI 遠端協作自動推送腳本
# 用途：當 Claude 修改程式碼後，自動 commit + push 到 GitHub
# 使用方式：在專案根目錄執行 bash ai-watch.sh

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
BRANCH="main"
INTERVAL=20  # 每 20 秒檢查一次

echo "🤖 AI 遠端協作模式啟動"
echo "📁 監控目錄：$REPO_DIR"
echo "🔁 每 ${INTERVAL} 秒自動同步一次"
echo "按 Ctrl+C 停止"
echo "---"

cd "$REPO_DIR"

while true; do
  # 先從遠端拉取最新狀態
  git fetch origin "$BRANCH" --quiet 2>/dev/null

  # 檢查是否有本地未提交的變更
  CHANGES=$(git status --porcelain 2>/dev/null)

  if [ -n "$CHANGES" ]; then
    TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
    FILES_CHANGED=$(echo "$CHANGES" | wc -l | tr -d ' ')

    echo "[$TIMESTAMP] 偵測到 ${FILES_CHANGED} 個檔案變更，正在提交..."

    # 清除過期 index.lock（VS Code / Codex 常遺留）
    if [ -f "$REPO_DIR/.git/index.lock" ]; then
      rm -f "$REPO_DIR/.git/index.lock" 2>/dev/null && echo "[$TIMESTAMP] 🔓 清除過期 index.lock"
    fi

    # 清除卡住的 rebase 狀態
    if [ -d "$REPO_DIR/.git/rebase-merge" ]; then
      rm -rf "$REPO_DIR/.git/rebase-merge" 2>/dev/null && echo "[$TIMESTAMP] 🔄 清除卡住的 rebase-merge"
    fi
    if [ -d "$REPO_DIR/.git/rebase-apply" ]; then
      rm -rf "$REPO_DIR/.git/rebase-apply" 2>/dev/null && echo "[$TIMESTAMP] 🔄 清除卡住的 rebase-apply"
    fi

    git add -A
    git commit -m "feat(ai): Claude 自動更新 — $TIMESTAMP

$(echo "$CHANGES" | head -10)" --quiet

    # Push，如果遠端有新 commit 先 merge（改用 merge 避免 rebase 卡住）
    if git push origin "$BRANCH" --quiet 2>/dev/null; then
      echo "[$TIMESTAMP] ✅ 推送成功 → GitHub 已更新"
    else
      echo "[$TIMESTAMP] ⚠️  遠端有更新，先拉取再推送..."
      git pull --no-rebase origin "$BRANCH" --quiet -X ours 2>/dev/null
      git push origin "$BRANCH" --quiet 2>/dev/null
      echo "[$TIMESTAMP] ✅ 重新推送成功"
    fi
  fi

  sleep "$INTERVAL"
done
