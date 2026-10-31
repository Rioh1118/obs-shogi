#!/usr/bin/env bash
# 引数のファイルをクリップボードへ写す。写す手段が無いか失敗したら非0で返す。
set -u -o pipefail

file=${1:?usage: copy.sh <file>}
[ -r "$file" ] || exit 2

# SSH 越しのクリップボードは接続先のもので、手元には届かない
[ -z "${SSH_CONNECTION:-}" ] || exit 1

if command -v pbcopy >/dev/null; then
  # pbcopy はロケールが UTF-8 でないと日本語を化けさせる
  LC_CTYPE=UTF-8 pbcopy <"$file"
elif command -v clip.exe >/dev/null; then
  # clip.exe は UTF-8 を解さない。WSL では wl-copy も見えるので Linux の口より先に見る
  iconv -f UTF-8 -t UTF-16LE "$file" | clip.exe
elif [ -n "${WAYLAND_DISPLAY:-}" ] && command -v wl-copy >/dev/null; then
  wl-copy <"$file"
elif [ -n "${DISPLAY:-}" ] && command -v xclip >/dev/null; then
  xclip -selection clipboard <"$file"
else
  exit 1
fi
