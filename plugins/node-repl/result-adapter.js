function base64Value(code) {
  if (code >= 65 && code <= 90) return code - 65
  if (code >= 97 && code <= 122) return code - 71
  if (code >= 48 && code <= 57) return code + 4
  if (code === 43) return 62
  if (code === 47) return 63
  return -1
}

function validateBase64(data) {
  if (typeof data !== 'string' || data.length === 0 || data.length % 4 !== 0) {
    throw new Error('node-repl: MCP 图片不是完整的 base64')
  }
  const padding = data.endsWith('==') ? 2 : (data.endsWith('=') ? 1 : 0)
  for (let offset = 0; offset < data.length; offset += 4) {
    const a = base64Value(data.charCodeAt(offset))
    const b = base64Value(data.charCodeAt(offset + 1))
    const last = offset + 4 === data.length
    const cPadding = data.charCodeAt(offset + 2) === 61
    const dPadding = data.charCodeAt(offset + 3) === 61
    const c = cPadding ? 0 : base64Value(data.charCodeAt(offset + 2))
    const d = dPadding ? 0 : base64Value(data.charCodeAt(offset + 3))
    if (a < 0 || b < 0 || c < 0 || d < 0 || (!last && (cPadding || dPadding))) {
      throw new Error('node-repl: MCP 图片包含无效的 base64')
    }
    if (cPadding && (!dPadding || (b & 15) !== 0)) throw new Error('node-repl: MCP 图片不是规范 base64')
    if (!cPadding && dPadding && (c & 3) !== 0) throw new Error('node-repl: MCP 图片不是规范 base64')
  }
  return (data.length / 4) * 3 - padding
}

function resultText(value) {
  if (!value || !Array.isArray(value.content)) return JSON.stringify(value)
  const text = value.content
    .filter(block => block && block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text)
    .join('\n')
  return text || JSON.stringify(value)
}

export function createResultAdapter(ctx, options) {
  async function decodeBase64(data) {
    const expectedBytes = validateBase64(data)
    // Dynamic host code runs in a VM realm. Managed subprocess stdout yields
    // host-realm Buffer chunks accepted by the attachment image decoder.
    const decoder = ctx.subprocess.spawn({
      argv: [options.base64Executable, '-D'],
      cwd: options.dshHome,
      env: {},
      stdio: { stdin: { data }, stdout: 'pipe', stderr: 'inherit' },
      graceMs: 2000,
    })
    if (!decoder.stdout) {
      decoder.terminate()
      throw new Error('node-repl: base64 解码器没有可用的 stdout')
    }
    const chunks = []
    decoder.stdout.on('data', chunk => chunks.push(chunk))
    const outcome = await decoder.done
    if (outcome.exitCode !== 0) throw new Error('node-repl: MCP 图片 base64 解码失败')
    if (chunks.length === 0) throw new Error('node-repl: MCP 图片 base64 解码结果为空')
    const bytes = chunks.length === 1 ? chunks[0] : chunks[0].constructor.concat(chunks)
    if (bytes.byteLength !== expectedBytes) throw new Error('node-repl: MCP 图片 base64 解码长度不匹配')
    console.log('node-repl: MCP 图片已解码', {
      bytes: bytes.byteLength,
      constructor: bytes.constructor && bytes.constructor.name,
      firstBytes: Array.from(bytes.subarray(0, 8)),
    })
    return bytes
  }

  async function persistResultImages(value) {
    if (!value || !Array.isArray(value.content)) return value
    const imageBlocks = value.content.filter(block => block && block.type === 'image')
    if (imageBlocks.length === 0) return value
    const decoded = []
    for (const block of imageBlocks) {
      if (typeof block.mimeType !== 'string') throw new Error('node-repl: MCP 图片缺少 mimeType')
      decoded.push({ data: await decodeBase64(block.data), mediaType: block.mimeType })
    }
    let refs
    try {
      refs = await options.attachments.saveImages(decoded)
    } catch (error) {
      console.error(
        'node-repl: MCP 图片附件持久化失败',
        String((error && error.message) || error),
        String((error && error.cause && error.cause.message) || ''),
      )
      throw error
    }
    let imageIndex = 0
    return {
      ...value,
      content: value.content.map(block => block && block.type === 'image'
        ? { type: 'image', attachment: refs[imageIndex++] }
        : block),
    }
  }

  return {
    resultText,
    render(_args, value) {
      if (value && Array.isArray(value.content)) {
        const blocks = value.content.filter(block => block && typeof block.type === 'string')
        if (blocks.length > 0) return blocks
      }
      return [{ type: 'text', text: resultText(value) }]
    },
    persistResultImages,
  }
}
