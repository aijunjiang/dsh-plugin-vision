// 会话图片枚举测试：覆盖宿主 session-controller 走的全部五条事件路径。
//
//   node tests/session-images.test.mjs
//
// 这是「分析用户在会话中上传的图片」这条需求的核心逻辑：latest / latest:N 与
// sha256 摘要点名都依赖它。事件形状对齐 packages/api/session-controller/src/commands.ts
// 的 imageBlockIn / imageInEvent，附件形状对齐 ImageAttachmentRef。
import assert from 'node:assert/strict'

// index.js 依赖 @deepseek-ai/schemastery（运行时由 DSH 提供）。没装依赖就跳过，别让 check 挂掉。
let mod
try {
  mod = await import('../index.js')
} catch (error) {
  if (error !== null && typeof error === 'object' && error.code === 'ERR_MODULE_NOT_FOUND') {
    console.log(`⏭  跳过宿主逻辑测试：依赖未安装（${error.message.split('\n')[0]}）`)
    process.exit(0)
  }
  throw error
}
const { buildPromptSection, sessionImageRefs, withDefaults } = mod

let passed = 0
/** 跑一条用例。 */
function test(title, fn) {
  fn()
  passed += 1
  console.log(`  ✓ ${title}`)
}

/** 造一个符合 ImageAttachmentRef 形状的附件。 */
function ref(id, name) {
  return {
    attachmentId: `sha256:${id.repeat(64).slice(0, 64)}`,
    mediaType: 'image/png',
    bytes: 13371,
    width: 640,
    height: 360,
    ...name === undefined ? {} : { name },
  }
}

/** 造一个 image content block。 */
function imageBlock(attachment) {
  return { type: 'image', attachment }
}

/** 包一层 exec。 */
function exec(events) {
  return { agent: { session: { events } } }
}

console.log('会话图片枚举:')

test('用户消息 data.content 里的图片', () => {
  const a = ref('a', 'shot.png')
  const found = sessionImageRefs(exec([
    { type: 'user/message', data: { content: [{ type: 'text', text: '看看这个' }, imageBlock(a)] } },
  ]))
  assert.deepEqual(found, [a])
})

test('data.message.content 里的图片', () => {
  const b = ref('b')
  const found = sessionImageRefs(exec([
    { type: 'assistant/message', data: { message: { content: [imageBlock(b)] } } },
  ]))
  assert.deepEqual(found, [b])
})

test('data.inserted[] 里的图片', () => {
  const c = ref('c')
  const found = sessionImageRefs(exec([
    { type: 'session/insert', data: { inserted: [{ content: [imageBlock(c)] }] } },
  ]))
  assert.deepEqual(found, [c])
})

test('assistant/chunk 的 block-end 图片', () => {
  const d = ref('d')
  const found = sessionImageRefs(exec([
    { type: 'assistant/chunk', data: { chunk: { type: 'block-end', block: imageBlock(d) } } },
  ]))
  assert.deepEqual(found, [d])
})

test('嵌套在 tool-result 里的图片（read_image 的产物）', () => {
  const e = ref('e', 'read.png')
  const found = sessionImageRefs(exec([
    {
      type: 'tool/result',
      data: { content: [{ type: 'tool-result', content: [{ type: 'text', text: 'ok' }, imageBlock(e)] }] },
    },
  ]))
  assert.deepEqual(found, [e])
})

test('assistant/chunk 但不是 block-end 时不收集', () => {
  const f = ref('f')
  const found = sessionImageRefs(exec([
    { type: 'assistant/chunk', data: { chunk: { type: 'block-delta', block: imageBlock(f) } } },
  ]))
  assert.deepEqual(found, [])
})

test('非 assistant/chunk 事件的 chunk 不收集', () => {
  const g = ref('g')
  const found = sessionImageRefs(exec([
    { type: 'user/message', data: { chunk: { type: 'block-end', block: imageBlock(g) } } },
  ]))
  assert.deepEqual(found, [])
})

test('同一张图重复出现只算一次，顺序为旧→新', () => {
  const a = ref('a')
  const b = ref('b')
  const found = sessionImageRefs(exec([
    { type: 'user/message', data: { content: [imageBlock(a)] } },
    { type: 'user/message', data: { content: [imageBlock(b)] } },
    { type: 'assistant/message', data: { message: { content: [imageBlock(a)] } } },
  ]))
  assert.deepEqual(found.map(r => r.attachmentId), [a.attachmentId, b.attachmentId])
})

test('latest:N 的切片语义取最后 N 张', () => {
  const refs = ['a', 'b', 'c', 'd'].map(id => ref(id))
  const found = sessionImageRefs(exec(refs.map(r => ({ type: 'user/message', data: { content: [imageBlock(r)] } }))))
  const want = 2
  const picked = found.slice(Math.max(0, found.length - want))
  assert.deepEqual(picked.map(r => r.attachmentId), [refs[2].attachmentId, refs[3].attachmentId])
})

