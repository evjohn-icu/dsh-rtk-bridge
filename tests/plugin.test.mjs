/**
 * dsh-rtk 插件单元测试 —— 判据与桩协议见 helpers.mjs / stubs/。
 *
 * 默认加载本仓库根的 ../index.js;也可用环境变量 RTK_PLUGIN_PATH
 * (file:// URL 或绝对路径)指向任意位置的插件文件,使测试与插件位置解耦。
 */
import test from 'node:test'
import assert from 'node:assert/strict'

const pluginUrl = process.env.RTK_PLUGIN_PATH
  ?? new URL('../index.js', import.meta.url).href
const { name, inject, apply } = await import(pluginUrl)

import { fakeExecutor, effectCtx, freshLog, clearLogEnv, rewriteCalls, versionCalls, stub } from './helpers.mjs'

test('插件导出形状', () => {
  assert.equal(name, 'dsh-rtk')
  assert.deepEqual(inject, ['shell'])
  assert.equal(typeof apply, 'function')
})

// ------------------------------------------------------------- 用例 1: 命中改写
test('1. 命中改写: command 变为改写结果, 其余 spec 字段原样保留', () => {
  const calls = []
  const ctx = effectCtx(fakeExecutor(calls), [])
  apply(ctx, { enabled: true, rtkExe: stub('stub-rewrite.sh') })

  const spec = ctx.shell.resolve({ command: 'git status', workdir: '/repo', timeoutMs: 42, sandboxPolicy: 'S' })
  assert.equal(spec.command, 'rtk git status')
  assert.equal(spec.workdir, '/repo')
  assert.equal(spec.timeoutMs, 42)
  assert.equal(spec.sandboxPolicy, 'S')
})

// ------------------------------------------------------- 用例 2: exit 1 无映射
test('2. exit 1(无映射) → 原命令直通', () => {
  const calls = []
  const ctx = effectCtx(fakeExecutor(calls), [])
  apply(ctx, { enabled: true, rtkExe: stub('stub-rewrite.sh') })

  const spec = ctx.shell.resolve({ command: 'ls -la /tmp' })
  assert.equal(spec.command, 'ls -la /tmp')
})

// --------------------------------------------- 用例 3: exit 2 deny 消息不进命令
test('3. exit 2 + stdout 有 deny 消息 → 原命令直通(安全用例)', () => {
  const calls = []
  const ctx = effectCtx(fakeExecutor(calls), [])
  apply(ctx, { enabled: true, rtkExe: stub('stub-deny.sh') })

  const spec = ctx.shell.resolve({ command: 'git status' })
  assert.equal(spec.command, 'git status')
  assert.doesNotMatch(spec.command, /denied/)
})

// --------------------------------------------------- 用例 4: exit 0 stdout 空
test('4. exit 0 + stdout 为空 → 直通', () => {
  const calls = []
  const ctx = effectCtx(fakeExecutor(calls), [])
  apply(ctx, { enabled: true, rtkExe: stub('stub-empty0.sh') })

  const spec = ctx.shell.resolve({ command: 'echo hi' })
  assert.equal(spec.command, 'echo hi')
})

// --------------------------------------------- 用例 5: stdout 与输入相同 → 直通
test('5. stdout 与输入相同 → 直通', () => {
  const calls = []
  const ctx = effectCtx(fakeExecutor(calls), [])
  apply(ctx, { enabled: true, rtkExe: stub('stub-same.sh') })

  const spec = ctx.shell.resolve({ command: 'npm test' })
  assert.equal(spec.command, 'npm test')
})

// ------------------------------------------------------------ 用例 6: 超时直通
test('6. 超时(rewriteTimeoutMs:100 + sleep 桩) → 直通且 spawnSync 不抛异常', () => {
  const calls = []
  const ctx = effectCtx(fakeExecutor(calls), [])
  apply(ctx, { enabled: true, rtkExe: stub('stub-slow.sh'), rewriteTimeoutMs: 100 })

  const spec = ctx.shell.resolve({ command: 'slow cmd' })
  assert.equal(spec.command, 'slow cmd')
})

// ------------------------------------------ 用例 7: rtkExe 不存在 → 全直通
test('7. rtkExe 指向不存在的路径 → 直通, 且 rewrite 不被调用(只有探测)', () => {
  const calls = []
  const ctx = effectCtx(fakeExecutor(calls), [])
  apply(ctx, { enabled: true, rtkExe: '/nonexistent/no-such-rtk' })
  const log = freshLog('noexe')
  try {
    const spec = ctx.shell.resolve({ command: 'git status' })
    assert.equal(spec.command, 'git status')
    assert.deepEqual(rewriteCalls(log), [], '探测失败后不应触发任何 rewrite 调用')
  } finally {
    clearLogEnv()
  }
})

test('7b. 探测失败(exit 1) → rewrite 绝不被调用', () => {
  const calls = []
  const ctx = effectCtx(fakeExecutor(calls), [])
  apply(ctx, { enabled: true, rtkExe: stub('stub-badversion.sh') })
  const log = freshLog('badversion')
  try {
    const spec = ctx.shell.resolve({ command: 'git status' })
    assert.equal(spec.command, 'git status')
    assert.deepEqual(rewriteCalls(log), [], '探测失败后不应触发任何 rewrite 调用')
  } finally {
    clearLogEnv()
  }
})

