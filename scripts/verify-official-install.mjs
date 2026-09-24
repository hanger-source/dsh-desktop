import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoDir = resolve(fileURLToPath(new URL('..', import.meta.url)))
const verifyDir = mkdtempSync(join(tmpdir(), 'hang-dsh-plugins-'))
const packageDir = join(verifyDir, 'package')
const dshHome = join(verifyDir, 'dsh-home')
const npmCli = process.env.npm_execpath
if (!npmCli) throw new Error('verify:official must be run through npm so the npm CLI entrypoint is available')
const env = {
  ...process.env,
  DSH_HOME: dshHome,
  npm_config_registry: process.env.npm_config_registry ?? 'https://registry.npmjs.org',
}

mkdirSync(packageDir, { recursive: true })

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoDir,
    env,
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    if (options.capture) {
      process.stderr.write(result.stdout ?? '')
      process.stderr.write(result.stderr ?? '')
    }
    throw new Error(`${command} exited with status ${result.status}`)
  }
  return result.stdout ?? ''
}

const globalNodeModules = run(process.execPath, [npmCli, 'root', '--global'], { capture: true }).trim()
const dshPackageDir = join(globalNodeModules, '@deepseek-ai', 'dsh')
const dshManifest = JSON.parse(readFileSync(join(dshPackageDir, 'package.json'), 'utf8'))
const dshBin = typeof dshManifest.bin === 'string' ? dshManifest.bin : dshManifest.bin?.dsh
if (!dshBin) throw new Error('the installed @deepseek-ai/dsh package does not declare a dsh executable')
const dshCli = join(dshPackageDir, dshBin)

let installSpec = process.argv[2]
if (!installSpec) {
  const packResult = JSON.parse(run(process.execPath, [
    npmCli,
    'pack',
    repoDir,
    '--pack-destination',
    packageDir,
    '--json',
  ], { capture: true }))
  installSpec = join(packageDir, packResult[0].filename)
}

run(process.execPath, [dshCli, 'integration', '--from-default-profile', 'web', '--dump-config'], { capture: true })
run(process.execPath, [dshCli, 'plugin', '--profile', 'integration', 'add', installSpec, '--save-exact'])

const installedPackageDir = join(
  dshHome,
  'profiles',
  'integration',
  'node_modules',
  '@hanger-source',
  'hang-dsh-plugins',
)
run(process.execPath, [join(repoDir, 'scripts', 'check-node-repl-runtime.mjs'), installedPackageDir])

const composedConfig = run(process.execPath, [dshCli, 'integration', '--dump-config'], { capture: true })
for (const rowId of [
  'hanger-conversation-experience',
  'hanger-quota-monitor',
  'hanger-node-repl',
]) {
  if (!composedConfig.includes(rowId)) {
    throw new Error(`official composed config is missing ${rowId}`)
  }
}

const runtime = spawn(process.execPath, [dshCli, 'integration', '--no-open', '--port', '0'], {
  cwd: repoDir,
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
})
let runtimeOutput = ''
runtime.stdout.setEncoding('utf8')
runtime.stderr.setEncoding('utf8')

const runtimeUrl = await new Promise((resolveUrl, reject) => {
  const timeout = setTimeout(() => reject(new Error(`official DSH host did not become ready\n${runtimeOutput}`)), 60_000)
  const consume = (chunk) => {
    runtimeOutput += chunk
    const match = runtimeOutput.match(/http:\/\/127\.0\.0\.1:\d+\/\?token=\S+/)
    if (!match) return
    clearTimeout(timeout)
    resolveUrl(match[0])
  }
  runtime.stdout.on('data', consume)
  runtime.stderr.on('data', consume)
  runtime.once('exit', (code) => {
    clearTimeout(timeout)
    reject(new Error(`official DSH host exited with status ${code}\n${runtimeOutput}`))
  })
})

try {
  if (/did not activate|启用失败/.test(runtimeOutput)) {
    throw new Error(`official DSH host reported a plugin activation failure\n${runtimeOutput}`)
  }
  const authResponse = await fetch(runtimeUrl, { redirect: 'manual' })
  const cookie = authResponse.headers.get('set-cookie')?.split(';', 1)[0]
  if (!cookie) throw new Error('official DSH host did not issue an authentication cookie')
  const origin = runtimeUrl.slice(0, runtimeUrl.indexOf('/?token='))
  const indexResponse = await fetch(`${origin}/`, { headers: { cookie } })
  if (!indexResponse.ok) throw new Error(`official DSH index returned HTTP ${indexResponse.status}`)
  const indexHtml = await indexResponse.text()
  for (const clientPackage of [
    '@hanger-source/dsh-conversation-experience',
    '@hanger-source/dsh-quota-monitor',
  ]) {
    if (!indexHtml.includes(clientPackage)) {
      throw new Error(`official Client graph is missing ${clientPackage}`)
    }
  }
} finally {
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(runtime.pid), '/t', '/f'], { stdio: 'ignore' })
  } else {
    runtime.kill('SIGINT')
  }
}

console.log(`official DSH install verified: ${installSpec}`)
console.log(`verification workspace retained at: ${verifyDir}`)