test('脏数据不炸：null / 非数组 / 缺 attachmentId / 无 events', () => {
  assert.deepEqual(sessionImageRefs(undefined), [])
  assert.deepEqual(sessionImageRefs({}), [])
  assert.deepEqual(sessionImageRefs(exec(undefined)), [])
  assert.deepEqual(sessionImageRefs(exec([null, 'x', 42])), [])
  assert.deepEqual(sessionImageRefs(exec([{ type: 'x', data: null }])), [])
  assert.deepEqual(sessionImageRefs(exec([{ type: 'x', data: { content: 'not-an-array' } }])), [])
  assert.deepEqual(sessionImageRefs(exec([{ type: 'x', data: { content: [{ type: 'image', attachment: null }] } }])), [])
  assert.deepEqual(sessionImageRefs(exec([{ type: 'x', data: { content: [{ type: 'image', attachment: {} }] } }])), [])
})

test('session getter 抛错时安全退化', () => {
  const hostile = { agent: { session: { get events() { throw new Error('boom') } } } }
  assert.deepEqual(sessionImageRefs(hostile), [])
})

console.log('\n配置归一化:')

test('空配置回落到 ark 预设与其默认能力', () => {
  const cfg = withDefaults({})
  assert.equal(cfg.provider, 'ark')
  assert.equal(cfg.apiKeyEnv, 'ARK_API_KEY')
  assert.ok(cfg.capabilities.length > 0, '应带出预设默认能力')
  assert.equal(cfg.detail, 'auto')
  assert.equal(cfg.thinking, 'default')
})

test('未知供应商回落到默认，未知能力被丢弃', () => {
  const cfg = withDefaults({ provider: 'no-such-vendor', capabilities: ['grounding', '不存在的能力'] })
  assert.equal(cfg.provider, 'ark')
  assert.deepEqual(cfg.capabilities, ['grounding'])
})

test('非法枚举值被纠正', () => {
  const cfg = withDefaults({ detail: 'ultra', thinking: 'maybe', maxTokens: 'x' })
  assert.equal(cfg.detail, 'auto')
  assert.equal(cfg.thinking, 'default')
  assert.equal(cfg.maxTokens, 2048)
})

console.log('\n提示词注入:')

test('段落写明「你自己看不到像素」与图片来源语法', () => {
  const text = buildPromptSection(withDefaults({ provider: 'ark' }))
  assert.match(text, /vision_analyze/u)
  assert.match(text, /cannot see pixels yourself/u)
  assert.match(text, /latest/u)
  assert.match(text, /sha256:/u)
  assert.match(text, /vision_list_images/u)
  assert.match(text, /坐标/u)
})

test('勾选的能力逐条出现，未勾选的不出现', () => {
  const text = buildPromptSection(withDefaults({ provider: 'dashscope', capabilities: ['grounding'] }))
  assert.match(text, /视觉定位/u, '勾了 grounding 就该出现')
  assert.ok(!text.includes('视频理解'), '没勾 video 就不该出现')
  assert.match(text, /bbox_2d/u, '百炼的 grounding 说明应带 bbox_2d 约定')
})

test('切换供应商会改变段落里的模型名与能力说明', () => {
  const ark = buildPromptSection(withDefaults({ provider: 'ark' }))
  const zhipu = buildPromptSection(withDefaults({ provider: 'zhipu', capabilities: ['grounding'] }))
  assert.match(ark, /doubao-seed-1-6-vision/u)
  assert.match(zhipu, /glm-4\.6v/u)
  assert.ok(ark !== zhipu, '不同供应商应产生不同提示词')
})

test('传图纪律三条都写进提示词，且与能力勾选无关', () => {
  // 一条都不勾也必须出现——这是调用方式的地基，不是可选能力
  const text = buildPromptSection(withDefaults({ provider: 'ark', capabilities: [] }))
  // 1. 别起局域网图片服务
  assert.match(text, /不要为了「给模型一个 URL」去起本地或局域网图片服务/u)
  assert.match(text, /127\.0\.0\.1/u)
  assert.match(text, /192\.168/u)
  // 2. 远端设备先取回本地
  assert.match(text, /先取回本地再传本地路径/u)
  // 3. 别自己读 base64
  assert.match(text, /不要自己读图片的 base64/u)
  assert.match(text, /挤占上下文/u)
  // 并给出正确做法
  assert.match(text, /直接把本地路径写进 images/u)
})

console.log(`\n✅ ${passed} 项断言全部通过`)
