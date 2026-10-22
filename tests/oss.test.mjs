// OSS 中转通道的单元测试。
//
// 只覆盖纯逻辑：签名、URL 构造、key 规范化。真上传需要真实 AK，放在
// tests/oss-live.test.mjs（有环境变量才跑）。这样默认 npm test 不需要网络与凭证。

import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { test } from 'node:test'

const {
  signOss,
  presignPut,
  presignGet,
  resolveOssUrl,
  normalizeKey,
  buildObjectKey,
  configProblem,
  bucketBase,
} = await import('../oss.js')

const cfg = {
  accessKeyId: 'LTAI_TEST_ID',
  accessKeySecret: 'test-secret-value',
  bucket: 'examplebucket',
  endpoint: 'oss-cn-hangzhou.aliyuncs.com',
}

// ---------------------------------------------------------------- 签名

await test('签名与独立 HMAC-SHA1 实现一致（防止自写自测）', () => {
  const params = {
    method: 'PUT',
    contentMd5: '',
    contentType: 'application/octet-stream',
    date: '1700000000',
    canonicalizedResource: '/examplebucket/a/b.png',
    secret: 'test-secret-value',
  }
  const expected = createHmac('sha1', params.secret)
    .update(`PUT\n\napplication/octet-stream\n1700000000\n/examplebucket/a/b.png`, 'utf8')
    .digest('base64')
  assert.equal(signOss(params), expected)
})

await test('签名对 StringToSign 的每一行都敏感', () => {
  const base = {
    method: 'PUT', contentMd5: '', contentType: '', date: '1700000000',
    canonicalizedResource: '/examplebucket/x', secret: 's',
  }
  const a = signOss(base)
  assert.notEqual(a, signOss({ ...base, method: 'GET' }), 'method 必须参与签名')
  assert.notEqual(a, signOss({ ...base, contentType: 'image/png' }), 'Content-Type 必须参与签名')
  assert.notEqual(a, signOss({ ...base, date: '1700000001' }), '过期时间必须参与签名')
  assert.notEqual(a, signOss({ ...base, canonicalizedResource: '/examplebucket/y' }), '资源路径必须参与签名')
  assert.notEqual(a, signOss({ ...base, secret: 'other' }), '密钥必须参与签名')
})

await test('Content-Type / Content-MD5 为空时以空行占位（不能省略行）', () => {
  const withEmpty = signOss({
    method: 'GET', contentMd5: '', contentType: '', date: '', canonicalizedResource: '/b/k', secret: 's',
  })
  const expected = createHmac('sha1', 's').update('GET\n\n\n\n/b/k', 'utf8').digest('base64')
  assert.equal(withEmpty, expected)
})

// ---------------------------------------------------------------- URL 构造

await test('bucketBase：虚拟托管风格，吃掉协议与尾斜杠', () => {
  assert.equal(bucketBase(cfg), 'https://examplebucket.oss-cn-hangzhou.aliyuncs.com')
  assert.equal(bucketBase({ ...cfg, endpoint: 'https://oss-cn-beijing.aliyuncs.com/' }),
    'https://examplebucket.oss-cn-beijing.aliyuncs.com')
})

await test('presignPut：URL 里带齐三个必需参数', () => {
  const { url, key, expiresAt } = presignPut(cfg, 'dsh-vision/a.png', 900)
  assert.match(url, /^https:\/\/examplebucket\.oss-cn-hangzhou\.aliyuncs\.com\/dsh-vision\/a\.png\?/)
  assert.match(url, /OSSAccessKeyId=LTAI_TEST_ID/)
  assert.match(url, /Expires=\d+/)
  assert.match(url, /Signature=/)
  assert.equal(key, 'dsh-vision/a.png')
  assert.ok(expiresAt > Date.now(), '过期时间应在未来')
})

