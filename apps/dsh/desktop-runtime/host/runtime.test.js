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

Test('远端检查跟随 DSH next 发布通道', async () => {
  const service = new VersionService({
    appVersion: '1.2.3',
    appBundlePath: '/Applications/DSH.app',
    dshVersion: '0.1.5-rc.3',
    dshExecutable: '/bin/false',
    dshHome: '/tmp/dsh-runtime-test',
    repository: 'hanger-source/dsh-desktop',
    commandEnvironment: process.env,
    requestJson: async url => {
      Assert.equal(url, 'https://registry.npmjs.org/@deepseek-ai/dsh/next')
      return { version: '0.1.7-rc.1' }
    },
  })
  service.localStatus = async () => ({
    app: service.localAppStatus(),
    pluginManager: service.localPluginManagerStatus(new Map()),
    dsh: service.localDshStatus(),
  })
  service.remoteTags = async () => ['dsh-app-v1.2.3', 'plugin-hang-dsh-plugins-v0.2.1']

  const status = await service.check()
  Assert.equal(status.dsh.latest, '0.1.7-rc.1')
  Assert.equal(status.dsh.updateAvailable, true)
})
