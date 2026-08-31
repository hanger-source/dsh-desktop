import Foundation
import Darwin

enum Env {
    static let port = 3080
    static var rootURL: URL { URL(string: "http://127.0.0.1:\(port)/")! }
    static var home: String { FileManager.default.homeDirectoryForCurrentUser.path }
    static var dshHome: String {
        ProcessInfo.processInfo.environment["DSH_HOME"] ?? home + "/.dsh"
    }
    static var desktopRepo: String { dshHome + "/dsh-desktop" }
    static var runtimeDir: String { dshHome + "/runtime/dsh-desktop" }

    static func commandEnvironment(executable: String, additionalExecutables: [String] = []) -> [String: String] {
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
        directories.append(contentsOf: additionalExecutables.map {
            URL(fileURLWithPath: $0).deletingLastPathComponent().path
        })
        if let inherited = environment["PATH"] {
            directories.append(contentsOf: inherited.split(separator: ":").map(String.init))
        }
        var seen = Set<String>()
        environment["PATH"] = directories.filter { seen.insert($0).inserted }.joined(separator: ":")
        return environment
    }
}

struct RuntimeLaunch {
    let dsh: String
    let node: String
    let npm: String?
    let overlay: String
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
        completion: @escaping (Result<RuntimeLaunch, Error>) -> Void
    ) {
        ensureDsh(status: status) { result in
            switch result {
            case .failure(let error):
                completion(.failure(error))
            case .success(let tools):
                status("正在准备 DSH Desktop", "正在装配 App 自带运行时…", nil)
                do {
                    let overlay = try self.generateOverlay()
                    completion(.success(RuntimeLaunch(
                        dsh: tools.dsh,
                        node: tools.node,
                        npm: tools.npm,
                        overlay: overlay
                    )))
                } catch {
                    completion(.failure(error))
                }
            }
        }
    }

    private struct Tools {
        let dsh: String
        let node: String
        let npm: String?
    }

    private func ensureDsh(
        status: @escaping (String, String, String?) -> Void,
        completion: @escaping (Result<Tools, Error>) -> Void
    ) {
        let node = findExecutable(nodeCandidates())
        let npm = findExecutable(npmCandidates())
        if let dsh = findExecutable(dshCandidates()), let node {
            completion(.success(Tools(dsh: dsh, node: node, npm: npm)))
            return
        }
        guard let node else {
            completion(.failure(messageError("找不到 Node.js。DSH.app 需要 Node.js 才能运行 @deepseek-ai/dsh。")))
            return
        }
        guard let npm else {
            completion(.failure(messageError("找不到与 Node.js 配套的 npm，无法安装 @deepseek-ai/dsh。")))
            return
        }

        status("正在安装 DeepSeek Harness", "本机尚未安装 dsh，正在从 npmjs 正式 registry 解析依赖并下载软件包。", "install.log")
        runCommand(
            executable: npm,
            arguments: ["install", "-g", "@deepseek-ai/dsh@latest", "--registry=https://registry.npmjs.org", "--loglevel=info"],
            environment: Env.commandEnvironment(executable: npm, additionalExecutables: [node]),
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
            completion(.success(Tools(dsh: dsh, node: node, npm: npm)))
        }
    }

    private func generateOverlay() throws -> String {
        guard let resources = Bundle.main.resourceURL else {
            throw messageError("DSH.app 缺少 Resources 目录。")
        }
        let runtime = resources.appendingPathComponent("runtime")
        let templatePath = runtime.appendingPathComponent("web-boot.yml").path
        let hostPath = runtime.appendingPathComponent("host/index.js").path
        let clientPath = runtime.appendingPathComponent("client").path
        guard FileManager.default.isReadableFile(atPath: hostPath) else {
            throw messageError("DSH.app 缺少内置 Host runtime：\n\(hostPath)")
        }
        guard FileManager.default.isReadableFile(atPath: clientPath + "/package.json") else {
            throw messageError("DSH.app 缺少内置 Client runtime：\n\(clientPath)")
        }
        let modulePath = Env.dshHome + "/profiles/web/node_modules/@hanger/dsh-desktop-runtime"
        let moduleParent = (modulePath as NSString).deletingLastPathComponent
        try FileManager.default.createDirectory(atPath: moduleParent, withIntermediateDirectories: true)
        if FileManager.default.fileExists(atPath: modulePath) {
            let resolved = URL(fileURLWithPath: modulePath).resolvingSymlinksInPath().path
            if resolved != clientPath {
                try FileManager.default.removeItem(atPath: modulePath)
                try FileManager.default.createSymbolicLink(atPath: modulePath, withDestinationPath: clientPath)
            }
        } else {
            try FileManager.default.createSymbolicLink(atPath: modulePath, withDestinationPath: clientPath)
        }
        let template = try String(contentsOfFile: templatePath, encoding: .utf8)
        guard template.contains("__DSH_DESKTOP_HOST__") else {
            throw messageError("overlay 模板缺少 __DSH_DESKTOP_HOST__ 占位符：\n\(templatePath)")
        }
        try FileManager.default.createDirectory(atPath: Env.runtimeDir, withIntermediateDirectories: true)
        let output = Env.runtimeDir + "/web-boot.generated.yml"
        let content = template.replacingOccurrences(of: "__DSH_DESKTOP_HOST__", with: hostPath)
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
            Env.home + "/.local/share/fnm/aliases/default/bin/dsh",
        ]
        if let npm {
            candidates.insert(URL(fileURLWithPath: npm).deletingLastPathComponent().appendingPathComponent("dsh").path, at: 0)
        }
        return candidates
    }

    private func nodeCandidates() -> [String] {
        [
            "/opt/homebrew/bin/node",
            "/usr/local/bin/node",
            Env.home + "/.local/share/fnm/aliases/default/bin/node",
        ]
    }

    private func npmCandidates() -> [String] {
        [
            "/opt/homebrew/bin/npm",
            "/usr/local/bin/npm",
            Env.home + "/.local/share/fnm/aliases/default/bin/npm",
        ]
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

    func start(launch: RuntimeLaunch, completion: @escaping (StartupResult) -> Void) {
        isListening { occupied in
            if occupied {
                completion(.failure("端口 3080 已被现有服务占用。请先关闭该服务，再由 DSH.app 启动并持有它。"))
                return
            }
            self.launchServer(launch: launch, completion: completion)
        }
    }

    private func launchServer(launch: RuntimeLaunch, completion: @escaping (StartupResult) -> Void) {
        do {
            try FileManager.default.createDirectory(atPath: Env.runtimeDir, withIntermediateDirectories: true)
            let logPath = Env.runtimeDir + "/server.log"
            try Data().write(to: URL(fileURLWithPath: logPath), options: .atomic)
            logHandle = FileHandle(forWritingAtPath: logPath)

            let executables = [launch.node] + (launch.npm.map { [$0] } ?? [])
            var environment = Env.commandEnvironment(executable: launch.dsh, additionalExecutables: executables)
            environment["DSH_HOME"] = Env.dshHome
            environment["DSH_PARENT_PID"] = String(ProcessInfo.processInfo.processIdentifier)
            environment["DSH_DESKTOP_REPO"] = Env.desktopRepo
            environment["DSH_DESKTOP_RUNTIME"] = Env.runtimeDir
            environment["DSH_DESKTOP_REMOTE"] = "https://github.com/hanger-source/dsh-desktop.git"
            environment["DSH_DESKTOP_GITHUB"] = "hanger-source/dsh-desktop"
            environment["DSH_APP_VERSION"] = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.0.0"
            environment["DSH_APP_BUNDLE_PATH"] = Bundle.main.bundlePath
            environment["DSH_EXECUTABLE"] = launch.dsh
            if let npm = launch.npm { environment["DSH_NPM_EXECUTABLE"] = npm }

            let child = Process()
            child.executableURL = URL(fileURLWithPath: launch.dsh)
            child.arguments = ["--profile", "web", "--patch", launch.overlay, "--no-open"]
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
                // HTTP 响应才是启动完成的事实；server.log 只用于诊断，不能作为 App 可用性的门禁。
                completion(.ready(Env.rootURL))
                return
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

    private func serverLogTail() -> String {
        let path = Env.runtimeDir + "/server.log"
        guard let text = try? String(contentsOfFile: path, encoding: .utf8) else {
            return "没有生成 server.log"
        }
        return text.split(separator: "\n", omittingEmptySubsequences: false).suffix(40).joined(separator: "\n")
    }
}