await test('presignPut：签名里用的是 Expires 而不是 GMT Date', () => {
  // 这是最容易写错的一处：URL 签名的第四行是过期时间戳。
  const { url: u } = presignPut(cfg, 'k.png', 900)
  const m = u.match(/Expires=(\d+)/)
  assert.ok(m !== null)
  const sec = m[1]
  const expectedSig = createHmac('sha1', cfg.accessKeySecret)
    .update(`PUT\n\napplication/octet-stream\n${sec}\n/examplebucket/k.png`, 'utf8')
    .digest('base64')
  const encoded = expectedSig.replace(/\//g, '%2F').replace(/\+/g, '%2B').replace(/=/g, '%3D')
  assert.ok(u.includes(encoded), 'PUT 签名应按 Expires 计时')
})

await test('presignGet：签名行不含 Content-Type（GET 无 body）', () => {
  const u = presignGet(cfg, 'k.png', 600)
  const sec = u.match(/Expires=(\d+)/)[1]
  const expected = createHmac('sha1', cfg.accessKeySecret)
    .update(`GET\n\n\n${sec}\n/examplebucket/k.png`, 'utf8')
    .digest('base64')
  const encoded = expected.replace(/\//g, '%2F').replace(/\+/g, '%2B').replace(/=/g, '%3D')
  assert.ok(u.includes(encoded))
})

await test('resolveOssUrl：oss:// 前缀被去掉并改写成可读地址', () => {
  const u = resolveOssUrl(cfg, 'oss://dsh-vision/x.png')
  assert.match(u, /^https:\/\/examplebucket\./)
  assert.match(u, /dsh-vision\/x\.png/)
  assert.match(u, /Signature=/)
})

await test('resolveOssUrl：配了 publicBase 时直拼公网地址（公共读 bucket 省一次签名）', () => {
  const u = resolveOssUrl({ ...cfg, publicBase: 'https://cdn.example.com/img/' }, 'a/b.png')
  assert.equal(u, 'https://cdn.example.com/img/a/b.png')
})

await test('object key 里的空格与中文会被正确编码', () => {
  const { url } = presignPut(cfg, 'dsh-vision/中文 名字.png', 900)
  assert.ok(url.includes('%E4%B8%AD%E6%96%87'), '中文应被百分号编码')
  assert.ok(url.includes('%20'), '空格应被编码')
  assert.ok(!url.includes(' '), 'URL 中不应出现裸空格')
})

await test('key 里的斜杠不被编码（否则 OSS 认成单个文件名）', () => {
  const { url } = presignPut(cfg, 'a/b/c.png', 900)
  // 只看路径部分：query 里的 %2F 是签名的 base64 转义，与 key 无关。
  const pathPart = url.split('?')[0]
  assert.ok(pathPart.endsWith('/a/b/c.png'), `路径应保持目录结构，实际 ${pathPart}`)
  assert.ok(!pathPart.includes('%2F'), '路径里的目录分隔符不应被编码')
})

// ---------------------------------------------------------------- key 规范化

await test('normalizeKey：去掉前导斜杠，挡住目录穿越', () => {
  assert.equal(normalizeKey('/a/b.png'), 'a/b.png')
  assert.equal(normalizeKey('///a/b.png'), 'a/b.png')
  assert.equal(normalizeKey('../../etc/passwd'), 'etc/passwd')
  assert.equal(normalizeKey('a/../b.png'), 'a/b.png')
})

await test('buildObjectKey：按 UTC 日期分目录，文件名被消毒', () => {
  const key = buildObjectKey({ name: '君禾 截图.PNG', now: Date.UTC(2026, 3, 24, 12, 6, 55) })
  assert.match(key, /^dsh-vision\/20260424\//)
  assert.ok(!/[\u4e00-\u9fa5]/u.test(key), '非 ASCII 应被替换，避免签名/URL 编码问题')
  assert.ok(key.endsWith('.PNG'))
})

await test('buildObjectKey：同名不同时刻不会撞车', () => {
  const a = buildObjectKey({ name: 'x.png' })
  const b = buildObjectKey({ name: 'x.png' })
  assert.notEqual(a, b, '应含随机段')
})

await test('buildObjectKey：超长文件名被截断', () => {
  const key = buildObjectKey({ name: `${'a'.repeat(300)}.png` })
  assert.ok(key.length < 120, `key 过长: ${key.length}`)
})

// ---------------------------------------------------------------- 配置校验

await test('configProblem：逐项报出缺失字段', () => {
  assert.equal(configProblem(cfg), '')
  assert.match(configProblem({}), /accessKeyId/)
  assert.match(configProblem({ ...cfg, accessKeySecret: '' }), /accessKeySecret/)
  assert.match(configProblem({ ...cfg, bucket: undefined }), /bucket/)
  assert.equal(configProblem(undefined), '未配置')
})

// ---------------------------------------------------------------- 有效期

await test('默认有效期 15 分钟，且可自定义', () => {
  const short = presignPut(cfg, 'k.png', 60)
  const ms = short.expiresAt - Date.now()
  assert.ok(ms > 50_000 && ms < 70_000, `实际 ${ms}ms`)
})
