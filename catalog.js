// dsh-plugin-vision —— 供应商与「特色能力」目录（宿主侧唯一真相源）。
//
// 客户端 client.js 无法 import 本文件（客户端 bundle 纯度门槛：闭包工厂内只能
// require 平台种子），因此 client.js 内嵌了本目录的一份精简副本，由
// `node scripts/sync-catalog.mjs` 生成、由 `npm run check` 校验一致性。
// 修改本文件后务必执行 `npm run sync`。

/**
 * 视觉模型「特色能力」。勾选后会把 promptHint 注入 agent 的系统提示，
 * 告诉 agent 这台 VLM 还能做什么、该怎么跟它提要求。
 *
 * label / labelEn 是给人看的（设置卡片按界面语言取用）；
 * promptHint 是给 agent 看的，不随界面语言变化。
 */
export const CAPABILITIES = [
  {
    id: 'grounding',
    label: '视觉定位 / 检测框（bbox）',
    labelEn: 'Visual grounding / bounding boxes',
    promptHint:
      '视觉定位：可以要求它框出目标。务必在 prompt 里写死输出格式，例如 '
      + '`只输出 JSON：[{"label":"...","bbox_2d":[x1,y1,x2,y2]}]`，'
      + '并要求它同时回报所用图像的像素宽高，否则坐标基准无法还原。',
  },
  {
    id: 'ocr',
    label: '高精度文字提取（OCR）',
    labelEn: 'High-precision OCR / text extraction',
    promptHint:
      'OCR：适合票据、表单、截图取字。要求「逐行输出、保留原始版式与换行、不要改写不要总结」效果最好；'
      + '拿不准的字符让它标注 [?]。',
  },
  {
    id: 'doc',
    label: '文档 / 图表解析',
    labelEn: 'Document / chart parsing',
    promptHint:
      '文档与图表解析：可以要求把表格还原成 Markdown 表格、把折线柱状图还原成数据点列表，并让它说明读数是精确值还是估算值。',
  },
  {
    id: 'video',
    label: '视频理解',
    labelEn: 'Video understanding',
    promptHint:
      '视频理解：images 里可以直接传视频 URL（该供应商支持时）。要求它按时间线分段描述，并给出事件出现的大致时间点。',
  },
  {
    id: 'gui',
    label: 'GUI 界面元素识别',
    labelEn: 'GUI element recognition',
    promptHint:
      'GUI 任务：识别按钮、图标、输入框并给出可点击位置。要求输出「元素名称 + 作用 + 坐标」，坐标基准同样要它自己声明。',
  },
  {
    id: 'thinking',
    label: '深度思考开关',
    labelEn: 'Deep thinking toggle',
    promptHint:
      '深度思考：调用时可传 thinking="enabled" 让它先推理再回答（更准更慢更贵），'
      + '简单看图用 thinking="disabled" 省钱提速。',
  },
  {
    id: 'high_res',
    label: '高分辨率 / 细节模式',
    labelEn: 'High-resolution / detail mode',
    promptHint:
      '高清模式：看小字、细纹理、密集图表时传 detail="high"；大致看一眼用 detail="low" 省 token。',
  },
  {
    id: 'multi_image',
    label: '多图对比',
    labelEn: 'Multi-image comparison',
    promptHint:
      '多图输入：images 可以一次传多张，用于前后对比、找不同、多页文档。'
      + '在 prompt 里用「第 1 张 / 第 2 张」指代，顺序与 images 数组一致。',
  },
  {
    id: 'json_output',
    label: '结构化 JSON 输出',
    labelEn: 'Structured JSON output',
    promptHint:
      '结构化输出：需要程序化消费时，在 prompt 里给出完整 JSON 骨架并要求「只输出 JSON，不要解释、不要代码围栏」。',
  },
]

/**
 * 供应商预设。全部按 OpenAI 兼容 `POST {baseUrl}/chat/completions` 调用。
 * - thinkingStyle: 'ark'（thinking:{type}）| 'boolean'（enable_thinking）| 'none'
 * - detailStyle:   'image_url'（image_url.detail）| 'dashscope'（vl_high_resolution_images）| 'none'
 * 模型 ID 会随厂商迭代变化，设置卡片里可随时改写。
 */
