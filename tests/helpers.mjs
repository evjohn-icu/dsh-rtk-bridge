/**
 * dsh-rtk 插件单元测试公共辅助。
 *
 * 侧信道约定:所有桩脚本每次被调用都向 $RTK_CALL_LOG 追加一行
 *   "<子命令>|<参数>"    例如  --version|  或  rewrite|git status
 * 测试用行数/内容断言 rtk 是否被调用、被调用几次。
 */
import { chmodSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
export const STUBS_DIR = path.join(here, 'stubs')
const TMP_DIR = path.join(here, '.tmp')

/** 返回可执行桩脚本路径(运行时兜底 chmod +x)。 */
export function stub(name) {
  const p = path.join(STUBS_DIR, name)
  chmodSync(p, 0o755)
  return p
}

/** 任务给定的 mock 形状:记录请求,返回带标准字段的 spec。
 * 默认戳记在前、请求字段在后覆盖 —— 这样 stdin/workdir 等请求字段会像真实
 * executor 一样进入 spec(真实 executor 会把这些戳进 spec, mock 必须回显)。 */
export function fakeExecutor(calls) {
  return {
    resolve(request) {
      calls.push(request)
      return { workdir: '/w', timeoutMs: 1000, sandboxPolicy: 'P', ...request }
    },
  }
}

/** 带 ctx.effect 的 ctx:cb() 返回的 disposer 被收集,便于模拟卸载。 */
export function effectCtx(shell, disposers) {
  return { shell, effect(cb) { disposers.push(cb()) } }
}

/** 新建唯一日志文件并导出 RTK_CALL_LOG;返回路径。 */
export function freshLog(label) {
  mkdirSync(TMP_DIR, { recursive: true })
  const p = path.join(TMP_DIR, `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}.log`)
  rmSync(p, { force: true })
  process.env.RTK_CALL_LOG = p
  return p
}

export function clearLogEnv() {
  delete process.env.RTK_CALL_LOG
}

export function readLog(file) {
  try {
    return readFileSync(file, 'utf8').split('\n').filter((l) => l.length > 0)
  } catch {
    return []
  }
}

/** 桩收到的 rewrite 调用行。 */
export function rewriteCalls(file) {
  return readLog(file).filter((l) => l.startsWith('rewrite|'))
}

/** 桩收到的 --version 探测行。 */
export function versionCalls(file) {
  return readLog(file).filter((l) => l.startsWith('--version|'))
}
