// 接收端点与 latest 语义的回归测试。
//
// 与 index.js 解耦：只测纯逻辑（mergeLatestSources）与 ingest.js 的解析器。
// index.js 在缺 @deepseek-ai/schemastery 时会整文件跳过，所以凡是能测的纯函数
// 都放这里，保证 CI 与本机都能跑。

import assert from 'node:assert/strict'
import { test } from 'node:test'

const { parseNameForTest } = await import('../ingest.js')
const { mergeLatestSources } = await import('../fallbacks.js')

// ---------------------------------------------------------------- ?name= 解析

await test('name 参数：纯 ASCII', () => {
  assert.equal(parseNameForTest('/dsh-vision/ingest?name=shot.png'), 'shot.png')
})

await test('name 参数：百分号编码的中文', () => {
  assert.equal(parseNameForTest('/dsh-vision/ingest?name=%E4%BD%A0%E5%A5%BD.png'), '你好.png')
})

await test('name 参数：未编码的裸中文也能取到（这是之前的空响应 bug）', () => {
  // 开发机的文件名常常是中文，curl 会把原始字节直接塞进 query。
  // 旧实现走 new URL() 会抛 Invalid URL，异常漏出 handler → 连接断开 → 客户端看到空响应。
  const raw = '/dsh-vision/ingest?name=君禾-流水线.png'
  assert.equal(parseNameForTest(raw), '君禾-流水线.png')
})

await test('name 参数：缺失时返回空串而不是抛错', () => {
  assert.equal(parseNameForTest('/dsh-vision/ingest'), '')
  assert.equal(parseNameForTest('/dsh-vision/ingest?foo=bar'), '')
  assert.equal(parseNameForTest(undefined), '')
  assert.equal(parseNameForTest(''), '')
})

await test('name 参数：残缺的百分号编码不崩', () => {
  assert.doesNotThrow(() => parseNameForTest('/dsh-vision/ingest?name=%E4%BD'))
  assert.equal(parseNameForTest('/dsh-vision/ingest?name=100%.png'), '100%.png')
})

await test('name 参数：超长名字被截断到 200 字符', () => {
  const long = 'a'.repeat(500)
  assert.equal(parseNameForTest(`/dsh-vision/ingest?name=${long}`).length, 200)
})

// ---------------------------------------------------------------- latest 合并

await test('mergeLatestSources：只有会话附件时保持原顺序', () => {
  const sessionRefs = [
    { attachmentId: 'sha256:aaa1', mediaType: 'image/png', bytes: 10 },
    { attachmentId: 'sha256:bbb2', mediaType: 'image/png', bytes: 20 },
  ]
  const merged = mergeLatestSources(sessionRefs, [])
  assert.deepEqual(merged.map(i => i.kind), ['session', 'session'])
  assert.deepEqual(merged.map(i => i.ref.attachmentId), ['sha256:aaa1', 'sha256:bbb2'])
})

await test('mergeLatestSources：只有 inbox 时按收到时间旧→新', () => {
  // listInbox 给的是新→旧
  const inbox = [
    { id: 'sha256:new', receivedAt: 300, mediaType: 'image/png', bytes: 1 },
    { id: 'sha256:old', receivedAt: 100, mediaType: 'image/png', bytes: 1 },
  ]
  const merged = mergeLatestSources([], inbox)
  assert.deepEqual(merged.map(i => i.ref.attachmentId), ['sha256:old', 'sha256:new'])
})

await test('mergeLatestSources：inbox 在前、会话附件在后（用户刚传的算最新）', () => {
  const sessionRefs = [{ attachmentId: 'sha256:session', mediaType: 'image/png', bytes: 1 }]
  const inbox = [{ id: 'sha256:inbox', receivedAt: 1, mediaType: 'image/png', bytes: 1 }]
  const merged = mergeLatestSources(sessionRefs, inbox)
  assert.equal(merged.length, 2)
  assert.equal(merged[merged.length - 1].ref.attachmentId, 'sha256:session', '最后一张应是会话附件')
})

await test('mergeLatestSources：inbox 条目的 id 被映射成 attachmentId（这是能读字节的前提）', () => {
  const inbox = [{ id: 'sha256:xyz', mediaType: 'image/jpeg', bytes: 99, width: 2560, height: 1440, name: 'a.jpg' }]
  const merged = mergeLatestSources([], inbox)
  assert.equal(merged[0].ref.attachmentId, 'sha256:xyz')
  assert.equal(merged[0].ref.width, 2560)
  assert.equal(merged[0].ref.height, 1440)
  assert.equal(merged[0].ref.name, 'a.jpg')
})

await test('mergeLatestSources：inbox 条目名字为空时不写入 name 字段', () => {
  const inbox = [{ id: 'sha256:q', mediaType: 'image/png', bytes: 1, name: '' }]
  const merged = mergeLatestSources([], inbox)
  assert.equal('name' in merged[0].ref, false)
})

await test('mergeLatestSources：两边都空时返回空数组（调用方据此报错）', () => {
  assert.deepEqual(mergeLatestSources([], []), [])
  assert.deepEqual(mergeLatestSources(undefined, undefined), [])
})

await test('mergeLatestSources：不修改入参（listInbox 的输出不能被就地反转）', () => {
  const inbox = [
    { id: 'sha256:a', receivedAt: 2, mediaType: 'image/png', bytes: 1 },
    { id: 'sha256:b', receivedAt: 1, mediaType: 'image/png', bytes: 1 },
  ]
  const snapshot = JSON.stringify(inbox)
  mergeLatestSources([], inbox)
  assert.equal(JSON.stringify(inbox), snapshot, '入参不应被修改')
})

await test('latest:N 语义：取合并时间线的最后 N 张', () => {
  const sessionRefs = [
    { attachmentId: 'sha256:s1', mediaType: 'image/png', bytes: 1 },
    { attachmentId: 'sha256:s2', mediaType: 'image/png', bytes: 1 },
  ]
  const inbox = [
    { id: 'sha256:i2', receivedAt: 20, mediaType: 'image/png', bytes: 1 },
    { id: 'sha256:i1', receivedAt: 10, mediaType: 'image/png', bytes: 1 },
  ]
  const ordered = mergeLatestSources(sessionRefs, inbox)
  // 时间线应为：i1(旧) → i2 → s1 → s2(最新)
  assert.deepEqual(ordered.map(i => i.ref.attachmentId), ['sha256:i1', 'sha256:i2', 'sha256:s1', 'sha256:s2'])

  const last1 = ordered.slice(-1).map(i => i.ref.attachmentId)
  assert.deepEqual(last1, ['sha256:s2'])

  const last3 = ordered.slice(-3).map(i => i.ref.attachmentId)
  assert.deepEqual(last3, ['sha256:i2', 'sha256:s1', 'sha256:s2'])
})
