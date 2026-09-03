# dsh-plugin-vision

**English** · [简体中文](./README.zh-CN.md)

Give a DSH agent a pair of eyes.

When the main model is text-only, an image in the conversation is just a line saying
`[image omitted because this model accepts text only; attachment sha256:1a2b3c4d]`.
This plugin closes that gap: the agent writes its own observation prompt, hands the image to an
online vision model (VLM), and gets a written answer back.

- **Many providers** — every call is the OpenAI-compatible `POST {baseUrl}/chat/completions`.
  Eleven presets ship in the box, and any other OpenAI-compatible endpoint works too.
- **Checked capabilities become prompt text** — tick what this model is good at (grounding / OCR /
  documents & charts / video / GUI / deep thinking / multi-image …) and those notes are **injected
  into the agent's system prompt in real time**, telling it what else this model can do and how to ask.
- **The prompt belongs to the agent** — the plugin ships no "describe this image" template. What to
  look at, how finely, and in what output shape is written by the agent on the spot.
- **It can see images from the conversation** — whatever the user drops into the input box, the agent
  can name with `latest` or with the eight-hex digest it sees in the placeholder.
- **Keys live in the credential store** — written to `~/.dsh/.credentials.yaml`; the UI only ever shows
  *configured* or *not set*, never the literal.
- **Bilingual UI** — the settings card follows DSH's own language preference (中文 / English).

---

## Install

### From the package registry

```bash
dsh plugin add dsh-plugin-vision
```

### Local development

Link the repository into the target profile's `node_modules` under its package name, then add one row
to that profile's `cordis.patch.yml`:

```powershell
# Windows, using the web profile
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

The web profile is live-reloading: saving the patch file applies **configuration changes** (provider,
model, base URL …) immediately. But **changes to the plugin's own source** (`index.js`, `catalog.js`)
are *not* hot-reloaded — the module stays in the ESM cache, so restart `dsh web` after editing it.
**The settings card is the browser half: refresh the page once; if it still does not appear, restart
`dsh web`.**

> ⚠️ On Windows, never edit that YAML with PowerShell 5.1's `Get-Content` / `Set-Content -Encoding utf8`:
> the first decodes as GBK and destroys non-ASCII comments, the second writes a BOM. Either one makes
> the whole patch layer fail to parse and takes every plugin down with it. Use
> `[System.IO.File]::ReadAllText/WriteAllText($p, $t, (New-Object System.Text.UTF8Encoding($false)))`.

---

## Configure

Settings → Plugins → **Vision**.

| Field | Meaning |
| --- | --- |
| Provider | Switching resets model, base URL and capabilities to that vendor's defaults |
| Model ID | Empty = the preset. **Vendors rotate model IDs; change it here when one expires** |
| Base URL | Empty = the preset endpoint; point it at a private deployment or proxy |
| API key | Written to the DSH credential store; empty = keep the stored key |
| Capabilities | Checked items are injected into the agent's system prompt |
| *Advanced* → Detail level | `auto` / `high` (better on small text) / `low` (faster, cheaper) |
| *Advanced* → Deep thinking | `unset` / `auto` / `enabled` / `disabled`; honoured only where supported |
| *Advanced* → Max images per call | Default 6 |
| *Advanced* → Timeout (ms) | Default 120000 |
| *Advanced* → Credential reference | The key name in the credential store; an environment variable of the same name also works |

Key resolution order: **the `apiKey` settings field → the DSH credential domain (whatever `apiKeyEnv`
points at) → an environment variable of that name**.

### Bundled provider presets

| id | Provider | Default endpoint | Default model |
| --- | --- | --- | --- |
| `ark` | Volcengine Ark (Doubao) | `https://ark.cn-beijing.volces.com/api/v3` | `doubao-seed-1-6-vision-250815` |
| `dashscope` | Alibaba Model Studio (Qwen-VL) | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen3-vl-plus` |
| `zhipu` | Zhipu BigModel (GLM-V) | `https://open.bigmodel.cn/api/paas/v4` | `glm-4.6v` |
| `openai` | OpenAI | `https://api.openai.com/v1` | `gpt-4o` |
| `gemini` | Google Gemini (OpenAI-compatible) | `https://generativelanguage.googleapis.com/v1beta/openai` | `gemini-2.5-flash` |
| `moonshot` | Moonshot Kimi | `https://api.moonshot.cn/v1` | `kimi-k3` |
| `stepfun` | StepFun | `https://api.stepfun.com/v1` | `step-1o-turbo-vision` |
| `siliconflow` | SiliconFlow | `https://api.siliconflow.cn/v1` | `Qwen/Qwen2.5-VL-72B-Instruct` |
| `openrouter` | OpenRouter (aggregator) | `https://openrouter.ai/api/v1` | `qwen/qwen2.5-vl-72b-instruct` |
| `ollama` | Local Ollama / vLLM (OpenAI-compatible) | `http://127.0.0.1:11434/v1` | `qwen2.5vl:7b` |
| `custom` | Custom (any OpenAI-compatible service) | (yours) | (yours) |

