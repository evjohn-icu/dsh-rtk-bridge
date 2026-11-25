/**
 * 代理形态测试:cordis 4.x 的 shell 是 Proxy。插件优先 patch
 * Symbol.for('cordis.original') 指向的 raw 实例, symbol 缺失时回退 patch proxy
 * 本身。两种 mock 形态都必须行为一致。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { apply } from './plugin-loader.mjs'
import { fakeExecutor, effectCtx, freshLog, clearLogEnv, rewriteCalls, versionCalls, stub } from './helpers.mjs'

const CORDIS_ORIGINAL = Symbol.for('cordis.original')

function proxyWithoutSymbol(calls) {
  // 无 symbol 的 proxy:插件应走回退分支, patch proxy 本身。
  return new Proxy(fakeExecutor(calls), {
    get(t, k) { return t[k] },
  })
}

function proxyWithRawSymbol(calls) {
  // raw 分支:symbol own property 指向自身(this mock 没有再包一层)。
  const target = fakeExecutor(calls)
  return new Proxy(target, {
    get(t, k, recv) {
      if (k === CORDIS_ORIGINAL) return t
      const v = Reflect.get(t, k)
      return typeof v === 'function' ? v.bind(recv) : v
    },
    ownKeys(t) { return Reflect.ownKeys(t).concat([CORDIS_ORIGINAL]) },
    getOwnPropertyDescriptor(t, k) {
      if (k === CORDIS_ORIGINAL) return { value: t, writable: false, enumerable: false, configurable: true }
      return Reflect.getOwnPropertyDescriptor(t, k)
    },
  })
}

test('A. proxy 形态(无 cordis.original symbol)→ 走回退分支 patch proxy 本身', () => {
  const calls = []
  const shell = proxyWithoutSymbol(calls)
  const ctx = effectCtx(shell, [])
  apply(ctx, { enabled: true, rtkExe: stub('stub-rewrite.sh') })

  const spec = ctx.shell.resolve({ command: 'git status' })
  assert.equal(spec.command, 'rtk git status')
  assert.equal(calls.length, 1)
})

test('B. proxy 形态(带 cordis.original symbol 指向自身)→ raw 分支, 行为一致', () => {
  const calls = []
  const shell = proxyWithRawSymbol(calls)
  const ctx = effectCtx(shell, [])
  apply(ctx, { enabled: true, rtkExe: stub('stub-rewrite.sh') })

  const spec = ctx.shell.resolve({ command: 'git status' })
  assert.equal(spec.command, 'rtk git status')
  assert.equal(calls.length, 1)
})

test('C. raw 分支的幂等性: 同一 proxy apply 两次不双包装', () => {
  const calls = []
  const shell = proxyWithRawSymbol(calls)
  const ctx = effectCtx(shell, [])
  const config = { enabled: true, rtkExe: stub('stub-rewrite.sh') }
  apply(ctx, config)
  apply(ctx, config)

  const log = freshLog('proxy-idempotent')
  try {
    const spec = ctx.shell.resolve({ command: 'git status' })
    assert.equal(spec.command, 'rtk git status')
    assert.equal(rewriteCalls(log).length, 1, '改写只发生一次')
  } finally {
    clearLogEnv()
  }
})

test('D. proxy 形态的缓存: 同命令两次 resolve, rewrite 只一次', () => {
  const calls = []
  const shell = proxyWithoutSymbol(calls)
  const ctx = effectCtx(shell, [])
  apply(ctx, { enabled: true, rtkExe: stub('stub-rewrite.sh') })
  const log = freshLog('proxy-cache')
  try {
    const a = ctx.shell.resolve({ command: 'git status' })
    const b = ctx.shell.resolve({ command: 'git status' })
    assert.equal(a.command, 'rtk git status')
    assert.equal(b.command, 'rtk git status')
    assert.equal(rewriteCalls(log).length, 1)
  } finally {
    clearLogEnv()
  }
})

test('E. proxy 形态的卸载恢复', () => {
  const calls = []
  const shell = proxyWithoutSymbol(calls)
  const originalResolve = shell.resolve
  const disposers = []
  const ctx = effectCtx(shell, disposers)
  apply(ctx, { enabled: true, rtkExe: stub('stub-rewrite.sh') })

  assert.notEqual(ctx.shell.resolve, originalResolve)
  disposers[0]()
  assert.equal(ctx.shell.resolve, originalResolve)
  const spec = ctx.shell.resolve({ command: 'git status' })
  assert.equal(spec.command, 'git status')
})

test('F. 探测在每次 apply 时发生且仅一次(rewrite 阶段零探测)', () => {
  // 探测发生在 apply 期(exe 解析), 之后不同命令各 rewrite 一次, 探测不再发生。
  const calls = []
  const log = freshLog('probe-once')
  const ctx = effectCtx(fakeExecutor(calls), [])
  apply(ctx, { enabled: true, rtkExe: stub('stub-rewrite.sh') })
  try {
    ctx.shell.resolve({ command: 'git status' }) // 命中改写
    ctx.shell.resolve({ command: 'ls -la' })     // exit 1 直通
    ctx.shell.resolve({ command: 'git diff' })   // 再来一次
    const v = versionCalls(log)
    assert.equal(v.length, 1, `--version 探测应只在 apply 时发生一次, 实际 ${v.length}: ${JSON.stringify(v)}`)
  } finally {
    clearLogEnv()
  }
})
