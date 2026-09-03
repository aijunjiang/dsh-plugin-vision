# dsh-plugin-vision

[English](./README.md) · **简体中文**

给 DSH 的 agent 装一双眼睛。

主模型是纯文本的时候，会话里的图片对它来说只是一行
`[image omitted because this model accepts text only; attachment sha256:1a2b3c4d]`。
这个插件把那道缺口补上：agent 自己写观察指令，把图片交给在线视觉大模型（VLM）去看，拿回文字结论。

- **多供应商**：统一按 OpenAI 兼容的 `POST {baseUrl}/chat/completions` 调用，内置 11 家预设，
  也可填任意自定义 endpoint。
- **能力勾选即提示词**：在设置卡片里勾选该模型的特色能力（检测框 / OCR / 文档图表 / 视频 / GUI /
  深度思考 / 多图对比…），这些说明会**实时注入 agent 的系统提示**，告诉它「这台模型还能干什么、
  该怎么提要求」。
- **提示词归 agent**：插件不预置「请描述这张图片」之类的模板。观察什么、要多细、输出什么格式，
  由 agent 现场撰写。
- **看得见会话里的图**：用户在输入框上传的图片，agent 可以直接用 `latest` 或占位符里那串 8 位摘要点名分析。
- **密钥进凭据库**：API Key 存在 `~/.dsh/.credentials.yaml`，界面只显示「已配置 / 未配置」，永不回显字面量。
- **界面双语**：设置卡片跟随 DSH 自身的语言设置切换（中文 / English）。

---

## 安装

### 从包安装

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

web profile 是 live-reload：保存补丁文件，**配置改动**（供应商、模型、baseUrl…）立刻生效，不用重启。
但 **插件源码（`index.js` / `catalog.js`）的改动不会热更**——模块被 ESM 缓存住了，改完要重启 `dsh web`。
**设置卡片属于客户端半，需要刷新一次页面；首次安装后如果卡片没出现，重启 `dsh web` 即可。**

> ⚠️ Windows 上改这个 YAML 千万别用 PowerShell 5.1 的 `Get-Content` / `Set-Content -Encoding utf8`：
> 前者按 GBK 解码会毁掉中文注释，后者会写入 BOM，两者都会让整个补丁层解析失败、所有插件一起掉线。
> 用 `[System.IO.File]::ReadAllText/WriteAllText($p, $t, (New-Object System.Text.UTF8Encoding($false)))`。

---

## 配置

设置 → 插件 → **视觉能力**。

| 项 | 说明 |
| --- | --- |
| 供应商 | 切换即带出该家的默认 endpoint、模型与能力勾选 |
| 模型 ID | 留空 = 用预设模型。**模型 ID 会随厂商迭代变化，过期了就在这里改** |
| Base URL | 留空 = 用预设 endpoint；私有部署 / 代理在这里填 |
| API Key | 写进 DSH 凭据库；留空表示不改动已存密钥 |
| 特色能力 | 勾选项注入 agent 系统提示；不勾就不会告诉 agent 该模型有这个本事 |
| *高级* → 细节档位 | `auto` / `high`（看小字更准）/ `low`（更快更省） |
| *高级* → 深度思考 | `不传` / `auto` / `enabled` / `disabled`，仅对支持的供应商生效 |
| *高级* → 单次最多图片数 | 默认 6 |
| *高级* → 超时（毫秒） | 默认 120000 |
| *高级* → 凭据引用名 | 密钥在凭据库里的键名，也可直接 export 同名环境变量 |

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
| `json:/路径/bundle.json` | **JSON 图包**：base64 存在文件里，一次可带多张，见下节 |
| `sha256:1a2b3c4d` | 会话附件摘要，**支持前缀**——文本模型占位符里那 8 位就够 |
| `latest` / `latest:3` | 本会话最近上传的 1 张 / 3 张图 |

### `vision_list_images`

无参数。列出当前会话里出现过的全部图片附件（名称、尺寸、类型、摘要），
让 agent 在只看到 `[image omitted …]` 时也知道有哪些图可看、该点名哪一张。

### 传图纪律（已写进 agent 的系统提示，并在运行时强制）

| 别这么干 | 该这么干 | 为什么 |
| --- | --- | --- |
| 起个本地/局域网图片服务，把 `http://192.168.1.7/a.png` 交给在线模型 | 直接把本地路径写进 `images` | **在线 VLM 在公网，它回不到你的内网**。插件会在发请求前拦下私有地址（`127.0.0.1` / `localhost` / `10.x` / `192.168.x` / `172.16–31.x` / `169.254.x` / `*.local`）并告诉 agent 怎么改 |
| 把远端设备上的路径直接丢给模型 | 先取回本地，再传本地路径 | 远端主机的本地路径对公网模型同样不可达 |
| 自己 `read` 出 base64 拼成 data URL 传进来 | 传路径，或用 `sha256:` 摘要 / `latest` 点名 | 那串字节会**完整落进 agent 的上下文**，既挤占上下文又白花 token；插件读同一张图不占 agent 一个 token。真塞了大段 base64（≥20000 字符）时，工具会在结果末尾提醒它下次换传法 |

> 例外：当 `baseUrl` 本身就指向本机模型（Ollama / vLLM）时，模型与图片在同一张网里，私有地址是合法的，插件不会拦。

### JSON 图包：手里只有 base64 时的正道