A preset is **a starting point, not a cage**: every endpoint and model can be overwritten in the card.
Model IDs move fast — the vendor's own documentation wins.

---

## How the agent uses it

### `vision_analyze`

| Parameter | Required | Meaning |
| --- | --- | --- |
| `images` | ✅ | Array of image sources |
| `prompt` | ✅ | The observation instruction, **written by the agent** |
| `system` | | A role for the vision model |
| `model` | | Override the model for this call only |
| `detail` | | `auto` / `high` / `low` |
| `thinking` | | `auto` / `enabled` / `disabled` |
| `max_tokens` | | Reply budget for this call |

Each entry of `images` may be:

| Form | Meaning |
| --- | --- |
| `C:\pic\a.png`, `/home/u/a.jpg` | A local file, read through `ctx.fs` so the sandbox and any remote route still apply; a missing extension is resolved by magic bytes |
| `https://…` | A remote URL, passed straight through for the model to fetch |
| `data:image/png;base64,…` | Inline |
| `json:/path/bundle.json` | **A JSON image bundle**: base64 kept in a file, many images at once — see below |
| `sha256:1a2b3c4d` | A conversation attachment digest — **a prefix is enough**, so the eight hex characters in the text-only placeholder work |
| `latest` / `latest:3` | The most recent 1 / 3 images in this conversation |

### `vision_list_images`

No parameters. Lists every image attachment seen in this conversation (name, size, type, digest) so
an agent staring at `[image omitted …]` still knows which images exist and how to name one.

### How images should reach the model (in the system prompt, and enforced at runtime)

| Don't | Do | Why |
| --- | --- | --- |
| Stand up a local/LAN image server and hand `http://192.168.1.7/a.png` to an online model | Put the local path straight into `images` | **The VLM runs on the public internet and cannot reach your intranet.** The plugin rejects private hosts before the request goes out (`127.0.0.1`, `localhost`, `10.x`, `192.168.x`, `172.16–31.x`, `169.254.x`, `*.local`) and tells the agent what to do instead |
| Pass a path that lives on a remote device | Fetch it locally first, then pass the local path | A remote host's local path is just as unreachable for a public model |
| `read` the image yourself, base64 it, and pass a data URL | Pass the path, or name it with a `sha256:` digest / `latest` | Those bytes land **in full inside the agent's context** — context spent and tokens burned; the plugin reading the same image costs the agent nothing. If a large data URL (≥20000 chars) is passed anyway, the tool result ends with a note telling the agent to switch |

> Exception: when `baseUrl` itself points at a local model (Ollama / vLLM), the model and the image share one network, so private addresses are legitimate and are not blocked.

### JSON image bundles: the right way when all you have is base64

Sometimes there really is no file — the bytes came back from a remote API, a database column, a script.
Then **do not let the agent print the base64**. Write it to a JSON file on the side that produced it and
let the agent pass a single path:

```json
{
  "images": [
    { "name": "first-frame", "data": "iVBORw0KGgoAAAANSUhEUg..." },
    { "name": "last-frame",  "data": "iVBORw0KGgoAAAANSUhEUg..." }
  ]
}
```

```
images: ["json:/tmp/bundle.json"]        the whole bundle
images: ["json:/tmp/bundle.json#2"]      only the 2nd image
images: ["json:/tmp/bundle.json#2-4"]    images 2 through 4
```

**What it saves** — measured on three 200×150 PNGs:

| | Characters | ≈ tokens |
| --- | ---: | ---: |
| Inlined as data URLs in `images` | 297,373 | ~74,000 |
| `json:/tmp/bundle.json` | **75** | **~20** |

The model receives **exactly the same images**; what disappears is the copy in the agent's context.

