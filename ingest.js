// dsh-plugin-vision —— 局域网图片接收端点。
//
// 解决的问题：开发机（多台、环境各异、随时在变）上的图片要交给 DSH 宿主机上的
// 视觉模型分析。以前的做法是「先把图片弄到宿主机磁盘，再传路径」——每换一台开发机
// 就要重来一遍。
//
// 现在：宿主机挂一条 HTTP 路由，任何开发机用一条 curl 把字节推上来即可。
// 开发机不需要装任何东西、不需要开放任何端口。
//
//   curl -T shot.png -H "Authorization: Bearer <token>" \
//        http://<宿主机>:3080/dsh-vision/ingest?name=shot.png
//
// 返回 { id: "sha256:<hex>", ... }，agent 之后用 vision_analyze images:["sha256:<hex>"]
// 分析它，或者直接 images:["latest"]。
//
// 安全：3080 绑定 0.0.0.0 且平台层没有鉴权，所以 token 校验、体积上限、条目上限
// 全部在这里自己做。没有 token 一律 401。

import { readFile, readdir, stat, unlink, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { randomBytes } from 'node:crypto'

/** 路由前缀。挂到 DSH 的 webServer 上，与 GUI 同端口。 */
export const INGEST_PATH = '/dsh-vision/ingest'

/** 接收端点的元数据（过期时间、上传者等），与附件对象分离存放。 */
const META_DIR = 'vision-inbox'

/** 允许上传的媒体类型（与 MEDIA_SNIFFERS 对齐）。 */
const ALLOWED_MEDIA = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp'])

/** DSH_HOME 解析：显式环境变量 > ~/.dsh。 */
function dshHome() {
  const explicit = typeof process !== 'undefined' && process.env ? process.env.DSH_HOME : undefined
  return explicit !== undefined && explicit !== '' ? explicit : join(homedir(), '.dsh')
}

/**
 * 按字节魔数判断图片类型。
 * 与本模块解耦实现，避免和 index.js 形成循环依赖。
 * @param {Uint8Array} b 字节
 * @returns {string|undefined} media type
 */
export function sniffMediaType(b) {
  if (b === undefined || b === null || b.length < 12) return undefined
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png'
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'image/gif'
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46
    && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp'
  if (b[0] === 0x42 && b[1] === 0x4d) return 'image/bmp'
  return undefined
}

/**
 * 生成本次运行的接收令牌。优先复用已有令牌，保证重启后开发机的脚本不用改。
 * @returns {Promise<string>} 令牌
 */
export async function loadOrCreateToken() {
  const dir = join(dshHome(), META_DIR)
  const file = join(dir, 'token')
  try {
    const existing = (await readFile(file, 'utf8')).trim()
    if (existing.length >= 16) return existing
  } catch {
    // 不存在就新建
  }
  const token = randomBytes(24).toString('base64url')
  await mkdir(dir, { recursive: true })
  await writeFile(file, `${token}\n`, { mode: 0o600 })
  return token
}

/**
 * 读取请求体，带上限。超限立即中止，不把内存吃穿。
 * @param {import('node:http').IncomingMessage} req 请求
 * @param {number} limit 字节上限
 * @returns {Promise<Uint8Array>} 请求体
 */
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length'])
    if (Number.isFinite(declared) && declared > limit) {
      reject(Object.assign(new Error(`请求体 ${declared} 字节，超过上限 ${limit}`), { status: 413 }))
      req.resume()
      return
    }
    const chunks = []
    let total = 0
    req.on('data', (chunk) => {
      total += chunk.length
      if (total > limit) {
        reject(Object.assign(new Error(`请求体超过上限 ${limit} 字节`), { status: 413 }))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

/** 统一的 JSON 响应。 */
function sendJson(res, status, value) {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

/**
 * 常量时间比较，避免 token 被逐字节试探。
 * @param {string} a 实际值
 * @param {string} b 期望值
 * @returns {boolean} 是否相等
 */
function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/**
 * 从请求里取令牌：Authorization: Bearer <t> 或 X-Vision-Token。
 * @param {import('node:http').IncomingMessage} req 请求
 * @returns {string} 令牌；没有则为空串
 */
function tokenOf(req) {
  const auth = req.headers.authorization
  if (typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim()
  const direct = req.headers['x-vision-token']
  if (typeof direct === 'string') return direct.trim()
  return ''
}

/**
 * 写一条入库元数据，用于 TTL 清理与 inbox 列表。
 * @param {object} entry 元数据
 * @returns {Promise<void>}
 */
async function writeMeta(entry) {
  const dir = join(dshHome(), META_DIR, 'items')
  await mkdir(dir, { recursive: true })
  const hex = entry.id.replace(/^sha256:/u, '')
  await writeFile(join(dir, `${hex}.json`), `${JSON.stringify(entry, null, 2)}\n`)
}

/**
 * 清理过期条目。删除元数据；附件对象交给附件服务自己的回收策略，
 * 这里不碰对象目录，避免删掉会话里还在引用的图。
 * @param {number} now 当前时间戳
 * @returns {Promise<number>} 清理条数
 */
export async function sweepExpired(now = Date.now()) {
  const dir = join(dshHome(), META_DIR, 'items')
  let names
  try {
    names = await readdir(dir)
  } catch {
    return 0
  }
  let removed = 0
  for (const name of names) {
    if (!name.endsWith('.json')) continue
    const file = join(dir, name)
    try {
      const entry = JSON.parse(await readFile(file, 'utf8'))
      if (typeof entry.expiresAt === 'number' && entry.expiresAt <= now) {
        await unlink(file)
        removed += 1
      }
    } catch {
      // 坏文件当作过期处理
      try {
        await unlink(file)
        removed += 1
      } catch { /* ignore */ }
    }
  }
  return removed
}

/**
 * 列出仍在有效期内的入库条目（新→旧）。
 * @param {number} now 当前时间戳
 * @returns {Promise<Array<object>>} 条目
 */
export async function listInbox(now = Date.now()) {
  const dir = join(dshHome(), META_DIR, 'items')
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
      const entry = JSON.parse(await readFile(join(dir, name), 'utf8'))
      if (typeof entry.expiresAt === 'number' && entry.expiresAt <= now) continue
      out.push(entry)
    } catch { /* ignore */ }
  }
  out.sort((a, b) => (b.receivedAt || 0) - (a.receivedAt || 0))
  return out
}

/**
 * 统计当前入库条目数，用于上限控制。
 * @returns {Promise<number>} 条数
 */
async function countInbox() {
  try {
    const names = await readdir(join(dshHome(), META_DIR, 'items'))
    return names.filter(name => name.endsWith('.json')).length
  } catch {
    return 0
  }
}

/**
 * 从请求 URL 里取 ?name= 参数，永远不抛。
 *
 * 走两遍：先让标准 URL 解析（能正确处理已编码的 %E4%BD%A0），失败就退化成
 * 手动切字符串——开发机的文件名常常是中文且未经 URL 编码，`new URL()` 会直接
 * 抛 Invalid URL。那个异常如果漏到 handler 外面，连接被断开，客户端只看到空响应，
 * 排查成本极高。
 *
 * @param {string|undefined} rawUrl 原始请求路径
 * @returns {string} 文件名（已 trim、截断到 200 字符）；取不到则为空串
 */
function parseName(rawUrl) {
  const fallback = () => {
    const query = String(rawUrl || '').split('?')[1]
    if (query === undefined) return ''
    for (const pair of query.split('&')) {
      const eq = pair.indexOf('=')
      if (eq < 0) continue
      if (pair.slice(0, eq) !== 'name') continue
      const value = pair.slice(eq + 1)
      try {
        // decodeURIComponent 处理 %XX；裸中文原样保留
        return decodeURIComponent(value).trim().slice(0, 200)
      } catch {
        // 编码残缺（比如孤立的 %）就当原文用
        return value.trim().slice(0, 200)
      }
    }
    return ''
  }
  try {
    const url = new URL(String(rawUrl || INGEST_PATH), 'http://localhost')
    const value = url.searchParams.get('name')
    if (value === null) return ''
    return value.trim().slice(0, 200)
  } catch {
    return fallback()
  }
}

/**
 * 构造接收路由的 handler。
 *
 * 配置字段名与 withDefaults 的产出保持一致（ingestEnabled / ingestTtlHours /
 * ingestMaxBytes / ingestMaxItems）。之前的版本这里读的是 enabled / ttlHours /
 * maxIngestBytes / maxInboxItems，对不上，导致端点永远判为「已关闭」——字段名
 * 必须与配置层逐字一致，否则 undefined 会让默认值悄悄失效。
 *
 * @param {object} ctx Cordis 上下文
 * @param {object} options 选项
 * @param {() => object} options.config 取当前配置
 * @param {() => string} options.token 取当前令牌
 * @returns {object} WebRoute
 */
export function makeIngestRoute(ctx, options) {
  return {
    kind: 'exact',
    path: INGEST_PATH,
    async handler(req, res) {
      const raw = options.config()
      const cfg = {
        enabled: raw.ingestEnabled !== false,
        ttlHours: Number.isFinite(raw.ingestTtlHours) ? raw.ingestTtlHours : 24,
        maxIngestBytes: Number.isFinite(raw.ingestMaxBytes) ? raw.ingestMaxBytes : 32 * 1024 * 1024,
        maxInboxItems: Number.isFinite(raw.ingestMaxItems) ? raw.ingestMaxItems : 200,
      }

      if (!cfg.enabled) {
        sendJson(res, 404, { ok: false, error: 'vision ingest endpoint is disabled' })
        return
      }
      if (req.method !== 'POST' && req.method !== 'PUT') {
        res.setHeader('allow', 'POST, PUT')
        sendJson(res, 405, { ok: false, error: 'use POST or PUT with the raw image bytes as the body' })
        return
      }
      if (!timingSafeEqual(tokenOf(req), options.token())) {
        // 不区分「没给」「给了但错」，避免探测。
        sendJson(res, 401, {
          ok: false,
          error: 'missing or invalid token',
          hint: 'send Authorization: Bearer <vision ingest token> (see Settings → Plugins → Vision)',
        })
        return
      }

      // ?name= 可能是中文（开发机的文件名），而 curl 常把原样字节塞进 query。
      // new URL() 遇到未转义的非 ASCII 会抛 Invalid URL——那不是「请求不合法」，
      // 而是「文件名不好解析」，绝不能让它把连接弄断（表现为空响应）。
      const name = parseName(req.url)

      let bytes
      try {
        bytes = await readBody(req, cfg.maxIngestBytes)
      } catch (error) {
        sendJson(res, error.status || 400, { ok: false, error: String(error.message || error) })
        return
      }
      if (bytes.length === 0) {
        sendJson(res, 400, { ok: false, error: 'empty body — send the raw image bytes' })
        return
      }

      const mediaType = sniffMediaType(bytes)
      if (mediaType === undefined || !ALLOWED_MEDIA.has(mediaType)) {
        sendJson(res, 415, {
          ok: false,
          error: 'body is not a supported image (PNG/JPEG/WebP/GIF/BMP)',
          hint: 'send the raw file bytes, not a form field or a base64 string',
        })
        return
      }

      // 条目上限：超了先清理过期，仍然超就拒绝，防止无人看管的机器刷爆磁盘。
      if (await countInbox() >= cfg.maxInboxItems) {
        await sweepExpired()
        if (await countInbox() >= cfg.maxInboxItems) {
          sendJson(res, 507, {
            ok: false,
            error: `inbox is full (${cfg.maxInboxItems} items); raise maxInboxItems or lower ttlHours`,
          })
          return
        }
      }

      const attachments = ctx.get('attachments')
      if (attachments === undefined || typeof attachments.saveImage !== 'function') {
        sendJson(res, 503, { ok: false, error: 'attachment service unavailable on this host' })
        return
      }

      let ref
      try {
        ref = await attachments.saveImage({
          data: bytes,
          mediaType,
          ...(name !== '' ? { name } : {}),
        })
      } catch (error) {
        sendJson(res, 400, {
          ok: false,
          error: `attachment rejected: ${String((error && error.message) || error)}`,
        })
        return
      }

      const now = Date.now()
      const entry = {
        id: ref.attachmentId,
        name: ref.name !== undefined ? ref.name : name,
        mediaType: ref.mediaType || mediaType,
        bytes: ref.bytes !== undefined ? ref.bytes : bytes.length,
        width: ref.width,
        height: ref.height,
        receivedAt: now,
        expiresAt: now + cfg.ttlHours * 3600 * 1000,
        remoteAddr: req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : '',
      }
      try {
        await writeMeta(entry)
      } catch {
        // 元数据写失败不影响本次使用——vision_analyze 走的是摘要解析，不依赖元数据
      }

      sendJson(res, 201, {
        ok: true,
        id: ref.attachmentId,
        digest: String(ref.attachmentId).replace(/^sha256:/u, '').slice(0, 12),
        mediaType: entry.mediaType,
        bytes: entry.bytes,
        width: entry.width,
        height: entry.height,
        expiresAt: new Date(entry.expiresAt).toISOString(),
        usage: `vision_analyze images=["sha256:${String(ref.attachmentId).replace(/^sha256:/u, '').slice(0, 12)}"]`,
      })
    },
  }
}

/**
 * 启动周期性清理。
 * @param {number} intervalMs 周期
 * @returns {() => void} 停止函数
 */
export function startSweeper(intervalMs) {
  const timer = setInterval(() => {
    void sweepExpired()
  }, intervalMs)
  if (typeof timer.unref === 'function') timer.unref()
  return () => clearInterval(timer)
}

export { dshHome, META_DIR }

// 仅供测试：?name= 解析器不依赖宿主，值得单独覆盖（它曾经把连接弄断过）。
export { parseName as parseNameForTest }
