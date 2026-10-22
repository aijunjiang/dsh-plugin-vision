// dsh-plugin-vision —— 阿里云 OSS 中转（第三级通道）。
//
// 场景：DSH 宿主机在局域网 A，开发机在局域网 B，两边互相不可达。
// 这时既不能推（局域网不通），也不方便把图拷过来（人在远程）。
//
// 做法：宿主机签发一个**短时预签名 PUT URL**，agent 通过已有的 SSH 路由把这条
// URL 交给开发机，开发机用 curl 直传。开发机**不需要任何 OSS 凭证**——凭据始终
// 留在宿主机，这正是预签名 URL 的用途。
//
//     agent ──ssh──▶ 开发机: curl -X PUT "<presigned>" --data-binary @shot.png
//                            │
//                            ▼
//                          OSS object
//                            │
//     agent ◀── vision_analyze images:["oss://<key>"] ── 宿主机读回字节 ──▶ VLM
//
// 刻意不引阿里云 SDK：签名算法（V1，HMAC-SHA1）不到百行，而 SDK 会把这个零依赖
// 插件拖进一棵大依赖树。用到的只有 node:crypto 与 fetch。

import { createHmac } from 'node:crypto'

/** OSS 通道默认有效期：签发后 15 分钟内必须传完。 */
export const DEFAULT_EXPIRE_SECONDS = 900

/**
 * OSS 的 Content-Type 由 PUT 时的 Content-Type 头决定；
 * 预签名时把它写进签名，避免「签名时不带、上传时带」导致的 SignatureDoesNotMatch。
 */
const PUT_CONTENT_TYPE = 'application/octet-stream'

/**
 * RFC 3986 编码，OSS 签名要求。encodeURIComponent 不转义 !'()* 这几个，
 * 在那几个字符出现在 object key 里时会导致签名对不上。
 * @param {string} value 原值
 * @returns {string} 编码结果
 */
