// 配置字段一致性守门。
//
// 背景：加一个新配置项需要动三处——Config schema、withDefaults、设置卡片。
// 漏掉卡片那一处时的症状极其隐蔽：字段能显示、能输入、能点保存，**但值被静默丢弃**。
// 用户以为配好了，实际 settings.yaml 里什么都没有，且没有任何报错。
//
// 这个测试读取三处的实际文本做比对，任何一处漏了就红。

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { test } from 'node:test'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

/** 从 Config 的 z.object({...}) 里取字段名。 */
async function schemaFields() {
  const src = await readFile(join(root, 'index.js'), 'utf8')
  const start = src.indexOf('export const Config = z.object({')
  assert.ok(start >= 0, '找不到 Config 定义')
  const body = src.slice(start, src.indexOf('\n})', start))
  const names = []
  for (const line of body.split('\n')) {
    const m = line.match(/^\s{2}([a-zA-Z][a-zA-Z0-9]*):\s*z\./)
    if (m !== null) names.push(m[1])
  }
  return names
}

/** 从 withDefaults 的 return {...} 里取字段名。 */
async function withDefaultsFields() {
  const src = await readFile(join(root, 'index.js'), 'utf8')
  const start = src.indexOf('export function withDefaults(')
  assert.ok(start >= 0, '找不到 withDefaults')
  const ret = src.indexOf('return {', start)
  const body = src.slice(ret, src.indexOf('\n  }', ret))
  const names = []
  for (const line of body.split('\n')) {
    const m = line.match(/^\s{4}([a-zA-Z][a-zA-Z0-9]*):/)
    if (m !== null) names.push(m[1])
  }
  return names
}

/** 从卡片 onSave 提交的对象里取字段名。 */
async function saveFields() {
  const src = await readFile(join(root, 'client.js'), 'utf8')
  const start = src.indexOf('function onSave()')
  assert.ok(start >= 0, '找不到 onSave')
  const call = src.indexOf('props.saveSettings({', start)
  assert.ok(call >= 0, '找不到 saveSettings 调用')
  const body = src.slice(call, src.indexOf('\n        })', call))
  const names = []
  for (const line of body.split('\n')) {
    const m = line.match(/^\s{10}([a-zA-Z][a-zA-Z0-9]*):/)
    if (m !== null) names.push(m[1])
  }
  return names
}

/**
 * 这些 schema 字段不经过卡片的 saveSettings 提交，属于**设计如此**：
 *  - apiKey：走独立的凭据通道（props.saveKey → 凭据域），不写在普通设置里
 *  - maxTokens / maxImageBytes / extraBody / ingestMaxBytes / ingestMaxItems：
 *    卡片里不暴露，只作为高级默认值留在 schema，用户用配置文件改
 * 任何新增的「卡片上能填」的字段都必须进 onSave，不得加进这个白名单。
 */
const NON_CARD_FIELDS = new Set([
  'apiKey',
  'maxTokens',
  'maxImageBytes',
  'extraBody',
  'ingestMaxBytes',
  'ingestMaxItems',
])

await test('卡片保存提交的字段 = Config schema 里「卡片可编辑」的字段（一个都不能少）', async () => {
  const schema = await schemaFields()
  const saved = await saveFields()
  const cardEditable = schema.filter(name => !NON_CARD_FIELDS.has(name))
  const missing = cardEditable.filter(name => !saved.includes(name))
  assert.deepEqual(
    missing,
    [],
    `这些字段在 schema 里有、但卡片保存时没提交，值会被静默丢弃：${missing.join(', ')}`,
  )
})

await test('withDefaults 覆盖了 schema 的每个字段', async () => {
  const schema = await schemaFields()
  const defaults = await withDefaultsFields()
  const missing = schema.filter(name => !defaults.includes(name))
  assert.deepEqual(missing, [], `withDefaults 漏了：${missing.join(', ')}`)
})

await test('schema 字段与 withDefaults 字段一一对应（没有多余项）', async () => {
  const schema = await schemaFields().then(list => list.slice().sort())
  const defaults = await withDefaultsFields().then(list => list.slice().sort())
  // withDefaults 里可能有 schema 之外的派生值，但不该出现 schema 里没有的配置项。
  const extra = defaults.filter(name => !schema.includes(name))
  assert.deepEqual(extra, [], `withDefaults 多出了 schema 没有的字段：${extra.join(', ')}`)
  assert.deepEqual(schema, defaults.filter(n => schema.includes(n)))
})

await test('新增的 OSS / ingest 字段确实在三处都到齐（针对本次回归）', async () => {
  const required = [
    'ingestEnabled', 'ingestTtlHours',
    'ossEnabled', 'ossBucket', 'ossEndpoint', 'ossAccessKeyId',
    'ossAccessKeySecret', 'ossPublicBase', 'ossExpireSeconds',
  ]
  const schema = await schemaFields()
  const defaults = await withDefaultsFields()
  const saved = await saveFields()
  for (const name of required) {
    assert.ok(schema.includes(name), `schema 缺 ${name}`)
    assert.ok(defaults.includes(name), `withDefaults 缺 ${name}`)
    assert.ok(saved.includes(name), `卡片保存缺 ${name} —— 用户填了会被静默丢弃`)
  }
})
