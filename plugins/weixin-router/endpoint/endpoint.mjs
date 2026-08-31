// weixin-router endpoint —— 独立子进程（普通 Node，可自由 import）
//
// 职责（与 host 的文件队列协作）：
//   1. 微信协议轮询：notifyStart → getUpdates 循环（保活），收到文本消息 →
//      append ~/.dsh/weixin-chatroom/inbox.jsonl
//   2. 发送队列：每 1s 检查 outbox.jsonl，逐条 sendMessageWeixin，
//      成功后才从 outbox 移除该行
// Host（Hang 插件，受限函数体）只做路由/处理，通过这两个文件与本进程通信。
import { appendFile, readFile, writeFile, mkdir } from 'node:fs/promises'
import { getUpdates, notifyStart } from '/opt/homebrew/lib/node_modules/dsh-weixin-gateway/lib/weixin/api/api.js'
import { sendMessageWeixin } from '/opt/homebrew/lib/node_modules/dsh-weixin-gateway/lib/weixin/send.js'
import { MessageItemType } from '/opt/homebrew/lib/node_modules/dsh-weixin-gateway/lib/weixin/api/types.js'

const ROOM = '/Users/fuhangbo/.dsh/weixin-chatroom'
const INBOX = `${ROOM}/inbox.jsonl`
const OUTBOX = `${ROOM}/outbox.jsonl`
const WX_DIR = '/Users/fuhangbo/.openclaw/openclaw-weixin'
const ACCOUNTS_DIR = `${WX_DIR}/accounts`
const POLL_INTERVAL_MS = 1000

async function loadAccount() {
  let index = []
  try { index = JSON.parse(await readFile(`${WX_DIR}/accounts.json`, 'utf8')) } catch { index = [] }
  if (!Array.isArray(index) || index.length === 0) throw new Error('没有已登录的微信账号')
  const accountId = index[index.length - 1]
  const acc = JSON.parse(await readFile(`${ACCOUNTS_DIR}/${accountId}.json`, 'utf8'))
  let tokens = {}
  try { tokens = JSON.parse(await readFile(`${ACCOUNTS_DIR}/${accountId}.context-tokens.json`, 'utf8')) } catch { tokens = {} }
  return { accountId, token: acc.token, baseUrl: acc.baseUrl, userId: acc.userId, tokens }
}

async function recordInbox(msg) {
  await mkdir(ROOM, { recursive: true })
  const entry = {
    ts: new Date().toISOString(),
    id: (msg.item_id ?? '') || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    from: msg.from_user_id ?? '',
    contextToken: msg.context_token ?? '',
    text: extractText(msg),
  }
  if (!entry.text) return false
  await appendFile(INBOX, JSON.stringify(entry) + '\n', 'utf8')
  return true
}

function extractText(msg) {
  const items = msg.item_list || []
  for (const item of items) {
    if (item && item.type === MessageItemType.TEXT && item.text_item && item.text_item.text != null) {
      return String(item.text_item.text)
    }
  }
  return ''
}

async function drainOutbox(account) {
  let raw = ''
  try { raw = await readFile(OUTBOX, 'utf8') } catch { return }
  if (!raw.trim()) return
  const lines = raw.split('\n').filter(Boolean)
  const remaining = []
  for (const line of lines) {
    let job
    try { job = JSON.parse(line) } catch { remaining.push(line); continue }
    try {
      const ctxToken = job.contextToken || account.tokens[job.to]
      await sendMessageWeixin({
        to: job.to,
        text: job.text,
        opts: { baseUrl: account.baseUrl, token: account.token, contextToken: ctxToken },
      })
      // 发送成功 → 不保留这行
    } catch (err) {
      console.error(`[wxr-endpoint] send failed to=${job.to}: ${String(err && err.message || err)}`)
      remaining.push(line) // 失败保留，下轮重试
    }
  }
  await writeFile(OUTBOX, remaining.join('\n') + (remaining.length ? '\n' : ''), 'utf8')
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const account = await loadAccount()
  await notifyStart({ baseUrl: account.baseUrl, token: account.token }).catch(() => {})
  console.log(`[wxr-endpoint] started, account=${account.accountId}, polling…`)
  let buf = ''
  let timeoutCount = 0
  while (true) {
    try {
      const resp = await getUpdates({
        baseUrl: account.baseUrl,
        token: account.token,
        get_updates_buf: buf,
        timeoutMs: 30000,
      }).catch((err) => {
        if (String(err).includes('abort')) throw err
        console.error(`[wxr-endpoint] getUpdates error: ${String(err && err.message || err)}`)
        return null
      })
      if (!resp) { await sleep(POLL_INTERVAL_MS); continue }
      buf = resp.get_updates_buf ?? buf
      if (resp.errcode === -14) {
        timeoutCount++
        if (timeoutCount >= 3) {
          console.error('[wxr-endpoint] 微信会话失效（-14），5 分钟后重试；如仍失败请重新扫码 dsh-weixin login')
          await sleep(300000)
          timeoutCount = 0
        } else { await sleep(5000) }
        continue
      }
      timeoutCount = 0
      for (const msg of resp.msgs ?? []) {
        try { await recordInbox(msg) } catch (err) { console.error(`[wxr-endpoint] record inbox: ${String(err)}`) }
      }
      await drainOutbox(account)
    } catch (err) {
      console.error(`[wxr-endpoint] poll loop: ${String(err && err.message || err)}`)
      await sleep(POLL_INTERVAL_MS)
    }
  }
}

main().catch((err) => { console.error(`[wxr-endpoint] fatal: ${String(err && err.message || err)}`); process.exit(1) })