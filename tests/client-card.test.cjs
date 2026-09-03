// 离线渲染测试：不开浏览器，把 client.js 的设置卡片渲染成静态 HTML 并断言。
//
//   node tests/client-card.test.cjs
//
// 覆盖：locale 词典注册与中英键集对齐、两种语言下的卡片渲染、
// 官方卡片结构（li/header/headText/field）、能力芯片、高级选项默认收起、
// 保存设置与写凭据的调用序列。
//
// React 不是本插件依赖（浏览器端由 DSH 平台注入），按顺序找解析根；
// 找不到就跳过（退出码 0）。
const path = require('node:path')
const assert = require('node:assert')
const os = require('node:os')

/** 依次尝试若干解析根，找到 react / react-dom。 */
function loadReact() {
  const dshHome = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  const roots = [
    path.join(__dirname, '..', 'node_modules'),
    path.join(dshHome, 'profiles', 'node_modules'),
    path.join(dshHome, 'node_modules'),
  ]
  for (const root of roots) {
    try {
      return {
        React: require(path.join(root, 'react')),
        renderToStaticMarkup: require(path.join(root, 'react-dom', 'server.js')).renderToStaticMarkup,
        root,
      }
    } catch (err) { /* 换下一个解析根 */ }
  }
  try {
    return {
      React: require('react'),
      renderToStaticMarkup: require('react-dom/server').renderToStaticMarkup,
      root: '(node resolution)',
    }
  } catch (err) { return undefined }
}

const found = loadReact()
if (found === undefined) {
  console.log('⏭  跳过客户端渲染测试：本机找不到 react / react-dom')
  process.exit(0)
}
const { React, renderToStaticMarkup } = found
console.log(`react 解析自: ${found.root}`)

// 拦截 useState：第 0 处（open）强制 true 好让折叠体参与渲染；
// 第 1 处（advanced）保持默认 false，以此验证高级选项默认收起。
let stateIndex = 0
let forceAdvanced = false
const ReactProxy = Object.assign(Object.create(React), {
  useState(init) {
    const real = React.useState(init)
    const index = stateIndex++
    if (index === 0) return [true, real[1]]
    if (index === 1 && forceAdvanced) return [true, real[1]]
    return real
  },
})

// --- 装载 client.js ---
let loaded
global.window = {
  __ModuleLoader__: {
    load({ id, factory }) {
      assert.strictEqual(id, 'dsh-plugin-vision', 'module id')
      loaded = factory(name => {
        if (name === 'react') return ReactProxy
        throw new Error(`harness: 客户端 bundle 不应 require("${name}")`)
      })
    },
  },
}
require(path.join(__dirname, '..', 'client.js'))
assert.ok(loaded, 'factory 未执行')
assert.deepStrictEqual(
  loaded.inject,
  ['slots', 'settingsScope', 'remote', 'remote.credentials'],
  'fiber inject 列表',
)

// --- mock 运行时 ---
const settings = {
  status: 'ready', writable: true, revision: 7, base: {}, user: {}, mode: 'host',
  value: {
    provider: 'dashscope', model: '', baseUrl: '', apiKeyEnv: 'DASHSCOPE_API_KEY',
    capabilities: ['grounding', 'ocr'], detail: 'high', thinking: 'default',
    maxImages: 6, timeoutMs: 120000,
  },
}
const writes = []
const credentialCalls = []
const scope = {
  getSnapshot: () => settings,
  subscribe: () => () => {},
  set: (field, value) => { writes.push([field, value]); return Promise.resolve() },
  unset: () => Promise.resolve(),
  mutate: () => Promise.resolve(),
}

const dicts = {}
let localeNs
let registration
let card
const ctx = {
  get: (name) => (name === 'locale'
    ? {
      register(ns, table) {
        localeNs = ns
        Object.assign(dicts, table)
        return () => {}
      },
    }
    : undefined),
  effect: (fn) => fn(),
  settingsScope: {
    bind: (spec) => {
      assert.strictEqual(spec.namespace, 'vision', '绑定的命名空间')
      return scope
    },
  },
  remote: {
    credentials: {
      describe(refs) {
        credentialCalls.push(refs)
        return Promise.resolve({ ok: true, value: { [refs[0]]: { configured: true, writable: true } } })
      },
      set(ref, value) { credentialCalls.push(['set', ref, value.length]); return Promise.resolve() },
      unset(ref) { credentialCalls.push(['unset', ref]); return Promise.resolve() },
    },
  },
  slots: {
    inject(key, gen) {
      assert.strictEqual(key, 'settings.plugin.item', 'slot 名')
      const it = gen()
      let step = it.next()
      while (!step.done) step = it.next()
    },
    register(options, component) {
      registration = options
      card = component
      return () => {}
    },
  },
}
loaded.apply(ctx)

