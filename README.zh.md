# dsh-rtk-bridge

[English](README.md) | 中文

一个 DeepSeek Harness（DSH）插件：在执行前把符合条件的 shell 命令交给本机 [rtk](https://github.com/rtk-ai/rtk)（Rust Token Killer）改写，让模型读到的是压缩后的工具输出，而不是原始字节。它只是一个很薄的接缝封装：零 DSH 内部模块 import，除命令字符串本身外，执行行为没有任何改变。

```text
$ git status                  # 改写前：469 B 原始输出
On branch main
Your branch is up to date with 'origin/main'.
Changes not staged for commit:
  modified:   src/index.js
  modified:   README.md
no changes added to commit

$ rtk git status              # 改写后：109 B，缩小 76.8%
main ≡ origin/main  M src/index.js  M README.md
```

（输出内容为示意；字节数为实测，见下文「实测数据」。）

## 工作原理

插件 inject `shell` 能力接缝，并 wrap 挂载执行器实例上的 `resolve()`。wrap 发生在执行器自己的 resolve 完成之后，因此 workdir、timeout、环境变量、沙箱策略、退出码渲染、后台任务语义全部原样继承——只有 `command` 源串可能变化。

由于插件零 DSH 内部模块 import、也没有 `@deepseek-ai` peer 依赖，它不受任何 dsh 版本门槛约束：唯一的引擎要求是 Node.js ≥ 20。

## 改写协议

对每条符合条件的命令，插件调用 `rtk rewrite <command>`，并沿用 rtk 官方 hook 的协议——只去掉权限决定部分，审批仍由 DSH 自己的 approval seam 负责。

| rtk rewrite 结果 | 行为 |
|---|---|
| 退出码 0 或 3，stdout 非空、不等于原命令、且不含换行 | 执行改写后的命令 |
| 退出码 1 或 2 | 原样直通 |
| 改写超时（`rewriteTimeoutMs`） | 原样直通 |
| rtk 二进制缺失或崩溃 | 原样直通 |

- 只有退出码与 stdout 同时满足判据才接受改写，因此 exit 2 的 deny 消息绝不会被误当作命令、更不会被执行。
- stderr 恒忽略。
- 复合命令、环境变量前缀、wrapper（`cd x && git status`、`FOO=bar git status`、`timeout 30 cargo build`）由 rtk 自己逐段处理；多行脚本、重定向、命令替换、`sudo` 会被 rtk 拒绝，这些命令原样直通。
- 已带 `rtk` 前缀的命令、以及喂 stdin 的调用（hooks 桥）完全跳过改写。

## 安装

```bash
# npm 包
dsh plugin --profile <your-profile> add dsh-rtk-bridge

# GitHub Release tgz
dsh plugin --profile <your-profile> add https://github.com/evjohn-icu/dsh-rtk-bridge/releases/latest/download/dsh-rtk-bridge.tgz

# 本地目录
dsh plugin --profile <your-profile> add /path/to/your/dsh-rtk-bridge-checkout
```

安装完成后重启 Harness 生效。收录情况也可以在 DSH Web 的插件市场（dsh-market 社区索引）里搜索确认。

### 要求

- Node.js ≥ 20（唯一的引擎门槛）。
- 本机有可用的 [rtk](https://github.com/rtk-ai/rtk) 二进制；下文实测数据基于 rtk 1.2.1。插件不安装、不锁定 rtk 版本；没有 rtk 时每条命令都原样直通。
- rtk 可用性在每次插件应用时探测一次：显式配置的 `rtkExe` 信任不探测，否则按平台候选链依序探测。因此后装 rtk 需要重启 Harness（或重载插件）才能生效。

## 配置

| 键 | 默认值 | 说明 |
|---|---|---|
| `enabled` | `true` | 设为 `false` 时插件保持挂载但不生效。 |
| `rtkExe` | 平台候选链 | 二进制名或绝对路径，用于非 PATH 安装（例如 `/opt/homebrew/bin/rtk`）。 |
| `rewriteTimeoutMs` | `3000` | 单次改写子进程的时限，上限 10000；超时后命令原样直通。 |

改写结果按进程缓存（500 条），重复命令零开销。

## Windows 兼容

- 改写通过 `spawnSync` 执行并带 `windowsHide`，不会闪出控制台窗口。
- 探测回退链包含 `%USERPROFILE%\.cargo\bin\rtk.exe`（`cargo install` 的默认位置）。
- 在 win32 上，只有命令首 token 属于开发工具白名单（git、cargo、npm、pytest、docker 等 40+ 项）时才尝试改写。这是有意为之：`ls`、`cat`、`pwd`、`cp`、`rm` 在 PowerShell 里是别名，改写会改变语义；其余命令一律原样直通。
- PowerShell 语法命令会被 rtk 全部拒绝改写（实测 exit 1），因此永远不会被改写——零风险。

## 实测数据

macOS + rtk 1.2.1 实测：

| 场景 | 结果 |
|---|---|
| 被 rtk 介入的命令（`git status`、大目录 `ls`、`find` 等） | 节省 34–77% 输出字节，中位约 66% |
| 小输出与已截断命令 | 原样透传，0 节省 |
| 全部命令整体 | 输出字节中位节省约 22% |
| 退出码 | 透传无损（0/1/2/128 严格一致） |
| 唯一观测到的偏移 | 目标二进制不存在时，rtk 返回 1 而非 shell 的 127 |
| 额外延迟 | 每次 +5–35 ms |
| `git status` | 469 B → 109 B（缩小 76.8%） |
| `ls /System/Library/Fonts` | 6125 B → 1510 B（缩小 75.3%） |
| DSH `workspace-write` 沙箱 | rtk 正常执行，压缩生效 |

## 兼容性与局限

- 不经 `ctx.shell` 的路径——持久终端（PTY）、文件搜索、工作区 git 快照等——不会被压缩。
- bash/pwsh 工具的呈现层仍显示原始命令；被压缩的只是模型读到的输出。
- rtk 未覆盖的命令类别不会被改写，也就不受益。

## 验证

安装并重启 Harness 后，在 git 仓库里通过 shell 工具跑 `git status`，输出应呈现 rtk 的压缩格式：一行分支信息加短状态项。

## 开发

```bash
npm test
# 或直接：
node --test "tests/*.test.mjs"
```

hermetic 桩是 POSIX shell 脚本：在 Windows 上请从 Git Bash 运行测试套件（CI 在 Ubuntu/macOS 跑完整套件，Windows 只做语法与打包检查）。

## 许可证

[MIT](https://opensource.org/licenses/MIT) © [evjohn-icu](https://github.com/evjohn-icu)
