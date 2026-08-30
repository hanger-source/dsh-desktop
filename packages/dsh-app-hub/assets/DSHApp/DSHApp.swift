// DSH — native macOS shell for DeepSeek Harness (dsh web).
// 职责：拉起/管理 dsh web 进程 + 原生窗口内嵌页面。更新提示/更新动作由页内插件承担。
import AppKit
import WebKit
import Foundation

enum Env {
    static let port = 3080
    static var url: URL { URL(string: "http://127.0.0.1:3080/")! }
    static func homeDir() -> String { NSString(string: "~").expandingTildeInPath }
}

final class ServerManager {
    static let shared = ServerManager()
    private var proc: Process?
    private var logFH: FileHandle?

    /// 端口是否就绪
    func isUp(completion: @escaping (Bool) -> Void) {
        var req = URLRequest(url: Env.url)
        req.timeoutInterval = 2
        URLSession.shared.dataTask(with: req) { _, resp, _ in
            let ok = (resp as? HTTPURLResponse)?.statusCode == 200
            DispatchQueue.main.async { completion(ok) }
        }.resume()
    }

    /// 没起来就拉起 dsh web
    func ensureUp(completion: @escaping (Bool) -> Void) {
        isUp { up in
            if up { completion(true); return }
            self.start(completion: completion)
        }
    }

    func start(completion: @escaping (Bool) -> Void) {
        // 本地没有 dsh 才安装；有则直接用（不做版本比对/自动升级）
        ensureDshInstalled { _ in
            DispatchQueue.main.async {
                self.startServer(completion: completion)
            }
        }
    }

    private func startServer(completion: @escaping (Bool) -> Void) {
        guard let dsh = findDsh() else {
            NSLog("DSH: 找不到 dsh 命令")
            completion(false)
            return
        }
        let logDir = Env.homeDir() + "/.dsh/hang-plugins/.runtime/dsh-app-hub"
        try? FileManager.default.createDirectory(atPath: logDir, withIntermediateDirectories: true)
        let logPath = logDir + "/server.log"
        FileManager.default.createFile(atPath: logPath, contents: nil)
        logFH = FileHandle(forWritingAtPath: logPath)

        let p = Process()
        // GUI 启动的 .app 环境 PATH 只有系统默认，dsh 的 shebang 是 /usr/bin/env node，
        // 必须显式带上 Homebrew 的 PATH，否则找不到 node 导致启动失败。
        var env = ProcessInfo.processInfo.environment
        env["PATH"] = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
        p.environment = env
        p.executableURL = URL(fileURLWithPath: dsh)
        p.arguments = ["--profile", "web", "--patch", Env.homeDir() + "/.dsh/hang-plugins/overlays/web/web-boot.yml", "--no-open"]
        p.standardOutput = logFH
        p.standardError = logFH
        p.terminationHandler = { _ in }
        do {
            try p.run()
        } catch {
            NSLog("DSH: 启动 dsh 失败 %@", error.localizedDescription)
            completion(false)
            return
        }
        proc = p
        pollUp(attempts: 0, completion: completion)
    }

    /// 本地没有 dsh 才 npm install -g；有则直接返回（不比对版本、不自动升级）。
    /// 安装失败不阻断启动（findDsh 兜底由调用方处理）。
    private func ensureDshInstalled(completion: @escaping (Bool) -> Void) {
        DispatchQueue.global().async {
            if self.findDsh() != nil {
                self.logToFile("dsh-app: 本地已有 dsh，直接使用")
                completion(false)
                return
            }
            let npm = "/opt/homebrew/bin/npm"
            let out = self.capture(npm, ["install", "-g", "@deepseek-ai/dsh@latest"], timeout: 300)
            let installed = self.findDsh() != nil
            self.logToFile("dsh-app: 本地无 dsh，npm install " + (installed ? "成功" : "失败/未完成") + " (outLen=" + String(out.count) + ")")
            completion(installed)
        }
    }