The parser is **deliberately liberal** (Postel's law) — all of these are accepted:

| Where | Accepted |
| --- | --- |
| Top level | `{"images":[…]}`, `{"items"/"list"/"data"/"frames":[…]}`, a bare array, or a single object for one image |
| Entry | An object, or **a bare base64 string** |
| Image field | `data` / `base64` / `b64` / `content` / `bytes` / `image` / `dataUrl`; the value may carry a `data:image/...;base64,` prefix, contain newlines, or be URL-safe base64 |
| Alternative source | `path` (a relative path resolves against **the JSON file's own directory**) or `url` (still subject to the private-address block) |
| Media type | `mediaType` / `mime` / `type` … may be **omitted entirely** — the plugin sniffs the magic bytes; a wrong declaration loses to the sniff and is flagged in the label |
| Name | `name` / `label` / `title` / `id` …, carried into the image label so the prompt can refer to "image 2" |

One line on the producing side:

```bash
# Remote box: bundle every PNG in the current directory
python3 -c "
import base64, glob, json
print(json.dumps({'images':[{'name':p,'data':base64.b64encode(open(p,'rb').read()).decode()} for p in sorted(glob.glob('*.png'))]}))
" > bundle.json
```

```js
// Node: dump in-memory buffers straight into a bundle
fs.writeFileSync('bundle.json', JSON.stringify({
  images: buffers.map((b, i) => ({ name: `frame-${i}`, data: b.toString('base64') })),
}))
```

Limits: each image still obeys the **per-image byte cap**, the expanded total still obeys **max images per
call**, the whole file is capped at 128 MB, and a bundle may not reference another bundle.

### Coordinate discipline

For anything positional, pin the output shape in the prompt **and make the model report the pixel size
of the image it actually processed** — otherwise the coordinates cannot be mapped back:

```
Output JSON only: [{"label":"...","bbox_2d":[x1,y1,x2,y2]}]
Before the JSON, state on one line the pixel width and height of the image you processed,
and whether the coordinates are absolute pixels or normalized.
```

Vendors disagree here (known: Qwen-VL returns `bbox_2d` in **absolute pixels of the processed image**;
GLM-V returns **0–1000 normalized** values wrapped in `<|begin_of_box|> … <|end_of_box|>`), so *asking
the model to state its own basis* beats assuming one.

---

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| `未配置视觉模型 API Key` | Save a key in the card, or export the environment variable named by `apiKeyEnv` |
| `HTTP 401 AuthenticationError` | A key was found but the endpoint rejects it — note that a *search* API key and a *model* API key are usually different things |
| `HTTP 404 / model not found` | The model ID expired or the account lacks access; pick another in the card |
| Only thinking content, no answer | A thinking model spent the whole budget on reasoning; raise `max_tokens` or set `thinking` to `disabled` |
| `按摘要 xxx 没找到附件对象` | Call `vision_list_images` first; images from another conversation are not in this one's events |
| `字节不是受支持的图片格式` | Only PNG / JPEG / WebP / GIF / BMP are accepted |
| The card never appears | The browser half needs one page refresh; if that fails, restart `dsh web` |
| Every plugin disappears at once | The profile's `cordis.patch.yml` is probably corrupted (BOM / encoding) — see the warning above |

---

## Development

```bash
npm run sync    # regenerate the CATALOG mirror inside client.js from catalog.js
npm test        # host logic + execute path + offline card rendering (no browser)
npm run check   # syntax check + mirror-is-in-sync check + the full test suite
```

- `catalog.js` — providers and capabilities, **the single source of truth**. Adding a provider means
  editing this file and running `npm run sync`.
- `index.js` — the host half: two tools, the settings namespace, key resolution, image resolution,
  and the live system-prompt section.
- `client.js` — the browser half: the settings card and its `zh` / `en` dictionaries. A client bundle
  may not `import`, so the catalog is mirrored in by generation rather than imported.
- `tests/session-images.test.mjs` — conversation image enumeration (the ground `latest` and digests
  stand on): all five event shapes the host's session controller walks (`data.content`,
  `data.message.content`, `data.inserted[]`, the `block-end` of `assistant/chunk`, and nested
  `tool-result`), plus de-duplication, ordering, hostile data, config normalization and prompt injection.
- `tests/execute.test.mjs` — stands up a local OpenAI-compatible endpoint and drives `execute()`
  end to end: request shape (auth header, per-vendor detail/thinking mapping, multi-image labelling,
  `extraBody` merge) and every response/error branch (chunked content, truncation, thinking-only,
  refusal, HTTP 500, non-JSON, missing key, too many images, abort).
- `tests/client-card.test.cjs` — renders the card to static HTML with `react-dom/server` and asserts
  the official card structure, both languages, `zh`/`en` key parity, the collapsed advanced section,
  and the save/credential call sequence.

All three skip cleanly (exit 0) when their dependencies are absent: `index.js` needs
`@deepseek-ai/schemastery`, and the card test needs `react` / `react-dom` (injected by the DSH platform
in the browser; locally they resolve from the DSH profile's `node_modules`).

### Working without a real key

Stand up an OpenAI-compatible fake endpoint, point `baseUrl` at it and put anything in `apiKey`:

```js
// mock.cjs — dump whatever arrives, then answer with a fixed line
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
