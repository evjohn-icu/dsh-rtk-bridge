/**
 * 统一的插件动态加载入口:优先 RTK_PLUGIN_PATH(file:// URL 或绝对路径),
 * 否则加载本仓库根的 ../index.js(相对于本文件所在的 tests/ 目录)。
 * 供多个测试文件共享同一个已加载模块。
 */
const pluginPath = process.env.RTK_PLUGIN_PATH
  ?? new URL('../index.js', import.meta.url).href

const mod = await import(pluginPath)
export const { name, inject, apply } = mod
