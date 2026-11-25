#!/bin/sh
# stdout 与输入完全相同的桩(exit 0)。
[ -n "$RTK_CALL_LOG" ] && printf '%s|%s\n' "$1" "$2" >> "$RTK_CALL_LOG"
case "$1" in
  --version) exit 0 ;;
  rewrite) printf '%s' "$2"; exit 0 ;;
esac
exit 0
