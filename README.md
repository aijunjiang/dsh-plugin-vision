# dsh-plugin-vision

给 DSH 的 agent 装一双眼睛。

主模型是纯文本的时候，会话里的图片对它来说只是一行
`[image omitted because this model accepts text only; attachment sha256:1a2b3c4d]`。
这个插件把那道缺口补上：agent 自己写观察指令，把图片交给在线视觉大模型（VLM）去看，拿回文字结论。

- **多供应商**：统一按 OpenAI 兼容的 `POST {baseUrl}/chat/completions` 调用，内置 11 家预设，也可填自定义 endpoint。
- **能力勾选即提示词**：在设置卡片里勾选该模型的特色能力（检测框 / OCR / 文档图表 / 视频 / GUI / 深度思考 / 多图对比…），
  这些说明会**实时注入 agent 的系统提示**，告诉它「这台模型还能干什么、该怎么提要求」。
- **提示词归 agent**：插件不预置「请描述这张图片」之类的模板。观察什么、要多细、输出什么格式，由 agent 现场撰写。
- **看得见会话里的图**：用户在输入框上传的图片，agent 可以直接用 `latest` 或那串 8 位摘要点名分析。
- **密钥进凭据库**：API Key 存在 `~/.dsh/.credentials.yaml`，界面只显示「已配置 / 未配置」，永不回显字面量。

---

## 安装

### 从包安装（推荐）

```bash
dsh plugin add dsh-plugin-vision
```

### 本地开发热装载

把仓库以包名链接进目标 profile 的 `node_modules`，再在该 profile 的 `cordis.patch.yml` 里插一行：

```powershell
# Windows（web profile 为例）
New-Item -ItemType Junction `
  -Path  "$env:USERPROFILE\.dsh\profiles\web\node_modules\dsh-plugin-vision" `
  -Target "C:\path\to\dsh-plugin-vision"
```

```yaml
# ~/.dsh/profiles/web/cordis.patch.yml
- insert:
    - id: vision-bundle
      name: dsh-plugin-vision
      config:
        provider: ark
        apiKeyEnv: ARK_API_KEY
```

web profile 是 live-reload：保存补丁文件，宿主半（两个工具 + 提示词注入）立刻生效，不用重启。
**设置卡片属于客户端半，需要刷新一次页面；首次安装后如果卡片没出现，重启 `dsh web` 即可。**

> ⚠️ Windows 上改这个 YAML 千万别用 PowerShell 5.1 的 `Get-Content` / `Set-Content -Encoding utf8`：
> 前者按 GBK 解码会毁掉中文注释，后者会写入 BOM，两者都会让整个补丁层解析失败、所有插件一起掉线。
> 用 `[System.IO.File]::ReadAllText/WriteAllText($p, $t, (New-Object System.Text.UTF8Encoding($false)))`。

---

## 配置

设置 → 插件 → **视觉能力 vision_analyze**。

| 项 | 说明 |
| --- | --- |
| 供应商 | 切换即带出该家的默认 endpoint、模型与能力勾选 |
| 模型 ID | 留空 = 用预设模型。**模型 ID 会随厂商迭代变化，过期了就在这里改** |
| Base URL | 留空 = 用预设 endpoint；私有部署 / 代理在这里填 |
| API Key | 写进 DSH 凭据库；留空表示不改动已存密钥 |
| 特色能力 | 勾选项注入 agent 系统提示；不勾就不会告诉 agent 该模型有这个本事 |
| 细节档位 | `auto` / `high`（看小字更准）/ `low`（更快更省） |
| 深度思考 | `default`（不传）/ `auto` / `enabled` / `disabled`，仅对支持的供应商生效 |
| 单次最多图片数 | 默认 6 |
| 超时(ms) | 默认 120000 |
| 凭据引用名 | 密钥在凭据库里的键名，也可直接 export 同名环境变量 |

密钥解析顺序：**设置里的 `apiKey` 字段 → DSH 凭据域（`apiKeyEnv` 指向的引用）→ 同名环境变量**。

### 内置供应商预设

| id | 供应商 | 默认 endpoint | 默认模型 |
| --- | --- | --- | --- |
| `ark` | 火山方舟（豆包 Doubao） | `https://ark.cn-beijing.volces.com/api/v3` | `doubao-seed-1-6-vision-250815` |
| `dashscope` | 阿里百炼（通义千问 Qwen-VL） | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen3-vl-plus` |
| `zhipu` | 智谱 BigModel（GLM-V） | `https://open.bigmodel.cn/api/paas/v4` | `glm-4.6v` |
| `openai` | OpenAI | `https://api.openai.com/v1` | `gpt-4o` |
| `gemini` | Google Gemini（OpenAI 兼容端点） | `https://generativelanguage.googleapis.com/v1beta/openai` | `gemini-2.5-flash` |
| `moonshot` | 月之暗面 Kimi | `https://api.moonshot.cn/v1` | `kimi-k3` |
| `stepfun` | 阶跃星辰 StepFun | `https://api.stepfun.com/v1` | `step-1o-turbo-vision` |
| `siliconflow` | 硅基流动 SiliconFlow | `https://api.siliconflow.cn/v1` | `Qwen/Qwen2.5-VL-72B-Instruct` |
| `openrouter` | OpenRouter（聚合） | `https://openrouter.ai/api/v1` | `qwen/qwen2.5-vl-72b-instruct` |
| `ollama` | 本地 Ollama / vLLM（OpenAI 兼容） | `http://127.0.0.1:11434/v1` | `qwen2.5vl:7b` |
| `custom` | 自定义（任意 OpenAI 兼容服务） | （自己填） | （自己填） |

