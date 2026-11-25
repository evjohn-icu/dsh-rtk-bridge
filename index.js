/**
 * @local/dsh-rtk — route shell commands through the local rtk CLI
 * (Rust Token Killer, https://github.com/rtk-ai/rtk) so compressed tool
 * output reaches the model context.
 *
 * Thin by design: no DeepSeek Harness internals are imported. The plugin
 * injects the `shell` capability seam and wraps `resolve()` on the mounted
 * executor instance, so workdir/timeout/env/sandbox/background semantics are
 * inherited unchanged; only the shell source may change.
 *
 * Decision protocol mirrors rtk's own Claude Code hook, minus permission
 * decisions, which stay with DSH's approval seam:
 *   exit 0|3 + non-empty stdout that differs from the input → run rewritten
 *   everything else (exit 1/2, timeout, missing binary, crash) → passthrough
 *
 * Rewrite success is judged by exit code AND stdout together, so an rtk
 * pipeline-rule denial (exit 2 with a printed message) can never be mistaken
 * for a command. stderr (always carrying rtk's no-hook notice) is ignored.
 */

import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

export const name = 'dsh-rtk'
export const inject = ['shell']

const IS_WIN32 = process.platform === 'win32'

/** Marker slot guarding against double-wrapping; holds the active disposer. */
const PATCHED = Symbol.for('@local/dsh-rtk.patched')

/** Probe timeout for the one-shot `rtk --version` availability check. */
const PROBE_TIMEOUT_MS = 5000

/** Rewritten-command cache size; cleared wholesale when exceeded. */
const CACHE_LIMIT = 500

/**
 * Candidate binaries probed when no explicit rtkExe is configured. The Electron
 * main process often runs with a minimal PATH (/usr/bin:/bin:...), so plain
 * "rtk" misses homebrew installs; the common absolute locations are the
 * fallback. On Windows, cargo's default install dir and the .exe suffix apply.
 */
const DEFAULT_EXE_CANDIDATES = IS_WIN32
  ? [
      'rtk.exe',
      join(process.env.USERPROFILE ?? '', '.cargo', 'bin', 'rtk.exe'),
      join(process.env.LOCALAPPDATA ?? '', 'Programs', 'rtk', 'rtk.exe'),
    ]
  : ['rtk', '/opt/homebrew/bin/rtk', '/usr/local/bin/rtk']

/**
 * Development tools whose names mean the same thing under PowerShell as in
 * POSIX shells. Windows-only gate: `ls`, `cat`, `cp`, `rm`, `pwd` are
 * PowerShell ALIASES (Get-ChildItem, Get-Content, Copy-Item, Remove-Item),
 * so rewriting `ls -la` to `rtk ls -la` would change what actually runs.
 * On POSIX every command goes to `rtk rewrite` as-is.
 */
const WIN32_SAFE_TOOLS = new Set([
  'git', 'gh', 'glab', 'cargo', 'rustc', 'go', 'golangci-lint', 'npm', 'npx',
  'pnpm', 'yarn', 'node', 'bun', 'deno', 'docker', 'kubectl', 'helm', 'aws',
  'gcloud', 'az', 'terraform', 'ruff', 'pytest', 'mypy', 'uv', 'poetry',
  'dotnet', 'jest', 'vitest', 'playwright', 'prisma', 'tsc', 'eslint',
  'prettier', 'biome', 'gradle', 'mvn', 'sbt', 'java', 'javac', 'python',
  'python3', 'py', 'pip', 'php', 'phpunit', 'phpstan', 'composer', 'next',
])

function probeExe(exe) {
  try {
    return spawnSync(exe, ['--version'], { timeout: PROBE_TIMEOUT_MS, stdio: 'ignore' }).status === 0
  } catch {
    return false
  }
}

/**
 * Resolve the working rtk binary once per plugin application: an explicitly
 * configured exe is trusted as-is (hermetic tests, non-standard installs);
 * otherwise the default candidates are probed in order. Absence degrades the
 * whole plugin to an identity transform.
 */
function resolveExe(configured) {
  if (typeof configured === 'string' && configured.length > 0) {
    return probeExe(configured) ? configured : null
  }
  for (const exe of DEFAULT_EXE_CANDIDATES) {
    if (probeExe(exe)) return exe
  }
  return null
}

