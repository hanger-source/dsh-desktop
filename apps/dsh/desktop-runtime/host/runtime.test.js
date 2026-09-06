'use strict'

const Assert = require('node:assert/strict')
const Test = require('node:test')
const { VersionService } = require('./versions.js')

Test('初始版本状态只读取本机，不触发远端检查', async () => {
  const service = new VersionService({
    appVersion: '1.2.3',
    appBundlePath: '/Applications/DSH.app',
    dshExecutable: '/bin/false',
    dshHome: '/tmp/dsh-runtime-test',
    repository: 'hanger-source/dsh-desktop',
    commandEnvironment: process.env,
  })
  const status = await service.status()
  Assert.equal(status.app.installed, '1.2.3')
  Assert.equal(status.app.latest, null)
  Assert.equal(status.app.updateAvailable, null)
  Assert.deepEqual(Object.keys(status).sort(), ['app', 'dsh', 'pluginManager'])
  Assert.equal(status.pluginManager.latest, null)
  Assert.equal(typeof status.pluginManager.error, 'string')
  Assert.ok(status.pluginManager.error.length > 0)
})