assert.ok(registration, 'ctx.slots.register 未被调用')
assert.strictEqual(registration.name, 'settings.plugin.item', '注册的 slot 名')
assert.strictEqual(registration.key, 'vision', '卡片 key')

// --- 多语种契约 ---
assert.strictEqual(localeNs, 'plugin.vision', 'locale 命名空间')
assert.strictEqual(registration.locale, 'plugin.vision', '槽位注册须声明 locale，框架才会注入 t')
assert.ok(dicts.zh && dicts.en, 'zh / en 词典都要注册')
const zhKeys = Object.keys(dicts.zh).sort()
const enKeys = Object.keys(dicts.en).sort()
assert.deepStrictEqual(zhKeys, enKeys, '中英词典键集必须完全一致（缺键会在界面上露出原始 key）')
for (const key of zhKeys) {
  assert.ok(typeof dicts.zh[key] === 'string' && dicts.zh[key] !== '', `zh 词条 "${key}" 为空`)
  assert.ok(typeof dicts.en[key] === 'string' && dicts.en[key] !== '', `en 词条 "${key}" 为空`)
}
assert.strictEqual(dicts.zh.langTag, 'zh', 'zh 语言探针')
assert.strictEqual(dicts.en.langTag, 'en', 'en 语言探针')
console.log(`✅ 多语种词典：${zhKeys.length} 个键，中英完全对齐`)

const face = registration.inject()
assert.ok(face.hooks && face.hooks.visionCard, 'hooks.visionCard 缺失')
const store = face.hooks.visionCard

/** 按给定词典合成框架那样的 t 函数。 */
function translatorFor(locale) {
  return function (key, params) {
    const text = dicts[locale][key]
    if (text === undefined) return key
    if (!params) return text
    return text.replace(/\{(\w+)\}/gu, (match, name) =>
      Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match)
  }
}

/** 渲染卡片；t 省略时走插件自带的浏览器语言兜底。 */
function render(t, advanced) {
  stateIndex = 0
  forceAdvanced = advanced === true
  const props = {
    useVisionCard: selector => selector(store.getSnapshot()),
    saveSettings: face.saveSettings,
    saveKey: face.saveKey,
    clearKey: face.clearKey,
    refreshCredential: face.refreshCredential,
  }
  if (t !== undefined) props.t = t
  return renderToStaticMarkup(React.createElement(card, props))
}

const failures = []
/** 断言 HTML 里必须出现某片段。 */
function must(html, tag, label, needle) {
  if (!html.includes(needle)) failures.push(`[${tag}] ${label} 未出现（找 "${needle}"）`)
}
/** 断言 HTML 里不得出现某片段。 */
function mustNot(html, tag, label, needle) {
  if (html.includes(needle)) failures.push(`[${tag}] ${label} 不该出现（找到 "${needle}"）`)
}