// ------------------------------------------------- 用例 8: enabled:false 不包装
test('8. enabled:false → apply 直接返回, resolve 未被包装', () => {
  const calls = []
  const shell = fakeExecutor(calls)
  const ctx = effectCtx(shell, [])
  apply(ctx, { enabled: false, rtkExe: stub('stub-rewrite.sh') })

  assert.equal(ctx.shell.resolve, shell.resolve, 'resolve 引用未变')
  const spec = ctx.shell.resolve({ command: 'git status' })
  assert.equal(spec.command, 'git status')
})

// --------------------------------------------- 用例 9: spec.stdin 存在 → 跳过改写
test('9. spec.stdin 存在 → 跳过改写(rewrite 未被调用)', () => {
  const calls = []
  const ctx = effectCtx(fakeExecutor(calls), [])
  apply(ctx, { enabled: true, rtkExe: stub('stub-rewrite.sh') })
  const log = freshLog('stdin')
  try {
    const spec = ctx.shell.resolve({ command: 'git status', stdin: 'something' })
    assert.equal(spec.command, 'git status')
    assert.deepEqual(rewriteCalls(log), [], 'stdin 存在时不应调用 rewrite')
  } finally {
    clearLogEnv()
  }
})

// ------------------------------------------- 用例 10: 首 token 已是 rtk → 直通
test('10. 命令首 token 已是 rtk → 不调 rewrite, 直通', () => {
  const calls = []
  const ctx = effectCtx(fakeExecutor(calls), [])
  apply(ctx, { enabled: true, rtkExe: stub('stub-rewrite.sh') })
  const log = freshLog('already-rtk')
  try {
    const spec = ctx.shell.resolve({ command: 'rtk git status' })
    assert.equal(spec.command, 'rtk git status')
    assert.deepEqual(rewriteCalls(log), [], 'already-rtk 不应调用 rewrite')
  } finally {
    clearLogEnv()
  }
})

// --------------------------------- 用例 11: 幂等 —— 同一 ctx 连续 apply 两次
test('11. 同一 fake ctx 连续 apply 两次: 不双包装, 改写只发生一次', () => {
  const calls = []
  const ctx = effectCtx(fakeExecutor(calls), [])
  const config = { enabled: true, rtkExe: stub('stub-rewrite.sh') }
  apply(ctx, config)
  apply(ctx, config) // 第二次必须无操作

  const log = freshLog('idempotent')
  try {
    const spec = ctx.shell.resolve({ command: 'git status' })
    assert.equal(spec.command, 'rtk git status')
    const rw = rewriteCalls(log)
    assert.equal(rw.length, 1, `改写只发生一次, 实际 ${rw.length} 次: ${JSON.stringify(rw)}`)
  } finally {
    clearLogEnv()
  }
})

// ------------------------------------------------------------ 用例 12: 卸载恢复
test('12. disposer 卸载后 resolve 恢复为原始函数引用, 再调返回原命令', () => {
  const calls = []
  const shell = fakeExecutor(calls)
  const originalResolve = shell.resolve
  const disposers = []
  const ctx = effectCtx(shell, disposers)
  apply(ctx, { enabled: true, rtkExe: stub('stub-rewrite.sh') })

  assert.equal(disposers.length, 1, 'ctx.effect 收到一个清理回调')
  assert.equal(typeof disposers[0], 'function')
  assert.notEqual(ctx.shell.resolve, originalResolve)

  disposers[0]()
  assert.equal(ctx.shell.resolve, originalResolve, '卸载后 resolve === 原始引用')
  const spec = ctx.shell.resolve({ command: 'git status' })
  assert.equal(spec.command, 'git status')
})

test('12b. 无 ctx.effect 时 apply 返回 disposer', () => {
  const calls = []
  const shell = fakeExecutor(calls)
  const originalResolve = shell.resolve
  const ctx = { shell }
  const dispose = apply(ctx, { enabled: true, rtkExe: stub('stub-rewrite.sh') })

  assert.equal(typeof dispose, 'function')
  dispose()
  assert.equal(ctx.shell.resolve, originalResolve)
})

// ------------------------------------------------------- 用例 13: 改写缓存
test('13. 同一条命令调两次 resolve, 桩的 rewrite 调用日志只有一次', () => {
  const calls = []
  const ctx = effectCtx(fakeExecutor(calls), [])
  apply(ctx, { enabled: true, rtkExe: stub('stub-rewrite.sh') })
  const log = freshLog('cache')
  try {
    const a = ctx.shell.resolve({ command: 'git status' })
    const b = ctx.shell.resolve({ command: 'git status' })
    assert.equal(a.command, 'rtk git status')
    assert.equal(b.command, 'rtk git status')
    const rw = rewriteCalls(log)
    assert.equal(rw.length, 1, `缓存生效应只调用一次 rewrite, 实际 ${rw.length}: ${JSON.stringify(rw)}`)
  } finally {
    clearLogEnv()
  }
})

// ------------------------------------------------- 用例 14: this 透传绑定
test('14. this 透传: 包装后 prototype resolve 内部的 this 仍指向实例', () => {
  class Executor {
    constructor() { this._cwd = '/instance-cwd' }
    resolve(request) {
      return { command: request.command, workdir: this._cwd, timeoutMs: 1000, sandboxPolicy: 'P' }
    }
  }
  const shell = new Executor()
  const ctx = effectCtx(shell, [])
  apply(ctx, { enabled: true, rtkExe: stub('stub-rewrite.sh') })

  const spec = ctx.shell.resolve({ command: 'git status' })
  assert.equal(spec.command, 'rtk git status')
  assert.equal(spec.workdir, '/instance-cwd', 'original.call(this) 应正确透传 this')
})