有时确实拿不到文件——远端 API 返回的、数据库字段里的、脚本现算的。这时**不要让 agent 把 base64 打印出来**，
而是在产生它的那一侧写成 JSON 文件，agent 只传一行路径：

```json
{
  "images": [
    { "name": "首帧", "data": "iVBORw0KGgoAAAANSUhEUg..." },
    { "name": "尾帧", "data": "iVBORw0KGgoAAAANSUhEUg..." }
  ]
}
```

```
images: ["json:/tmp/bundle.json"]        整包
images: ["json:/tmp/bundle.json#2"]      只要第 2 张
images: ["json:/tmp/bundle.json#2-4"]    第 2 到第 4 张
```

**省了多少**：实测 3 张 200×150 的 PNG，

| | 字符数 | 约合 token |
| --- | ---: | ---: |
| 拼成 data URL 走 `images` | 297,373 | ~74,000 |
| `json:/tmp/bundle.json` | **75** | **~20** |

模型收到的图**一模一样**，省掉的是 agent 上下文里那份副本。

解析器**刻意写得宽松**（Postel 原则），下面这些生产方写法都认：

| 位置 | 接受的写法 |
| --- | --- |
| 顶层 | `{"images":[…]}`、`{"items"/"list"/"data"/"frames":[…]}`、顶层直接是数组、单张时直接一个对象 |
| 条目 | 对象，或**直接一串 base64 字符串** |
| 图片字段 | `data` / `base64` / `b64` / `content` / `bytes` / `image` / `dataUrl`；值可带 `data:image/...;base64,` 前缀、可带换行、可是 URL-safe base64 |
| 替代来源 | `path`（相对路径按 **JSON 文件所在目录**解析）或 `url`（同样受私有地址拦截约束） |
| 类型 | `mediaType` / `mime` / `type` 等**可以完全省略**——插件按字节魔数嗅探；声明错了以嗅探为准，并在标签里标注 |
| 名字 | `name` / `label` / `title` / `id` 等，会写进图片标签，方便在 prompt 里用「第 2 张」指代 |

生产方一行就能写出来：

```bash
# 远端：把当前目录若干 PNG 打成图包
python3 -c "
import base64, glob, json
print(json.dumps({'images':[{'name':p,'data':base64.b64encode(open(p,'rb').read()).decode()} for p in sorted(glob.glob('*.png'))]}))
" > bundle.json
```

```js
// Node：把内存里的 Buffer 直接落盘成图包
fs.writeFileSync('bundle.json', JSON.stringify({
  images: buffers.map((b, i) => ({ name: `frame-${i}`, data: b.toString('base64') })),
}))
```

约束：单图仍受**单图字节上限**约束，展开后的总张数仍受**单次最多图片数**约束，整包读取上限 128MB；
图包里不能再引用另一个图包（禁止套娃）。

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
| 只有思考内容、没有正文 | 思考型模型把 token 全花在推理上了：调大 `max_tokens`，或把 `thinking` 设为 `disabled` |
| `按摘要 xxx 没找到附件对象` | 先调 `vision_list_images` 确认摘要；跨会话的图不在当前会话事件里 |
| `字节不是受支持的图片格式` | 只支持 PNG / JPEG / WebP / GIF / BMP |
| 卡片不出现 | 客户端半需要刷新页面；仍无则重启 `dsh web` |
| 所有插件一起消失 | 多半是 profile 的 `cordis.patch.yml` 被写坏（BOM / 编码），见上文警告 |

---

## 开发

```bash
npm run sync    # 用 catalog.js 重新生成 client.js 里的 CATALOG 镜像
npm test        # 宿主逻辑 + 执行路径 + 卡片离线渲染（不开浏览器）
npm run check   # 语法检查 + 校验镜像同步 + 跑全部测试
```

- `catalog.js` —— 供应商与能力清单，**唯一真相源**。加一家供应商只改这里，然后 `npm run sync`。
- `index.js` —— 宿主半：两个工具、配置命名空间、密钥解析、图片解析、动态系统提示段落。
- `client.js` —— 客户端半：设置卡片与它的 `zh` / `en` 词典。客户端 bundle 不允许 import，
  故 CATALOG 以生成的方式内联。
- `tests/session-images.test.mjs` —— 会话图片枚举（`latest` / 摘要点名的地基）：覆盖宿主
  session-controller 走的全部五条事件路径（`data.content`、`data.message.content`、`data.inserted[]`、
  `assistant/chunk` 的 `block-end`、嵌套 `tool-result`），外加去重、顺序、脏数据与配置归一化、提示词注入。
- `tests/execute.test.mjs` —— 起一个本地 OpenAI 兼容假端点，把 `execute()` 完整跑通：断言请求体
  （鉴权头、各家 detail/thinking 映射、多图标注、extraBody 合并）与全部响应/错误分支
  （分片 content、思考截断、只有思考没有正文、模型拒答、HTTP 500、非 JSON、缺 Key、张数超限、中止）。
- `tests/client-card.test.cjs` —— 用 `react-dom/server` 把卡片渲染成静态 HTML，断言官方卡片结构、
  中英两种语言、`zh`/`en` 键集对齐、高级选项默认收起，以及保存设置与写凭据的调用序列。

三个测试都会在依赖缺失时自动跳过（退出码 0）：`index.js` 需要 `@deepseek-ai/schemastery`，
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
