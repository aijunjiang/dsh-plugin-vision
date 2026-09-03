// 执行路径集成测试：起一个本地 OpenAI 兼容假端点，把 vision_analyze 的 execute()
// 完整跑一遍，断言请求体形状与各种响应/错误分支的输出。
//
//   node tests/execute.test.mjs
//
// 不需要任何真实 API Key，不碰浏览器，也不依赖 DSH 运行时。
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let mod
try {
  mod = await import('../index.js')
} catch (error) {
  if (error !== null && typeof error === 'object' && error.code === 'ERR_MODULE_NOT_FOUND') {
    console.log(`⏭  跳过执行路径测试：依赖未安装（${error.message.split('\n')[0]}）`)
    process.exit(0)
  }
  throw error
}
const { apply } = mod

// 1x1 透明 PNG，避免碰文件系统与 ctx.fs
const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

// --- 假端点 ---
let nextResponse = { status: 200, payload: {} }
let lastRequest
const server = http.createServer((req, res) => {
  const chunks = []
  req.on('data', c => chunks.push(c))
  req.on('end', () => {
    lastRequest = {
      url: req.url,
      authorization: req.headers.authorization,
      body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
    }
    res.writeHead(nextResponse.status, { 'Content-Type': 'application/json' })
    res.end(nextResponse.raw === undefined ? JSON.stringify(nextResponse.payload) : nextResponse.raw)
  })
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port
const baseUrl = `http://127.0.0.1:${port}/v1`

/** 用给定配置装载插件，取出 vision_analyze 的定义。 */
function mount(config) {
  const tools = []
  const ctx = {
    get: () => undefined,
    inject: () => {},
    tools: { register: definition => { tools.push(definition) } },
  }
  apply(ctx, { baseUrl, apiKey: 'test-key', ...config })
  const analyze = tools.find(t => t.name === 'vision_analyze')
  assert.ok(analyze, 'vision_analyze 未注册')
  return analyze
}

/** 设定下一次响应为一个正常的 assistant 消息。 */
function reply(message, extra) {
  nextResponse = { status: 200, payload: { choices: [{ finish_reason: 'stop', message, ...extra }] } }
}

let passed = 0
/** 跑一条用例。 */
async function test(title, fn) {
  await fn()
  passed += 1
  console.log(`  ✓ ${title}`)
}

const analyze = mount({ provider: 'ark' })

console.log('请求体:')

await test('端点、鉴权头与基本结构', async () => {
  reply({ content: 'ok' })
  await analyze.execute({ images: [TINY_PNG], prompt: '看看' }, {})
  assert.equal(lastRequest.url, '/v1/chat/completions')
  assert.equal(lastRequest.authorization, 'Bearer test-key')
  assert.equal(lastRequest.body.model, 'doubao-seed-1-6-vision-250815')
  assert.equal(lastRequest.body.stream, false)
  assert.equal(lastRequest.body.messages.length, 1)
  const parts = lastRequest.body.messages[0].content
  assert.equal(parts[0].type, 'image_url')
  assert.equal(parts[0].image_url.url, TINY_PNG)
  assert.equal(parts[1].type, 'text')
  assert.equal(parts[1].text, '看看')
})

await test('system 参数落到 system role', async () => {
  reply({ content: 'ok' })
  await analyze.execute({ images: [TINY_PNG], prompt: 'p', system: '你是质检员' }, {})
  assert.equal(lastRequest.body.messages[0].role, 'system')
  assert.equal(lastRequest.body.messages[0].content, '你是质检员')
  assert.equal(lastRequest.body.messages[1].role, 'user')
})

await test('方舟风格：detail 进 image_url，thinking 是对象', async () => {
  reply({ content: 'ok' })
  await analyze.execute({ images: [TINY_PNG], prompt: 'p', detail: 'high', thinking: 'enabled' }, {})
  assert.equal(lastRequest.body.messages[0].content[0].image_url.detail, 'high')
  assert.deepEqual(lastRequest.body.thinking, { type: 'enabled' })
  assert.equal(lastRequest.body.vl_high_resolution_images, undefined)
})

await test('百炼风格：高分辨率开关 + 布尔 thinking，且不污染 image_url', async () => {
  const qwen = mount({ provider: 'dashscope' })
  reply({ content: 'ok' })
  await qwen.execute({ images: [TINY_PNG], prompt: 'p', detail: 'high', thinking: 'enabled' }, {})
  assert.equal(lastRequest.body.model, 'qwen3-vl-plus')
  assert.equal(lastRequest.body.vl_high_resolution_images, true)
  assert.equal(lastRequest.body.enable_thinking, true)
  assert.equal(lastRequest.body.messages[0].content[0].image_url.detail, undefined)
  assert.equal(lastRequest.body.thinking, undefined)
})

await test('OpenAI 风格：不发任何 thinking 字段', async () => {
  const oai = mount({ provider: 'openai' })
  reply({ content: 'ok' })
  await oai.execute({ images: [TINY_PNG], prompt: 'p', thinking: 'enabled' }, {})
  assert.equal(lastRequest.body.thinking, undefined)
  assert.equal(lastRequest.body.enable_thinking, undefined)
})

await test('多图时逐张插入「第 N 张」标注', async () => {
  reply({ content: 'ok' })
  await analyze.execute({ images: [TINY_PNG, TINY_PNG], prompt: 'p' }, {})
  const parts = lastRequest.body.messages[0].content
  assert.match(parts[0].text, /^第 1 张/u)
  assert.equal(parts[1].type, 'image_url')
  assert.match(parts[2].text, /^第 2 张/u)
  assert.equal(parts[3].type, 'image_url')
  assert.equal(parts[4].text, 'p')
})

await test('模型与 max_tokens 可被单次调用覆盖', async () => {
  reply({ content: 'ok' })
  await analyze.execute({ images: [TINY_PNG], prompt: 'p', model: 'other-model', max_tokens: 77 }, {})
  assert.equal(lastRequest.body.model, 'other-model')
  assert.equal(lastRequest.body.max_tokens, 77)
})

await test('extraBody 合并进请求体', async () => {
  const custom = mount({ provider: 'ark', extraBody: '{"top_p":0.1,"seed":42}' })
  reply({ content: 'ok' })
  await custom.execute({ images: [TINY_PNG], prompt: 'p' }, {})
  assert.equal(lastRequest.body.top_p, 0.1)
  assert.equal(lastRequest.body.seed, 42)
})

console.log('\n响应分支:')

await test('正常回复带上供应商、图片清单与用量', async () => {
  nextResponse = {
    status: 200,
    payload: {
      choices: [{ finish_reason: 'stop', message: { content: '我看到一个红色圆形。' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    },
  }
  const out = await analyze.execute({ images: [TINY_PNG], prompt: 'p' }, {})
  assert.match(out, /【视觉模型观察结果】/u)
  assert.match(out, /火山方舟/u)
  assert.match(out, /我看到一个红色圆形。/u)
  assert.match(out, /tokens 输入 10 \/ 输出 5 \/ 合计 15/u)
})

await test('content 是分片数组时按段拼接', async () => {
  reply({ content: [{ type: 'text', text: '第一段。' }, { type: 'text', text: '第二段。' }] })
  const out = await analyze.execute({ images: [TINY_PNG], prompt: 'p' }, {})
  assert.match(out, /第一段。\n第二段。/u)
})

await test('思考摘要过长时截断', async () => {
  reply({ content: 'ok', reasoning_content: 'x'.repeat(900) })
  const out = await analyze.execute({ images: [TINY_PNG], prompt: 'p' }, {})
  assert.match(out, /模型思考摘要/u)
  assert.match(out, /\[已截断\]/u)
})

await test('正文被 max_tokens 截断时给出提醒', async () => {
  nextResponse = { status: 200, payload: { choices: [{ finish_reason: 'length', message: { content: '左侧是一个红色圆' } }] } }
  const out = await analyze.execute({ images: [TINY_PNG], prompt: 'p' }, {})
  assert.match(out, /左侧是一个红色圆/u)
  assert.match(out, /因 max_tokens 上限被截断/u)
})

await test('只有思考内容、正文为空：交出思考内容并给出处方', async () => {
  nextResponse = {
    status: 200,
    payload: { choices: [{ finish_reason: 'length', message: { content: '', reasoning_content: '我先观察左上角……' } }] },
  }
  const out = await analyze.execute({ images: [TINY_PNG], prompt: 'p' }, {})
  assert.match(out, /只产出了思考内容/u)
  assert.match(out, /max_tokens 用尽/u)
  assert.match(out, /我先观察左上角……/u)
  assert.ok(!out.includes('原始响应片段'), '不该再退化成裸响应转储')
})

await test('模型拒答时如实转达', async () => {
  reply({ content: '', refusal: '该图片涉及敏感内容。' })
  const out = await analyze.execute({ images: [TINY_PNG], prompt: 'p' }, {})
  assert.match(out, /视觉模型拒绝回答：该图片涉及敏感内容。/u)
})

await test('彻底空响应才转储原始片段', async () => {
  nextResponse = { status: 200, payload: { choices: [{ finish_reason: 'content_filter', message: { content: '' } }] } }
  const out = await analyze.execute({ images: [TINY_PNG], prompt: 'p' }, {})
  assert.match(out, /没有返回正文/u)
  assert.match(out, /content_filter/u)
})

console.log('\n错误分支:')

await test('HTTP 500 带出状态码、供应商与响应片段', async () => {
  nextResponse = { status: 500, payload: { error: { message: 'upstream unavailable' } } }
  const out = await analyze.execute({ images: [TINY_PNG], prompt: 'p' }, {})
  assert.match(out, /HTTP 500/u)
  assert.match(out, /火山方舟/u)
  assert.match(out, /upstream unavailable/u)
})

await test('200 但不是 JSON', async () => {
  nextResponse = { status: 200, raw: '<html>502 Bad Gateway</html>' }
  const out = await analyze.execute({ images: [TINY_PNG], prompt: 'p' }, {})
  assert.match(out, /无法解析的内容/u)
  assert.match(out, /502 Bad Gateway/u)
})

await test('缺少 API Key 时明确指路', async () => {
  const noKey = mount({ provider: 'ark', apiKey: '', apiKeyEnv: 'DEFINITELY_NOT_SET_12345' })
  const out = await noKey.execute({ images: [TINY_PNG], prompt: 'p' }, {})
  assert.match(out, /未配置视觉模型 API Key/u)
  assert.match(out, /DEFINITELY_NOT_SET_12345/u)
})

await test('images 为空 / prompt 为空 / 超过张数上限', async () => {
  assert.match(await analyze.execute({ images: [], prompt: 'p' }, {}), /至少需要 1 项/u)
  assert.match(await analyze.execute({ images: [TINY_PNG], prompt: '   ' }, {}), /prompt 不能为空/u)
  const few = mount({ provider: 'ark', maxImages: 2 })
  assert.match(await few.execute({ images: [TINY_PNG, TINY_PNG, TINY_PNG], prompt: 'p' }, {}), /单次最多 2 张/u)
})

await test('非法 extraBody 在发请求前就拦下', async () => {
  const bad = mount({ provider: 'ark', extraBody: 'not json' })
  const out = await bad.execute({ images: [TINY_PNG], prompt: 'p' }, {})
  assert.match(out, /附加请求体.*不是合法 JSON/u)
})

await test('自定义供应商未填 baseUrl / 模型时给出指引', async () => {
  const tools = []
  apply({ get: () => undefined, inject: () => {}, tools: { register: d => tools.push(d) } }, { provider: 'custom', apiKey: 'k' })
  const custom = tools.find(t => t.name === 'vision_analyze')
  assert.match(await custom.execute({ images: [TINY_PNG], prompt: 'p' }, {}), /未配置 baseUrl/u)
})

await test('调用方 abort 时不抛异常，返回可读文案', async () => {
  const controller = new AbortController()
  controller.abort()
  reply({ content: 'ok' })
  const out = await analyze.execute({ images: [TINY_PNG], prompt: 'p' }, { signal: controller.signal })
  assert.match(out, /超时或被中止|HTTP 请求失败/u)
})

console.log('传图纪律:')

// 公网 endpoint 用 RFC 2606 保留域 .invalid：判定上算公网（触发拦截逻辑），
// 但永远解析不出去，测试不会真的打网络。
const PUBLIC_ENDPOINT = 'https://vision.invalid/v1'

await test('公网模型 + 私有地址 URL 当场拦下并指路', async () => {
  // endpoint 在公网，图片 URL 却指向内网：模型回不来，必须在发请求前拒绝
  const remote = mount({ provider: 'ark', baseUrl: PUBLIC_ENDPOINT })
  for (const url of [
    'http://127.0.0.1:8080/a.png',
    'http://localhost:9000/a.png',
    'http://192.168.1.7/a.png',
    'http://10.0.0.3:8000/a.png',
    'http://172.20.1.9/a.png',
    'http://169.254.10.1/a.png',
    'http://my-nas.local/a.png',
  ]) {
    const out = await remote.execute({ images: [url], prompt: 'p' }, {})
    assert.match(out, /指向私有地址/u, `应拦下 ${url}`)
    assert.match(out, /不要为了「给模型一个 URL」去起本地或局域网图片服务/u, `应给出替代做法 ${url}`)
    assert.match(out, /先取回本地/u, `应说明远端设备怎么办 ${url}`)
  }
  // 172.15 / 172.32 在私有段之外，不该误伤
  const ok = await remote.execute({ images: ['http://172.15.0.1/a.png'], prompt: 'p' }, {})
  assert.doesNotMatch(ok, /指向私有地址/u, '172.15 不是私有段')
})

await test('公网 URL 放行（拦截器不误伤正常链接）', async () => {
  const remote = mount({ provider: 'ark', baseUrl: PUBLIC_ENDPOINT })
  const out = await remote.execute({ images: ['https://example.com/a.png'], prompt: 'p' }, {})
  // 过了拦截这一关就会去发请求，而 .invalid 解析不出去 —— 报的是网络错误而非私有地址
  assert.doesNotMatch(out, /指向私有地址/u)
  assert.match(out, /HTTP 请求失败|超时或被中止/u)
})

await test('本机模型时私有地址合法（不误伤 Ollama / vLLM）', async () => {
  // baseUrl 本身就是 127.0.0.1，说明模型与图片在同一张网里
  reply({ content: 'ok' })
  const out = await analyze.execute({ images: ['http://192.168.1.7/a.png'], prompt: 'p' }, {})
  assert.doesNotMatch(out, /指向私有地址/u)
  assert.equal(lastRequest.body.messages[0].content[0].image_url.url, 'http://192.168.1.7/a.png')
})

await test('调用方硬塞大段 base64 时，结果里回敬一条纠正', async () => {
  const bulky = `data:image/png;base64,${'A'.repeat(30000)}`
  reply({ content: 'ok' })
  const out = await analyze.execute({ images: [bulky], prompt: 'p' }, {})
  assert.match(out, /base64 data URL 是你直接拼进参数的/u)
  assert.match(out, /JSON 图包/u, '应指路到 JSON 图包')
  // 小图不该触发唠叨
  reply({ content: 'ok' })
  const quiet = await analyze.execute({ images: [TINY_PNG], prompt: 'p' }, {})
  assert.doesNotMatch(quiet, /直接拼进参数/u)
})

console.log('JSON 图包:')

const B64 = TINY_PNG.replace(/^data:image\/png;base64,/u, '')
const tmp = await mkdtemp(join(tmpdir(), 'vision-bundle-'))
/** 在临时目录写一个图包，返回路径。 */
async function bundle(name, payload) {
  const file = join(tmp, name)
  await writeFile(file, typeof payload === 'string' ? payload : JSON.stringify(payload), 'utf8')
  return file
}

await test('标准格式 {"images":[{data,name}]} 多张展开，且不带 base64 进上下文', async () => {
  const file = await bundle('std.json', {
    images: [
      { data: B64, mediaType: 'image/png', name: '首帧' },
      { data: B64, name: '尾帧' },
    ],
  })
  reply({ content: 'ok' })
  const out = await analyze.execute({ images: [`json:${file}`], prompt: 'p' }, {})
  const parts = lastRequest.body.messages[0].content
  const images = parts.filter(p => p.type === 'image_url')
  assert.equal(images.length, 2, '两条应展开成两张图')
  assert.equal(images[0].image_url.url, TINY_PNG, '解码后应还原成同一张图')
  assert.match(out, /共 2 张图/u)
  assert.match(out, /首帧/u, '标签应带上条目名，便于模型指代')
  assert.match(out, /尾帧/u)
})

await test('宽松解析：顶层数组 / 纯 base64 字符串 / 单对象 / data URL / URL-safe / 带换行', async () => {
  const shapes = {
    'arr.json': [{ data: B64 }],
    'bare.json': [B64],
    'single.json': { data: B64 },
    'dataurl.json': { images: [{ data: TINY_PNG }] },
    'wrapped.json': { images: [{ data: `${B64.slice(0, 20)}\n${B64.slice(20)}` }] },
    'items.json': { items: [{ b64: B64 }] },
    'urlsafe.json': { images: [{ data: B64.replace(/\+/gu, '-').replace(/\//gu, '_') }] },
  }
  for (const [name, payload] of Object.entries(shapes)) {
    const file = await bundle(name, payload)
    reply({ content: 'ok' })
    await analyze.execute({ images: [`json:${file}`], prompt: 'p' }, {})
    const images = lastRequest.body.messages[0].content.filter(p => p.type === 'image_url')
    assert.equal(images.length, 1, `${name} 应解析出 1 张`)
    assert.equal(images[0].image_url.url, TINY_PNG, `${name} 解码结果应一致`)
  }
})

await test('不带 json: 前缀的 .json 路径也走图包解析', async () => {
  const file = await bundle('implicit.json', { images: [{ data: B64 }] })
  reply({ content: 'ok' })
  const out = await analyze.execute({ images: [file], prompt: 'p' }, {})
  assert.match(out, /JSON 图包/u)
  assert.doesNotMatch(out, /不是受支持的图片格式/u)
})

await test('选择子 #2 与 #2-3 精确取图', async () => {
  const file = await bundle('many.json', {
    images: [{ data: B64, name: 'a' }, { data: B64, name: 'b' }, { data: B64, name: 'c' }, { data: B64, name: 'd' }],
  })
  reply({ content: 'ok' })
  const one = await analyze.execute({ images: [`json:${file}#2`], prompt: 'p' }, {})
  assert.match(one, /共 1 张图/u)
  assert.match(one, /"b"/u, '#2 应取第二条')
  reply({ content: 'ok' })
  const range = await analyze.execute({ images: [`json:${file}#2-3`], prompt: 'p' }, {})
  assert.match(range, /共 2 张图/u)
  assert.match(range, /"b"/u)
  assert.match(range, /"c"/u)
  assert.doesNotMatch(range, /"d"/u)
})

await test('图包内 path 条目相对 JSON 所在目录解析', async () => {
  await writeFile(join(tmp, 'pic.png'), Buffer.from(B64, 'base64'))
  const file = await bundle('rel.json', { images: [{ path: 'pic.png', name: '相对图' }] })
  reply({ content: 'ok' })
  const out = await analyze.execute({ images: [`json:${file}`], prompt: 'p' }, {})
  assert.match(out, /相对图/u)
  const images = lastRequest.body.messages[0].content.filter(p => p.type === 'image_url')
  assert.equal(images[0].image_url.url, TINY_PNG)
})

await test('图包错误逐条说清怎么改', async () => {
  const cases = [
    ['broken.json', '{ not json', /不是合法 JSON/u],
    ['empty.json', { images: [] }, /没有任何图片条目/u],
    ['nokey.json', { foo: 1 }, /找不到图片列表/u],
    ['nodata.json', { images: [{ name: 'x' }] }, /找不到图片数据/u],
    ['notb64.json', { images: [{ data: '不是base64!!' }] }, /不是合法 base64/u],
    ['notimg.json', { images: [{ data: Buffer.from('hello world').toString('base64') }] }, /不是受支持的图片格式/u],
    ['oob.json', { images: [{ data: B64 }] }, /超出范围/u, '#9'],
    ['nest.json', { images: [{ path: 'inner.json' }] }, /不能再引用另一个 JSON 图包/u],
  ]
  for (const [name, payload, pattern, suffix] of cases) {
    const file = await bundle(name, payload)
    const out = await analyze.execute({ images: [`json:${file}${suffix || ''}`], prompt: 'p' }, {})
    assert.match(out, pattern, `${name} 的报错应可操作`)
  }
  const missing = await analyze.execute({ images: ['json:/definitely/not/here.json'], prompt: 'p' }, {})
  assert.match(missing, /读不到 JSON 图包/u)
})

await test('图包同样受单次张数上限约束', async () => {
  const file = await bundle('toomany.json', { images: Array.from({ length: 5 }, () => ({ data: B64 })) })
  const few = mount({ provider: 'ark', maxImages: 3 })
  const out = await few.execute({ images: [`json:${file}`], prompt: 'p' }, {})
  assert.match(out, /超过单次 3 张上限/u)
})

await rm(tmp, { recursive: true, force: true })

server.close()
console.log(`\n✅ ${passed} 项断言全部通过`)
