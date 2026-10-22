// dsh-plugin-vision —— OSS 对象的延迟删除调度。
//
// 目标：视觉模型分析完就把 OSS 上的图删掉，把存储与流量成本压到最低。
//
// 为什么是「延迟」而不是「立刻」：
//   1. 同一个 objectKey 常被重试读（agent 换个 prompt 再问一次、多轮追问同一张图）。
//      立刻删会让第二次读直接 404，把「省钱」变成「功能坏掉」。
//   2. 一次调用里解析多张图时，删除时机要与分析全部完成对齐，不能边读边删。
//
// 为什么还要写盘（pending 目录）：
//   进程重启会丢掉内存里的定时器。把待删清单落盘，重启后能接着删——否则那些图
//   会永远留在 OSS 上，正是这次要消灭的东西。
//
// 成本事实（写在这里，免得以后误解）：
//   OSS 存储按「月」为最小计费周期，删除并不能让当月账单归零。真正的成本大头是
//   公网流出流量与请求次数。延迟删除的价值在于「不让图长期堆积」，而不是「删了
//   当月就免费」。

import { readFile, readdir, unlink, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'

/** 待删清单目录（与 inbox 元数据分开，语义不同：一个待分析、一个待清理）。 */
const PENDING_DIR = 'vision-oss-pending'

/** DSH_HOME 解析：显式环境变量 > ~/.dsh。 */
function dshHome() {
  const explicit = typeof process !== 'undefined' && process.env ? process.env.DSH_HOME : undefined
  return explicit !== undefined && explicit !== '' ? explicit : join(homedir(), '.dsh')
}

function pendingDir() {
  return join(dshHome(), PENDING_DIR)
}

/**
 * 把 objectKey 的删除时间编码进文件名。
 * key 里可能有斜杠，用哈希避免目录结构，同时保留可读的前缀。
 * @param {string} key object key
 * @returns {string} 文件名（不含目录）
 */
function fileNameFor(key) {
  let hash = 0
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) | 0
  }
  return `${(hash >>> 0).toString(16).padStart(8, '0')}.json`
}

/**
 * 登记一条待删记录。
 * @param {object} entry 记录
 * @param {string} entry.key object key
 * @param {number} entry.deleteAfter 绝对时间戳（毫秒）
 * @returns {Promise<void>}
 */
export async function scheduleDelete(entry) {
  const dir = pendingDir()
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, fileNameFor(entry.key)), `${JSON.stringify(entry, null, 2)}\n`)
}

/**
 * 读取全部待删记录。
 * @returns {Promise<Array<object>>} 记录数组；目录不存在时为空
 */
export async function listPending() {
  const dir = pendingDir()
  let names
  try {
    names = await readdir(dir)
  } catch {
    return []
  }
  const out = []
  for (const name of names) {
    if (!name.endsWith('.json')) continue
    try {
      out.push(JSON.parse(await readFile(join(dir, name), 'utf8')))
    } catch {
      // 坏文件直接跳过，不阻塞其余记录
    }
  }
  return out
}

/**
 * 移除一条待删记录。
 * @param {string} key object key
 * @returns {Promise<void>}
 */
export async function forgetPending(key) {
  try {
    await unlink(join(pendingDir(), fileNameFor(key)))
  } catch {
    // 已经不存在就算了
  }
}

/**
 * 执行到期的删除。
 *
 * 失败（网络、权限）**不**移除记录，留待下次重试；成功才清掉。
 * 这样一次 OSS 抖动不会导致图永远留在那里。
 *
 * @param {object} options 选项
 * @param {(key: string) => Promise<{deleted: boolean, status: number, reason?: string}>} options.remove
 *   实际删除函数（注入便于测试）
 * @param {number} [options.now] 当前时间戳
 * @returns {Promise<{deleted: string[], failed: Array<{key: string, reason: string}>, skipped: number}>} 统计
 */
export async function runDueDeletes(options) {
  const now = typeof options.now === 'number' ? options.now : Date.now()
  const pending = await listPending()
  const deleted = []
  const failed = []
  let skipped = 0

  for (const item of pending) {
    if (typeof item.deleteAfter !== 'number' || item.deleteAfter > now) {
      skipped += 1
      continue
    }
    let result
    try {
      result = await options.remove(item.key)
    } catch (error) {
      const message = error !== null && typeof error === 'object' && error.message ? error.message : String(error)
      result = { deleted: false, status: 0, reason: message }
    }
    if (result.deleted) {
      await forgetPending(item.key)
      deleted.push(item.key)
    } else {
      failed.push({ key: item.key, reason: result.reason || `HTTP ${result.status}` })
    }
  }
  return { deleted, failed, skipped }
}

/**
 * 启动周期性清理。
 * @param {object} options 选项
 * @param {() => Promise<unknown>} options.tick 每次执行的清理动作
 * @param {number} options.intervalMs 周期
 * @returns {() => void} 停止函数
 */
export function startOssSweeper({ tick, intervalMs = 60_000 }) {
  const timer = setInterval(() => {
    void tick()
  }, intervalMs)
  if (typeof timer.unref === 'function') timer.unref()
  return () => clearInterval(timer)
}

/** 默认延迟：分析完成后 5 分钟。 */
export const DEFAULT_DELETE_DELAY_MS = 5 * 60 * 1000

export { pendingDir, fileNameFor, PENDING_DIR }
