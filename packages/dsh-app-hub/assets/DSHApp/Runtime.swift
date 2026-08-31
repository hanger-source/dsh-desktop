import Foundation
import Darwin

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
        let modulePath = Env.dshHome + "/profiles/web/node_modules/@hanger/dsh-client-bootstrap"
        let moduleParent = (modulePath as NSString).deletingLastPathComponent
        try FileManager.default.createDirectory(atPath: moduleParent, withIntermediateDirectories: true)
        if FileManager.default.fileExists(atPath: modulePath) {
            let resolved = URL(fileURLWithPath: modulePath).resolvingSymlinksInPath().path
            guard resolved == clientBootstrapPath else {
                throw messageError("dsh-client-bootstrap 模块入口指向了其他路径：\n\(modulePath)\n→ \(resolved)")
            }
        } else {
            try FileManager.default.createSymbolicLink(atPath: modulePath, withDestinationPath: clientBootstrapPath)
        }
        let template = try String(contentsOfFile: templatePath, encoding: .utf8)
        guard template.contains("__DSH_BOOT_PLUGIN__") else {
            throw messageError("overlay 模板缺少 __DSH_BOOT_PLUGIN__ 占位符：\n\(templatePath)")
        }
        try FileManager.default.createDirectory(atPath: Env.runtimeDir, withIntermediateDirectories: true)
        let output = Env.runtimeDir + "/web-boot.generated.yml"
        let content = template.replacingOccurrences(of: "__DSH_BOOT_PLUGIN__", with: pluginPath)
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
    private(set) var ownsServer = false

    func isListening(timeout: TimeInterval = 2, completion: @escaping (Bool) -> Void) {
        var request = URLRequest(url: Env.rootURL)
        request.timeoutInterval = timeout
        URLSession.shared.dataTask(with: request) { _, response, _ in
            DispatchQueue.main.async { completion(response is HTTPURLResponse) }
        }.resume()
    }

    func start(dsh: String, overlay: String, completion: @escaping (StartupResult) -> Void) {
        isListening { occupied in
            if occupied {
                completion(.failure("端口 3080 已被现有服务占用。请先关闭该服务，再由 DSH.app 启动并持有它。"))
                return
            }
            self.launchServer(dsh: dsh, overlay: overlay, completion: completion)
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