export const PROVIDERS = [
  {
    id: 'ark',
    label: '火山方舟（豆包 Doubao）',
    labelEn: 'Volcengine Ark (Doubao)',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    model: 'doubao-seed-1-6-vision-250815',
    keyEnv: 'ARK_API_KEY',
    thinkingStyle: 'ark',
    detailStyle: 'image_url',
    caps: ['grounding', 'thinking', 'video', 'gui', 'doc', 'multi_image', 'json_output'],
    defaultCaps: ['grounding', 'thinking', 'doc', 'multi_image'],
    notes: {
      thinking: '深度思考：thinking 取 enabled / disabled / auto 三档（豆包 Seed 1.6 系列原生支持）。',
    },
    docs: 'https://www.volcengine.com/docs/82379/1362913',
  },
  {
    id: 'dashscope',
    label: '阿里百炼（通义千问 Qwen-VL）',
    labelEn: 'Alibaba Model Studio (Qwen-VL)',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen3-vl-plus',
    keyEnv: 'DASHSCOPE_API_KEY',
    thinkingStyle: 'boolean',
    detailStyle: 'dashscope',
    caps: ['grounding', 'ocr', 'doc', 'video', 'thinking', 'high_res', 'multi_image', 'json_output'],
    defaultCaps: ['grounding', 'ocr', 'doc', 'high_res', 'multi_image'],
    notes: {
      grounding:
        '通义千问的定位输出约定是 `{"bbox_2d":[x1,y1,x2,y2],"label":"..."}`，坐标为「模型实际处理后的图像」绝对像素，'
        + '左上角为原点；如果你要映射回原图，必须让它回报所用图像宽高。',
      ocr: 'OCR：还有专用模型 qwen-vl-ocr，纯取字场景可在调用时用 model 入参临时切过去。',
      high_res: '高清模式：detail="high" 会转成 vl_high_resolution_images=true。',
    },
    docs: 'https://help.aliyun.com/zh/model-studio/qwen-vl-compatible-with-openai',
  },
  {
    id: 'zhipu',
    label: '智谱 BigModel（GLM-V）',
    labelEn: 'Zhipu BigModel (GLM-V)',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4.6v',
    keyEnv: 'ZHIPU_API_KEY',
    thinkingStyle: 'ark',
    detailStyle: 'none',
    caps: ['grounding', 'ocr', 'doc', 'video', 'gui', 'thinking', 'multi_image', 'json_output'],
    defaultCaps: ['grounding', 'doc', 'gui', 'multi_image'],
    notes: {
      grounding:
        'GLM-V 的定位坐标是「归一化到 0-1000」的相对值（x=round(x_px/W*1000)），不是像素！'
        + '答案里的框常被 <|begin_of_box|> … <|end_of_box|> 包住，括号样式可能是 [] / [[]] / () / <>。'
        + '要还原像素需自己乘回宽高。',
    },
    docs: 'https://docs.bigmodel.cn/',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    labelEn: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o',
    keyEnv: 'OPENAI_API_KEY',
    thinkingStyle: 'none',
    detailStyle: 'image_url',
    caps: ['ocr', 'doc', 'high_res', 'multi_image', 'json_output'],
    defaultCaps: ['doc', 'high_res', 'multi_image'],
    notes: {
      high_res: 'detail 取 low / high / auto，直接影响图片 token 消耗。',
    },
    docs: 'https://platform.openai.com/docs/guides/vision',
  },
  {
    id: 'gemini',
    label: 'Google Gemini（OpenAI 兼容端点）',
    labelEn: 'Google Gemini (OpenAI-compatible)',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-2.5-flash',
    keyEnv: 'GEMINI_API_KEY',
    thinkingStyle: 'none',
    detailStyle: 'none',
    caps: ['ocr', 'doc', 'video', 'multi_image', 'json_output'],
    defaultCaps: ['doc', 'multi_image'],
    docs: 'https://ai.google.dev/gemini-api/docs/openai',
  },
  {
    id: 'moonshot',
    label: '月之暗面 Kimi',
    labelEn: 'Moonshot Kimi',
    baseUrl: 'https://api.moonshot.cn/v1',
    model: 'kimi-k3',
    keyEnv: 'MOONSHOT_API_KEY',
    thinkingStyle: 'none',
    detailStyle: 'none',
    caps: ['ocr', 'doc', 'video', 'multi_image', 'json_output'],
    defaultCaps: ['ocr', 'doc', 'multi_image'],
    docs: 'https://platform.kimi.com/docs/guide/use-kimi-vision-model',
  },
  {
    id: 'stepfun',
    label: '阶跃星辰 StepFun',
    labelEn: 'StepFun',
    baseUrl: 'https://api.stepfun.com/v1',
    model: 'step-1o-turbo-vision',
    keyEnv: 'STEP_API_KEY',
    thinkingStyle: 'none',
    detailStyle: 'none',
    caps: ['ocr', 'doc', 'video', 'multi_image', 'json_output'],
    defaultCaps: ['ocr', 'doc', 'multi_image'],
    notes: {
      multi_image: '单次请求多图总体积需控制在 20MB 以内；建议长宽都不超过 4096 像素。',
    },
    docs: 'https://platform.stepfun.com/docs/zh/guides/models/vision',
  },
  {
    id: 'siliconflow',
    label: '硅基流动 SiliconFlow',
    labelEn: 'SiliconFlow',
    baseUrl: 'https://api.siliconflow.cn/v1',
    model: 'Qwen/Qwen2.5-VL-72B-Instruct',
    keyEnv: 'SILICONFLOW_API_KEY',
    thinkingStyle: 'none',
    detailStyle: 'none',
    caps: ['grounding', 'ocr', 'doc', 'multi_image', 'json_output'],
    defaultCaps: ['grounding', 'ocr', 'multi_image'],
    notes: {
      grounding: '托管的是开源权重，定位约定跟随所选模型（Qwen 系为 bbox_2d 绝对像素，GLM 系为 0-1000 归一化）。',
    },
    docs: 'https://docs.siliconflow.cn/',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter（聚合）',
    labelEn: 'OpenRouter (aggregator)',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'qwen/qwen2.5-vl-72b-instruct',
    keyEnv: 'OPENROUTER_API_KEY',
    thinkingStyle: 'none',
    detailStyle: 'image_url',
    caps: ['grounding', 'ocr', 'doc', 'high_res', 'multi_image', 'json_output'],
    defaultCaps: ['ocr', 'doc', 'multi_image'],
    docs: 'https://openrouter.ai/docs',
  },
  {
    id: 'ollama',
    label: '本地 Ollama / vLLM（OpenAI 兼容）',
    labelEn: 'Local Ollama / vLLM (OpenAI-compatible)',
    baseUrl: 'http://127.0.0.1:11434/v1',
    model: 'qwen2.5vl:7b',
    keyEnv: 'OLLAMA_API_KEY',
    thinkingStyle: 'none',
    detailStyle: 'none',
    caps: ['grounding', 'ocr', 'doc', 'multi_image', 'json_output'],
    defaultCaps: ['grounding', 'ocr'],
    notes: {
      grounding: '本地部署常需自行缩放图片；坐标基准以模型实际收到的分辨率为准，务必让它回报宽高。',
    },
    docs: 'https://ollama.com/blog/openai-compatibility',
  },
  {
    id: 'custom',
    label: '自定义（任意 OpenAI 兼容服务）',
    labelEn: 'Custom (any OpenAI-compatible service)',
    baseUrl: '',
    model: '',
    keyEnv: 'VISION_API_KEY',
    thinkingStyle: 'none',
    detailStyle: 'image_url',
    caps: ['grounding', 'ocr', 'doc', 'video', 'gui', 'thinking', 'high_res', 'multi_image', 'json_output'],
    defaultCaps: ['multi_image'],
    docs: '',
  },
]

/** 默认供应商 id。 */
export const DEFAULT_PROVIDER = 'ark'

/**
 * 按 id 取供应商预设。
 * @param {string} id 供应商 id
 * @returns {object} 命中的预设；未命中时回落到默认供应商
 */
export function providerById(id) {
  for (const provider of PROVIDERS) {
    if (provider.id === id) return provider
  }
  for (const provider of PROVIDERS) {
    if (provider.id === DEFAULT_PROVIDER) return provider
  }
  return PROVIDERS[0]
}

/**
 * 按 id 取能力定义。
 * @param {string} id 能力 id
 * @returns {object|undefined} 能力定义
 */
export function capabilityById(id) {
  for (const capability of CAPABILITIES) {
    if (capability.id === id) return capability
  }
  return undefined
}