    private func capture(_ exe: String, _ args: [String], timeout: TimeInterval) -> String {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: exe)
        p.arguments = args
        let pipe = Pipe()
        p.standardOutput = pipe
        p.standardError = Pipe()
        do { try p.run() } catch { return "" }
        let sem = DispatchSemaphore(value: 0)
        p.terminationHandler = { _ in sem.signal() }
        if sem.wait(timeout: .now() + timeout) == .timedOut { p.terminate() }
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        return String(data: data, encoding: .utf8) ?? ""
    }



    private func logToFile(_ line: String) {
        let p = Env.homeDir() + "/.dsh/hang-plugins/.runtime/dsh-app-hub/shell.log"
        let nl = String(UnicodeScalar(10))
        let text = line + nl
        if let h = FileHandle(forWritingAtPath: p) {
            h.seekToEndOfFile()
            h.write(text.data(using: .utf8)!)
            try? h.close()
        } else {
            try? text.data(using: .utf8)?.write(to: URL(fileURLWithPath: p))
        }
    }

    private func findDsh() -> String? {
        let cands = [
            "/opt/homebrew/bin/dsh",
            "/usr/local/bin/dsh",
            Env.homeDir() + "/.local/bin/dsh",
        ]
        for c in cands where FileManager.default.isExecutableFile(atPath: c) { return c }
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/usr/bin/which")
        p.arguments = ["dsh"]
        let pipe = Pipe()
        p.standardOutput = pipe
        try? p.run()
        p.waitUntilExit()
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        let s = String(data: data, encoding: .utf8)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return (s ?? "").isEmpty ? nil : s
    }

    private func pollUp(attempts: Int, completion: @escaping (Bool) -> Void) {
        if attempts > 40 { completion(false); return }
        isUp { up in
            if up { completion(true) }
            else {
                DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
                    self.pollUp(attempts: attempts + 1, completion: completion)
                }
            }
        }
    }

    /// 常驻模式：壳退出不结束 dsh web 服务。
    /// 这样重开壳时服务/会话/动态插件都还在；要彻底停服务请在终端控制。
    func stop() {
        proc = nil
        try? logFH?.close()
        logFH = nil
    }
}


