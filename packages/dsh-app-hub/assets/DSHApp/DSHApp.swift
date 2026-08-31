// DSH — native macOS shell for the officially published DeepSeek Harness CLI.
import AppKit
import WebKit
import Foundation

enum Env {
    static let port = 3080
    static var rootURL: URL { URL(string: "http://127.0.0.1:\(port)/")! }
    static var home: String { FileManager.default.homeDirectoryForCurrentUser.path }
    static var dshHome: String {
        ProcessInfo.processInfo.environment["DSH_HOME"] ?? home + "/.dsh"
    }
    static var pluginRepo: String { dshHome + "/hang-plugins" }
    static var runtimeDir: String { pluginRepo + "/.runtime/dsh-app-hub" }

    static func commandEnvironment(executable: String) -> [String: String] {
        var environment = ProcessInfo.processInfo.environment
        var directories = [
            URL(fileURLWithPath: executable).deletingLastPathComponent().path,
            "/opt/homebrew/bin",
            "/usr/local/bin",
            "/usr/bin",
            "/bin",
            "/usr/sbin",
            "/sbin",
        ]
        if let inherited = environment["PATH"] {
            directories.append(contentsOf: inherited.split(separator: ":").map(String.init))
        }
        var seen = Set<String>()
        environment["PATH"] = directories.filter { seen.insert($0).inserted }.joined(separator: ":")
        return environment
    }
}

enum StepResult {
    case success
    case failure(String)
}

enum StartupResult {
    case ready(URL)
    case failure(String)
}

final class RuntimeInstaller {
    static let shared = RuntimeInstaller()

    func prepare(
        status: @escaping (String, String, String?) -> Void,
        completion: @escaping (Result<(dsh: String, overlay: String), Error>) -> Void
    ) {
        ensureDsh(status: status) { result in
            switch result {
            case .failure(let error):
                completion(.failure(error))
            case .success(let dsh):
                status("正在同步 DSH 插件", "正在更新插件仓库和技能…", "bootstrap.log")
                self.runBootstrap { bootstrap in
                    switch bootstrap {
                    case .failure(let error):
                        completion(.failure(self.messageError(error)))
                    case .success:
                        do {
                            let overlay = try self.generateOverlay()
                            completion(.success((dsh: dsh, overlay: overlay)))
                        } catch {
                            completion(.failure(error))
                        }
                    }
                }
            }
        }
    }

    private func ensureDsh(
        status: @escaping (String, String, String?) -> Void,
        completion: @escaping (Result<String, Error>) -> Void
    ) {
        if let dsh = findExecutable(dshCandidates()) {
            completion(.success(dsh))
            return
        }
        guard let npm = findExecutable([
            "/opt/homebrew/bin/npm",
            "/usr/local/bin/npm",
            Env.home + "/.local/share/fnm/aliases/default/bin/npm",
        ]) else {
            completion(.failure(messageError("找不到 npm，无法安装正式发布的 @deepseek-ai/dsh。")))
            return
        }

        status("正在安装 DeepSeek Harness", "本机尚未安装 dsh，正在从 npmjs 正式 registry 解析依赖并下载软件包。", "install.log")
        runCommand(
            executable: npm,
            arguments: ["install", "-g", "@deepseek-ai/dsh@latest", "--registry=https://registry.npmjs.org", "--loglevel=info"],
            environment: Env.commandEnvironment(executable: npm),
            logName: "install.log",
            timeout: 300
        ) { result in
            if case .failure(let reason) = result {
                let detail = self.logTail("install.log")
                completion(.failure(self.messageError("正式 dsh 安装失败：\(reason)\n\n\(detail)")))
                return
            }
            guard let dsh = self.findExecutable(self.dshCandidates(npm: npm)) else {
                completion(.failure(self.messageError("npm 安装成功，但全局 bin 目录中没有 dsh。\n\n" + self.logTail("install.log"))))
                return
            }
            completion(.success(dsh))
        }
    }

    private func runBootstrap(completion: @escaping (StepResult) -> Void) {
        guard let script = Bundle.main.resourceURL?.appendingPathComponent("bootstrap.sh"),
              FileManager.default.isReadableFile(atPath: script.path) else {
            completion(.failure("DSH.app 缺少内置 bootstrap.sh。"))
            return
        }
        var environment = ProcessInfo.processInfo.environment
        environment["DSH_HOME"] = Env.dshHome
        environment["DSH_BOOT_NO_SHELL"] = "1"
        runCommand(
            executable: "/bin/bash",
            arguments: [script.path],
            environment: environment,
            logName: "bootstrap.log",
            timeout: 120
        ) { result in
            if case .failure(let reason) = result {
                completion(.failure("插件同步失败：\(reason)\n\n" + self.logTail("bootstrap.log")))
                return
            }
            completion(.success)
        }
    }

