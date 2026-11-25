#!/bin/sh
# 探测失败桩:--version 退出 1;rewrite 本可成功 —— 用于证明探测失败后 rewrite 绝不被调用。
[ -n "$RTK_CALL_LOG" ] && printf '%s|%s\n' "$1" "$2" >> "$RTK_CALL_LOG"
case "$1" in
  --version) exit 1 ;;
  rewrite) printf 'rtk git status'; exit 3 ;;
esac
exit 0
