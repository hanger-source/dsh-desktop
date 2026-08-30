// DSH — native macOS shell for the local DeepSeek Harness checkout.
// The app owns one explicit runtime: ~/projects/deepseek-harness/apps/cli/lib/bin.js.
import AppKit
import WebKit
import Foundation

enum Env {
    static let port = 3080
    static var url: URL { URL(string: "http://127.0.0.1:\(port)/")! }
    static var home: String { FileManager.default.homeDirectoryForCurrentUser.path }
    static var dshHome: String {
        ProcessInfo.processInfo.environment["DSH_HOME"] ?? home + "/.dsh"
    }
    static var sourceRoot: String {
        ProcessInfo.processInfo.environment["DSH_SOURCE_ROOT"] ?? home + "/projects/deepseek-harness"
    }
    static var runtimeDir: String { dshHome + "/hang-plugins/.runtime/dsh-app-hub" }
}

enum StartupResult {
    case ready(URL)
    case failed(String)
}

final class ServerManager {
    static let shared = ServerManager()

    private var process: Process?
    private var logHandle: FileHandle?
    private(set) var ownsServer = false

    func isUp(completion: @escaping (Bool) -> Void) {
        var request = URLRequest(url: Env.url)
        request.timeoutInterval = 2
        URLSession.shared.dataTask(with: request) { _, response, _ in
            let up = response is HTTPURLResponse
            DispatchQueue.main.async { completion(up) }
        }.resume()
    }

    func ensureUp(completion: @escaping (StartupResult) -> Void) {
        isUp { up in
            if up {
                completion(.failed("端口 3080 已被现有服务占用。请先关闭该服务，再由 DSH.app 启动并持有它。"))
                return
            }
            self.start(completion: completion)
        }
    }