final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKScriptMessageHandler {
    private var window: NSWindow!
    private var webView: WKWebView!
    private var wasUp = false

    func applicationDidFinishLaunching(_ note: Notification) {
        NSApp.setActivationPolicy(.regular)
        buildMenu()
        buildWindow()
        startWatchdog()
        logToFile("dsh-app: launched, shell.log 用于排查外观/启动问题")
        // 兜底：页面异常未触发 didFinish 时，8 秒后强制亮出窗口
        DispatchQueue.main.asyncAfter(deadline: .now() + 8) { [weak self] in
            self?.showWindowWhenReady()
        }
        // 首次等待 server 就绪再加载
        ServerManager.shared.ensureUp { [weak self] up in
            guard let self else { return }
            if !up {
                self.showFatal("dsh web 启动失败 —— 请检查 ~/.dsh/dsh-app-hub/server.log")
                return
            }
            self.wasUp = true
            self.load()
        }
    }

    /// 菜单栏：编辑菜单是 WKWebView 复制/粘贴快捷键（⌘C/⌘V）的前提
    private func buildMenu() {
        let mainMenu = NSMenu()

        let appItem = NSMenuItem()
        mainMenu.addItem(appItem)
        let appMenu = NSMenu(title: "DSH")
        appMenu.addItem(withTitle: "重启 DSH 服务",
                        action: #selector(AppDelegate.restartDSHService(_:)),
                        keyEquivalent: "r").target = self
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "退出 DSH",
                        action: #selector(NSApplication.terminate(_:)),
                        keyEquivalent: "q")
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

        // 无边框窗口的剩余操作入口
        let winItem = NSMenuItem()
        mainMenu.addItem(winItem)
        let winMenu = NSMenu(title: "窗口")
        winMenu.addItem(withTitle: "关闭窗口",
                        action: #selector(NSWindow.performClose(_:)),
                        keyEquivalent: "w")
        winItem.submenu = winMenu

        NSApp.mainMenu = mainMenu
    }

    /// 看门狗：server 挂了自动拉起，恢复后重载页面（覆盖"更新→重启"场景）
    private func startWatchdog() {
        let t = Timer.scheduledTimer(withTimeInterval: 3.0, repeats: true) { [weak self] _ in
            ServerManager.shared.isUp { up in
                DispatchQueue.main.async {
                    guard let self else { return }
                    if up && !self.wasUp {
                        self.load()
                    } else if !up && self.wasUp {
                        ServerManager.shared.ensureUp { ok in
                            if ok { self.load() }
                        }
                    }
                    self.wasUp = up
                }
            }
        }
        t.tolerance = 1.0
    }

    private func buildWindow() {
        let rect = NSRect(x: 0, y: 0, width: 1280, height: 820)
        window = NSWindow(
            contentRect: rect,
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "DeepSeek Harness"
        // 100% 系统默认标题栏：跟随系统明暗、红绿灯齐全、可拖、页面在下方不压入、
        // 标题栏区域无页面文本 → 不可能出现选字。零自定义。
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.setFrameAutosaveName("DSHMainWindow")
        let config = WKWebViewConfiguration()
        // 主题回调桥（踩坑记录）：
        //  - dsh 切深色时在 <body> 上 toggle 属性 data-ds-dark-theme → 必须监听 body；
        //  - boot 脚本还会把 documentElement.style.colorScheme 写成 light/dark → 同时监听 html 的 style；
        //  - 跟随系统时两者可能是推导值 → fallback prefers-color-scheme。
        // 两处都监听、优先取页面实际明暗，避免只盯一个节点漏信号导致标题栏不变。
        config.userContentController.add(self, name: "dshAppearance")
        let themeScript = WKUserScript(
            source: "(function(){var dark=function(){var b=document.body,h=document.documentElement;if(b&&b.hasAttribute('data-ds-dark-theme'))return true;if(h){var cs=getComputedStyle(h).colorScheme;if(cs==='dark')return true;if(cs==='light')return false}return window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches};var report=function(){var v=dark()?'dark':'light';if(window.webkit&&window.webkit.messageHandlers&&window.webkit.messageHandlers.dshAppearance){window.webkit.messageHandlers.dshAppearance.postMessage(v)}};var attach=function(){var b=document.body,h=document.documentElement;if(!b){setTimeout(attach,100);return}new MutationObserver(report).observe(b,{attributes:true,attributeFilter:['data-ds-dark-theme']});new MutationObserver(report).observe(h,{attributes:true,attributeFilter:['style']});if(window.matchMedia){window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change',report)}report()};attach();})();",
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true)
        config.userContentController.addUserScript(themeScript)
        webView = WKWebView(frame: rect, configuration: config)
        webView.autoresizingMask = [.width, .height]
        webView.navigationDelegate = self
        window.contentView = webView
        window.center()
    }

    private func load() {
        webView.load(URLRequest(url: Env.url))
    }

    private func showFatal(_ message: String) {
        let alert = NSAlert()
        alert.messageText = "DeepSeek Harness"
        alert.informativeText = message
        alert.alertStyle = .critical
        alert.runModal()
        NSApp.terminate(nil)
    }

    private var windowShown = false

    /// 菜单「重启 DSH 服务」：杀监听 3080 的旧服务，看门狗会自动拉起新服务并重载页面
    @objc func restartDSHService(_ sender: Any?) {
        logToFile("dsh-app: menu restart requested")
        let lsof = Process()
        lsof.executableURL = URL(fileURLWithPath: "/usr/bin/lsof")
        lsof.arguments = ["-tiTCP:3080", "-sTCP:LISTEN"]
        let pipe = Pipe()
        lsof.standardOutput = pipe
        try? lsof.run()
        lsof.waitUntilExit()
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        let nl = Character(UnicodeScalar(10))
        let cr = Character(UnicodeScalar(13))
        let pids = String(data: data, encoding: .utf8)?
            .split(omittingEmptySubsequences: true,
                   whereSeparator: { $0 == nl || $0 == cr || $0 == " " })
            ?? []
        for pid in pids {
            let kill = Process()
            kill.executableURL = URL(fileURLWithPath: "/bin/kill")
            kill.arguments = [String(pid)]
            try? kill.run()
            kill.waitUntilExit()
        }
        // watchdog 每 3s 检测端口 → 自动拉起新 dsh web 并 reload 页面
    }

    private func showWindowWhenReady() {
        guard !windowShown else { return }
        windowShown = true
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    // ---- 页面就绪后亮出窗口，并按持久化偏好设置外观 ----
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        let pref = readThemePreference()
        logToFile("dsh-app: didFinish preference=" + pref)
        switch pref {
        case "dark":
            window.appearance = NSAppearance(named: .darkAqua)
        case "light":
            window.appearance = NSAppearance(named: .aqua)
        default:
            window.appearance = nil
        }
        showWindowWhenReady()
    }

    // 回调：dsh 主题变化 → 按持久化偏好设置窗口外观（深/浅/跟随系统）
    func userContentController(_ userContentController: WKUserContentController,
                              didReceive message: WKScriptMessage) {
        guard message.name == "dshAppearance", let s = message.body as? String else { return }
        let pref = readThemePreference()
        logToFile("dsh-app: page theme=" + s + " preference=" + pref)
        switch pref {
        case "dark":
            window.appearance = NSAppearance(named: .darkAqua)
        case "light":
            window.appearance = NSAppearance(named: .aqua)
        default:
            window.appearance = nil
        }
        logToFile("dsh-app: window appearance=" + String(describing: window.appearance?.name))
    }

    private func logToFile(_ s: String) {
        let p = Env.homeDir() + "/.dsh/hang-plugins/.runtime/dsh-app-hub/shell.log"
        let nl = String(UnicodeScalar(10))
        if let h = FileHandle(forWritingAtPath: p) {
            h.seekToEndOfFile()
            h.write((s + nl).data(using: .utf8)!)
            try? h.close()
        } else {
            try? (s + nl).data(using: .utf8)?.write(to: URL(fileURLWithPath: p))
        }
    }

    /// 读 ~/.dsh/settings.yaml 的 ui-theme.preference（dark|light|system）
    /// 注意：YAML 子键带缩进（如 "  preference: light"），判断行首必须先 trim，
    /// 否则解析永远失败、默认返回 system（曾因此让"设置浅色"失效）。
    private func readThemePreference() -> String {
        let path = Env.homeDir() + "/.dsh/settings.yaml"
        guard let text = try? String(contentsOfFile: path, encoding: .utf8),
              let range = text.range(of: "ui-theme:") else { return "system" }
        let newline = String(UnicodeScalar(10))
        let tail = String(text[range.upperBound...])
        let after = tail.components(separatedBy: newline).first {
            $0.trimmingCharacters(in: .whitespaces).hasPrefix("preference:")
        }
        guard let line = after else { return "system" }
        let v = line.replacingOccurrences(of: "preference:", with: "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return (v == "dark" || v == "light") ? v : "system"
    }

    // ---- 断线自动重连：server 更新/重启后页面自动恢复 ----
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) { [weak self] in
            self?.load()
        }
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) { [weak self] in
            self?.load()
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
    func applicationWillTerminate(_ note: Notification) { ServerManager.shared.stop() }
}
// 显式入口：把 AppDelegate 挂到 NSApplication 并进入主循环
let appDelegate = AppDelegate()
NSApplication.shared.delegate = appDelegate
_ = NSApplicationMain(CommandLine.argc, CommandLine.unsafeArgv)
