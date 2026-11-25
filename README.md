# dsh-rtk-bridge

English | [中文](README.zh.md)

A DeepSeek Harness (DSH) plugin that routes eligible shell commands through the local [rtk](https://github.com/rtk-ai/rtk) (Rust Token Killer) CLI before execution, so the model reads compressed tool output instead of raw bytes. It is a thin seam wrapper: zero DSH internal modules are imported, and nothing about command execution changes except the command string itself.

```text
$ git status                  # before: 469 B of raw output
On branch main
Your branch is up to date with 'origin/main'.
Changes not staged for commit:
  modified:   src/index.js
  modified:   README.md
no changes added to commit

$ rtk git status              # after: 109 B — 76.8% smaller
main ≡ origin/main  M src/index.js  M README.md
```

(Output content is illustrative; the byte counts are measured — see [Benchmarks](#benchmarks).)

## How it works

The plugin injects the `shell` capability seam and wraps `resolve()` on the mounted executor instance. The wrap runs after the executor's own resolution, so workdir, timeout, environment, sandbox policy, exit-code rendering, and background-job semantics are all inherited unchanged — only the `command` source may change.

Because the plugin imports zero DSH internal modules and carries no `@deepseek-ai` peer dependency, it is not subject to any DSH version gate: the only engine requirement is Node.js ≥ 20.

## Rewrite protocol

For every eligible command the plugin calls `rtk rewrite <command>` and applies rtk's own hook protocol, minus permission decisions — approval remains with DSH's own approval seam.

| rtk rewrite result | Behavior |
|---|---|
| exit 0 or 3, with non-empty stdout that differs from the input and contains no newline | run the rewritten command |
| exit 1 or 2 | run the original command unchanged |
| rewrite timeout (`rewriteTimeoutMs`) | run the original command unchanged |
| rtk binary missing, or rtk crashes | run the original command unchanged |

- A rewrite is accepted only when the exit code and the stdout satisfy the criteria together, so an exit-2 deny message is never mistaken for, and never executed as, a command.
- stderr is always ignored.
- rtk itself handles compound commands, environment prefixes, and wrappers (`cd x && git status`, `FOO=bar git status`, `timeout 30 cargo build`) per segment, and refuses multi-line scripts, redirects, command substitution, and `sudo`; those commands pass through unchanged.
- Commands already prefixed with `rtk` and calls that feed stdin (hooks bridges) skip the rewrite entirely.

## Install

```bash
# npm package
dsh plugin --profile <your-profile> add dsh-rtk-bridge

# GitHub release tarball
dsh plugin --profile <your-profile> add https://github.com/evjohn-icu/dsh-rtk-bridge/releases/latest/download/dsh-rtk-bridge.tgz

# local checkout
dsh plugin --profile <your-profile> add /path/to/your/dsh-rtk-bridge-checkout
```

Restart the Harness after installing so the plugin takes effect. Listing availability can also be checked by searching the plugin marketplace in DSH Web (dsh-market community index).

### Requirements

- Node.js ≥ 20 (the only engine gate).
- A working [rtk](https://github.com/rtk-ai/rtk) binary; the benchmarks below used rtk 1.2.1. The plugin neither installs nor pins rtk, and without it every command passes through unchanged.
- rtk availability is probed once per plugin application: an explicitly configured `rtkExe` is trusted without probing, otherwise the platform candidate chain is probed in order. Installing rtk afterwards therefore requires a Harness restart (or a plugin reload) to take effect.

## Configuration

| Key | Default | Meaning |
|---|---|---|
| `enabled` | `true` | Set to `false` to keep the plugin mounted but inert. |
| `rtkExe` | platform candidate chain | Binary name or absolute path, for non-PATH installs (for example `/opt/homebrew/bin/rtk`). |
| `rewriteTimeoutMs` | `3000` | Per-rewrite subprocess deadline, capped at 10000; expiry passes the command through unchanged. |

Rewrites are cached per process (500 entries), so repeated commands cost nothing.

## Windows support

- Rewrites run through `spawnSync` with `windowsHide`, so no console window flashes.
- The probe fallback chain includes `%USERPROFILE%\.cargo\bin\rtk.exe`, the default `cargo install` location.
- On win32, a rewrite is attempted only when the first token of the command is in a development-tool whitelist (git, cargo, npm, pytest, docker, and 40+ more). This is deliberate: `ls`, `cat`, `pwd`, `cp`, and `rm` are PowerShell aliases, so rewriting them could change semantics; every other command passes through untouched.
- Commands written in PowerShell syntax are all refused by rtk itself (measured exit 1), so they are never rewritten — zero risk.

## Benchmarks

Measured on macOS with rtk 1.2.1:

| Scenario | Result |
|---|---|
| Commands rtk rewrote (`git status`, large-directory `ls`, `find`, …) | 34–77% of output bytes saved, median ≈ 66% |
| Small-output and already-truncated commands | passed through unchanged, 0% saved |
| All commands combined | median ≈ 22% of output bytes saved |
| Exit codes | passed through losslessly (0/1/2/128 strictly identical) |
| Only deviation observed | target binary missing: rtk returns 1 instead of the shell's 127 |
| Extra latency | +5–35 ms per rewrite |
| `git status` | 469 B → 109 B (76.8% smaller) |
| `ls /System/Library/Fonts` | 6125 B → 1510 B (75.3% smaller) |
| DSH `workspace-write` sandbox | rtk executes normally and compression works |

## Compatibility and limitations

- Paths that do not go through `ctx.shell` — persistent terminal (PTY) sessions, file search, workspace git snapshots, and similar — are not compressed.
- The bash/pwsh tool presentation still shows the original command; only the output the model reads is compressed.
- Command categories rtk does not cover are not rewritten and see no benefit.

## Verify

After installing and restarting the Harness, run `git status` in a git repository through the shell tool. The output should appear in rtk's condensed form: a branch line followed by short status entries.

## Development

```bash
npm test
# or directly:
node --test tests/
```

## License

[MIT](https://opensource.org/licenses/MIT) © [evjohn-icu](https://github.com/evjohn-icu)
