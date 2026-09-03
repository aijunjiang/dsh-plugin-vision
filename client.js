/* dsh-plugin-vision — browser half（设置卡片）。
 *
 * 手工按 DSH 客户端模块系统的闭包工厂契约产出：经典脚本加载后调用
 * window.__ModuleLoader__.load({ id, factory })；仅在 factory 内通过注入的
 * require 取平台种子（react），其余一律内联，规避客户端 bundle 纯度门槛。
 *
 * 卡片能力：
 *   - 供应商下拉：切换即带出该家的默认 endpoint / 模型 / 能力勾选
 *   - 特色能力复选框：勾选项会实时注入 agent 的系统提示（宿主半负责）
 *   - API Key 走 DSH 凭据域，页面只显示「是否已配置」，密钥字面量永不回显
 *
 * 下方 CATALOG 是 catalog.js 的镜像，由 `npm run sync` 生成；不要手改。
 */
window.__ModuleLoader__.load({
  id: 'dsh-plugin-vision',
  factory: (require) => {
    'use strict'
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    var React = require('react')
    var createElement = React.createElement
    var useState = React.useState
    var useEffect = React.useEffect

    /** 设置命名空间（必须与宿主半 VISION_NS 一致）。 */
    var NS = 'vision'

    /* >>> CATALOG-SYNC-START (generated from catalog.js by scripts/sync-catalog.mjs) */
    var CATALOG = {
      "defaultProvider": "ark",
      "capabilities": [
        {
          "id": "grounding",
          "label": "视觉定位 / 检测框（bbox）",
          "labelEn": "Visual grounding / bounding boxes",
          "promptHint": "视觉定位：可以要求它框出目标。务必在 prompt 里写死输出格式，例如 `只输出 JSON：[{\"label\":\"...\",\"bbox_2d\":[x1,y1,x2,y2]}]`，并要求它同时回报所用图像的像素宽高，否则坐标基准无法还原。"
        },
        {
          "id": "ocr",
          "label": "高精度文字提取（OCR）",
          "labelEn": "High-precision OCR / text extraction",
          "promptHint": "OCR：适合票据、表单、截图取字。要求「逐行输出、保留原始版式与换行、不要改写不要总结」效果最好；拿不准的字符让它标注 [?]。"
        },
        {
          "id": "doc",
          "label": "文档 / 图表解析",
          "labelEn": "Document / chart parsing",
          "promptHint": "文档与图表解析：可以要求把表格还原成 Markdown 表格、把折线柱状图还原成数据点列表，并让它说明读数是精确值还是估算值。"
        },
        {
          "id": "video",
          "label": "视频理解",
          "labelEn": "Video understanding",
          "promptHint": "视频理解：images 里可以直接传视频 URL（该供应商支持时）。要求它按时间线分段描述，并给出事件出现的大致时间点。"
        },
        {
          "id": "gui",
          "label": "GUI 界面元素识别",
          "labelEn": "GUI element recognition",
          "promptHint": "GUI 任务：识别按钮、图标、输入框并给出可点击位置。要求输出「元素名称 + 作用 + 坐标」，坐标基准同样要它自己声明。"
        },
        {
          "id": "thinking",
          "label": "深度思考开关",
          "labelEn": "Deep thinking toggle",
          "promptHint": "深度思考：调用时可传 thinking=\"enabled\" 让它先推理再回答（更准更慢更贵），简单看图用 thinking=\"disabled\" 省钱提速。"
        },
        {
          "id": "high_res",
          "label": "高分辨率 / 细节模式",
          "labelEn": "High-resolution / detail mode",
          "promptHint": "高清模式：看小字、细纹理、密集图表时传 detail=\"high\"；大致看一眼用 detail=\"low\" 省 token。"
        },
        {
          "id": "multi_image",
          "label": "多图对比",
          "labelEn": "Multi-image comparison",
          "promptHint": "多图输入：images 可以一次传多张，用于前后对比、找不同、多页文档。在 prompt 里用「第 1 张 / 第 2 张」指代，顺序与 images 数组一致。"
        },
        {
          "id": "json_output",
          "label": "结构化 JSON 输出",
          "labelEn": "Structured JSON output",
          "promptHint": "结构化输出：需要程序化消费时，在 prompt 里给出完整 JSON 骨架并要求「只输出 JSON，不要解释、不要代码围栏」。"
        }
      ],
      "providers": [
        {
          "id": "ark",
          "label": "火山方舟（豆包 Doubao）",
          "labelEn": "Volcengine Ark (Doubao)",
          "baseUrl": "https://ark.cn-beijing.volces.com/api/v3",
          "model": "doubao-seed-1-6-vision-250815",
          "keyEnv": "ARK_API_KEY",
          "caps": [
            "grounding",
            "thinking",
            "video",
            "gui",
            "doc",
            "multi_image",
            "json_output"
          ],
          "defaultCaps": [
            "grounding",
            "thinking",
            "doc",
            "multi_image"
          ],
          "notes": {
            "thinking": "深度思考：thinking 取 enabled / disabled / auto 三档（豆包 Seed 1.6 系列原生支持）。"
          },
          "docs": "https://www.volcengine.com/docs/82379/1362913"
        },
        {
          "id": "dashscope",
          "label": "阿里百炼（通义千问 Qwen-VL）",
          "labelEn": "Alibaba Model Studio (Qwen-VL)",
          "baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1",
          "model": "qwen3-vl-plus",
          "keyEnv": "DASHSCOPE_API_KEY",
          "caps": [
            "grounding",
            "ocr",
            "doc",
            "video",
            "thinking",
            "high_res",
            "multi_image",
            "json_output"
          ],
          "defaultCaps": [
            "grounding",
            "ocr",
            "doc",
            "high_res",
            "multi_image"
          ],
          "notes": {
            "grounding": "通义千问的定位输出约定是 `{\"bbox_2d\":[x1,y1,x2,y2],\"label\":\"...\"}`，坐标为「模型实际处理后的图像」绝对像素，左上角为原点；如果你要映射回原图，必须让它回报所用图像宽高。",
            "ocr": "OCR：还有专用模型 qwen-vl-ocr，纯取字场景可在调用时用 model 入参临时切过去。",
            "high_res": "高清模式：detail=\"high\" 会转成 vl_high_resolution_images=true。"
          },
          "docs": "https://help.aliyun.com/zh/model-studio/qwen-vl-compatible-with-openai"
        },
        {
          "id": "zhipu",
          "label": "智谱 BigModel（GLM-V）",
          "labelEn": "Zhipu BigModel (GLM-V)",
          "baseUrl": "https://open.bigmodel.cn/api/paas/v4",
          "model": "glm-4.6v",
          "keyEnv": "ZHIPU_API_KEY",
          "caps": [
            "grounding",
            "ocr",
            "doc",
            "video",
            "gui",
            "thinking",
            "multi_image",
            "json_output"
          ],
          "defaultCaps": [
            "grounding",
            "doc",
            "gui",
            "multi_image"
          ],
          "notes": {
            "grounding": "GLM-V 的定位坐标是「归一化到 0-1000」的相对值（x=round(x_px/W*1000)），不是像素！答案里的框常被 <|begin_of_box|> … <|end_of_box|> 包住，括号样式可能是 [] / [[]] / () / <>。要还原像素需自己乘回宽高。"
          },
          "docs": "https://docs.bigmodel.cn/"
        },
        {
          "id": "openai",
          "label": "OpenAI",
          "labelEn": "OpenAI",
          "baseUrl": "https://api.openai.com/v1",
          "model": "gpt-4o",
          "keyEnv": "OPENAI_API_KEY",
          "caps": [
            "ocr",
            "doc",
            "high_res",
            "multi_image",
            "json_output"
          ],
          "defaultCaps": [
            "doc",
            "high_res",
            "multi_image"
          ],
          "notes": {
            "high_res": "detail 取 low / high / auto，直接影响图片 token 消耗。"
          },
          "docs": "https://platform.openai.com/docs/guides/vision"
        },
        {
          "id": "gemini",
          "label": "Google Gemini（OpenAI 兼容端点）",
          "labelEn": "Google Gemini (OpenAI-compatible)",
          "baseUrl": "https://generativelanguage.googleapis.com/v1beta/openai",
          "model": "gemini-2.5-flash",
          "keyEnv": "GEMINI_API_KEY",
          "caps": [
            "ocr",
            "doc",
            "video",
            "multi_image",
            "json_output"
          ],
          "defaultCaps": [
            "doc",
            "multi_image"
          ],
          "docs": "https://ai.google.dev/gemini-api/docs/openai"
        },
        {
          "id": "moonshot",
          "label": "月之暗面 Kimi",
          "labelEn": "Moonshot Kimi",
          "baseUrl": "https://api.moonshot.cn/v1",
          "model": "kimi-k3",
          "keyEnv": "MOONSHOT_API_KEY",
          "caps": [
            "ocr",
            "doc",
            "video",
            "multi_image",
            "json_output"
          ],
          "defaultCaps": [
            "ocr",
            "doc",
            "multi_image"
          ],
          "docs": "https://platform.kimi.com/docs/guide/use-kimi-vision-model"
        },
        {
          "id": "stepfun",
          "label": "阶跃星辰 StepFun",
          "labelEn": "StepFun",
          "baseUrl": "https://api.stepfun.com/v1",
          "model": "step-1o-turbo-vision",
          "keyEnv": "STEP_API_KEY",
          "caps": [
            "ocr",
            "doc",
            "video",
            "multi_image",
            "json_output"
          ],
          "defaultCaps": [
            "ocr",
            "doc",
            "multi_image"
          ],
          "notes": {
            "multi_image": "单次请求多图总体积需控制在 20MB 以内；建议长宽都不超过 4096 像素。"
          },
          "docs": "https://platform.stepfun.com/docs/zh/guides/models/vision"
        },
        {
          "id": "siliconflow",
          "label": "硅基流动 SiliconFlow",
          "labelEn": "SiliconFlow",
          "baseUrl": "https://api.siliconflow.cn/v1",
          "model": "Qwen/Qwen2.5-VL-72B-Instruct",
          "keyEnv": "SILICONFLOW_API_KEY",
          "caps": [
            "grounding",
            "ocr",
            "doc",
            "multi_image",
            "json_output"
          ],
          "defaultCaps": [
            "grounding",
            "ocr",
            "multi_image"
          ],
          "notes": {
            "grounding": "托管的是开源权重，定位约定跟随所选模型（Qwen 系为 bbox_2d 绝对像素，GLM 系为 0-1000 归一化）。"
          },
          "docs": "https://docs.siliconflow.cn/"
        },
        {
          "id": "openrouter",
          "label": "OpenRouter（聚合）",
          "labelEn": "OpenRouter (aggregator)",
          "baseUrl": "https://openrouter.ai/api/v1",
          "model": "qwen/qwen2.5-vl-72b-instruct",
          "keyEnv": "OPENROUTER_API_KEY",
          "caps": [
            "grounding",
            "ocr",
            "doc",
            "high_res",
            "multi_image",
            "json_output"
          ],
          "defaultCaps": [
            "ocr",
            "doc",
            "multi_image"
          ],
          "docs": "https://openrouter.ai/docs"
        },
        {
          "id": "ollama",
          "label": "本地 Ollama / vLLM（OpenAI 兼容）",
          "labelEn": "Local Ollama / vLLM (OpenAI-compatible)",
          "baseUrl": "http://127.0.0.1:11434/v1",
          "model": "qwen2.5vl:7b",
          "keyEnv": "OLLAMA_API_KEY",
          "caps": [
            "grounding",
            "ocr",
            "doc",
            "multi_image",
            "json_output"
          ],
          "defaultCaps": [
            "grounding",
            "ocr"
          ],
          "notes": {
            "grounding": "本地部署常需自行缩放图片；坐标基准以模型实际收到的分辨率为准，务必让它回报宽高。"
          },
          "docs": "https://ollama.com/blog/openai-compatibility"
        },
        {
          "id": "custom",
          "label": "自定义（任意 OpenAI 兼容服务）",
          "labelEn": "Custom (any OpenAI-compatible service)",
          "baseUrl": "",
          "model": "",
          "keyEnv": "VISION_API_KEY",
          "caps": [
            "grounding",
            "ocr",
            "doc",
            "video",
            "gui",
            "thinking",
            "high_res",
            "multi_image",
            "json_output"
          ],
          "defaultCaps": [
            "multi_image"
          ],
          "docs": ""
        }
      ]
    }
    /* <<< CATALOG-SYNC-END */

    function providerById(id) {
      for (var i = 0; i < CATALOG.providers.length; i++) {
        if (CATALOG.providers[i].id === id) return CATALOG.providers[i]
      }
      for (var j = 0; j < CATALOG.providers.length; j++) {
        if (CATALOG.providers[j].id === CATALOG.defaultProvider) return CATALOG.providers[j]
      }
      return CATALOG.providers[0] || { id: '', label: '', baseUrl: '', model: '', keyEnv: 'VISION_API_KEY', caps: [], defaultCaps: [] }
    }
    function capabilityById(id) {
      for (var i = 0; i < CATALOG.capabilities.length; i++) {
        if (CATALOG.capabilities[i].id === id) return CATALOG.capabilities[i]
      }
      return undefined
    }

    /* ---- 多语种 --------------------------------------------------------
     * 词典注册进 ctx.locale 后，槽位注册声明 locale: LOCALE_NS，渲染机制会把
     * t 作为标准 prop 注入，并在用户切换语言时自动重渲——与官方卡片同一条路。
     * langTag 是给自己看的探针：用它决定 CATALOG 里取 label 还是 labelEn。
     */
    var LOCALE_NS = 'plugin.vision'

    var ZH = {
      langTag: 'zh',
      title: '视觉能力',
      description: '把图片交给在线视觉模型，让纯文本 agent 也能看图',
      expand: '展开',
      collapse: '收起',
      unsaved: '未保存',
      readOnly: '设置当前不可写（连接为只读或内存模式）。',
      save: '保存',
      saving: '保存中…',
      discard: '放弃更改',
      saveFailed: '保存失败',
      provider: '供应商',
      providerHint: '切换供应商会重置模型、Base URL 与能力勾选为该家的默认组合。',
      model: '模型 ID',
      modelHint: '留空 = 使用预设 {preset}。模型 ID 随厂商迭代变化，过期了在这里改。',
      modelHintEmpty: '该供应商没有预设模型，必须填写。',
      baseUrl: 'Base URL',
      baseUrlHint: '留空 = 使用预设 {preset}。私有部署或代理在这里填。',
      baseUrlHintEmpty: '自定义供应商必须填写 OpenAI 兼容的 endpoint。',
      apiKey: 'API Key',
      apiKeyHint: '写入本机凭据库 {ref}，界面永不回显；留空 = 不改动已存密钥。',
      apiKeyHintLocked: '凭据 {ref} 由环境变量等只读来源提供，不能在此修改。',
      apiKeySet: '已配置',
      apiKeyUnset: '未配置',
      apiKeyChecking: '检查中…',
      apiKeyEnv: '环境变量',
      capabilities: '特色能力',
      capabilitiesHint: '勾选项会实时注入 agent 的系统提示，告诉它这台模型还能干什么。悬停查看每项说明。',
      advancedShow: '显示高级选项',
      advancedHide: '收起高级选项',
      detail: '细节档位',
      detailHint: '高清更准更贵，低清更快更省；仅对支持的供应商生效。',
      detailAuto: 'auto（默认）',
      detailHigh: 'high（看小字更准）',
      detailLow: 'low（更快更省）',
      thinking: '深度思考',
      thinkingHint: '仅对支持的供应商生效。',
      thinkingDefault: '不传（由模型默认）',
      maxImages: '单次最多图片数',
      maxImagesHint: '超过这个数量的调用会被直接拒绝。',
      timeout: '超时（毫秒）',
      timeoutHint: '大图或开启深度思考时建议调大。',
      keyRef: '凭据引用名',
      keyRefHint: '密钥在凭据库里的键名；也可直接 export 同名环境变量。',
      clearKey: '清除已存密钥',
      clearedKey: '已清除凭据 {ref}。',
      savedOk: '设置已保存。',
      savedOkWithKey: '设置已保存，密钥已写入凭据 {ref}。',
      docs: '接口文档',
    }

    var EN = {
      langTag: 'en',
      title: 'Vision',
      description: 'Send images to an online vision model so a text-only agent can see',
      expand: 'Expand',
      collapse: 'Collapse',
      unsaved: 'Unsaved',
      readOnly: 'These settings are currently read-only (read-only or in-memory connection).',
      save: 'Save',
      saving: 'Saving…',
      discard: 'Discard',
      saveFailed: 'Save failed',
      provider: 'Provider',
      providerHint: 'Switching provider resets the model, base URL and capabilities to that vendor\u2019s defaults.',
      model: 'Model ID',
      modelHint: 'Empty = use the preset {preset}. Vendors rotate model IDs; change it here when one expires.',
      modelHintEmpty: 'This provider ships no preset model — a model ID is required.',
      baseUrl: 'Base URL',
      baseUrlHint: 'Empty = use the preset {preset}. Point this at a private deployment or proxy.',
      baseUrlHintEmpty: 'A custom provider needs an OpenAI-compatible endpoint.',
      apiKey: 'API key',
      apiKeyHint: 'Written to the local credential store as {ref} and never echoed back; empty = keep the stored key.',
      apiKeyHintLocked: 'Credential {ref} comes from a read-only source such as the environment and cannot be edited here.',
      apiKeySet: 'Configured',
      apiKeyUnset: 'Not set',
      apiKeyChecking: 'Checking…',
      apiKeyEnv: 'From environment',
      capabilities: 'Capabilities',
      capabilitiesHint: 'Checked items are injected into the agent\u2019s system prompt so it knows what this model can do. Hover for details.',
      advancedShow: 'Show advanced options',
      advancedHide: 'Hide advanced options',
      detail: 'Detail level',
      detailHint: 'High is more accurate and more expensive; low is faster and cheaper. Honoured only by providers that support it.',
      detailAuto: 'auto (default)',
      detailHigh: 'high (better on small text)',
      detailLow: 'low (faster, cheaper)',
      thinking: 'Deep thinking',
      thinkingHint: 'Honoured only by providers that support it.',
      thinkingDefault: 'unset (model default)',
      maxImages: 'Max images per call',
      maxImagesHint: 'Calls carrying more images than this are rejected outright.',
      timeout: 'Timeout (ms)',
      timeoutHint: 'Raise it for large images or when deep thinking is on.',
      keyRef: 'Credential reference',
      keyRefHint: 'The key name in the credential store; exporting an environment variable of the same name also works.',
      clearKey: 'Clear stored key',
      clearedKey: 'Credential {ref} cleared.',
      savedOk: 'Settings saved.',
      savedOkWithKey: 'Settings saved; the key was written to credential {ref}.',
      docs: 'API docs',
    }

    /** 部署缺少 locale 服务时的兜底：按浏览器语言选词典。 */
    function makeFallbackTranslate() {
      var tag = ''
      if (typeof navigator !== 'undefined' && navigator) tag = String(navigator.language || '')
      var dict = tag.toLowerCase().indexOf('zh') === 0 ? ZH : EN
      return function (key, params) {
        var text = dict[key]
        if (text === undefined) text = EN[key]
        if (text === undefined) return key
        if (!params) return text
        return text.replace(/\{(\w+)\}/g, function (match, name) {
          return Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match
        })
      }
    }
    var FALLBACK_T = makeFallbackTranslate()

    /** CATALOG 条目的显示名：中文界面取 label，其余取 labelEn。 */
    function displayLabel(entry, t) {
      if (!entry) return ''
      if (t('langTag') === 'zh') return entry.label
      return entry.labelEn || entry.label
    }

    /* ---- 样式（对齐官方 PluginCard.module.css / fields.module.css）------- */
    var css = {
      card: {
        listStyle: 'none',
        border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.3))',
        borderRadius: '12px',
        background: 'var(--dsw-alias-bg-layer-3, transparent)',
      },
      cardOpen: {
        background: 'var(--dsw-alias-bg-layer-2, transparent)',
        borderColor: 'var(--dsw-alias-label-dimmed, rgba(128,128,128,.5))',
      },
      header: {
        width: '100%',
        appearance: 'none',
        border: 0,
        background: 'none',
        font: 'inherit',
        color: 'inherit',
        textAlign: 'left',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        padding: '14px 16px',
        borderRadius: '12px',
        boxSizing: 'border-box',
      },
      headText: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '4px' },
      name: {
        fontSize: '15px', fontWeight: 600, lineHeight: 1.4,
        color: 'var(--dsw-alias-label-primary, inherit)',
      },
      headDesc: {
        fontSize: '13px', lineHeight: 1.5,
        color: 'var(--dsw-alias-label-tertiary, #999)',
      },
      pending: {
        flex: 'none', borderRadius: '999px', padding: '1px 8px',
        fontSize: '11px', lineHeight: '17px', fontWeight: 500, whiteSpace: 'nowrap',
        background: 'var(--dsw-alias-bg-module-platform, rgba(128,128,128,.18))',
        color: 'var(--dsw-alias-label-secondary, #888)',
      },
      chevron: { flex: 'none', fontSize: '11px', color: 'var(--dsw-alias-label-tertiary, #999)' },
      body: {
        borderTop: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.3))',
        margin: '0 16px',
        paddingBottom: '8px',
      },
      readOnly: {
        margin: '12px 0 0', fontSize: '12px', lineHeight: 1.5,
        color: 'var(--dsw-alias-label-tertiary, #999)',
      },
      field: { display: 'flex', flexDirection: 'column', gap: '6px', padding: '12px 0' },
      fieldDivided: {
        display: 'flex', flexDirection: 'column', gap: '6px', padding: '12px 0',
        borderTop: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.3))',
      },
      head: { display: 'flex', alignItems: 'center', gap: '8px' },
      label: {
        flex: 1, minWidth: 0, fontSize: '13px', fontWeight: 500, lineHeight: 1.5,
        color: 'var(--dsw-alias-label-primary, inherit)',
      },
      badges: { display: 'inline-flex', alignItems: 'center', gap: '8px' },
      badge: {
        borderRadius: '999px', padding: '1px 8px', fontSize: '11px', lineHeight: '17px',
        whiteSpace: 'nowrap', fontWeight: 500,
        background: 'var(--dsw-alias-bg-module-platform, rgba(128,128,128,.18))',
        color: 'var(--dsw-alias-label-secondary, #888)',
      },
      badgeMuted: {
        borderRadius: '999px', padding: '1px 8px', fontSize: '11px', lineHeight: '17px',
        whiteSpace: 'nowrap', color: 'var(--dsw-alias-label-tertiary, #999)',
      },
      input: {
        height: '34px', padding: '0 12px', boxSizing: 'border-box', width: '100%',
        border: '1px solid var(--dsw-alias-border-l2, #555)', borderRadius: '8px',
        background: 'var(--dsw-alias-bg-layer-3, #222)',
        font: 'inherit', fontSize: '13px', lineHeight: 1.5,
        color: 'var(--dsw-alias-label-primary, inherit)',
      },
      hint: {
        margin: 0, fontSize: '12px', lineHeight: 1.5,
        color: 'var(--dsw-alias-label-tertiary, #999)',
      },
      error: {
        margin: 0, fontSize: '12px', lineHeight: 1.5,
        color: 'var(--dsw-alias-label-error, #ef4444)',
      },
      ok: {
        margin: 0, fontSize: '12px', lineHeight: 1.5,
        color: 'var(--dsw-alias-label-success, #16a34a)',
      },
      chips: { display: 'flex', flexWrap: 'wrap', gap: '8px' },
      chip: {
        display: 'inline-flex', alignItems: 'center', gap: '6px',
        padding: '4px 10px', borderRadius: '999px', cursor: 'pointer',
        border: '1px solid var(--dsw-alias-border-l2, #555)',
        fontSize: '12px', lineHeight: 1.5,
        color: 'var(--dsw-alias-label-secondary, #888)',
      },
      chipOn: {
        display: 'inline-flex', alignItems: 'center', gap: '6px',
        padding: '4px 10px', borderRadius: '999px', cursor: 'pointer',
        border: '1px solid var(--dsw-alias-label-dimmed, rgba(128,128,128,.5))',
        background: 'var(--dsw-alias-bg-module-platform, rgba(128,128,128,.18))',
        fontSize: '12px', lineHeight: 1.5,
        color: 'var(--dsw-alias-label-primary, inherit)',
      },
      disclosure: {
        appearance: 'none', border: 'none', background: 'none', padding: '10px 0 0',
        font: 'inherit', fontSize: '12px', lineHeight: 1.5, cursor: 'pointer',
        color: 'var(--dsw-alias-label-secondary, #888)', textAlign: 'left',
      },
      footer: {
        display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px',
        padding: '12px 0 4px',
        borderTop: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.3))',
      },
      footNote: { flex: 1, minWidth: 0, margin: 0, fontSize: '12px', lineHeight: 1.5 },
      button: {
        appearance: 'none', border: '1px solid transparent', borderRadius: '8px',
        padding: '5px 14px', font: 'inherit', fontSize: '13px', lineHeight: 1.5, cursor: 'pointer',
      },
      discard: {
        appearance: 'none', borderRadius: '8px', padding: '5px 14px',
        font: 'inherit', fontSize: '13px', lineHeight: 1.5, cursor: 'pointer',
        border: '1px solid var(--dsw-alias-border-l2, #555)',
        background: 'none',
        color: 'var(--dsw-alias-label-secondary, #888)',
      },
      save: {
        appearance: 'none', border: '1px solid transparent', borderRadius: '8px',
        padding: '5px 14px', font: 'inherit', fontSize: '13px', lineHeight: 1.5, cursor: 'pointer',
        background: 'var(--dsw-alias-label-primary, #eee)',
        color: 'var(--dsw-alias-bg-layer-3, #222)',
      },
    }

    /** 把设置快照投影成卡片草稿。 */
    function draftFrom(values) {
      var preset = providerById(values.provider)
      return {
        provider: preset.id,
        model: values.model || '',
        baseUrl: values.baseUrl || '',
        apiKeyEnv: values.apiKeyEnv || preset.keyEnv,
        capabilities: (values.capabilities && values.capabilities.length > 0)
          ? values.capabilities.slice()
          : preset.defaultCaps.slice(),
        detail: values.detail || 'auto',
        thinking: values.thinking || 'default',
        maxImages: values.maxImages || 6,
        timeoutMs: values.timeoutMs || 120000,
      }
    }

    function VisionCard(props) {
      var t = typeof props.t === 'function' ? props.t : FALLBACK_T
      var snap = props.useVisionCard(function (s) { return s })
      var settingsWritable = !!(snap && snap.writable && snap.status === 'ready')
      var values = (snap && snap.values) || {}
      var cred = (snap && snap.credential) || { ref: 'VISION_API_KEY', configured: false, writable: true, known: false }

      var openState = useState(false)
      var open = openState[0]
      var setOpen = openState[1]
      var advancedState = useState(false)
      var advanced = advancedState[0]
      var setAdvanced = advancedState[1]
      var draftState = useState(function () { return draftFrom(values) })
      var draft = draftState[0]
      var setDraft = draftState[1]
      var dirtyState = useState(false)
      var dirty = dirtyState[0]
      var setDirty = dirtyState[1]
      var keyState = useState('')
      var keyText = keyState[0]
      var setKeyText = keyState[1]
      var busyState = useState(false)
      var busy = busyState[0]
      var setBusy = busyState[1]
      var noticeState = useState(null)
      var notice = noticeState[0]
      var setNotice = noticeState[1]

      // 外部（其它界面/宿主）改动设置时，未编辑状态下跟随刷新
      useEffect(function () {
        if (!dirty) setDraft(draftFrom(values))
      }, [snap && snap.revision, snap && snap.status])

      useEffect(function () {
        props.refreshCredential()
      }, [])

      var preset = providerById(draft.provider)
      var allowKeyWrite = cred.writable
      var keyDirty = keyText !== ''
      var staged = dirty || keyDirty

      function patch(next) {
        setDirty(true)
        setNotice(null)
        setDraft(Object.assign({}, draft, next))
      }

      function onProviderChange(id) {
        var target = providerById(id)
        setDirty(true)
        setNotice(null)
        // 切换供应商即回到该家的默认组合：endpoint / 模型留空表示跟随预设
        setDraft({
          provider: target.id,
          model: '',
          baseUrl: '',
          apiKeyEnv: target.keyEnv,
          capabilities: target.defaultCaps.slice(),
          detail: draft.detail,
          thinking: draft.thinking,
          maxImages: draft.maxImages,
          timeoutMs: draft.timeoutMs,
        })
      }

      function toggleCap(id, on) {
        var next = draft.capabilities.filter(function (item) { return item !== id })
        if (on) next.push(id)
        patch({ capabilities: next })
      }

      function onDiscard() {
        setDraft(draftFrom(values))
        setKeyText('')
        setDirty(false)
        setNotice(null)
      }

      function onSave() {
        setBusy(true)
        setNotice(null)
        var work = props.saveSettings({
          provider: draft.provider,
          model: draft.model.replace(/^\s+|\s+$/g, ''),
          baseUrl: draft.baseUrl.replace(/^\s+|\s+$/g, ''),
          apiKeyEnv: draft.apiKeyEnv.replace(/^\s+|\s+$/g, '') || preset.keyEnv,
          capabilities: draft.capabilities,
          detail: draft.detail,
          thinking: draft.thinking,
          maxImages: Number(draft.maxImages) || 6,
          timeoutMs: Number(draft.timeoutMs) || 120000,
        })
        var key = keyText.replace(/^\s+|\s+$/g, '')
        work = work.then(function (res) {
          if (res && res.error) return res
          if (key === '') return {}
          return props.saveKey(key)
        })
        work.then(function (res) {
          setBusy(false)
          if (res && res.error) {
            setNotice({ ok: false, text: t('saveFailed') + '：' + res.error })
            return
          }
          setKeyText('')
          setDirty(false)
          setNotice({
            ok: true,
            text: key === '' ? t('savedOk') : t('savedOkWithKey', { ref: cred.ref }),
          })
          setOpen(false)
        })
      }

      function onClear() {
        setBusy(true)
        setNotice(null)
        props.clearKey().then(function (res) {
          setBusy(false)
          if (res && res.error) {
            setNotice({ ok: false, text: t('saveFailed') + '：' + res.error })
            return
          }
          setKeyText('')
          setNotice({ ok: true, text: t('clearedKey', { ref: cred.ref }) })
        })
      }

      /** 一个字段行：标签（+徽标）、控件、说明——与官方 fields 同构。 */
      function field(key, first, labelText, badge, control, hintText) {
        return createElement('div', { style: first ? css.field : css.fieldDivided, key: key },
          createElement('div', { style: css.head },
            createElement('label', { style: css.label, htmlFor: key }, labelText),
            badge ? createElement('span', { style: css.badges }, badge) : null,
          ),
          control,
          hintText ? createElement('p', { style: css.hint }, hintText) : null,
        )
      }

      function textInput(id, value, placeholder, onChange, disabled) {
        return createElement('input', {
          id: id,
          style: css.input,
          type: 'text',
          spellCheck: false,
          placeholder: placeholder || '',
          value: value,
          disabled: disabled,
          onChange: function (e) { onChange(e.target.value) },
        })
      }

      function selectInput(id, value, options, onChange, disabled) {
        return createElement('select', {
          id: id,
          style: css.input,
          value: value,
          disabled: disabled,
          onChange: function (e) { onChange(e.target.value) },
        }, options.map(function (opt) {
          return createElement('option', { key: opt.value, value: opt.value }, opt.label)
        }))
      }

      var locked = busy || !settingsWritable

      // 密钥状态徽标
      var keyBadge
      if (!cred.known) keyBadge = createElement('span', { style: css.badgeMuted }, t('apiKeyChecking'))
      else if (cred.configured) keyBadge = createElement('span', { style: css.badge }, t('apiKeySet'))
      else if (!allowKeyWrite) keyBadge = createElement('span', { style: css.badge }, t('apiKeyEnv'))
      else keyBadge = createElement('span', { style: css.badgeMuted }, t('apiKeyUnset'))

      var capChips = preset.caps.map(function (capId) {
        var cap = capabilityById(capId)
        if (cap === undefined) return null
        var checked = draft.capabilities.indexOf(capId) >= 0
        var note = (preset.notes && preset.notes[capId]) || cap.promptHint
        return createElement('label', {
          style: checked ? css.chipOn : css.chip,
          key: capId,
          title: note,
        },
          createElement('input', {
            type: 'checkbox',
            checked: checked,
            disabled: locked,
            onChange: function (e) { toggleCap(capId, e.target.checked) },
          }),
          displayLabel(cap, t),
        )
      })

      var fields = []
      fields.push(field('vision-provider', true, t('provider'), null,
        selectInput('vision-provider', draft.provider, CATALOG.providers.map(function (p) {
          return { value: p.id, label: displayLabel(p, t) }
        }), onProviderChange, locked),
        t('providerHint')))

      fields.push(field('vision-model', false, t('model'), null,
        textInput('vision-model', draft.model, preset.model, function (v) { patch({ model: v }) }, locked),
        preset.model ? t('modelHint', { preset: preset.model }) : t('modelHintEmpty')))

      fields.push(field('vision-baseurl', false, t('baseUrl'), null,
        textInput('vision-baseurl', draft.baseUrl, preset.baseUrl || 'https://…/v1',
          function (v) { patch({ baseUrl: v }) }, locked),
        preset.baseUrl ? t('baseUrlHint', { preset: preset.baseUrl }) : t('baseUrlHintEmpty')))

      fields.push(field('vision-api-key', false, t('apiKey'), keyBadge,
        createElement('input', {
          id: 'vision-api-key',
          style: css.input,
          type: 'password',
          autoComplete: 'new-password',
          spellCheck: false,
          value: keyText,
          disabled: busy || !allowKeyWrite,
          onChange: function (e) { setNotice(null); setKeyText(e.target.value) },
        }),
        allowKeyWrite ? t('apiKeyHint', { ref: cred.ref }) : t('apiKeyHintLocked', { ref: cred.ref })))

      fields.push(field('vision-capabilities', false, t('capabilities'), null,
        createElement('div', { style: css.chips }, capChips),
        t('capabilitiesHint')))

      if (advanced) {
        fields.push(field('vision-detail', false, t('detail'), null,
          selectInput('vision-detail', draft.detail, [
            { value: 'auto', label: t('detailAuto') },
            { value: 'high', label: t('detailHigh') },
            { value: 'low', label: t('detailLow') },
          ], function (v) { patch({ detail: v }) }, locked),
          t('detailHint')))

        fields.push(field('vision-thinking', false, t('thinking'), null,
          selectInput('vision-thinking', draft.thinking, [
            { value: 'default', label: t('thinkingDefault') },
            { value: 'auto', label: 'auto' },
            { value: 'enabled', label: 'enabled' },
            { value: 'disabled', label: 'disabled' },
          ], function (v) { patch({ thinking: v }) }, locked),
          t('thinkingHint')))

        fields.push(field('vision-max-images', false, t('maxImages'), null,
          textInput('vision-max-images', String(draft.maxImages), '6',
            function (v) { patch({ maxImages: v.replace(/[^0-9]/g, '') }) }, locked),
          t('maxImagesHint')))

        fields.push(field('vision-timeout', false, t('timeout'), null,
          textInput('vision-timeout', String(draft.timeoutMs), '120000',
            function (v) { patch({ timeoutMs: v.replace(/[^0-9]/g, '') }) }, locked),
          t('timeoutHint')))

        fields.push(field('vision-key-env', false, t('keyRef'), null,
          textInput('vision-key-env', draft.apiKeyEnv, preset.keyEnv,
            function (v) { patch({ apiKeyEnv: v }) }, locked),
          t('keyRefHint')))

        if (preset.docs) {
          fields.push(createElement('p', { style: css.hint, key: 'vision-docs' }, t('docs') + '：' + preset.docs))
        }
      }

      return createElement('li', { style: open ? Object.assign({}, css.card, css.cardOpen) : css.card },
        createElement('button', {
          type: 'button',
          style: css.header,
          'aria-expanded': open,
          'aria-label': t(open ? 'collapse' : 'expand') + ': ' + t('title'),
          onClick: function () { setOpen(!open) },
        },
          createElement('span', { style: css.headText },
            createElement('span', { style: css.name }, t('title')),
            createElement('span', { style: css.headDesc }, t('description')),
          ),
          staged ? createElement('span', { style: css.pending }, t('unsaved')) : null,
          createElement('span', { style: css.chevron }, open ? '▲' : '▼'),
        ),
        open ? createElement('div', { style: css.body },
          settingsWritable ? null : createElement('p', { style: css.readOnly, role: 'status' }, t('readOnly')),
          fields,
          createElement('button', {
            type: 'button',
            style: css.disclosure,
            onClick: function () { setAdvanced(!advanced) },
          }, advanced ? t('advancedHide') : t('advancedShow')),
          createElement('div', { style: css.footer },
            notice
              ? createElement('p', { style: Object.assign({}, css.footNote, notice.ok ? css.ok : css.error), role: 'status' }, notice.text)
              : null,
            createElement('button', {
              type: 'button',
              style: css.discard,
              disabled: busy || !allowKeyWrite || !cred.configured,
              onClick: onClear,
            }, t('clearKey')),
            createElement('button', {
              type: 'button',
              style: css.discard,
              disabled: !staged || busy,
              onClick: onDiscard,
            }, t('discard')),
            createElement('button', {
              type: 'button',
              style: css.save,
              disabled: !staged || busy || !settingsWritable,
              onClick: onSave,
            }, t(busy ? 'saving' : 'save')),
          ),
        ) : null,
      )
    }

    function apply(ctx) {
      var scope = ctx.settingsScope.bind({ namespace: NS })

      // 词典注册进宿主的 locale 服务：注册成功后，槽位声明 locale: LOCALE_NS，
      // 渲染机制会合成 t 这个标准 prop，并在用户切换语言时自动重渲。
      // 服务缺席时退回 FALLBACK_T（按浏览器语言选词典），卡片照常可用。
      var localeReady = false
      var localeService = typeof ctx.get === 'function' ? ctx.get('locale') : undefined
      if (localeService && typeof localeService.register === 'function') {
        try {
          var disposeLocale = localeService.register(LOCALE_NS, { zh: ZH, en: EN })
          localeReady = true
          if (typeof ctx.effect === 'function' && typeof disposeLocale === 'function') {
            ctx.effect(function () { return disposeLocale }, 'vision: locale dictionaries')
          }
        } catch (err) {
          // 命名空间被占用等异常不应拖垮整张卡片
          localeReady = false
        }
      }

      var latest = {
        status: 'loading',
        writable: false,
        revision: undefined,
        values: {},
        credential: { ref: 'VISION_API_KEY', configured: false, writable: true, known: false },
      }
      var listeners = []
      var scheduled = false

      function notify() {
        scheduled = false
        var list = listeners.slice()
        for (var i = 0; i < list.length; i++) {
          try { list[i]() } catch (err) { /* 忽略渲染端监听器异常 */ }
        }
      }
      function update(next) {
        latest = next
        if (!scheduled) {
          scheduled = true
          queueMicrotask(notify)
        }
      }

      function valuesOf() {
        var s = scope.getSnapshot()
        return (s && s.value) ? s.value : {}
      }
      function refOf() {
        var declared = valuesOf().apiKeyEnv
        if (typeof declared === 'string' && declared.length > 0) return declared
        var preset = providerById(valuesOf().provider)
        return preset.keyEnv || 'VISION_API_KEY'
      }
      function remoteCreds() {
        return ctx.remote ? ctx.remote.credentials : undefined
      }

      function refreshCredential() {
        var ref = refOf()
        var creds = remoteCreds()
        if (!creds || typeof creds.describe !== 'function') {
          update(Object.assign({}, latest, {
            credential: { ref: ref, configured: false, writable: true, known: true },
          }))
          return
        }
        update(Object.assign({}, latest, {
          credential: { ref: ref, configured: false, writable: true, known: false },
        }))
        creds.describe([ref]).then(function (response) {
          if (ref !== refOf()) return
          var view = response && response.ok && response.value ? response.value[ref] : undefined
          update(Object.assign({}, latest, {
            credential: {
              ref: ref,
              configured: !!(view && view.configured),
              writable: view ? view.writable !== false : true,
              known: true,
            },
          }))
        }).catch(function () {
          if (ref !== refOf()) return
          update(Object.assign({}, latest, {
            credential: { ref: ref, configured: false, writable: true, known: true },
          }))
        })
      }

      function syncSettings() {
        var s = scope.getSnapshot()
        update(Object.assign({}, latest, {
          status: s ? s.status : 'unavailable',
          writable: !!(s && s.writable),
          revision: s ? s.revision : undefined,
          values: (s && s.value) ? s.value : {},
        }))
      }

      scope.subscribe(function () {
        syncSettings()
        refreshCredential()
      })
      syncSettings()
      refreshCredential()

      // 以下三个函数在没有 t 的作用域里，只回技术细节（语言中立），
      // 由卡片加上翻译过的「保存失败」前缀后展示。
      function saveSettings(patch) {
        var s = scope.getSnapshot()
        if (!s || s.status !== 'ready' || !s.writable) {
          return Promise.resolve({ error: 'settings namespace is not writable (status=' + (s ? s.status : '?') + ')' })
        }
        var fields = Object.keys(patch)
        var chain = Promise.resolve()
        fields.forEach(function (field) {
          chain = chain.then(function () { return scope.set(field, patch[field]) })
        })
        return chain.then(function () { return {} }).catch(function (err) {
          return { error: String((err && err.message) || err) }
        })
      }

      function saveKey(key) {
        var ref = refOf()
        var creds = remoteCreds()
        if (!creds || typeof creds.set !== 'function') {
          return Promise.resolve({ error: 'credential service unavailable (remote.credentials missing)' })
        }
        return creds.set(ref, key).then(function () {
          refreshCredential()
          return {}
        }).catch(function (err) {
          return { error: String((err && err.message) || err) }
        })
      }

      function clearKey() {
        var ref = refOf()
        var creds = remoteCreds()
        if (!creds || typeof creds.unset !== 'function') {
          return Promise.resolve({ error: 'credential service unavailable (remote.credentials missing)' })
        }
        return creds.unset(ref).then(function () {
          refreshCredential()
          return {}
        }).catch(function (err) {
          return { error: String((err && err.message) || err) }
        })
      }

      var store = {
        getSnapshot: function () { return latest },
        subscribe: function (listener) {
          listeners.push(listener)
          return function () {
            var i = listeners.indexOf(listener)
            if (i >= 0) listeners.splice(i, 1)
          }
        },
      }

      ctx.slots.inject('settings.plugin.item', function* registerCard() {
        var registration = {
          name: 'settings.plugin.item',
          key: NS,
          inject: function () {
            return {
              hooks: { visionCard: store },
              saveSettings: saveSettings,
              saveKey: saveKey,
              clearKey: clearKey,
              refreshCredential: refreshCredential,
            }
          },
        }
        // 只有词典真的注册成功才声明命名空间：渲染机制在缺少 locale face 时
        // 会 fail loud，卡片宁可退回自带词典也不能整张炸掉。
        if (localeReady) registration.locale = LOCALE_NS
        yield ctx.slots.register(registration, VisionCard)
      })
    }

    exports.inject = ['slots', 'settingsScope', 'remote', 'remote.credentials']
    exports.apply = apply
    return module.exports
  },
})
