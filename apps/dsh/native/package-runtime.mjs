import ChildProcess from 'node:child_process'
import Crypto from 'node:crypto'
import Fs from 'node:fs'
import Os from 'node:os'
import Path from 'node:path'

const [repositoryRoot, resourcesDirectory, appVersion] = process.argv.slice(2)
if (!repositoryRoot || !resourcesDirectory || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(appVersion || '')) {
  throw new Error('用法：node package-runtime.mjs <repository-root> <resources-directory> <app-version>')
}

const packagesDirectory = Path.join(resourcesDirectory, 'packages')
const workDirectory = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'dsh-app-packages-'))

function readManifest(directory) {
  return JSON.parse(Fs.readFileSync(Path.join(directory, 'package.json'), 'utf8'))
}

function pack(directory) {
  const output = ChildProcess.execFileSync('npm', ['pack', '--json', '--pack-destination', packagesDirectory], {
    cwd: directory,
    encoding: 'utf8',
  })
  const rows = JSON.parse(output)
  if (rows.length !== 1 || !rows[0].filename) throw new Error('npm pack 没有返回唯一的软件包')
  const filename = rows[0].filename
  const data = Fs.readFileSync(Path.join(packagesDirectory, filename))
  return { filename, sha256: Crypto.createHash('sha256').update(data).digest('hex') }
}

try {
  Fs.rmSync(packagesDirectory, { recursive: true, force: true })
  Fs.rmSync(Path.join(resourcesDirectory, 'desktop-runtime'), { recursive: true, force: true })
  Fs.mkdirSync(packagesDirectory, { recursive: true })

  const desktopSource = Path.join(repositoryRoot, 'apps/dsh/desktop-runtime')
  const desktopWork = Path.join(workDirectory, 'desktop-runtime')
  Fs.cpSync(desktopSource, desktopWork, {
    recursive: true,
    filter: source => Path.basename(source) !== 'node_modules',
  })
  const desktopManifest = readManifest(desktopWork)
  desktopManifest.version = appVersion
  Fs.writeFileSync(Path.join(desktopWork, 'package.json'), JSON.stringify(desktopManifest, null, 2) + '\n')

  const managerSource = Path.join(repositoryRoot, 'plugins/hang-dsh-plugins')
  const managerManifest = readManifest(managerSource)
  const desktopArchive = pack(desktopWork)
  const managerArchive = pack(managerSource)
  const manifest = {
    schemaVersion: 1,
    desktopRuntime: {
      name: desktopManifest.name,
      version: desktopManifest.version,
      archive: desktopArchive.filename,
      sha256: desktopArchive.sha256,
    },
    pluginManager: {
      name: managerManifest.name,
      version: managerManifest.version,
      archive: managerArchive.filename,
      sha256: managerArchive.sha256,
    },
  }
  Fs.writeFileSync(Path.join(packagesDirectory, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
} finally {
  Fs.rmSync(workDirectory, { recursive: true, force: true })
}
