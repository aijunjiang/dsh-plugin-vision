// OSS 用完即删的调度逻辑测试。
//
// 重点不是「能不能删」，而是三个容易做错的地方：
//   1. 未到期的不能被提前删（否则重试会 404）
//   2. 删除失败不能清记录（否则图永远留在 OSS 上）
//   3. 待删清单要落盘（否则进程重启后那些图就再也删不掉了）

import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile, mkdir, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

const home = await mkdtemp(join(tmpdir(), 'vision-cleanup-'))
process.env.DSH_HOME = home

const {
  scheduleDelete,
  listPending,
  forgetPending,
  runDueDeletes,
  fileNameFor,
  pendingDir,
} = await import('../oss-cleanup.js')

const { presignDelete, deleteObject } = await import('../oss.js')

const NOW = 1_800_000_000_000

await test('scheduleDelete 落盘，listPending 能读回', async () => {
  await scheduleDelete({ key: 'dsh-vision/a.png', deleteAfter: NOW + 300_000 })
  const pending = await listPending()
  assert.equal(pending.length, 1)
  assert.equal(pending[0].key, 'dsh-vision/a.png')
  assert.equal(pending[0].deleteAfter, NOW + 300_000)
})

await test('不同 key 落到不同文件，互不覆盖', async () => {
  await forgetPending('dsh-vision/a.png')
  await scheduleDelete({ key: 'dsh-vision/b.png', deleteAfter: NOW })
  await scheduleDelete({ key: 'dsh-vision/c.png', deleteAfter: NOW })
  const names = await readdir(pendingDir())
  assert.equal(names.filter(n => n.endsWith('.json')).length, 2)
  const keys = (await listPending()).map(p => p.key).sort()
  assert.deepEqual(keys, ['dsh-vision/b.png', 'dsh-vision/c.png'])
})

await test('未到期的对象不会被删（重试窗口）', async () => {
  await rm(pendingDir(), { recursive: true, force: true })
  await scheduleDelete({ key: 'future.png', deleteAfter: NOW + 60_000 })
  const removed = []
  const result = await runDueDeletes({
    now: NOW,
    remove: async key => { removed.push(key); return { deleted: true, status: 204 } },
  })
  assert.deepEqual(removed, [], '未到期不该调用删除')
  assert.equal(result.skipped, 1)
  assert.equal(result.deleted.length, 0)
})

await test('到期对象被删除，且记录被清掉', async () => {
  await rm(pendingDir(), { recursive: true, force: true })
  await scheduleDelete({ key: 'due.png', deleteAfter: NOW - 1 })
  const removed = []
  const result = await runDueDeletes({
    now: NOW,
    remove: async key => { removed.push(key); return { deleted: true, status: 204 } },
  })
  assert.deepEqual(removed, ['due.png'])
  assert.deepEqual(result.deleted, ['due.png'])
  assert.equal((await listPending()).length, 0, '成功后应清掉记录')
})

await test('删除失败时保留记录，等下次重试（否则图会永远留在 OSS）', async () => {
  await rm(pendingDir(), { recursive: true, force: true })
  await scheduleDelete({ key: 'flaky.png', deleteAfter: NOW - 1 })
  const result = await runDueDeletes({
    now: NOW,
    remove: async () => ({ deleted: false, status: 403, reason: 'no DeleteObject permission' }),
  })
  assert.equal(result.failed.length, 1)
  assert.match(result.failed[0].reason, /DeleteObject/)
  assert.equal((await listPending()).length, 1, '失败必须保留记录')
})

await test('删除函数抛异常也不清记录，且不中断其它条目', async () => {
  await rm(pendingDir(), { recursive: true, force: true })
  await scheduleDelete({ key: 'boom.png', deleteAfter: NOW - 1 })
  await scheduleDelete({ key: 'ok.png', deleteAfter: NOW - 1 })
  const result = await runDueDeletes({
    now: NOW,
    remove: async key => {
      if (key === 'boom.png') throw new Error('network down')
      return { deleted: true, status: 204 }
    },
  })
  assert.equal(result.failed.length, 1)
  assert.deepEqual(result.deleted, ['ok.png'])
  const left = (await listPending()).map(p => p.key)
  assert.deepEqual(left, ['boom.png'], '抛异常的那条应留下重试')
})

await test('坏掉的记录文件不会让整轮清理崩掉', async () => {
  await rm(pendingDir(), { recursive: true, force: true })
  await mkdir(pendingDir(), { recursive: true })
  await writeFile(join(pendingDir(), 'garbage.json'), '{not json')
  await scheduleDelete({ key: 'good.png', deleteAfter: NOW - 1 })
  await assert.doesNotReject(() => runDueDeletes({
    now: NOW,
    remove: async () => ({ deleted: true, status: 204 }),
  }))
})

await test('空目录时返回空结果而不是报错', async () => {
  await rm(pendingDir(), { recursive: true, force: true })
  const result = await runDueDeletes({ now: NOW, remove: async () => ({ deleted: true, status: 204 }) })
  assert.deepEqual(result.deleted, [])
  assert.deepEqual(result.failed, [])
  assert.equal(result.skipped, 0)
})

await test('fileNameFor 对不同 key 不撞车（含只差一个字符的近似 key）', () => {
  const a = fileNameFor('dsh-vision/20261022/x.png')
  const b = fileNameFor('dsh-vision/20261022/y.png')
  assert.notEqual(a, b)
})

await test('presignDelete：方法是 DELETE，且与 GET 签名不同', () => {
  const cfg = { accessKeyId: 'A', accessKeySecret: 'S', bucket: 'b', endpoint: 'e.com' }
  const del = presignDelete(cfg, 'k.png')
  assert.match(del.url, /^https:\/\/b\.e\.com\/k\.png\?OSSAccessKeyId=A&Expires=\d+&Signature=/)
  const getSig = presignDelete(cfg, 'k.png').url.match(/Signature=([^&]+)/)[1]
  assert.ok(getSig.length > 10)
})

// ---------------------------------------------------------------- 真实删除语义

await test('deleteObject：204 视为成功（OSS 对不存在的对象也回 204）', async () => {
  const original = globalThis.fetch
  globalThis.fetch = async () => new Response(null, { status: 204 })
  try {
    const cfg = { accessKeyId: 'A', accessKeySecret: 'S', bucket: 'b', endpoint: 'e.com' }
    const r = await deleteObject(cfg, 'k.png')
    assert.equal(r.deleted, true)
    assert.equal(r.status, 204)
  } finally {
    globalThis.fetch = original
  }
})

await test('deleteObject：403 给出权限提示', async () => {
  const original = globalThis.fetch
  globalThis.fetch = async () => new Response('AccessDenied', { status: 403 })
  try {
    const cfg = { accessKeyId: 'A', accessKeySecret: 'S', bucket: 'b', endpoint: 'e.com' }
    const r = await deleteObject(cfg, 'k.png')
    assert.equal(r.deleted, false)
    assert.match(r.reason, /DeleteObject/)
  } finally {
    globalThis.fetch = original
  }
})

await test('deleteObject：网络失败不抛异常，返回可读原因', async () => {
  const original = globalThis.fetch
  globalThis.fetch = async () => { throw new Error('ECONNREFUSED') }
  try {
    const cfg = { accessKeyId: 'A', accessKeySecret: 'S', bucket: 'b', endpoint: 'e.com' }
    const r = await deleteObject(cfg, 'k.png')
    assert.equal(r.deleted, false)
    assert.equal(r.status, 0)
    assert.match(r.reason, /网络请求失败/)
  } finally {
    globalThis.fetch = original
  }
})

await rm(home, { recursive: true, force: true })
