// 接收端点（开发机推图）的端到端测试：真起一个 http server，用真请求打。
//
// 覆盖：令牌校验、格式校验、体积上限、条目上限、TTL 清理、inbox 列表、
// 以及「推上来之后能被摘要找到」这条最关键的链路。

import { createServer } from 'node:http'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'

// DSH_HOME 必须在 import 之前设好，模块里是惰性读取的，但令牌读写依赖它。
const home = await mkdtemp(join(tmpdir(), 'vision-ingest-'))
process.env.DSH_HOME = home

const {
  INGEST_PATH,
  loadOrCreateToken,
  makeIngestRoute,
  listInbox,
  sweepExpired,
  sniffMediaType,
} = await import('../ingest.js')

/** 最小合法 PNG（1x1）。 */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

/**
 * 造一张「内容不同、仍然合法」的 PNG：在 IDAT 之后塞一段私有 chunk。
 * 用来验证多条不同图片各自成条（内容寻址会把同字节的图去重成一条）。
 * @param {number} n 区分因子
 * @returns {Buffer} PNG 字节
 */
function pngVariant(n) {
  const chunk = Buffer.from(`tEXtVariant${n}`, 'latin1')
  return Buffer.concat([PNG, chunk])
}

/** 极简附件服务替身：只实现 saveImage，按内容寻址（与真实服务口径一致）。 */
function fakeAttachments() {
  const saved = []
  return {
    saved,
    async saveImage(input) {
      const hex = createHash('sha256').update(input.data).digest('hex')
      const ref = {
        attachmentId: `sha256:${hex}`,
        mediaType: input.mediaType,
        bytes: input.data.length,
        width: 1,
        height: 1,
        ...(input.name !== undefined ? { name: input.name } : {}),
      }
      saved.push(ref)
      return ref
    },
  }
}