function uriEncode(value) {
  return encodeURIComponent(value)
    .replace(/!/gu, '%21')
    .replace(/'/gu, '%27')
    .replace(/\(/gu, '%28')
    .replace(/\)/gu, '%29')
    .replace(/\*/gu, '%2A')
}

/**
 * 规范化 object key：去掉开头的斜杠，禁止越权字符。
 * @param {string} key 原始 key
 * @returns {string} 规范化后的 key
 */
export function normalizeKey(key) {
  return String(key).replace(/^\/+/u, '').replace(/\.\.(\/|$)/gu, '')
}

/**
 * 生成 OSS V1 签名。
 *
 * 注意 Date 位：这个位置放什么取决于调用场景。
 *  - Header 签名（Authorization 头）：放 GMT 格式的 Date。
 *  - URL 签名（预签名）：放**过期时间戳**（Expires，unix 秒）。
 * 算法本身不变，变的只是第四行。写错这一行，OSS 会回 SignatureDoesNotMatch，
 * 而且报错里不会提示你「你把 Date 和 Expires 搞混了」。
 *
 * @param {object} options 签名参数
 * @param {string} options.method HTTP 方法
 * @param {string} options.contentMd5 Content-MD5（可空）
 * @param {string} options.contentType Content-Type（可空）
 * @param {string} options.date Date 头或 Expires 时间戳（URL 签名时用后者）
 * @param {string} options.canonicalizedResource "/bucket/key" 形式
 * @param {string} options.secret AccessKey Secret
 * @returns {string} base64 签名
 */
export function signOss({ method, contentMd5, contentType, date, canonicalizedResource, secret }) {
  const stringToSign = [
    method,
    contentMd5 || '',
    contentType || '',
    date || '',
    canonicalizedResource,
  ].join('\n')
  return createHmac('sha1', secret).update(stringToSign, 'utf8').digest('base64')
}

/**
 * 构造 bucket 的基地址（虚拟托管风格）。
 * @param {object} cfg OSS 配置
 * @returns {string} 形如 https://bucket.oss-cn-hangzhou.aliyuncs.com
 */
export function bucketBase(cfg) {
  const endpoint = String(cfg.endpoint).replace(/^https?:\/\//iu, '').replace(/\/+$/u, '')
  return `https://${cfg.bucket}.${endpoint}`
}

/**
 * 签发一个预签名 PUT URL。
 *
 * 开发机拿到它就能直接用 curl 上传，不需要 OSS 凭证。
 *
 * @param {object} cfg OSS 配置
 * @param {string} key object key
 * @param {number} [expiresIn] 有效期秒数
 * @returns {{url: string, key: string, expiresAt: number}} 预签名结果
 */
export function presignPut(cfg, key, expiresIn = DEFAULT_EXPIRE_SECONDS) {
  const normalized = normalizeKey(key)
  const expiresAt = Math.floor(Date.now() / 1000) + expiresIn
  const canonicalizedResource = `/${cfg.bucket}/${normalized}`
  const signature = signOss({
    method: 'PUT',
    contentMd5: '',
    contentType: PUT_CONTENT_TYPE,
    date: String(expiresAt),
    canonicalizedResource,
    secret: cfg.accessKeySecret,
  })
  const query = [
    `OSSAccessKeyId=${uriEncode(cfg.accessKeyId)}`,
    `Expires=${expiresAt}`,
    `Signature=${uriEncode(signature)}`,
  ].join('&')
  return {
    url: `${bucketBase(cfg)}/${uriEncode(normalized).replace(/%2F/gu, '/')}?${query}`,
    key: normalized,
    expiresAt: expiresAt * 1000,
  }
}

/**
 * 签发一个预签名 GET URL（供宿主机自己或别人临时读回）。
 * @param {object} cfg OSS 配置
 * @param {string} key object key
 * @param {number} [expiresIn] 有效期秒数
 * @returns {string} 预签名 URL
 */
export function presignGet(cfg, key, expiresIn = DEFAULT_EXPIRE_SECONDS) {
  const normalized = normalizeKey(key)
  const expiresAt = Math.floor(Date.now() / 1000) + expiresIn
  const canonicalizedResource = `/${cfg.bucket}/${normalized}`
  const signature = signOss({
    method: 'GET',
    contentMd5: '',
    contentType: '',
    date: String(expiresAt),
    canonicalizedResource,
    secret: cfg.accessKeySecret,
  })
  const query = [
    `OSSAccessKeyId=${uriEncode(cfg.accessKeyId)}`,
    `Expires=${expiresAt}`,
    `Signature=${uriEncode(signature)}`,
  ].join('&')
  return `${bucketBase(cfg)}/${uriEncode(normalized).replace(/%2F/gu, '/')}?${query}`
}

/**
 * 签发任意方法的预签名 URL（GET / DELETE / PUT 等）。
 *
 * 三种方法共用一套签名结构，差别只在 VERB 与 Content-Type 位：
 *  - GET / DELETE 没有 body，Content-Type 留空
 *  - PUT 必须与上传时的 Content-Type 一致，否则 SignatureDoesNotMatch
 *
 * @param {object} cfg OSS 配置
 * @param {string} method HTTP 方法
 * @param {string} key object key
 * @param {number} expiresIn 有效期秒数
 * @param {string} [contentType] PUT 时需要的 Content-Type
 * @returns {{url: string, key: string, expiresAt: number}} 预签名结果
 */
export function presign(cfg, method, key, expiresIn = DEFAULT_EXPIRE_SECONDS, contentType = '') {
  const normalized = normalizeKey(key)
  const expiresAt = Math.floor(Date.now() / 1000) + expiresIn
  const canonicalizedResource = `/${cfg.bucket}/${normalized}`
  const signature = signOss({
    method,
    contentMd5: '',
    contentType,
    date: String(expiresAt),
    canonicalizedResource,
    secret: cfg.accessKeySecret,
  })
  const query = [
    `OSSAccessKeyId=${uriEncode(cfg.accessKeyId)}`,
    `Expires=${expiresAt}`,
    `Signature=${uriEncode(signature)}`,
  ].join('&')
  return {
    url: `${bucketBase(cfg)}/${uriEncode(normalized).replace(/%2F/gu, '/')}?${query}`,
    key: normalized,
    expiresAt: expiresAt * 1000,
  }
}

/**
 * 签发预签名 DELETE URL——用完即删的那一步。
 * @param {object} cfg OSS 配置
 * @param {string} key object key
 * @param {number} [expiresIn] 有效期秒数
 * @returns {{url: string, key: string, expiresAt: number}} 预签名结果
 */
export function presignDelete(cfg, key, expiresIn = 300) {
  return presign(cfg, 'DELETE', key, expiresIn, '')
}

/**
 * 立刻删除一个对象。
 *
 * OSS 的 DELETE 是幂等的：对象不存在也返回 204，所以重复调用安全。
 * 这一点让「延迟删除」可以有多个冗余触发点而不会互相干扰。
 *
 * @param {object} cfg OSS 配置
 * @param {string} key object key
 * @param {object} [options] 选项
 * @param {AbortSignal} [options.signal] 中止信号
 * @returns {Promise<{deleted: boolean, status: number, reason?: string}>} 删除结果
 */
export async function deleteObject(cfg, key, options = {}) {
  const { url } = presignDelete(cfg, key)
  let response
  try {
    response = await fetch(url, { method: 'DELETE', signal: options.signal })
  } catch (error) {
    const message = error !== null && typeof error === 'object' && error.message ? error.message : String(error)
    return { deleted: false, status: 0, reason: `网络请求失败：${message}` }
  }
  // 204 = 删除成功（对象本来就不存在时 OSS 也回 204，幂等）
  if (response.status === 204 || response.status === 200) {
    return { deleted: true, status: response.status }
  }
  const detail = (await response.text().catch(() => '')).slice(0, 300)
  const hint = response.status === 403
    ? '签名或权限问题：当前 AccessKey 可能没有该 bucket 的 DeleteObject 权限。'
    : ''
  return { deleted: false, status: response.status, reason: `${hint}${detail}`.trim() }
}

/**
 * 把 oss:// 或 object key 解析成实际可下载的地址。
 *
 * 优先用预签名 GET（bucket 私有时可读）；若配置了 publicBase，
 * 也可以直接拼公网地址（bucket 公共读时更省事）。
 *
 * @param {object} cfg OSS 配置
 * @param {string} spec "oss://a/b.png" 或 "a/b.png"
 * @returns {string} 可 GET 的 URL
 */
export function resolveOssUrl(cfg, spec) {
  const key = normalizeKey(String(spec).replace(/^oss:\/\//iu, ''))
  if (cfg.publicBase !== undefined && cfg.publicBase !== '') {
    return `${String(cfg.publicBase).replace(/\/+$/u, '')}/${uriEncode(key).replace(/%2F/gu, '/')}`
  }
  return presignGet(cfg, key, cfg.readExpireSeconds || DEFAULT_EXPIRE_SECONDS)
}

/**
 * 判断配置是否够用。
 * @param {object} cfg OSS 配置
 * @returns {string} 缺失项描述；齐全时为空串
 */
export function configProblem(cfg) {
  if (cfg === undefined || cfg === null) return '未配置'
  const missing = []
  if (!cfg.accessKeyId) missing.push('accessKeyId')
  if (!cfg.accessKeySecret) missing.push('accessKeySecret')
  if (!cfg.bucket) missing.push('bucket')
  if (!cfg.endpoint) missing.push('endpoint')
  return missing.length === 0 ? '' : `缺少 ${missing.join(' / ')}`
}

/**
 * 为一次上传生成 object key（按日期分目录，便于生命周期规则清理）。
 * @param {object} options 选项
 * @param {string} [options.name] 原始文件名
 * @param {number} [options.now] 时间戳
 * @returns {string} object key
 */
export function buildObjectKey({ name, now = Date.now() } = {}) {
  const date = new Date(now)
  const pad = n => (n < 10 ? `0${n}` : String(n))
  const dir = `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`
  const stamp = `${dir}-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`
  const rand = Math.random().toString(36).slice(2, 8)
  const safeName = String(name || 'image')
    .replace(/[^\w.-]+/gu, '_')
    .replace(/_{2,}/gu, '_')
    .slice(-60)
  return `dsh-vision/${dir}/${stamp}-${rand}-${safeName}`
}
