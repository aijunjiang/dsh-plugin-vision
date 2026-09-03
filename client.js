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
          "promptHint": "视觉定位：可以要求它框出目标。务必在 prompt 里写死输出格式，例如 `只输出 JSON：[{\"label\":\"...\",\"bbox_2d\":[x1,y1,x2,y2]}]`，并要求它同时回报所用图像的像素宽高，否则坐标基准无法还原。"
        },
        {
          "id": "ocr",
          "label": "高精度文字提取（OCR）",
          "promptHint": "OCR：适合票据、表单、截图取字。要求「逐行输出、保留原始版式与换行、不要改写不要总结」效果最好；拿不准的字符让它标注 [?]。"
        },
        {
          "id": "doc",
          "label": "文档 / 图表解析",
          "promptHint": "文档与图表解析：可以要求把表格还原成 Markdown 表格、把折线柱状图还原成数据点列表，并让它说明读数是精确值还是估算值。"
        },
        {
          "id": "video",
          "label": "视频理解",
          "promptHint": "视频理解：images 里可以直接传视频 URL（该供应商支持时）。要求它按时间线分段描述，并给出事件出现的大致时间点。"
        },
        {
          "id": "gui",
          "label": "GUI 界面元素识别",
          "promptHint": "GUI 任务：识别按钮、图标、输入框并给出可点击位置。要求输出「元素名称 + 作用 + 坐标」，坐标基准同样要它自己声明。"
        },
        {
          "id": "thinking",
          "label": "深度思考开关",
          "promptHint": "深度思考：调用时可传 thinking=\"enabled\" 让它先推理再回答（更准更慢更贵），简单看图用 thinking=\"disabled\" 省钱提速。"
        },
        {
          "id": "high_res",
          "label": "高分辨率 / 细节模式",
          "promptHint": "高清模式：看小字、细纹理、密集图表时传 detail=\"high\"；大致看一眼用 detail=\"low\" 省 token。"
        },
        {
          "id": "multi_image",
          "label": "多图对比",
          "promptHint": "多图输入：images 可以一次传多张，用于前后对比、找不同、多页文档。在 prompt 里用「第 1 张 / 第 2 张」指代，顺序与 images 数组一致。"
        },
        {
          "id": "json_output",
          "label": "结构化 JSON 输出",
          "promptHint": "结构化输出：需要程序化消费时，在 prompt 里给出完整 JSON 骨架并要求「只输出 JSON，不要解释、不要代码围栏」。"
        }
      ],
      "providers": [
        {
          "id": "ark",
          "label": "火山方舟（豆包 Doubao）",
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

    var css = {
      card: {
        border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.3))',
        borderRadius: '10px',
        background: 'var(--dsw-alias-bg-layer-2, transparent)',
        overflow: 'hidden',
      },
      header: {
        display: 'flex', alignItems: 'center', gap: '10px',
        padding: '12px 16px', cursor: 'pointer', width: '100%', boxSizing: 'border-box',
        border: 'none', background: 'none', textAlign: 'left', font: 'inherit', color: 'inherit',
      },
      badge: { borderRadius: '999px', padding: '1px 10px', fontSize: '11px', lineHeight: '18px', whiteSpace: 'nowrap' },
      badgeOk: { background: 'var(--dsw-alias-color-success-bg, rgba(34,197,94,.18))', color: 'var(--dsw-alias-label-success, #16a34a)' },
      badgeEmpty: { background: 'var(--dsw-alias-bg-module-platform, rgba(128,128,128,.18))', color: 'var(--dsw-alias-label-secondary, #888)' },
      badgeWarn: { background: 'rgba(234,179,8,.18)', color: '#ca8a04' },
      title: { fontSize: '13px', fontWeight: 600, color: 'var(--dsw-alias-label-primary, inherit)', whiteSpace: 'nowrap' },
      summary: {
        flex: '1', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        fontSize: '12px', color: 'var(--dsw-alias-label-tertiary, #999)',
      },
      chevron: { color: 'var(--dsw-alias-label-tertiary, #999)', fontSize: '11px', flexShrink: 0 },
      body: { padding: '0 16px 14px', display: 'flex', flexDirection: 'column', gap: '10px' },
      desc: { margin: 0, fontSize: '12px', lineHeight: 1.6, color: 'var(--dsw-alias-label-secondary, #888)' },
      row: { display: 'flex', flexDirection: 'column', gap: '6px' },
      grid: { display: 'flex', gap: '10px', flexWrap: 'wrap' },
      cell: { display: 'flex', flexDirection: 'column', gap: '6px', flex: '1 1 160px', minWidth: 0 },
      label: { fontSize: '13px', color: 'var(--dsw-alias-label-primary, inherit)' },
      hint: { margin: 0, fontSize: '12px', lineHeight: 1.6, color: 'var(--dsw-alias-label-tertiary, #999)' },
      input: {
        border: '1px solid var(--dsw-alias-border-l2, #555)', background: 'var(--dsw-alias-bg-layer-3, #222)',
        color: 'var(--dsw-alias-label-primary, inherit)', borderRadius: '8px', padding: '8px 12px',
        fontSize: '13px', width: '100%', boxSizing: 'border-box',
      },
      caps: { display: 'flex', flexDirection: 'column', gap: '6px' },
      capRow: { display: 'flex', gap: '8px', alignItems: 'flex-start', fontSize: '12px', lineHeight: 1.5 },
      capLabel: { color: 'var(--dsw-alias-label-primary, inherit)', fontWeight: 500 },
      capHint: { color: 'var(--dsw-alias-label-tertiary, #999)' },
      buttons: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' },
      btn: {
        borderRadius: '8px', padding: '6px 14px', fontSize: '13px', cursor: 'pointer',
        border: '1px solid var(--dsw-alias-border-l2, #555)',
        background: 'var(--dsw-alias-bg-module-platform, #333)', color: 'var(--dsw-alias-label-primary, inherit)',
      },
      primary: { background: 'var(--dsw-alias-brand-primary, #3b82f6)', borderColor: 'transparent', color: '#fff' },
      noteOk: { fontSize: '12px', lineHeight: 1.5, margin: 0, color: 'var(--dsw-alias-label-success, #16a34a)' },
      noteError: { fontSize: '12px', lineHeight: 1.5, margin: 0, color: 'var(--dsw-alias-label-error, #ef4444)' },
      divider: { margin: 0, border: 'none', borderTop: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.25))' },
      section: { fontSize: '12px', fontWeight: 600, color: 'var(--dsw-alias-label-secondary, #888)', marginTop: '4px' },
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
      var snap = props.useVisionCard(function (s) { return s })
      var settingsWritable = !!(snap && snap.writable && snap.status === 'ready')
      var values = (snap && snap.values) || {}
      var cred = (snap && snap.credential) || { ref: 'VISION_API_KEY', configured: false, writable: true, known: false }

      var openState = useState(false)
      var open = openState[0]
      var setOpen = openState[1]
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

      var badgeText = ''
      var badgeStyle = css.badge
      if (!cred.known) {
        badgeStyle = Object.assign({}, badgeStyle, css.badgeEmpty)
        badgeText = '检查中…'
      } else if (cred.configured) {
        badgeStyle = Object.assign({}, badgeStyle, css.badgeOk)
        badgeText = '已配置'
      } else if (!allowKeyWrite) {
        badgeStyle = Object.assign({}, badgeStyle, css.badgeWarn)
        badgeText = '环境变量来源'
      } else {
        badgeStyle = Object.assign({}, badgeStyle, css.badgeEmpty)
        badgeText = '未配置密钥'
      }

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
            setNotice({ ok: false, text: res.error })
            return
          }
          setKeyText('')
          setDirty(false)
          setNotice({ ok: true, text: key === '' ? '设置已保存。' : '设置已保存，密钥已写入凭据 ' + cred.ref + '。' })
          setOpen(false)
        })
      }

      function onClear() {
        setBusy(true)
        setNotice(null)
        props.clearKey().then(function (res) {
          setBusy(false)
          if (res && res.error) {
            setNotice({ ok: false, text: res.error })
            return
          }
          setKeyText('')
          setNotice({ ok: true, text: '已清除凭据 ' + cred.ref + '。' })
        })
      }

      function textCell(id, label, value, placeholder, onChange, hint) {
        return createElement('div', { style: css.cell, key: id },
          createElement('label', { style: css.label, htmlFor: id }, label),
          createElement('input', {
            id: id,
            style: css.input,
            type: 'text',
            spellCheck: false,
            placeholder: placeholder,
            value: value,
            disabled: busy || !settingsWritable,
            onChange: function (e) { onChange(e.target.value) },
          }),
          hint ? createElement('p', { style: css.hint }, hint) : null,
        )
      }

      function selectCell(id, label, value, options, onChange) {
        return createElement('div', { style: css.cell, key: id },
          createElement('label', { style: css.label, htmlFor: id }, label),
          createElement('select', {
            id: id,
            style: css.input,
            value: value,
            disabled: busy || !settingsWritable,
            onChange: function (e) { onChange(e.target.value) },
          }, options.map(function (opt) {
            return createElement('option', { key: opt.value, value: opt.value }, opt.label)
          })),
        )
      }

      var summaryText = preset.label + ' · ' + (draft.model || preset.model || '未设置模型')
      var chevronLabel = open ? '收起 ▾' : '展开 ▸'

      var capRows = preset.caps.map(function (capId) {
        var cap = capabilityById(capId)
        if (cap === undefined) return null
        var checked = draft.capabilities.indexOf(capId) >= 0
        var note = (preset.notes && preset.notes[capId]) || cap.promptHint
        return createElement('label', { style: css.capRow, key: capId },
          createElement('input', {
            type: 'checkbox',
            checked: checked,
            disabled: busy || !settingsWritable,
            onChange: function (e) { toggleCap(capId, e.target.checked) },
          }),
          createElement('span', null,
            createElement('span', { style: css.capLabel }, cap.label),
            createElement('span', { style: css.capHint }, ' — ' + note),
          ),
        )
      })

      return createElement('div', { style: css.card },
        createElement('div', {
          style: css.header,
          role: 'button',
          tabIndex: 0,
          'aria-expanded': String(open),
          onClick: function () { setOpen(!open) },
          onKeyDown: function (e) {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(!open) }
          },
        },
          createElement('span', { style: badgeStyle }, badgeText),
          createElement('span', { style: css.title }, '视觉能力 vision_analyze'),
          createElement('span', { style: css.summary }, summaryText),
          createElement('span', { style: css.chevron }, chevronLabel),
        ),
        open ? createElement('div', { style: css.body },
          createElement('hr', { style: css.divider }),
          createElement('p', { style: css.desc },
            '把图片交给在线视觉大模型，让没有视觉的 agent 也能"看"。观察用的提示词由 agent 自己撰写；'
            + '这里勾选的特色能力会实时注入 agent 的系统提示，告诉它这台模型还能干什么。'
            + 'API Key 存在本机 DSH 凭据库，界面不回显。'),

          createElement('div', { style: css.grid },
            selectCell('vision-provider', '供应商', draft.provider, CATALOG.providers.map(function (p) {
              return { value: p.id, label: p.label }
            }), onProviderChange),
            textCell('vision-model', '模型 ID', draft.model, preset.model || '（必填）',
              function (v) { patch({ model: v }) },
              draft.model === '' && preset.model ? '留空 = 使用预设 ' + preset.model : undefined),
          ),

          textCell('vision-baseurl', 'Base URL', draft.baseUrl, preset.baseUrl || 'https://…/v1',
            function (v) { patch({ baseUrl: v }) },
            draft.baseUrl === '' && preset.baseUrl ? '留空 = 使用预设 ' + preset.baseUrl : undefined),

          createElement('div', { style: css.row },
            createElement('label', { style: css.label, htmlFor: 'vision-api-key' }, 'API Key'),
            createElement('input', {
              id: 'vision-api-key',
              style: css.input,
              type: 'password',
              autoComplete: 'new-password',
              spellCheck: false,
              placeholder: '粘贴 API Key（留空 = 不改动已存密钥）',
              value: keyText,
              disabled: busy || !allowKeyWrite,
              onChange: function (e) { setKeyText(e.target.value) },
            }),
            createElement('p', { style: css.hint },
              '凭据引用：' + cred.ref
              + (allowKeyWrite ? '' : ' — 该引用由环境变量/只读来源提供，不能在此修改')),
          ),

          createElement('div', { style: css.section }, '特色能力（勾选项会注入 agent 系统提示）'),
          createElement('div', { style: css.caps }, capRows),

          createElement('div', { style: css.section }, '调用参数'),
          createElement('div', { style: css.grid },
            selectCell('vision-detail', '细节档位', draft.detail, [
              { value: 'auto', label: 'auto（默认）' },
              { value: 'high', label: 'high（看小字更准）' },
              { value: 'low', label: 'low（更快更省）' },
            ], function (v) { patch({ detail: v }) }),
            selectCell('vision-thinking', '深度思考', draft.thinking, [
              { value: 'default', label: '不传（由模型默认）' },
              { value: 'auto', label: 'auto' },
              { value: 'enabled', label: 'enabled' },
              { value: 'disabled', label: 'disabled' },
            ], function (v) { patch({ thinking: v }) }),
            textCell('vision-max-images', '单次最多图片数', String(draft.maxImages), '6',
              function (v) { patch({ maxImages: v.replace(/[^0-9]/g, '') }) }),
            textCell('vision-timeout', '超时(ms)', String(draft.timeoutMs), '120000',
              function (v) { patch({ timeoutMs: v.replace(/[^0-9]/g, '') }) }),
          ),
          textCell('vision-key-env', '凭据引用名', draft.apiKeyEnv, preset.keyEnv,
            function (v) { patch({ apiKeyEnv: v }) },
            '密钥在凭据库里的键名；也可直接 export 同名环境变量。'),

          createElement('div', { style: css.buttons },
            createElement('button', {
              style: Object.assign({}, css.btn, css.primary),
              disabled: busy || !settingsWritable,
              onClick: onSave,
            }, busy ? '保存中…' : '保存并收起'),
            createElement('button', {
              style: css.btn,
              disabled: busy || !allowKeyWrite,
              onClick: onClear,
            }, '清除已存 Key'),
            settingsWritable ? null : createElement('span', { style: css.noteError }, '设置当前不可写（连接为只读或内存模式）。'),
            notice ? createElement('span', { style: notice.ok ? css.noteOk : css.noteError }, notice.text) : null,
          ),
          preset.docs ? createElement('p', { style: css.hint }, '接口文档：' + preset.docs) : null,
        ) : null,
      )
    }

    function apply(ctx) {
      var scope = ctx.settingsScope.bind({ namespace: NS })

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

      function saveSettings(patch) {
        var s = scope.getSnapshot()
        if (!s || s.status !== 'ready' || !s.writable) {
          return Promise.resolve({ error: '设置命名空间当前不可写（status=' + (s ? s.status : '?') + '）。' })
        }
        var fields = Object.keys(patch)
        var chain = Promise.resolve()
        fields.forEach(function (field) {
          chain = chain.then(function () { return scope.set(field, patch[field]) })
        })
        return chain.then(function () { return {} }).catch(function (err) {
          return { error: '保存设置失败：' + String((err && err.message) || err) }
        })
      }

      function saveKey(key) {
        var ref = refOf()
        var creds = remoteCreds()
        if (!creds || typeof creds.set !== 'function') {
          return Promise.resolve({ error: '凭据服务不可用（remote.credentials 缺失）。' })
        }
        return creds.set(ref, key).then(function () {
          refreshCredential()
          return {}
        }).catch(function (err) {
          return { error: '写入凭据失败：' + String((err && err.message) || err) }
        })
      }

      function clearKey() {
        var ref = refOf()
        var creds = remoteCreds()
        if (!creds || typeof creds.unset !== 'function') {
          return Promise.resolve({ error: '凭据服务不可用（remote.credentials 缺失）。' })
        }
        return creds.unset(ref).then(function () {
          refreshCredential()
          return {}
        }).catch(function (err) {
          return { error: '清除凭据失败：' + String((err && err.message) || err) }
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
        yield ctx.slots.register({
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
        }, VisionCard)
      })
    }

    exports.inject = ['slots', 'settingsScope', 'remote', 'remote.credentials']
    exports.apply = apply
    return module.exports
  },
})