// 等一拍，让 apply() 发出的 describe 落地，密钥徽标进入「已配置」
setTimeout(() => {
  const zh = render(translatorFor('zh'))

  console.log('\n--- 结构（对齐官方 PluginCard）---')
  must(zh, 'struct', '外层 li', '<li style="list-style:none')
  must(zh, 'struct', '12px 圆角', 'border-radius:12px')
  must(zh, 'struct', '头部为 button', '<button type="button"')
  must(zh, 'struct', '头部 aria-expanded', 'aria-expanded="true"')
  must(zh, 'struct', '标题字号 15px/600', 'font-size:15px;font-weight:600')
  must(zh, 'struct', '描述行 13px/tertiary', 'font-size:13px;line-height:1.5;color:var(--dsw-alias-label-tertiary')
  must(zh, 'struct', '字段 12px 上下内距', 'padding:12px 0')
  must(zh, 'struct', '输入框 34px 高', 'height:34px')
  must(zh, 'struct', '页脚右对齐', 'justify-content:flex-end')

  console.log('--- 中文 ---')
  must(zh, 'zh', '标题', '>视觉能力<')
  must(zh, 'zh', '描述', '把图片交给在线视觉模型，让纯文本 agent 也能看图')
  must(zh, 'zh', '供应商', 'id="vision-provider"')
  must(zh, 'zh', '模型', 'id="vision-model"')
  must(zh, 'zh', 'Base URL', 'id="vision-baseurl"')
  must(zh, 'zh', '密钥输入框', 'id="vision-api-key"')
  must(zh, 'zh', '密钥为 password 型', 'type="password"')
  must(zh, 'zh', '已配置徽标', '>已配置<')
  must(zh, 'zh', '能力区', '>特色能力<')
  must(zh, 'zh', '展开高级选项', '>显示高级选项<')
  must(zh, 'zh', '保存', '>保存<')
  must(zh, 'zh', '放弃更改', '>放弃更改<')
  must(zh, 'zh', '清除密钥', '>清除已存密钥<')
  must(zh, 'zh', '凭据引用名出现在说明里', 'DASHSCOPE_API_KEY')
  must(zh, 'zh', '中文供应商名', '阿里百炼（通义千问 Qwen-VL）')
  must(zh, 'zh', '中文能力名', '高精度文字提取（OCR）')

  const options = (zh.match(/<option /gu) || []).length
  if (options !== 11) failures.push(`供应商下拉应为 11 项，实际 ${options}`)
  const boxes = (zh.match(/type="checkbox"/gu) || []).length
  const checked = (zh.match(/type="checkbox" checked=""/gu) || []).length
  if (boxes !== 8) failures.push(`dashscope 的能力芯片应为 8 个，实际 ${boxes}`)
  if (checked !== 2) failures.push(`已勾选应为 2 个（grounding+ocr），实际 ${checked}`)

  console.log('--- 高级选项默认收起 ---')
  for (const id of ['vision-detail', 'vision-thinking', 'vision-max-images', 'vision-timeout', 'vision-key-env']) {
    mustNot(zh, 'collapsed', `高级字段 ${id}`, `id="${id}"`)
  }

  const zhAdvanced = render(translatorFor('zh'), true)
  console.log('--- 展开后高级选项到齐 ---')
  for (const id of ['vision-detail', 'vision-thinking', 'vision-max-images', 'vision-timeout', 'vision-key-env']) {
    must(zhAdvanced, 'advanced', `高级字段 ${id}`, `id="${id}"`)
  }
  must(zhAdvanced, 'advanced', '收起入口', '>收起高级选项<')
  must(zhAdvanced, 'advanced', '接口文档', 'help.aliyun.com')

  console.log('--- 英文 ---')
  const en = render(translatorFor('en'))
  must(en, 'en', '标题', '>Vision<')
  must(en, 'en', '描述', 'Send images to an online vision model')
  must(en, 'en', '供应商标签', '>Provider<')
  must(en, 'en', '模型标签', '>Model ID<')
  must(en, 'en', '密钥标签', '>API key<')
  must(en, 'en', '能力标签', '>Capabilities<')
  must(en, 'en', '已配置徽标', '>Configured<')
  must(en, 'en', '保存', '>Save<')
  must(en, 'en', '放弃', '>Discard<')
  must(en, 'en', '清除密钥', '>Clear stored key<')
  must(en, 'en', '高级入口', '>Show advanced options<')
  must(en, 'en', '英文供应商名', 'Alibaba Model Studio (Qwen-VL)')
  must(en, 'en', '英文能力名', 'High-precision OCR / text extraction')
  mustNot(en, 'en', '中文标题', '视觉能力')
  mustNot(en, 'en', '中文供应商名', '阿里百炼')

  console.log('--- 无 locale 服务时的兜底 ---')
  const fallback = render(undefined)
  if (!fallback.includes('>视觉能力<') && !fallback.includes('>Vision<')) {
    failures.push('[fallback] 没有 t 时应按浏览器语言渲染出中文或英文标题')
  }

  if (failures.length > 0) {
    console.error('\n❌ 失败项:')
    for (const f of failures) console.error('  - ' + f)
    console.error('\n--- 中文 HTML 片段 ---\n' + zh.slice(0, 2500))
    process.exit(1)
  }
  console.log(`\n✅ 渲染断言全部通过（中文 ${zh.length} 字符 / 英文 ${en.length} 字符）`)

  // --- 写入路径 ---
  face.saveSettings({ provider: 'zhipu', model: 'glm-4.6v', capabilities: ['grounding', 'thinking'] })
    .then((res) => {
      assert.deepStrictEqual(res, {}, 'saveSettings 应返回 {}')
      assert.deepStrictEqual(writes, [
        ['provider', 'zhipu'],
        ['model', 'glm-4.6v'],
        ['capabilities', ['grounding', 'thinking']],
      ], 'settings 写入序列（含数组字段）')
      return face.saveKey('sk-fake-123456')
    })
    .then((res) => {
      assert.deepStrictEqual(res, {}, 'saveKey 应返回 {}')
      const setCall = credentialCalls.find(c => c[0] === 'set')
      assert.ok(setCall, 'credentials.set 未被调用')
      assert.strictEqual(setCall[1], 'DASHSCOPE_API_KEY', '写入的凭据引用名')
      assert.strictEqual(setCall[2], 14, '写入的密钥长度')
      console.log('✅ 保存设置（含数组字段）与写密钥路径通过')
    })
    .catch((err) => {
      console.error('❌ 写入路径失败: ' + err.message)
      process.exit(1)
    })
}, 50)