    func restart(completion: @escaping (StartupResult) -> Void) {
        guard ownsServer else {
            completion(.failed("当前 3080 服务不是由 DSH.app 启动，不能由 App 重启。"))
            return
        }
        stopOwnedServer()
        DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
            self.start(completion: completion)
        }
    }

    private func start(completion: @escaping (StartupResult) -> Void) {
        let cli = Env.sourceRoot + "/apps/cli/lib/bin.js"
        guard FileManager.default.isReadableFile(atPath: cli) else {
            completion(.failed("找不到已构建的 dsh CLI：\n\(cli)\n\n请先在 deepseek-harness 仓库完成构建。"))
            return
        }
        guard let node = findExecutable([
            "/opt/homebrew/bin/node",
            "/usr/local/bin/node",
            Env.home + "/.local/share/fnm/aliases/default/bin/node",
        ]) else {
            completion(.failed("找不到 Node.js。DSH.app 不会在后台安装运行时。"))
            return
        }
        guard let resources = Bundle.main.resourceURL?.appendingPathComponent("dsh-plugins") else {
            completion(.failed("DSH.app 缺少内置插件资源。"))
            return
        }
        let bootPlugin = resources.appendingPathComponent("overlays/web/plugins/dsh-boot.js")
        let overlayTemplate = resources.appendingPathComponent("overlays/web/web-boot.yml")
        guard FileManager.default.isReadableFile(atPath: bootPlugin.path),
              let template = try? String(contentsOf: overlayTemplate, encoding: .utf8) else {
            completion(.failed("DSH.app 内置的 dsh-boot 或 overlay 不完整。"))
            return
        }

        do {
            try FileManager.default.createDirectory(atPath: Env.runtimeDir, withIntermediateDirectories: true)
            let overlayPath = Env.runtimeDir + "/web-boot.generated.yml"
            let overlay = template.replacingOccurrences(of: "__DSH_BOOT_PLUGIN__", with: bootPlugin.path)
            try overlay.write(toFile: overlayPath, atomically: true, encoding: .utf8)

            let logPath = Env.runtimeDir + "/server.log"
            FileManager.default.createFile(atPath: logPath, contents: nil)
            logHandle = FileHandle(forWritingAtPath: logPath)

            var environment = ProcessInfo.processInfo.environment
            environment["PATH"] = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
            environment["DSH_HOME"] = Env.dshHome
            environment["DSH_SOURCE_ROOT"] = Env.sourceRoot
            environment["DSH_PLUGIN_REPO"] = resources.path
            environment["DSH_PARENT_PID"] = String(ProcessInfo.processInfo.processIdentifier)

            let child = Process()
            child.executableURL = URL(fileURLWithPath: node)
            child.arguments = [cli, "--profile", "web", "--patch", overlayPath, "--no-open"]
            child.currentDirectoryURL = URL(fileURLWithPath: Env.sourceRoot)
            child.environment = environment
            child.standardOutput = logHandle
            child.standardError = logHandle
            child.terminationHandler = { [weak self] _ in
                DispatchQueue.main.async {
                    self?.ownsServer = false
                }
            }
            try child.run()
            process = child
            ownsServer = true
            pollUp(attempt: 0, completion: completion)
        } catch {
            completion(.failed("启动 dsh web 失败：\(error.localizedDescription)"))
        }
    }

    private func pollUp(attempt: Int, completion: @escaping (StartupResult) -> Void) {
        if process?.isRunning == false {
            completion(.failed("dsh web 已退出。\n\n" + serverLogTail()))
            return
        }
        if attempt >= 40 {
            completion(.failed("等待 dsh web 超时。\n\n" + serverLogTail()))
            return
        }
        isUp { up in
            if up {
                guard let url = self.serverURL() else {
                    completion(.failed("dsh web 已监听，但 server.log 没有输出带 token 的启动 URL。\n\n" + self.serverLogTail()))
                    return
                }
                completion(.ready(url))
            } else {
                DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
                    self.pollUp(attempt: attempt + 1, completion: completion)
                }
            }
        }
    }

    func runBootstrapInBackground() {
        guard let script = Bundle.main.resourceURL?.appendingPathComponent("bootstrap.sh"),
              FileManager.default.isReadableFile(atPath: script.path) else { return }
        do {
            try FileManager.default.createDirectory(atPath: Env.runtimeDir, withIntermediateDirectories: true)
            let logPath = Env.runtimeDir + "/bootstrap.log"
            FileManager.default.createFile(atPath: logPath, contents: nil)
            let handle = FileHandle(forWritingAtPath: logPath)
            let child = Process()
            child.executableURL = URL(fileURLWithPath: "/bin/bash")
            child.arguments = [script.path]
            var environment = ProcessInfo.processInfo.environment
            environment["DSH_HOME"] = Env.dshHome
            environment["DSH_BOOT_NO_SHELL"] = "1"
            child.environment = environment
            child.standardOutput = handle
            child.standardError = handle
            child.terminationHandler = { _ in try? handle?.close() }
            try child.run()
        } catch {
            appendShellLog("bootstrap start failed: \(error.localizedDescription)")
        }
    }

    func stopOwnedServer() {
        guard ownsServer, let child = process, child.isRunning else {
            process = nil
            ownsServer = false
            return
        }
        Darwin.kill(child.processIdentifier, SIGTERM)
        appendShellLog("quit -> SIGTERM dsh web pid=\(child.processIdentifier)")
        process = nil
        ownsServer = false
        try? logHandle?.close()
        logHandle = nil
    }

    private func findExecutable(_ candidates: [String]) -> String? {
        candidates.first { FileManager.default.isExecutableFile(atPath: $0) }
    }

    private func serverLogTail() -> String {
        let path = Env.runtimeDir + "/server.log"
        guard let text = try? String(contentsOfFile: path, encoding: .utf8) else {
            return "没有生成 server.log"
        }
        return text.split(separator: "\n", omittingEmptySubsequences: false).suffix(30).joined(separator: "\n")
    }

    private func serverURL() -> URL? {
        let path = Env.runtimeDir + "/server.log"
        guard let text = try? String(contentsOfFile: path, encoding: .utf8) else { return nil }
        for line in text.split(separator: "\n").reversed() {
            guard let marker = line.range(of: "dsh web: ") else { continue }
            let value = String(line[marker.upperBound...]).trimmingCharacters(in: .whitespacesAndNewlines)
            if let url = URL(string: value), url.host == "127.0.0.1", url.port == Env.port {
                return url
            }
        }
        return nil
    }

    private func appendShellLog(_ line: String) {
        try? FileManager.default.createDirectory(atPath: Env.runtimeDir, withIntermediateDirectories: true)
        let url = URL(fileURLWithPath: Env.runtimeDir + "/shell.log")
        let data = (ISO8601DateFormatter().string(from: Date()) + " " + line + "\n").data(using: .utf8)!
        if let handle = try? FileHandle(forWritingTo: url) {
            handle.seekToEndOfFile()
            try? handle.write(contentsOf: data)
            try? handle.close()
        } else {
            try? data.write(to: url)
        }
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKScriptMessageHandler {
    private var window: NSWindow!
    private var webView: WKWebView!

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        buildMenu()
        buildWindow()
        showWindow()
        showStatus(title: "正在启动 DeepSeek Harness", detail: "正在启动本机 deepseek-harness 运行时…")
        startServer()
    }

    private func buildMenu() {
        let mainMenu = NSMenu()
        let appItem = NSMenuItem()
        mainMenu.addItem(appItem)
        let appMenu = NSMenu(title: "DSH")
        appMenu.addItem(withTitle: "重启 DSH 服务", action: #selector(restartService(_:)), keyEquivalent: "r").target = self
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "退出 DSH", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
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
        NSApp.mainMenu = mainMenu
    }

    private func buildWindow() {
        let rect = NSRect(x: 0, y: 0, width: 1280, height: 820)
        window = NSWindow(contentRect: rect, styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "DeepSeek Harness"
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.setFrameAutosaveName("DSHMainWindow")

        let config = WKWebViewConfiguration()
        config.userContentController.add(self, name: "dshAppearance")
        let themeScript = WKUserScript(
            source: "(function(){var report=function(){var b=document.body,h=document.documentElement,d=!!(b&&b.hasAttribute('data-ds-dark-theme'));if(!d&&h)d=getComputedStyle(h).colorScheme==='dark';window.webkit.messageHandlers.dshAppearance.postMessage(d?'dark':'light')};new MutationObserver(report).observe(document.documentElement,{attributes:true,subtree:true});setTimeout(report,0)})();",
            injectionTime: .atDocumentEnd,
            forMainFrameOnly: true)
        config.userContentController.addUserScript(themeScript)
        webView = WKWebView(frame: rect, configuration: config)
        webView.autoresizingMask = [.width, .height]
        webView.navigationDelegate = self
        window.contentView = webView
        window.center()
    }

    private func showWindow() {
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    private func startServer() {
        ServerManager.shared.ensureUp { [weak self] result in
            guard let self else { return }
            switch result {
            case .ready(let url):
                self.webView.load(URLRequest(url: url))
                ServerManager.shared.runBootstrapInBackground()
            case .failed(let message):
                self.showStatus(title: "DeepSeek Harness 启动失败", detail: message, isError: true)
            }
        }
    }

    @objc private func restartService(_ sender: Any?) {
        showStatus(title: "正在重启 DeepSeek Harness", detail: "正在停止并重新启动 DSH.app 拥有的服务…")
        ServerManager.shared.restart { [weak self] result in
            guard let self else { return }
            switch result {
            case .ready(let url):
                self.webView.load(URLRequest(url: url))
            case .failed(let message):
                self.showStatus(title: "DeepSeek Harness 重启失败", detail: message, isError: true)
            }
        }
    }

    private func showStatus(title: String, detail: String, isError: Bool = false) {
        let color = isError ? "#d92d20" : "#4f46e5"
        let html = """
        <!doctype html><meta charset="utf-8"><style>
        :root{color-scheme:light dark}body{margin:0;font:14px -apple-system,BlinkMacSystemFont,sans-serif;background:Canvas;color:CanvasText}
        main{max-width:760px;margin:15vh auto;padding:32px}.mark{width:10px;height:10px;border-radius:50%;background:\(color);margin-bottom:22px}
        h1{font-size:24px;margin:0 0 14px}pre{white-space:pre-wrap;line-height:1.65;padding:16px;border-radius:10px;background:color-mix(in srgb,CanvasText 7%,Canvas);border:1px solid color-mix(in srgb,CanvasText 15%,Canvas)}
        </style><main><div class="mark"></div><h1>\(escapeHTML(title))</h1><pre>\(escapeHTML(detail))</pre></main>
        """
        webView.loadHTMLString(html, baseURL: nil)
    }

    private func escapeHTML(_ value: String) -> String {
        value.replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "dshAppearance", let theme = message.body as? String else { return }
        window.appearance = theme == "dark" ? NSAppearance(named: .darkAqua) : NSAppearance(named: .aqua)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        showStatus(title: "DeepSeek Harness 页面加载失败", detail: error.localizedDescription, isError: true)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
    func applicationWillTerminate(_ notification: Notification) { ServerManager.shared.stopOwnedServer() }
}

let appDelegate = AppDelegate()
NSApplication.shared.delegate = appDelegate
_ = NSApplicationMain(CommandLine.argc, CommandLine.unsafeArgv)