    private func generateOverlay() throws -> String {
        let templatePath = Env.pluginRepo + "/overlays/web/web-boot.yml"
        let pluginPath = Env.pluginRepo + "/overlays/web/plugins/dsh-boot.js"
        let clientBootstrapPath = Env.pluginRepo + "/overlays/web/plugins/dsh-client-bootstrap"
        guard FileManager.default.isReadableFile(atPath: pluginPath) else {
            throw messageError("插件仓库缺少 dsh-boot：\n\(pluginPath)")
        }
        guard FileManager.default.isReadableFile(atPath: clientBootstrapPath + "/package.json") else {
            throw messageError("插件仓库缺少 dsh-client-bootstrap：\n\(clientBootstrapPath)")
        }
        let template = try String(contentsOfFile: templatePath, encoding: .utf8)
        guard template.contains("__DSH_BOOT_PLUGIN__") else {
            throw messageError("overlay 模板缺少 __DSH_BOOT_PLUGIN__ 占位符：\n\(templatePath)")
        }
        guard template.contains("__DSH_CLIENT_BOOTSTRAP__") else {
            throw messageError("overlay 模板缺少 __DSH_CLIENT_BOOTSTRAP__ 占位符：\n\(templatePath)")
        }
        try FileManager.default.createDirectory(atPath: Env.runtimeDir, withIntermediateDirectories: true)
        let output = Env.runtimeDir + "/web-boot.generated.yml"
        let content = template
            .replacingOccurrences(of: "__DSH_BOOT_PLUGIN__", with: pluginPath)
            .replacingOccurrences(of: "__DSH_CLIENT_BOOTSTRAP__", with: clientBootstrapPath)
        try content.write(toFile: output, atomically: true, encoding: .utf8)
        return output
    }

    private func runCommand(
        executable: String,
        arguments: [String],
        environment: [String: String]? = nil,
        logName: String,
        timeout: TimeInterval,
        completion: @escaping (StepResult) -> Void
    ) {
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                try FileManager.default.createDirectory(atPath: Env.runtimeDir, withIntermediateDirectories: true)
                let logPath = Env.runtimeDir + "/" + logName
                try Data().write(to: URL(fileURLWithPath: logPath), options: .atomic)
                guard let log = FileHandle(forWritingAtPath: logPath) else {
                    throw self.messageError("无法写入日志：\n\(logPath)")
                }
                defer { try? log.close() }

                let child = Process()
                child.executableURL = URL(fileURLWithPath: executable)
                child.arguments = arguments
                child.environment = environment
                child.standardOutput = log
                child.standardError = log
                let finished = DispatchSemaphore(value: 0)
                child.terminationHandler = { _ in finished.signal() }
                try child.run()

                if finished.wait(timeout: .now() + timeout) == .timedOut {
                    child.terminate()
                    _ = finished.wait(timeout: .now() + 5)
                    DispatchQueue.main.async { completion(.failure("命令超时：\(executable)")) }
                    return
                }
                let result: StepResult = child.terminationStatus == 0
                    ? .success
                    : .failure("命令退出码 \(child.terminationStatus)")
                DispatchQueue.main.async { completion(result) }
            } catch {
                DispatchQueue.main.async { completion(.failure(error.localizedDescription)) }
            }
        }
    }

    private func findExecutable(_ candidates: [String]) -> String? {
        candidates.first { FileManager.default.isExecutableFile(atPath: $0) }
    }

    private func dshCandidates(npm: String? = nil) -> [String] {
        var candidates = [
            "/opt/homebrew/bin/dsh",
            "/usr/local/bin/dsh",
            Env.home + "/.local/bin/dsh",
        ]
        if let npm {
            candidates.insert(URL(fileURLWithPath: npm).deletingLastPathComponent().appendingPathComponent("dsh").path, at: 0)
        }
        return candidates
    }

    private func logTail(_ name: String) -> String {
        let path = Env.runtimeDir + "/" + name
        guard let text = try? String(contentsOfFile: path, encoding: .utf8) else {
            return "没有生成 \(name)"
        }
        return text.split(separator: "\n", omittingEmptySubsequences: false).suffix(40).joined(separator: "\n")
    }

    private func messageError(_ message: String) -> Error {
        NSError(domain: "DSHApp", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
    }
}

final class ServerManager {
    static let shared = ServerManager()

