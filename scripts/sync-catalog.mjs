#!/usr/bin/env node
// 把 catalog.js（宿主侧唯一真相源）镜像进 client.js 的 CATALOG 常量。
//   node scripts/sync-catalog.mjs         生成/更新
//   node scripts/sync-catalog.mjs --check 只校验是否已同步（CI / npm run check 用）
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { CAPABILITIES, DEFAULT_PROVIDER, PROVIDERS } from '../catalog.js'

const here = dirname(fileURLToPath(import.meta.url))
const clientPath = join(here, '..', 'client.js')
const START = '/* >>> CATALOG-SYNC-START (generated from catalog.js by scripts/sync-catalog.mjs) */'
const END = '/* <<< CATALOG-SYNC-END */'

const mirror = {
  defaultProvider: DEFAULT_PROVIDER,
  capabilities: CAPABILITIES.map(cap => ({ id: cap.id, label: cap.label, promptHint: cap.promptHint })),
  providers: PROVIDERS.map(provider => ({
    id: provider.id,
    label: provider.label,
    baseUrl: provider.baseUrl,
    model: provider.model,
    keyEnv: provider.keyEnv,
    caps: provider.caps,
    defaultCaps: provider.defaultCaps,
    ...provider.notes === undefined ? {} : { notes: provider.notes },
    docs: provider.docs === undefined ? '' : provider.docs,
  })),
}

const literal = JSON.stringify(mirror, null, 2)
  .split('\n')
  .map((line, index) => (index === 0 ? line : `    ${line}`))
  .join('\n')
const block = `${START}\n    var CATALOG = ${literal}\n    ${END}`

const source = await readFile(clientPath, 'utf8')
const startAt = source.indexOf(START)
const endAt = source.indexOf(END)
if (startAt < 0 || endAt < 0) {
  console.error('sync-catalog: client.js 里找不到 CATALOG 同步标记')
  process.exit(1)
}
const next = source.slice(0, startAt) + block + source.slice(endAt + END.length)

if (process.argv.includes('--check')) {
  if (next !== source) {
    console.error('sync-catalog: client.js 的 CATALOG 与 catalog.js 不一致，请运行 `npm run sync`')
    process.exit(1)
  }
  console.log('sync-catalog: CATALOG 已同步')
} else if (next === source) {
  console.log('sync-catalog: CATALOG 无变化')
} else {
  await writeFile(clientPath, next, 'utf8')
  console.log('sync-catalog: 已更新 client.js 的 CATALOG')
}