/**
 * Probe the rtk binary once per process; absence degrades the whole plugin
 * to an identity transform (every command runs exactly as before).
 */
function createRtk(exe, timeoutMs) {
  const cache = new Map()
  /**
   * Rewrite one shell command, or return it unchanged when rtk cannot (or
   * should not) improve it. Only accepts rewrites rtk itself approves with
   * exit 0/3 and non-empty stdout.
   */
  function rewrite(command) {
    const cached = cache.get(command)
    if (cached !== undefined) return cached
    let next = command
    if (exe !== null) {
      try {
        const result = spawnSync(exe, ['rewrite', command], { timeout: timeoutMs, encoding: 'utf8', windowsHide: true })
        const status = result.status
        const out = typeof result.stdout === 'string' ? result.stdout.trim() : ''
        // rtk's protocol guarantees exit 0/3 stdout is the rewritten command;
        // a newline inside it would execute as a second line, so reject it.
        if ((status === 0 || status === 3) && out.length > 0 && out !== command && !out.includes('\n')) next = out
      } catch {
        /* spawn failure: passthrough */
      }
    }
    if (cache.size >= CACHE_LIMIT) cache.clear()
    cache.set(command, next)
    return next
  }
  return { rewrite }
}

/** First whitespace-delimited token of a command, for the already-rtk fast path. */
function firstToken(command) {
  const t = command.trimStart()
  const end = t.search(/\s/)
  return end === -1 ? t : t.slice(0, end)
}

/**
 * Wrap the mounted shell executor's `resolve` so eligible commands execute
 * through rtk. The wrapper runs after the executor's own resolution, so the
 * returned spec keeps its stamped workdir/timeout/sandbox policy and only
 * the command source may change. Idempotent and fully reversible: a
 * disposer restores the original method.
 */
export function apply(ctx, config) {
  if (config?.enabled === false) return
  const timeoutMs = Number.isFinite(config?.rewriteTimeoutMs) && config.rewriteTimeoutMs > 0
    ? Math.min(config.rewriteTimeoutMs, 10000) // an unbounded deadline would freeze the whole harness
    : 3000
  const exe = resolveExe(config?.rtkExe)
  const rtk = createRtk(exe, timeoutMs)

  const shell = ctx.shell
  if (!shell || typeof shell.resolve !== 'function') return

  // Prefer the raw service instance behind cordis 4.x's traceable proxy;
  // fall back to the proxy itself when the symbol is absent.
  const raw = shell[Symbol.for('cordis.original')]
  const target = raw && typeof raw.resolve === 'function' ? raw : shell

  // A marker from a previous application (executor reloaded with the same
  // instance, or a config change) holds that wrap's disposer: unwrap the old
  // closure (whose probe/cache are stale) before wrapping with this one.
  const previous = target[PATCHED]
  if (typeof previous === 'function') previous()

  // Remember whether `resolve` was an own property before patching, so the
  // disposer restores the exact prior shape instead of leaving the prototype
  // method's value behind as a stray own property.
  const originalDescriptor = Object.prototype.hasOwnProperty.call(target, 'resolve')
    ? Object.getOwnPropertyDescriptor(target, 'resolve')
    : undefined
  const original = target.resolve
  target.resolve = function rtkResolve(request) {
    const spec = original.call(this, request)
    if (
      spec
      && typeof spec.command === 'string'
      && spec.command.length > 0
      && spec.stdin === undefined // stdin-feeding callers (hooks bridges) keep their exact pipeline
    ) {
      if (firstToken(spec.command) !== 'rtk') { // already-rtk commands skip the rewrite entirely
        if (!IS_WIN32 || WIN32_SAFE_TOOLS.has(firstToken(spec.command))) {
          const next = rtk.rewrite(spec.command)
          if (next !== spec.command) return { ...spec, command: next }
        }
      }
    }
    return spec
  }

  let disposed = false
  const dispose = () => {
    if (disposed) return
    disposed = true
    if (originalDescriptor) Object.defineProperty(target, 'resolve', originalDescriptor)
    else delete target.resolve
    delete target[PATCHED]
  }
  Object.defineProperty(target, PATCHED, { value: dispose, enumerable: false, configurable: true })

  const register = () => {
    if (typeof ctx.effect === 'function') {
      ctx.effect(() => dispose)
      return
    }
    return dispose
  }
  return register()
}
