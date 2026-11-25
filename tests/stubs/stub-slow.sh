#!/bin/sh
# 慢桩:rewrite "slow cmd" 时睡 5 秒,配合 rewriteTimeoutMs:100 测超时直通。
case "$1" in
  --version) exit 0 ;;
  rewrite)
    case "$2" in
      "slow cmd") sleep 5; exit 0 ;;
      *) exit 1 ;;
    esac ;;
esac
exit 0
