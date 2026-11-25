#!/bin/sh
# 管线规则拒绝桩:rewrite 打印拒绝消息到 stdout 并 exit 2(消息绝不能被当成命令)。
[ -n "$RTK_CALL_LOG" ] && printf '%s|%s\n' "$1" "$2" >> "$RTK_CALL_LOG"
case "$1" in
  --version) exit 0 ;;
  rewrite)
    printf 'rtk: denied by pipeline rule: %s' "$2"
    printf 'notice: rtk hook protocol v1\n' >&2
    exit 2 ;;
esac
exit 0