    private var process: Process?
    private var logHandle: FileHandle?
    private var launch: (dsh: String, overlay: String)?
    private(set) var ownsServer = false

    func isListening(timeout: TimeInterval = 2, completion: @escaping (Bool) -> Void) {
        var request = URLRequest(url: Env.rootURL)
        request.timeoutInterval = timeout
        URLSession.shared.dataTask(with: request) { _, response, _ in
            DispatchQueue.main.async { completion(response is HTTPURLResponse) }
        }.resume()
    }

    func start(dsh: String, overlay: String, completion: @escaping (StartupResult) -> Void) {
        launch = (dsh: dsh, overlay: overlay)
        isListening { occupied in
            if occupied {
                completion(.failure("端口 3080 已被现有服务占用。请先关闭该服务，再由 DSH.app 启动并持有它。"))
                return
            }
            self.launchServer(dsh: dsh, overlay: overlay, completion: completion)
        }
    }

    func restart(completion: @escaping (StartupResult) -> Void) {
        guard ownsServer, let child = process, let launch else {
            completion(.failure("当前服务不是由 DSH.app 启动，不能由 App 重启。"))
            return
        }
        Darwin.kill(child.processIdentifier, SIGTERM)
        waitForPortRelease(attempt: 0, launch: launch, completion: completion)
    }

    private func waitForPortRelease(
        attempt: Int,
        launch: (dsh: String, overlay: String),
        completion: @escaping (StartupResult) -> Void
    ) {
        isListening(timeout: 0.4) { occupied in
            if !occupied {
                try? self.logHandle?.close()
                self.logHandle = nil
                self.process = nil
                self.ownsServer = false
                self.launchServer(dsh: launch.dsh, overlay: launch.overlay, completion: completion)
                return
            }
            if attempt >= 30 {
                completion(.failure("旧 dsh web 在 3080 端口上未能退出，重启已停止。"))
                return
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
                self.waitForPortRelease(attempt: attempt + 1, launch: launch, completion: completion)
            }
        }
    }

    private func launchServer(dsh: String, overlay: String, completion: @escaping (StartupResult) -> Void) {
        do {
            try FileManager.default.createDirectory(atPath: Env.runtimeDir, withIntermediateDirectories: true)
            let logPath = Env.runtimeDir + "/server.log"
            try Data().write(to: URL(fileURLWithPath: logPath), options: .atomic)
            logHandle = FileHandle(forWritingAtPath: logPath)

            var environment = Env.commandEnvironment(executable: dsh)
            environment["DSH_HOME"] = Env.dshHome
            environment["DSH_PLUGIN_REPO"] = Env.pluginRepo
            environment["DSH_PARENT_PID"] = String(ProcessInfo.processInfo.processIdentifier)

            let child = Process()
            child.executableURL = URL(fileURLWithPath: dsh)
            child.arguments = ["--profile", "web", "--patch", overlay, "--no-open"]
            child.environment = environment
            child.standardOutput = logHandle
            child.standardError = logHandle
            child.terminationHandler = { [weak self] _ in
                DispatchQueue.main.async {
                    guard self?.process === child else { return }
                    self?.process = nil
                    self?.ownsServer = false
                }
            }
            try child.run()
            process = child
            ownsServer = true
            poll(attempt: 0, completion: completion)
        } catch {
            completion(.failure("启动 dsh web 失败：\(error.localizedDescription)"))
        }
    }

    private func poll(attempt: Int, completion: @escaping (StartupResult) -> Void) {
        if process?.isRunning == false {
            completion(.failure("dsh web 已退出。\n\n" + serverLogTail()))
            return
        }
        if attempt >= 40 {
            completion(.failure("等待 dsh web 启动 URL 超时。\n\n" + serverLogTail()))
            return
        }
        isListening { ready in
            if ready {
                if let url = self.serverURL() {
                    completion(.ready(url))
                    return
                }
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                self.poll(attempt: attempt + 1, completion: completion)
            }
        }
    }

    func stopOwnedServer() {
        guard ownsServer, let child = process, child.isRunning else {
            process = nil
            ownsServer = false
            return
        }
        Darwin.kill(child.processIdentifier, SIGTERM)
        process = nil
        ownsServer = false
        try? logHandle?.close()
        logHandle = nil
    }

    private func serverURL() -> URL? {
        let path = Env.runtimeDir + "/server.log"
        guard let text = try? String(contentsOfFile: path, encoding: .utf8) else { return nil }
        for line in text.split(separator: "\n").reversed() {
            guard let marker = line.range(of: "dsh web: ") else { continue }
            let value = String(line[marker.upperBound...]).trimmingCharacters(in: .whitespacesAndNewlines)
            if let url = URL(string: value), url.host == "127.0.0.1", url.port == Env.port { return url }
        }
        return nil
    }

