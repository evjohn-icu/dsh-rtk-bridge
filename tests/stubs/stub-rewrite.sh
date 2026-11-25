#!/bin/sh
# 通用桩:--version 探测成功;rewrite 命中 "git status" → 输出改写并 exit 3,其余 exit 1。
# 每次被调用都向 $RTK_CALL_LOG 追加一行 "<$1>|<$2>"(侧信道计数)。
[ -n "$RTK_CALL_LOG" ] && printf '%s|%s\n' "$1" "$2" >> "$RTK_CALL_LOG"
case "$1" in
  --version) exit 0 ;;
  rewrite)
    case "$2" in
      "git status") printf 'rtk git status'; exit 3 ;;   # 真实 rtk 的 stdout 无换行结尾,桩照做
      *) exit 1 ;;                                        # 无改写
    esac ;;
esac
exit 0
