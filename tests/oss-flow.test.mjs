// OSS 通道的端到端测试：用本地假服务模拟 OSS，验证「签发 → 上传 → 读回」。
//
// 不联网、不需要真实 AK。真上传放 tests/oss-live.test.mjs（有环境变量才跑）。
//
// 假服务刻意做了鉴权检查（缺 OSSAccessKeyId/Expires/Signature 就 403），
// 这样「预签名 URL 结构是否完整」这件事才真的被测到，而不是自说自话。

import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { test } from 'node:test'

const { presignPut, presignGet } = await import('../oss.js')

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

/**
 * 起一个假的 OSS：内存存对象，校验三个签名参数。
 * @returns {Promise<{base: string, replace: Function, store: Map, close: Function}>}
 */
async function fakeOss() {
  const store = new Map()
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost')
    const key = decodeURIComponent(url.pathname.slice(1))

    const required = ['OSSAccessKeyId', 'Expires', 'Signature']
    const missing = required.filter(name => !url.searchParams.has(name))
    if (missing.length > 0) {
      res.writeHead(403)
      res.end(`MissingQueryParameter: ${missing.join(',')}`)
      return
    }

    if (req.method === 'PUT') {
      const chunks = []
      req.on('data', chunk => chunks.push(chunk))
      req.on('end', () => {
        store.set(key, Buffer.concat(chunks))
        res.writeHead(200, { etag: '"mock"' })
        res.end()
      })
      return
    }
    if (req.method === 'GET') {
      const data = store.get(key)
      if (data === undefined) {
        res.writeHead(404)
        res.end('NoSuchKey')
        return
      }
      res.writeHead(200, { 'content-length': data.length, 'content-type': 'application/octet-stream' })
      res.end(data)
      return
    }
    res.writeHead(405)
    res.end()
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  const host = `127.0.0.1:${port}`
  // presign 生成的是 https://<bucket>.<endpoint>/...，这里把虚拟托管主机名换回本地地址。
  const replace = u => u.replace(`https://bkt.${host}`, `http://${host}`)
  return { base: `http://${host}`, host, replace, store, close: () => new Promise(r => server.close(r)) }
}

const cfgFor = host => ({
  accessKeyId: 'AK',
  accessKeySecret: 'SK',
  bucket: 'bkt',
  endpoint: host,
})

await test('签发 → 上传 → 读回，字节完全一致', async () => {
  const oss = await fakeOss()
  try {
    const cfg = cfgFor(oss.host)
    const { url, key } = presignPut(cfg, 'dsh-vision/round-trip.png', 900)
    assert.equal(key, 'dsh-vision/round-trip.png')

    const putUrl = oss.replace(url)
    const put = await fetch(putUrl, {
      method: 'PUT',
      headers: { 'content-type': 'application/octet-stream' },
      body: PNG,
    })
    assert.equal(put.status, 200, 'PUT 应成功')

    const got = await fetch(putUrl)
    assert.equal(got.status, 200)
    const bytes = Buffer.from(await got.arrayBuffer())
    assert.ok(bytes.equals(PNG), '读回内容应与上传一致')
  } finally {
    await oss.close()
  }
})

await test('缺签名参数的请求被拒（证明 URL 结构完整是必须的）', async () => {
  const oss = await fakeOss()
  try {
    const cfg = cfgFor(oss.host)
    const { url } = presignPut(cfg, 'a.png', 900)
    const bare = oss.replace(url).split('?')[0]
    const res = await fetch(bare)
    assert.equal(res.status, 403)
  } finally {
    await oss.close()
  }
})

await test('对象不存在 → 404（供 vision_analyze 给出可读报错）', async () => {
  const oss = await fakeOss()
  try {
    const cfg = cfgFor(oss.host)
    const url = oss.replace(presignGet(cfg, 'never-uploaded.png', 60))
    const res = await fetch(url)
    assert.equal(res.status, 404)
  } finally {
    await oss.close()
  }
})

await test('PUT 与 GET 的签名不同（方法参与签名）', async () => {
  const putUrl = presignPut({ accessKeyId: 'A', accessKeySecret: 'S', bucket: 'b', endpoint: 'e.com' }, 'k', 900)
  const getUrl = presignGet({ accessKeyId: 'A', accessKeySecret: 'S', bucket: 'b', endpoint: 'e.com' }, 'k', 900)
  const putSig = putUrl.url.match(/Signature=([^&]+)/)[1]
  const getSig = getUrl.match(/Signature=([^&]+)/)[1]
  assert.notEqual(putSig, getSig)
})

await test('目录结构在假服务上被正确还原（key 没有被编码成一整段）', async () => {
  const oss = await fakeOss()
  try {
    const cfg = cfgFor(oss.host)
    const { url, key } = presignPut(cfg, 'dsh-vision/20260424/x.png', 900)
    await fetch(oss.replace(url), {
      method: 'PUT',
      headers: { 'content-type': 'application/octet-stream' },
      body: PNG,
    })
    assert.ok(oss.store.has(key), `假服务里应存有 ${key}`)
    assert.equal(oss.store.size, 1)
  } finally {
    await oss.close()
  }
})
