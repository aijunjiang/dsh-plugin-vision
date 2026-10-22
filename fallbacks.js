// dsh-plugin-vision —— 可脱离宿主依赖的纯逻辑。
//
// 存在的理由：index.js 顶层 import 了 @deepseek-ai/schemastery，缺这个包时整个
// 文件连解析都过不去，指向它的测试只能整组跳过。凡是「不需要 Cordis 上下文、
// 也不需要 schemastery」的逻辑都下沉到这里，保证本地与 CI 都能真跑。

/**
 * 把两个 latest 来源合并成一条「旧 → 新」的时间线。
 *
 * 顺序约定：接收端点 inbox（按收到时间旧→新）在前，会话附件在后。
 * 理由是会话附件代表用户**此刻**刚拖进输入框的图，应当压过此前推送上来的。
 * listInbox 返回新→旧，这里的反转与它配套，两处必须一起看。
 *
 * @param {Array<object>} sessionRefs 会话附件 ref（会话顺序，旧→新）
 * @param {Array<object>} inboxItems listInbox 的输出（新→旧）
 * @returns {Array<{kind: 'inbox'|'session', ref: object}>} 合成后的时间线（旧→新）
 */
export function mergeLatestSources(sessionRefs, inboxItems) {
  const fromInbox = (Array.isArray(inboxItems) ? inboxItems : []).slice().reverse().map(item => ({
    kind: 'inbox',
    ref: {
      attachmentId: item.id,
      mediaType: item.mediaType,
      bytes: item.bytes,
      width: item.width,
      height: item.height,
      ...(item.name !== undefined && item.name !== '' ? { name: item.name } : {}),
    },
  }))
  const fromSession = (Array.isArray(sessionRefs) ? sessionRefs : []).map(ref => ({ kind: 'session', ref }))
  return fromInbox.concat(fromSession)
}

/**
 * 判断某个错误是不是「本地路径读不到」。
 *
 * 这类失败的语义很特殊：图片很可能在开发机上而不在宿主机上，所以调用方要给出的
 * 不是「换个路径试试」，而是「改用推送或先把文件传过来」。把它单列出来，是为了让
 * 降级提示只在这种情况出现，而不是对任何错误都糊一段建议。
 *
 * @param {unknown} error 任意错误
 * @returns {boolean} 是否属于路径不可读
 */
export function isUnreadablePath(error) {
  if (error === null || typeof error !== 'object') return false
  const code = typeof error.code === 'string' ? error.code : ''
  if (code === 'ENOENT' || code === 'EACCES' || code === 'EISDIR' || code === 'ENOTDIR') return true
  const message = typeof error.message === 'string' ? error.message : ''
  return /ENOENT|no such file|not found|读不到|permission denied/i.test(message)
}
