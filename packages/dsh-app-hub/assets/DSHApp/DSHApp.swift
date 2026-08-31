// DSH — native macOS shell for the officially published DeepSeek Harness CLI.
import AppKit
import WebKit
import Foundation

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKScriptMessageHandler {
    private var window: NSWindow!
    private var webView: WKWebView!
    private var startupPage: StartupPageController!
    private var appliedPageTheme: String?

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        buildMenu()
        buildWindow()
        showWindow()
        prepareAndStart()
    }

    private func prepareAndStart() {
        startupPage.showProgress(title: "正在启动 DeepSeek Harness", detail: "正在检查正式 dsh 运行时…", logName: nil)
        RuntimeInstaller.shared.prepare(
            status: { [weak self] title, detail, logName in
                self?.startupPage.showProgress(title: title, detail: detail, logName: logName)
            },
            completion: { [weak self] result in
                guard let self else { return }
                switch result {
                case .failure(let error):
                    self.startupPage.showStatus(title: "DeepSeek Harness 准备失败", detail: error.localizedDescription, isError: true)
                case .success(let launch):
                    self.startupPage.showProgress(title: "正在启动 DeepSeek Harness", detail: "正式 dsh 已就绪，正在启动 web 服务…", logName: "server.log")
                    ServerManager.shared.start(dsh: launch.dsh, overlay: launch.overlay) { result in
                        self.handleStartup(result)
                    }
                }
            }
        )
    }

    private func handleStartup(_ result: StartupResult) {
        switch result {
        case .ready(let url):
            startupPage.stop()
            webView.load(URLRequest(url: url))
        case .failure(let message):
            startupPage.showStatus(title: "DeepSeek Harness 启动失败", detail: message, isError: true)
        }
    }

    private func buildMenu() {
        let mainMenu = NSMenu()

        let appItem = NSMenuItem()
        mainMenu.addItem(appItem)
        let appMenu = NSMenu(title: "DSH")
        appMenu.addItem(withTitle: "关于 DSH", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "").target = NSApp
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "重启 APP", action: #selector(restartApplication(_:)), keyEquivalent: "").target = self
        appMenu.addItem(.separator())
        let servicesItem = NSMenuItem(title: "服务", action: nil, keyEquivalent: "")
        let servicesMenu = NSMenu(title: "服务")
        servicesItem.submenu = servicesMenu
        appMenu.addItem(servicesItem)
        NSApp.servicesMenu = servicesMenu
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "隐藏 DSH", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h").target = NSApp
        let hideOthers = appMenu.addItem(withTitle: "隐藏其他", action: #selector(NSApplication.hideOtherApplications(_:)), keyEquivalent: "h")
        hideOthers.keyEquivalentModifierMask = [.command, .option]
        hideOthers.target = NSApp
        appMenu.addItem(withTitle: "全部显示", action: #selector(NSApplication.unhideAllApplications(_:)), keyEquivalent: "").target = NSApp
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "退出 DSH", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q").target = NSApp
        appItem.submenu = appMenu

        let editItem = NSMenuItem()
        mainMenu.addItem(editItem)
        let editMenu = NSMenu(title: "编辑")
        editMenu.addItem(withTitle: "撤销", action: Selector(("undo:")), keyEquivalent: "z")
        editMenu.addItem(withTitle: "重做", action: Selector(("redo:")), keyEquivalent: "Z")
        editMenu.addItem(.separator())
        editMenu.addItem(withTitle: "剪切", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "复制", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "粘贴", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: "全选", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = editMenu

        let viewItem = NSMenuItem()
        mainMenu.addItem(viewItem)
        let viewMenu = NSMenu(title: "显示")
        viewMenu.addItem(withTitle: "刷新页面", action: #selector(reloadPage(_:)), keyEquivalent: "r").target = self
        viewMenu.addItem(.separator())
        let fullScreen = viewMenu.addItem(withTitle: "进入全屏幕", action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f")
        fullScreen.keyEquivalentModifierMask = [.command, .control]
        viewItem.submenu = viewMenu

        let windowItem = NSMenuItem()
        mainMenu.addItem(windowItem)
        let windowMenu = NSMenu(title: "窗口")
        windowMenu.addItem(withTitle: "最小化", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        windowMenu.addItem(withTitle: "缩放", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
        windowMenu.addItem(.separator())
        windowMenu.addItem(withTitle: "前置全部窗口", action: #selector(NSApplication.arrangeInFront(_:)), keyEquivalent: "")
        windowItem.submenu = windowMenu
        NSApp.windowsMenu = windowMenu

        NSApp.mainMenu = mainMenu
    }

    private func buildWindow() {
        let rect = NSRect(x: 0, y: 0, width: 1280, height: 820)
        window = DSHWindow(
            contentRect: rect,
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        window.title = "DeepSeek Harness"
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.titlebarSeparatorStyle = .none
        window.setFrameAutosaveName("DSHMainWindow")
        applyStartupThemePreference()

        let titlebarHeight = max(0, window.frame.height - window.contentLayoutRect.height)
        (window as? DSHWindow)?.dragRegionHeight = titlebarHeight
        let titlebarCSSHeight = String(format: "%.1f", locale: Locale(identifier: "en_US_POSIX"), titlebarHeight)

        let config = WKWebViewConfiguration()
        config.userContentController.add(self, name: "dshAppearance")
        let themeScript = WKUserScript(
            source: """
            (() => {
              const style = document.createElement('style')
              style.textContent = `
                #root > .dsh-native-titlebar-frame {
                  box-sizing: border-box;
                  padding-top: \(titlebarCSSHeight)px;
                }
                #root > .dsh-native-titlebar-frame > :first-child {
                  box-shadow: 0 -\(titlebarCSSHeight)px 0 var(--dsw-specific-sidebar-fill);
                }
              `

              const markFrame = () => {
                const frame = document.getElementById('root')?.firstElementChild
                if (!frame) return false
                frame.classList.add('dsh-native-titlebar-frame')
                return true
              }
              const isDark = () => {
                const body = document.body
                const html = document.documentElement
                if (body?.hasAttribute('data-ds-dark-theme') || html.hasAttribute('data-ds-dark-theme')) return true
                const colorScheme = getComputedStyle(html).colorScheme
                if (colorScheme === 'dark') return true
                if (colorScheme === 'light') return false
                return window.matchMedia?.('(prefers-color-scheme: dark)').matches === true
              }
              const report = () => {
                window.webkit?.messageHandlers?.dshAppearance?.postMessage(isDark() ? 'dark' : 'light')
              }
              window.dshReportAppearance = report

              const attach = () => {
                if (!document.head || !document.body) {
                  window.setTimeout(attach, 20)
                  return
                }
                document.head.appendChild(style)
                if (!markFrame()) {
                  const frameObserver = new MutationObserver(() => {
                    if (markFrame()) frameObserver.disconnect()
                  })
                  frameObserver.observe(document.body, { childList: true, subtree: true })
                }
                const themeObserver = new MutationObserver(report)
                themeObserver.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })
                themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-ds-dark-theme', 'style'] })
                window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener('change', report)
                report()
              }
              attach()
            })()
            """,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        )
        config.userContentController.addUserScript(themeScript)
        let content = NSView(frame: rect)
        content.autoresizingMask = [.width, .height]
        webView = WKWebView(frame: content.bounds, configuration: config)
        webView.autoresizingMask = [.width, .height]
        webView.navigationDelegate = self
        startupPage = StartupPageController(webView: webView)
        content.addSubview(webView)
        let dragView = TitlebarDragView(frame: NSRect(
            x: 0,
            y: content.bounds.height - titlebarHeight,
            width: content.bounds.width,
            height: titlebarHeight
        ))
        dragView.autoresizingMask = [.width, .minYMargin]
        dragView.setAccessibilityElement(false)
        content.addSubview(dragView)
        window.contentView = content
        window.center()
    }

    private func applyStartupThemePreference() {
        let path = Env.dshHome + "/settings.yaml"
        guard let text = try? String(contentsOfFile: path, encoding: .utf8),
              let range = text.range(of: "ui-theme:") else { return }
        let tail = String(text[range.upperBound...])
        guard let line = tail.components(separatedBy: "\n").first(where: {
            $0.trimmingCharacters(in: .whitespaces).hasPrefix("preference:")
        }) else { return }
        let preference = line.replacingOccurrences(of: "preference:", with: "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if preference == "dark" {
            window.appearance = NSAppearance(named: .darkAqua)
        } else if preference == "light" {
            window.appearance = NSAppearance(named: .aqua)
        }
    }

    private func showWindow() {
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    @objc private func restartApplication(_ sender: Any?) {
        let relauncher = Process()
        relauncher.executableURL = URL(fileURLWithPath: "/usr/bin/nohup")
        relauncher.arguments = [
            "/bin/bash",
            "-c",
            "sleep 1; /usr/bin/open \"$1\"",
            "dsh-relaunch",
            Bundle.main.bundlePath,
        ]
        relauncher.standardOutput = FileHandle.nullDevice
        relauncher.standardError = FileHandle.nullDevice
        do {
            try relauncher.run()
            NSApp.terminate(nil)
        } catch {
            startupPage.showStatus(title: "DSH.app 重启失败", detail: error.localizedDescription, isError: true)
        }
    }

    @objc private func reloadPage(_ sender: Any?) {
        webView.reload()
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        webView.evaluateJavaScript("window.dshReportAppearance && window.dshReportAppearance()")
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "dshAppearance",
              let theme = message.body as? String,
              theme == "dark" || theme == "light" else { return }
        applyPageTheme(theme)
    }

    private func applyPageTheme(_ theme: String) {
        guard appliedPageTheme != theme else { return }
        appliedPageTheme = theme
        window.appearance = NSAppearance(named: theme == "dark" ? .darkAqua : .aqua)
        appendAppearanceLog("page=\(theme) window=\(window.appearance?.name.rawValue ?? "system")")
    }

    private func appendAppearanceLog(_ message: String) {
        let path = Env.runtimeDir + "/appearance.log"
        let line = ISO8601DateFormatter().string(from: Date()) + " [DSHApp] " + message + "\n"
        if let handle = FileHandle(forWritingAtPath: path) {
            handle.seekToEndOfFile()
            handle.write(line.data(using: .utf8)!)
            try? handle.close()
        } else {
            try? line.write(toFile: path, atomically: true, encoding: .utf8)
        }
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        startupPage.showStatus(title: "DeepSeek Harness 页面加载失败", detail: error.localizedDescription, isError: true)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
    func applicationWillTerminate(_ notification: Notification) {
        ServerManager.shared.stopOwnedServer()
    }
}

@main
struct DSHApplication {
    static func main() {
        let appDelegate = AppDelegate()
        NSApplication.shared.delegate = appDelegate
        _ = NSApplicationMain(CommandLine.argc, CommandLine.unsafeArgv)
    }
}
