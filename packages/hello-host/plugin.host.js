// 无 UI 的 host 插件（声明式加载）：DSH 通过 agent.cordis.yml 行自动挂载。
// 形式：CommonJS module.exports = { inject, apply }。挂载即生效，无需 define/dynamic 注册。
module.exports = {
  inject: ['subprocess'],
  apply(ctx) {
    console.log('[hello-host] 已自动挂载（声明式无 UI 插件，重启自动加载）')
    // 示例能力：挂载时把当前时间写入 ~/.dsh/hang-plugins/.last-mount
    const sub = ctx.get('subprocess')
    if (sub === undefined) return
    const handle = sub.spawn({
      argv: ['/bin/bash', '-c', 'date "+%Y-%m-%d %H:%M:%S" > /Users/fuhangbo/.dsh/hang-plugins/.last-mount'],
      cwd: '/',
      stdio: { stdin: 'ignore', stdout: { maxBytes: 8192 }, stderr: { maxBytes: 4096 } },
      graceMs: 2000,
    })
    handle.done.catch(() => { /* 忽略 */ })
  },
}