    private func serverLogTail() -> String {
        let path = Env.runtimeDir + "/server.log"
        guard let text = try? String(contentsOfFile: path, encoding: .utf8) else {
            return "没有生成 server.log"
        }
        return text.split(separator: "\n", omittingEmptySubsequences: false).suffix(40).joined(separator: "\n")
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKScriptMessageHandler {
    private var window: NSWindow!
    private var webView: WKWebView!
    private var progressTimer: Timer?
    private var progressStartedAt = Date()
    private var progressLogName: String?
    private var controlRMonitor: Any?

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        buildMenu()
        buildWindow()
        installControlRReload()
        showWindow()
        prepareAndStart()
    }

    private func prepareAndStart() {
        showProgress(title: "正在启动 DeepSeek Harness", detail: "正在检查正式 dsh 运行时…", logName: nil)
        RuntimeInstaller.shared.prepare(
            status: { [weak self] title, detail, logName in
                self?.showProgress(title: title, detail: detail, logName: logName)
            },
            completion: { [weak self] result in
                guard let self else { return }
                switch result {
                case .failure(let error):
                    self.showStatus(title: "DeepSeek Harness 准备失败", detail: error.localizedDescription, isError: true)
                case .success(let launch):
                    self.showProgress(title: "正在启动 DeepSeek Harness", detail: "正式 dsh 已就绪，正在启动 web 服务…", logName: "server.log")
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
            stopProgress()
            webView.load(URLRequest(url: url))
        case .failure(let message):
            showStatus(title: "DeepSeek Harness 启动失败", detail: message, isError: true)
        }
    }

    private func buildMenu() {
        let mainMenu = NSMenu()
        let appItem = NSMenuItem()
        mainMenu.addItem(appItem)
        let appMenu = NSMenu(title: "DSH")
        appMenu.addItem(withTitle: "刷新页面", action: #selector(reloadPage(_:)), keyEquivalent: "r").target = self
        appMenu.addItem(withTitle: "重启 DSH 服务", action: #selector(restartService(_:)), keyEquivalent: "").target = self
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
            source: "(function(){var dark=function(){var b=document.body,h=document.documentElement;if(b&&b.hasAttribute('data-ds-dark-theme'))return true;if(h){var cs=getComputedStyle(h).colorScheme;if(cs==='dark')return true;if(cs==='light')return false}return window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches};var report=function(){var v=dark()?'dark':'light';if(window.webkit&&window.webkit.messageHandlers&&window.webkit.messageHandlers.dshAppearance){window.webkit.messageHandlers.dshAppearance.postMessage(v)}};var attach=function(){var b=document.body,h=document.documentElement;if(!b){setTimeout(attach,100);return}new MutationObserver(report).observe(b,{attributes:true,attributeFilter:['data-ds-dark-theme']});new MutationObserver(report).observe(h,{attributes:true,attributeFilter:['style']});if(window.matchMedia){window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change',report)}report()};attach();})();",
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        )
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

    @objc private func restartService(_ sender: Any?) {
        showProgress(title: "正在重启 DeepSeek Harness", detail: "正在停止并重新启动 DSH.app 持有的服务…", logName: "server.log")
        ServerManager.shared.restart { [weak self] result in self?.handleStartup(result) }
    }

    @objc private func reloadPage(_ sender: Any?) {
        webView.reload()
    }

    private func installControlRReload() {
        controlRMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            let key = event.charactersIgnoringModifiers?.lowercased()
            let modifiers = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
            guard key == "r", modifiers.contains(.control) else { return event }
            self?.webView.reload()
            return nil
        }
    }

    private func showProgress(title: String, detail: String, logName: String?) {
        stopProgress()
        progressStartedAt = Date()
        progressLogName = logName
        let html = """
        <!doctype html><meta charset="utf-8"><style>
        :root{color-scheme:light dark}*{box-sizing:border-box}body{margin:0;font:14px -apple-system,BlinkMacSystemFont,sans-serif;background:Canvas;color:CanvasText}
        main{max-width:820px;margin:11vh auto;padding:36px}.eyebrow{font-size:12px;font-weight:650;letter-spacing:.08em;text-transform:uppercase;opacity:.55;margin-bottom:16px}
        h1{font-size:28px;margin:0 0 12px}p{font-size:15px;line-height:1.6;margin:0 0 24px;opacity:.72}.track{height:8px;border-radius:999px;overflow:hidden;background:color-mix(in srgb,CanvasText 10%,Canvas);margin-bottom:14px}
        .bar{width:38%;height:100%;border-radius:999px;background:linear-gradient(90deg,#4f46e5,#8b5cf6,#4f46e5);background-size:200% 100%;animation:move 1.2s linear infinite,travel 2.2s ease-in-out infinite alternate}@keyframes move{to{background-position:-200% 0}}@keyframes travel{from{transform:translateX(-15%)}to{transform:translateX(180%)}}
        .meta{display:flex;justify-content:space-between;gap:20px;font-size:12px;opacity:.58;margin-bottom:22px}.log{min-height:150px;max-height:270px;overflow:auto;white-space:pre-wrap;word-break:break-word;line-height:1.55;padding:16px;border-radius:12px;background:color-mix(in srgb,CanvasText 7%,Canvas);border:1px solid color-mix(in srgb,CanvasText 14%,Canvas);font:12px ui-monospace,SFMono-Regular,Menlo,monospace}
        </style><main><div class="eyebrow">DSH.app · 正式安装链</div><h1>\(escapeHTML(title))</h1><p>\(escapeHTML(detail))</p><div class="track"><div class="bar"></div></div><div class="meta"><span id="activity">正在处理，请保持窗口打开</span><span id="elapsed">已用时 0 秒</span></div><pre class="log" id="live-log">正在等待进程输出…</pre></main>
        <script>window.dshUpdateProgress=function(s){document.getElementById('elapsed').textContent=s.elapsed;document.getElementById('live-log').textContent=s.log||'进程仍在运行，暂时没有新输出…';var box=document.getElementById('live-log');box.scrollTop=box.scrollHeight}</script>
        """
        webView.loadHTMLString(html, baseURL: nil)
        progressTimer = Timer.scheduledTimer(withTimeInterval: 0.75, repeats: true) { [weak self] _ in
            self?.refreshProgress()
        }
        refreshProgress()
    }

    private func refreshProgress() {
        let seconds = max(0, Int(Date().timeIntervalSince(progressStartedAt)))
        let elapsed = seconds < 60 ? "已用时 \(seconds) 秒" : String(format: "已用时 %d:%02d", seconds / 60, seconds % 60)
        var log = "正在等待进程输出…"
        if let name = progressLogName {
            let path = Env.runtimeDir + "/" + name
            if let text = try? String(contentsOfFile: path, encoding: .utf8), !text.isEmpty {
                log = text.split(separator: "\n", omittingEmptySubsequences: false).suffix(18).joined(separator: "\n")
            }
        }
        guard let data = try? JSONSerialization.data(withJSONObject: ["elapsed": elapsed, "log": log]),
              let json = String(data: data, encoding: .utf8) else { return }
        webView.evaluateJavaScript("window.dshUpdateProgress && window.dshUpdateProgress(\(json))")
    }

    private func stopProgress() {
        progressTimer?.invalidate()
        progressTimer = nil
        progressLogName = nil
    }

    private func showStatus(title: String, detail: String, isError: Bool = false) {
        stopProgress()
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

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        applyThemePreference()
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "dshAppearance" else { return }
        applyThemePreference()
    }

    private func applyThemePreference() {
        switch readThemePreference() {
        case "dark": window.appearance = NSAppearance(named: .darkAqua)
        case "light": window.appearance = NSAppearance(named: .aqua)
        default: window.appearance = nil
        }
    }

    private func readThemePreference() -> String {
        let path = Env.dshHome + "/settings.yaml"
        guard let text = try? String(contentsOfFile: path, encoding: .utf8),
              let range = text.range(of: "ui-theme:") else { return "system" }
        let tail = String(text[range.upperBound...])
        guard let line = tail.components(separatedBy: "\n").first(where: {
            $0.trimmingCharacters(in: .whitespaces).hasPrefix("preference:")
        }) else { return "system" }
        let value = line.replacingOccurrences(of: "preference:", with: "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return value == "dark" || value == "light" ? value : "system"
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        showStatus(title: "DeepSeek Harness 页面加载失败", detail: error.localizedDescription, isError: true)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
    func applicationWillTerminate(_ notification: Notification) {
        if let controlRMonitor { NSEvent.removeMonitor(controlRMonitor) }
        ServerManager.shared.stopOwnedServer()
    }
}

let appDelegate = AppDelegate()
NSApplication.shared.delegate = appDelegate
_ = NSApplicationMain(CommandLine.argc, CommandLine.unsafeArgv)