预设是**起点不是牢笼**：任何一家的 endpoint / 模型都能在卡片里改。模型 ID 更新很快，以厂商文档为准。

---

## agent 怎么用

### `vision_analyze`

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `images` | ✅ | 图片来源数组 |
| `prompt` | ✅ | 观察指令，**由 agent 自己撰写** |
| `system` | | 给 VLM 的角色设定 |
| `model` | | 临时覆盖本次模型 |
| `detail` | | `auto` / `high` / `low` |
| `thinking` | | `auto` / `enabled` / `disabled` |
| `max_tokens` | | 本次回复上限 |

`images` 每一项可以是：

| 写法 | 含义 |
| --- | --- |
| `C:\pic\a.png`、`/home/u/a.jpg` | 本地文件；经 `ctx.fs` 读取，尊重沙箱与远端路由；无扩展名也能按魔数识别 |
| `https://…` | 远程 URL，原样交给 VLM 自己抓 |
| `data:image/png;base64,…` | 直传 |
| `sha256:1a2b3c4d` | 会话附件摘要，**支持前缀**——文本模型占位符里那 8 位就够 |
| `latest` / `latest:3` | 本会话最近上传的 1 张 / 3 张图 |

### `vision_list_images`

无参数。列出当前会话里出现过的全部图片附件（名称、尺寸、类型、摘要），
让 agent 在只看到 `[image omitted …]` 时也知道有哪些图可看、该点名哪一张。

### 坐标纪律

任何涉及位置的问题，都要在 prompt 里**写死输出格式并要求模型回报它处理的图像宽高**，否则坐标无法还原：

```
只输出 JSON：[{"label":"...","bbox_2d":[x1,y1,x2,y2]}]
并在 JSON 前用一行说明你处理的图像像素宽高，以及坐标是绝对像素还是归一化值。
```

各家约定并不一致（已知：Qwen-VL 返回处理后图像的**绝对像素** `bbox_2d`；GLM-V 返回 **0–1000 归一化**
且包在 `<|begin_of_box|> … <|end_of_box|>` 里），所以「让模型自报基准」比「假设某种基准」可靠。

---

## 排错

| 现象 | 原因 / 处理 |
| --- | --- |
| `未配置视觉模型 API Key` | 卡片里保存密钥，或 export `apiKeyEnv` 指定的环境变量 |
| `HTTP 401 AuthenticationError` | 密钥取到了但不被该 endpoint 认可——注意「搜索 API 密钥」和「模型 API 密钥」通常不是同一把 |
| `HTTP 404 / model not found` | 模型 ID 过期或该账号无权限，在卡片里换一个 |
| `按摘要 xxx 没找到附件对象` | 先调 `vision_list_images` 确认摘要；跨会话的图不在当前会话事件里 |
| `字节不是受支持的图片格式` | 只支持 PNG / JPEG / WebP / GIF / BMP |
| 卡片不出现 | 客户端半需要刷新页面；仍无则重启 `dsh web` |
| 所有插件一起消失 | 多半是 profile 的 `cordis.patch.yml` 被写坏（BOM / 编码），见上文警告 |

---

## 开发

```bash
npm run sync    # 用 catalog.js 重新生成 client.js 里的 CATALOG 镜像
npm test        # 宿主逻辑测试 + 卡片离线渲染测试（不开浏览器）
npm run check   # 语法检查 + 校验镜像同步 + 跑全部测试
```

- `catalog.js` —— 供应商与能力清单，**唯一真相源**。加一家供应商只改这里，然后 `npm run sync`。
- `index.js` —— 宿主半：两个工具、配置命名空间、密钥解析、图片解析、动态系统提示段落。
- `client.js` —— 客户端半：设置卡片。客户端 bundle 不允许 import，故 CATALOG 以生成的方式内联。
- `tests/session-images.test.mjs` —— 会话图片枚举（`latest` / 摘要点名的地基）：覆盖宿主
  session-controller 走的全部五条事件路径（`data.content`、`data.message.content`、`data.inserted[]`、
  `assistant/chunk` 的 `block-end`、嵌套 `tool-result`），外加去重、顺序、脏数据与配置归一化、提示词注入。
- `tests/client-card.test.cjs` —— 用 `react-dom/server` 把卡片渲染成静态 HTML，断言控件齐全、
  徽标状态正确、保存设置与写凭据的调用序列无误。

两个测试都会在依赖缺失时自动跳过（退出码 0）：`index.js` 需要 `@deepseek-ai/schemastery`，
卡片测试需要 `react` / `react-dom`（浏览器端由 DSH 平台注入，本地可从 DSH profile 的
`node_modules` 解析）。

### 想在没有真实密钥时联调？

起一个 OpenAI 兼容的假端点，把 `baseUrl` 指过去、`apiKey` 随便填，就能验证请求体与全链路：

```js
// mock.cjs —— 收到什么就落盘什么，然后回一段固定答复
require('node:http').createServer((req, res) => {
  const chunks = []
  req.on('data', c => chunks.push(c))
  req.on('end', () => {
    require('node:fs').writeFileSync('last-request.json', Buffer.concat(chunks).toString())
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ choices: [{ message: { content: 'MOCK OK' }, finish_reason: 'stop' }] }))
  })
}).listen(8791, '127.0.0.1')
```

## License

MIT