/** 在当前进程起一个只挂接收路由的服务，返回地址与关闭函数。 */
async function serve(config, token, attachments) {
  const ctx = { get: name => (name === 'attachments' ? attachments : undefined) }
  const route = makeIngestRoute(ctx, { config: () => config, token: () => token })
  const server = createServer((req, res) => {
    void route.handler(req, res)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  return {
    url: `http://127.0.0.1:${port}${INGEST_PATH}`,
    close: () => new Promise(resolve => server.close(resolve)),
  }
}

const baseConfig = {
  enabled: true,
  ttlHours: 24,
  maxIngestBytes: 1024 * 1024,
  maxInboxItems: 5,
}

await test('没有令牌 → 401，且不回显任何内部信息', async () => {
  const app = await serve(baseConfig, 'secret-token-value', fakeAttachments())
  try {
    const res = await fetch(app.url, { method: 'POST', body: PNG })
    assert.equal(res.status, 401)
    const body = await res.json()
    assert.equal(body.ok, false)
    assert.equal(body.error, 'missing or invalid token')
  } finally {
    await app.close()
  }
})

await test('令牌错误 → 401（与缺失同一种响应，避免探测）', async () => {
  const app = await serve(baseConfig, 'secret-token-value', fakeAttachments())
  try {
    const res = await fetch(app.url, {
      method: 'POST',
      headers: { authorization: 'Bearer wrong' },
      body: PNG,
    })
    assert.equal(res.status, 401)
  } finally {
    await app.close()
  }
})

await test('GET → 405 并告知正确方法', async () => {
  const app = await serve(baseConfig, 't', fakeAttachments())
  try {
    const res = await fetch(app.url)
    assert.equal(res.status, 405)
    assert.match(res.headers.get('allow'), /POST/)
  } finally {
    await app.close()
  }
})

await test('正常推送 → 201，返回摘要与可直接用的 usage', async () => {
  const attachments = fakeAttachments()
  const app = await serve(baseConfig, 'tok', attachments)
  try {
    const res = await fetch(`${app.url}?name=shot.png`, {
      method: 'POST',
      headers: { authorization: 'Bearer tok' },
      body: PNG,
    })
    assert.equal(res.status, 201)
    const body = await res.json()
    assert.equal(body.ok, true)
    assert.match(body.id, /^sha256:/)
    assert.equal(body.mediaType, 'image/png')
    assert.equal(body.width, 1)
    assert.match(body.usage, /vision_analyze images=\["sha256:/)
    assert.equal(attachments.saved.length, 1)
    assert.equal(attachments.saved[0].name, 'shot.png')
  } finally {
    await app.close()
  }
})

await test('X-Vision-Token 头也能用（方便 curl -H 而不是拼 Bearer）', async () => {
  const app = await serve(baseConfig, 'tok2', fakeAttachments())
  try {
    const res = await fetch(app.url, {
      method: 'POST',
      headers: { 'x-vision-token': 'tok2' },
      body: PNG,
    })
    assert.equal(res.status, 201)
  } finally {
    await app.close()
  }
})

await test('非图片字节 → 415', async () => {
  const app = await serve(baseConfig, 'tok', fakeAttachments())
  try {
    const res = await fetch(app.url, {
      method: 'POST',
      headers: { authorization: 'Bearer tok' },
      body: Buffer.from('this is definitely not an image'),
    })
    assert.equal(res.status, 415)
  } finally {
    await app.close()
  }
})

await test('空 body → 400', async () => {
  const app = await serve(baseConfig, 'tok', fakeAttachments())
  try {
    const res = await fetch(app.url, { method: 'POST', headers: { authorization: 'Bearer tok' }, body: '' })
    assert.equal(res.status, 400)
  } finally {
    await app.close()
  }
})

await test('超过体积上限 → 413', async () => {
  const app = await serve({ ...baseConfig, maxIngestBytes: 32 }, 'tok', fakeAttachments())
  try {
    const res = await fetch(app.url, {
      method: 'POST',
      headers: { authorization: 'Bearer tok' },
      body: Buffer.concat([PNG, Buffer.alloc(200)]),
    })
    assert.equal(res.status, 413)
  } finally {
    await app.close()
  }
})

await test('端点关闭 → 404', async () => {
  const app = await serve({ ...baseConfig, enabled: false }, 'tok', fakeAttachments())
  try {
    const res = await fetch(app.url, { method: 'POST', headers: { authorization: 'Bearer tok' }, body: PNG })
    assert.equal(res.status, 404)
  } finally {
    await app.close()
  }
})

await test('条目上限生效：满了之后拒绝新图', async () => {
  await rm(join(home, 'vision-inbox'), { recursive: true, force: true })
  const app = await serve({ ...baseConfig, maxInboxItems: 2 }, 'limit-tok', fakeAttachments())
  try {
    for (let i = 0; i < 2; i += 1) {
      const res = await fetch(`${app.url}?name=f${i}.png`, {
        method: 'POST',
        headers: { authorization: 'Bearer limit-tok' },
        body: pngVariant(i),
      })
      assert.equal(res.status, 201, `第 ${i + 1} 张应成功`)
    }
    const over = await fetch(app.url, { method: 'POST', headers: { authorization: 'Bearer limit-tok' }, body: pngVariant(9) })
    assert.equal(over.status, 507)
  } finally {
    await app.close()
  }
})

await test('同一张图重复推送 → 内容寻址去重，不额外占条目', async () => {
  await rm(join(home, 'vision-inbox'), { recursive: true, force: true })
  const app = await serve({ ...baseConfig, maxInboxItems: 2 }, 'dup-tok', fakeAttachments())
  try {
    const same = pngVariant(42)
    const first = await fetch(app.url, { method: 'POST', headers: { authorization: 'Bearer dup-tok' }, body: same })
    const second = await fetch(app.url, { method: 'POST', headers: { authorization: 'Bearer dup-tok' }, body: same })
    assert.equal(first.status, 201)
    assert.equal(second.status, 201)
    const a = await first.json()
    const b = await second.json()
    assert.equal(a.id, b.id, '同一字节应得到同一个摘要')
    assert.equal((await listInbox()).length, 1, 'inbox 里应只有一条')
  } finally {
    await app.close()
  }
})

await test('inbox 列表按时间新→旧，且带过期时间', async () => {
  await rm(join(home, 'vision-inbox'), { recursive: true, force: true })
  const app = await serve(baseConfig, 'order-tok', fakeAttachments())
  try {
    for (let i = 0; i < 3; i += 1) {
      await fetch(`${app.url}?name=o${i}.png`, {
        method: 'POST',
        headers: { authorization: 'Bearer order-tok' },
        body: pngVariant(100 + i),
      })
    }
  } finally {
    await app.close()
  }
  const items = await listInbox()
  assert.equal(items.length, 3, `inbox 应有 3 条，实际 ${items.length}`)
  assert.ok(items.every(item => typeof item.expiresAt === 'number'))
  for (let i = 1; i < items.length; i += 1) {
    assert.ok(items[i - 1].receivedAt >= items[i].receivedAt, '应按 receivedAt 倒序')
  }
})

await test('过期条目被清理，未过期的保留', async () => {
  const dir = join(home, 'vision-inbox', 'items')
  await mkdir(dir, { recursive: true })
  const old = { id: 'sha256:old', receivedAt: 1, expiresAt: Date.now() - 1000 }
  const fresh = { id: 'sha256:fresh', receivedAt: 2, expiresAt: Date.now() + 100000 }
  await writeFile(join(dir, 'old.json'), JSON.stringify(old))
  await writeFile(join(dir, 'fresh.json'), JSON.stringify(fresh))

  const removed = await sweepExpired()
  assert.ok(removed >= 1, '至少应清掉过期那条')

  const remaining = await listInbox()
  assert.ok(remaining.some(item => item.id === 'sha256:fresh'), '未过期的应留下')
  assert.ok(!remaining.some(item => item.id === 'sha256:old'), '过期的应已删除')
})

await test('坏掉的元数据文件不会让清理崩掉', async () => {
  const dir = join(home, 'vision-inbox', 'items')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'garbage.json'), '{not json at all')
  await assert.doesNotReject(() => sweepExpired())
})

await test('令牌持久化：多次读取得到同一个（重启后开发机脚本不用改）', async () => {
  const first = await loadOrCreateToken()
  const second = await loadOrCreateToken()
  assert.equal(first, second)
  assert.ok(first.length >= 16)
})

await test('嗅探：五种格式都认，非图片不认', () => {
  assert.equal(sniffMediaType(PNG), 'image/png')
  assert.equal(sniffMediaType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])), 'image/jpeg')
  assert.equal(sniffMediaType(Buffer.from('GIF89a----------', 'latin1')), 'image/gif')
  assert.equal(sniffMediaType(Buffer.from('RIFFxxxxWEBP', 'latin1')), 'image/webp')
  assert.equal(sniffMediaType(Buffer.from('BM----------', 'latin1')), 'image/bmp')
  assert.equal(sniffMediaType(Buffer.from('hello world!', 'latin1')), undefined)
})

await rm(home, { recursive: true, force: true })
