// 离线渲染测试：不开浏览器，把 client.js 的设置卡片渲染成静态 HTML 并断言。
//
//   node tests/client-card.test.cjs
//
// React 不是本插件的依赖（浏览器端由 DSH 平台注入），所以按顺序找：
// 本地 node_modules → DSH profile 的 node_modules。都找不到就跳过（退出码 0）。
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
    } catch (err) {
      // 换下一个解析根
    }
  }
  try {
    return {
      React: require('react'),
      renderToStaticMarkup: require('react-dom/server').renderToStaticMarkup,
      root: '(node resolution)',
    }
  } catch (err) {
    return undefined
  }
}

const found = loadReact()
if (found === undefined) {
  console.log('⏭  跳过客户端渲染测试：本机找不到 react / react-dom')
  process.exit(0)
}
const { React, renderToStaticMarkup } = found
console.log(`react 解析自: ${found.root}`)

// --- 拦截 useState：强制第一处（open）为 true，好让折叠体也参与渲染 ---
let stateIndex = 0
const ReactProxy = Object.assign(Object.create(React), {
  useState(init) {
    const real = React.useState(init)
    if (stateIndex++ === 0) return [true, real[1]]
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
assert.deepStrictEqual(loaded.inject, ['slots', 'settingsScope', 'remote', 'remote.credentials'], 'fiber inject 列表')

// --- mock 运行时 ---
const settings = {
  status: 'ready',
  writable: true,
  revision: 7,
  base: {},
  user: {},
  mode: 'host',
  value: { provider: 'dashscope', model: '', baseUrl: '', apiKeyEnv: 'DASHSCOPE_API_KEY', capabilities: ['grounding', 'ocr'], detail: 'high', thinking: 'default', maxImages: 6, timeoutMs: 120000 },
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
let registered
const ctx = {
  settingsScope: { bind: spec => { assert.strictEqual(spec.namespace, 'vision', '绑定的命名空间'); return scope } },
  remote: {
    credentials: {
      describe(refs) { credentialCalls.push(refs); return Promise.resolve({ ok: true, value: { [refs[0]]: { configured: true, writable: true } } }) },
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
      registered = { options, component }
      return () => {}
    },
  },
}
loaded.apply(ctx)
assert.ok(registered, 'ctx.slots.register 未被调用')
assert.strictEqual(registered.options.name, 'settings.plugin.item', '注册的 slot 名')
assert.strictEqual(registered.options.key, 'vision', '卡片 key')

const face = registered.options.inject()
assert.ok(face.hooks && face.hooks.visionCard, 'hooks.visionCard 缺失')
const store = face.hooks.visionCard

// --- 渲染 ---
function render() {
  stateIndex = 0
  return renderToStaticMarkup(React.createElement(registered.component, {
    useVisionCard: selector => selector(store.getSnapshot()),
    saveSettings: face.saveSettings,
    saveKey: face.saveKey,
    clearKey: face.clearKey,
    refreshCredential: face.refreshCredential,
  }))
}

// 等一拍，让 apply() 里发出的 describe 落地，徽标进入「已配置」
setTimeout(() => {
  const html = render()
  const checks = [
    ['卡片标题', '视觉能力 vision_analyze'],
    ['已配置徽标', '已配置'],
    ['供应商下拉', '<select id="vision-provider"'],
    ['模型输入框', 'id="vision-model"'],
    ['Base URL 输入框', 'id="vision-baseurl"'],
    ['密钥输入框', 'id="vision-api-key"'],
    ['密钥输入框为 password 型', 'type="password"'],
    ['能力分组标题', '特色能力（勾选项会注入 agent 系统提示）'],
    ['细节档位', 'id="vision-detail"'],
    ['深度思考', 'id="vision-thinking"'],
    ['凭据引用名', 'id="vision-key-env"'],
    ['保存按钮', '保存并收起'],
    ['清除按钮', '清除已存 Key'],
    ['当前供应商摘要', 'qwen3-vl-plus'],
    ['凭据引用显示', 'DASHSCOPE_API_KEY'],
  ]
  const failures = []
  for (const [label, needle] of checks) {
    if (!html.includes(needle)) failures.push(`${label} 未出现（找 "${needle}"）`)
  }

  // 供应商下拉必须列全 11 家
  const optionCount = (html.match(/<option /gu) || []).length
  // 11 个供应商 + 3 个 detail + 4 个 thinking = 18
  if (optionCount !== 18) failures.push(`option 总数应为 18，实际 ${optionCount}`)

  // 能力复选框：dashscope 的 caps 数量
  const checkboxCount = (html.match(/type="checkbox"/gu) || []).length
  const checkedCount = (html.match(/type="checkbox" checked=""/gu) || []).length

  console.log('--- 渲染断言 ---')
  console.log(`HTML 长度: ${html.length}`)
  console.log(`能力复选框: ${checkboxCount} 个，已勾选 ${checkedCount} 个（设置里勾了 grounding+ocr）`)
  console.log(`credentials.describe 调用: ${JSON.stringify(credentialCalls)}`)
  if (checkboxCount === 0) failures.push('没有渲染出任何能力复选框')
  if (checkedCount !== 2) failures.push(`应有 2 个已勾选，实际 ${checkedCount}`)

  if (failures.length > 0) {
    console.error('\n❌ 失败项:')
    for (const f of failures) console.error('  - ' + f)
    console.error('\n--- HTML 片段 ---\n' + html.slice(0, 3000))
    process.exit(1)
  }
  console.log('\n✅ 客户端卡片离线渲染全部断言通过')

  // --- 写入路径：保存设置 + 写密钥 ---
  face.saveSettings({ provider: 'zhipu', model: 'glm-4.6v', capabilities: ['grounding', 'thinking'] })
    .then((res) => {
      assert.deepStrictEqual(res, {}, 'saveSettings 应返回 {}')
      assert.deepStrictEqual(writes, [
        ['provider', 'zhipu'],
        ['model', 'glm-4.6v'],
        ['capabilities', ['grounding', 'thinking']],
      ], 'settings 写入序列')
      return face.saveKey('sk-fake-123456')
    })
    .then((res) => {
      assert.deepStrictEqual(res, {}, 'saveKey 应返回 {}')
      const setCall = credentialCalls.find(c => c[0] === 'set')
      assert.ok(setCall, 'credentials.set 未被调用')
      assert.strictEqual(setCall[1], 'DASHSCOPE_API_KEY', '写入的凭据引用名')
      assert.strictEqual(setCall[2], 14, '写入的密钥长度')
      console.log('✅ 保存设置（含数组字段）与写密钥路径通过')
      console.log(`   settings 写入: ${JSON.stringify(writes)}`)
      console.log(`   凭据调用: ${JSON.stringify(credentialCalls)}`)
    })
    .catch((err) => {
      console.error('❌ 写入路径失败: ' + err.message)
      process.exit(1)
    })
}, 50)
