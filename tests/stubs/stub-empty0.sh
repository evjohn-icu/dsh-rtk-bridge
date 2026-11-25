#!/bin/sh
# exit 0 且 stdout 为空的桩。
[ -n "$RTK_CALL_LOG" ] && printf '%s|%s\n' "$1" "$2" >> "$RTK_CALL_LOG"
case "$1" in
  --version) exit 0 ;;
  rewrite) exit 0 ;;
esac
exit 0
