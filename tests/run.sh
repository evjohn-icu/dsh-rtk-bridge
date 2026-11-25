#!/bin/sh
# 运行 dsh-rtk 插件单元测试(全部 hermetic,rtk 用本地桩脚本模拟)。
# 使用系统 PATH 上的 node(>=20 即可,无需 DSH_NODE_EXECUTABLE)。
# 等价形式:仓库根 `npm test` 或 `node --test tests/`。
set -e
cd "$(dirname "$0")/.."
chmod +x tests/stubs/*.sh
node --test tests/
