// 会话体验 —— Host 半
// 只转发经过形状校验的队列动作到权威 sessionController。
return {
  apply(ctx) {
    function queueAction(value) {
      if (!value || typeof value !== 'object') throw new Error('队列动作无效')
      if (value.kind === 'remove' || value.kind === 'steer') return { kind: value.kind }
      if (value.kind !== 'edit' || !Array.isArray(value.content) || value.content.length === 0) {
        throw new Error('队列编辑内容无效')
      }
      const content = value.content.map(block => {
        if (!block || block.type !== 'text' || typeof block.text !== 'string') {
          throw new Error('队列编辑只接受文本内容')
        }
        return { type: 'text', text: block.text }
      })
      return { kind: 'edit', content }
    }

    harness.handle('flowui.queue.update', args => {
      const sessionController = ctx.get('sessionController')
      if (!sessionController) throw new Error('会话体验：sessionController 服务不可用')
      if (!args || typeof args.sessionId !== 'string' || args.sessionId === '') {
        throw new Error('缺少会话 ID')
      }
      if (typeof args.itemId !== 'string' || args.itemId === '') {
        throw new Error('缺少队列消息 ID')
      }
      return sessionController.updateQueue({
        sessionId: args.sessionId,
        itemId: args.itemId,
        action: queueAction(args.action),
      })
    })
  },
}
