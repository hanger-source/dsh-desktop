import Foundation
import Darwin

enum Env {
    static let port = 3080
    static var rootURL: URL { URL(string: "http://127.0.0.1:\(port)/")! }
    static var home: String { FileManager.default.homeDirectoryForCurrentUser.path }
    static var dshHome: String {
        ProcessInfo.processInfo.environment["DSH_HOME"] ?? home + "/.dsh"
    }
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
    let pnpm: String
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
                self.ensurePnpm(tools: tools, status: status) { pnpmResult in
                    switch pnpmResult {
                    case .failure(let error):
                        completion(.failure(error))
                    case .success(let prepared):
                        self.ensurePluginManager(tools: prepared, status: status) { managerResult in
                            switch managerResult {
                            case .failure(let error):
                                completion(.failure(error))
                            case .success:
                                self.ensureLegacyPluginsMigrated(tools: prepared, status: status) { migrationResult in
                                    switch migrationResult {
                                    case .failure(let error):
                                        completion(.failure(error))
                                    case .success:
                                        self.reconcilePluginActivationState(
                                            node: prepared.node,
                                            dsh: prepared.dsh,
                                            pnpm: prepared.pnpm!,
                                            npm: prepared.npm
                                        ) { activationResult in
                                            switch activationResult {
                                            case .failure(let error): completion(.failure(error))
                                            case .success:
                                                completion(.success(RuntimeLaunch(
                                                    dsh: prepared.dsh,
                                                    node: prepared.node,
                                                    npm: prepared.npm,
                                                    pnpm: prepared.pnpm!
                                                )))
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    private struct Tools {
        let dsh: String
        let node: String
        let npm: String?
        let pnpm: String?
    }

    private func ensureDsh(
        status: @escaping (String, String, String?) -> Void,
        completion: @escaping (Result<Tools, Error>) -> Void
    ) {
        let node = findExecutable(nodeCandidates())
        let npm = findExecutable(npmCandidates())
        if let dsh = findExecutable(dshCandidates()), let node {
            completion(.success(Tools(dsh: dsh, node: node, npm: npm, pnpm: findExecutable(pnpmCandidates()))))
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
            completion(.success(Tools(dsh: dsh, node: node, npm: npm, pnpm: self.findExecutable(self.pnpmCandidates()))))
        }
    }

    private let pluginManagerName = "@hanger-source/hang-dsh-plugins"
    private let pluginManagerVersion = "0.1.0-beta.10"

    private func ensurePnpm(
        tools: Tools,
        status: @escaping (String, String, String?) -> Void,
        completion: @escaping (Result<Tools, Error>) -> Void
    ) {
        if let pnpm = tools.pnpm {
            completion(.success(Tools(dsh: tools.dsh, node: tools.node, npm: tools.npm, pnpm: pnpm)))
            return
        }
        guard let npm = tools.npm else {
            completion(.failure(messageError("找不到 pnpm，且没有可用于安装 pnpm 的 npm。")))
            return
        }
        status("正在准备插件运行时", "DSH 的正式插件命令需要 pnpm，正在安装 pnpm 10。", "pnpm-install.log")
        runCommand(
            executable: npm,
            arguments: ["install", "-g", "pnpm@10", "--registry=https://registry.npmjs.org", "--loglevel=info"],
            environment: Env.commandEnvironment(executable: npm, additionalExecutables: [tools.node]),
            logName: "pnpm-install.log",
            timeout: 300
        ) { result in
            if case .failure(let reason) = result {
                completion(.failure(self.messageError("pnpm 安装失败：\(reason)\n\n" + self.logTail("pnpm-install.log"))))
                return
            }
            guard let pnpm = self.findExecutable(self.pnpmCandidates(npm: npm)) else {
                completion(.failure(self.messageError("npm 安装成功，但全局 bin 目录中没有 pnpm。\n\n" + self.logTail("pnpm-install.log"))))
                return
            }
            completion(.success(Tools(dsh: tools.dsh, node: tools.node, npm: tools.npm, pnpm: pnpm)))
        }
    }

    private func ensurePluginManager(
        tools: Tools,
        status: @escaping (String, String, String?) -> Void,
        completion: @escaping (Result<Void, Error>) -> Void
    ) {
        if let installed = installedPluginManagerVersion(),
           compareSemanticVersions(installed, pluginManagerVersion) >= 0,
           profileHasPluginManagerBundle() {
            completion(.success(()))
            return
        }
        guard let pnpm = tools.pnpm else {
            completion(.failure(messageError("pnpm 尚未准备完成。")))
            return
        }
        let defaultSpec = "github:hanger-source/dsh-desktop#plugin-hang-dsh-plugins-v\(pluginManagerVersion)&path:/plugins/hang-dsh-plugins"
        let spec = ProcessInfo.processInfo.environment["DSH_PLUGIN_MANAGER_SPEC"] ?? defaultSpec
        status("正在准备 Hang 的插件", "正在通过 dsh plugin 安装 Desktop 插件管理器…", "plugin-manager-install.log")
        runCommand(
            executable: tools.dsh,
            arguments: ["plugin", "--profile", "web", "add", spec, "--save-exact"],
            environment: Env.commandEnvironment(executable: tools.dsh, additionalExecutables: [tools.node, pnpm] + (tools.npm.map { [$0] } ?? [])),
            logName: "plugin-manager-install.log",
            timeout: 300
        ) { result in
            if case .failure(let reason) = result {
                completion(.failure(self.messageError("Hang 的插件管理器安装失败：\(reason)\n\n" + self.logTail("plugin-manager-install.log"))))
                return
            }
            guard self.installedPluginManagerVersion() == self.pluginManagerVersion,
                  self.profileHasPluginManagerBundle() else {
                completion(.failure(self.messageError("dsh plugin 已退出成功，但管理器没有进入 web profile。\n\n" + self.logTail("plugin-manager-install.log"))))
                return
            }
            completion(.success(()))
        }
    }

    func updatePluginManager(
        launch: RuntimeLaunch,
        version: String,
        completion: @escaping (Result<Void, Error>) -> Void
    ) {
        guard isSemanticVersion(version) else {
            completion(.failure(messageError("基础插件版本无效：\(version)")))
            return
        }
        let spec = "github:hanger-source/dsh-desktop#plugin-hang-dsh-plugins-v\(version)&path:/plugins/hang-dsh-plugins"
        let executables = [launch.node, launch.pnpm] + (launch.npm.map { [$0] } ?? [])
        runCommand(
            executable: launch.dsh,
            arguments: ["plugin", "--profile", "web", "add", spec, "--save-exact"],
            environment: Env.commandEnvironment(executable: launch.dsh, additionalExecutables: executables),
            logName: "plugin-manager-update.log",
            timeout: 300
        ) { result in
            if case .failure(let reason) = result {
                completion(.failure(self.messageError(
                    "Hang DSH Plugins 更新失败：\(reason)\n\n" + self.logTail("plugin-manager-update.log")
                )))
                return
            }
            guard self.installedPluginManagerVersion() == version,
                  self.profileHasPluginManagerBundle() else {
                completion(.failure(self.messageError(
                    "dsh plugin 已退出成功，但基础插件没有更新到 \(version)。\n\n" + self.logTail("plugin-manager-update.log")
                )))
                return
            }
            self.reconcilePluginActivationState(
                node: launch.node,
                dsh: launch.dsh,
                pnpm: launch.pnpm,
                npm: launch.npm,
                completion: completion
            )
        }
    }

    private func reconcilePluginActivationState(
        node: String,
        dsh: String,
        pnpm: String,
        npm: String?,
        completion: @escaping (Result<Void, Error>) -> Void
    ) {
        let script = Env.dshHome + "/profiles/web/node_modules/@hanger-source/hang-dsh-plugins/host/reconcile.js"
        guard FileManager.default.fileExists(atPath: script) else {
            completion(.failure(messageError("基础插件状态入口不存在：\n\(script)")))
            return
        }
        var environment = Env.commandEnvironment(
            executable: node,
            additionalExecutables: [dsh, pnpm] + (npm.map { [$0] } ?? [])
        )
        environment["DSH_HOME"] = Env.dshHome
        environment["DSH_EXECUTABLE"] = dsh
        runCommand(
            executable: node,
            arguments: [script],
            environment: environment,
            logName: "plugin-activation.log",
            timeout: 30
        ) { result in
            if case .failure(let reason) = result {
                completion(.failure(self.messageError(
                    "应用插件启用状态失败：\(reason)\n\n" + self.logTail("plugin-activation.log")
                )))
                return
            }
            completion(.success(()))
        }
    }

    private func installedPluginManagerVersion() -> String? {
        let path = Env.dshHome + "/profiles/web/node_modules/@hanger-source/hang-dsh-plugins/package.json"
        guard let data = FileManager.default.contents(atPath: path),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        return json["version"] as? String
    }

    private func isSemanticVersion(_ value: String) -> Bool {
        value.range(
            of: #"^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$"#,
            options: .regularExpression
        ) != nil
    }

    private func compareSemanticVersions(_ left: String, _ right: String) -> Int {
        func parse(_ value: String) -> ([Int], [String])? {
            let parts = value.split(separator: "-", maxSplits: 1).map(String.init)
            let core = parts[0].split(separator: ".").compactMap { Int($0) }
            guard core.count == 3 else { return nil }
            let prerelease = parts.count == 2 ? parts[1].split(separator: ".").map(String.init) : []
            return (core, prerelease)
        }
        guard let lhs = parse(left), let rhs = parse(right) else { return 0 }
        for index in 0..<3 where lhs.0[index] != rhs.0[index] {
            return lhs.0[index] < rhs.0[index] ? -1 : 1
        }
        if lhs.1.isEmpty || rhs.1.isEmpty {
            if lhs.1.isEmpty == rhs.1.isEmpty { return 0 }
            return lhs.1.isEmpty ? 1 : -1
        }
        for index in 0..<max(lhs.1.count, rhs.1.count) {
            if index >= lhs.1.count { return -1 }
            if index >= rhs.1.count { return 1 }
            let a = lhs.1[index]
            let b = rhs.1[index]
            if a == b { continue }
            if let an = Int(a), let bn = Int(b) { return an < bn ? -1 : 1 }
            if Int(a) != nil { return -1 }
            if Int(b) != nil { return 1 }
            return a < b ? -1 : 1
        }
        return 0
    }

    private func ensureLegacyPluginsMigrated(
        tools: Tools,
        status: @escaping (String, String, String?) -> Void,
        completion: @escaping (Result<Void, Error>) -> Void
    ) {
        let marker = Env.dshHome + "/profiles/web/.hang-dsh-plugins-migration-v2.json"
        if FileManager.default.fileExists(atPath: marker) {
            completion(.success(()))
            return
        }
        let script = Env.dshHome + "/profiles/web/node_modules/@hanger-source/hang-dsh-plugins/host/migrate.js"
        guard FileManager.default.fileExists(atPath: script) else {
            completion(.failure(messageError("Hang 的插件迁移入口不存在：\n\(script)")))
            return
        }
        status("正在迁移 Hang 的插件", "正在把旧版本中实际启用的插件接入正式 DSH profile…", "plugin-migration.log")
        var environment = Env.commandEnvironment(
            executable: tools.node,
            additionalExecutables: [tools.dsh, tools.pnpm!] + (tools.npm.map { [$0] } ?? [])
        )
        environment["DSH_HOME"] = Env.dshHome
        environment["DSH_EXECUTABLE"] = tools.dsh
        environment["DSH_DESKTOP_GITHUB"] = "hanger-source/dsh-desktop"
        runCommand(
            executable: tools.node,
            arguments: [script],
            environment: environment,
            logName: "plugin-migration.log",
            timeout: 600
        ) { result in
            if case .failure(let reason) = result {
                completion(.failure(self.messageError("旧插件迁移失败：\(reason)\n\n" + self.logTail("plugin-migration.log"))))
                return
            }
            completion(.success(()))
        }
    }

    private func profileHasPluginManagerBundle() -> Bool {
        let path = Env.dshHome + "/profiles/web/package.json"
        guard let data = FileManager.default.contents(atPath: path),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let dsh = json["dsh"] as? [String: Any],
              let profile = dsh["profile"] as? [String: Any],
              let bundles = profile["bundles"] as? [String] else { return false }
        return bundles.contains(pluginManagerName)
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

    private func pnpmCandidates(npm: String? = nil) -> [String] {
        var candidates = [
            "/opt/homebrew/bin/pnpm",
            "/usr/local/bin/pnpm",
            Env.home + "/.local/bin/pnpm",
            Env.home + "/.local/share/fnm/aliases/default/bin/pnpm",
        ]
        if let npm {
            candidates.insert(URL(fileURLWithPath: npm).deletingLastPathComponent().appendingPathComponent("pnpm").path, at: 0)
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

    func start(launch: RuntimeLaunch, completion: @escaping (StartupResult) -> Void) {
        waitUntilAvailable(launch: launch, attempt: 0, completion: completion)
    }

    private func launchServer(launch: RuntimeLaunch, completion: @escaping (StartupResult) -> Void) {
        do {
            try FileManager.default.createDirectory(atPath: Env.runtimeDir, withIntermediateDirectories: true)
            let logPath = Env.runtimeDir + "/server.log"
            try Data().write(to: URL(fileURLWithPath: logPath), options: .atomic)
            logHandle = FileHandle(forWritingAtPath: logPath)

            let executables = [launch.node, launch.pnpm] + (launch.npm.map { [$0] } ?? [])
            var environment = Env.commandEnvironment(executable: launch.dsh, additionalExecutables: executables)
            environment["DSH_HOME"] = Env.dshHome
            environment["DSH_PARENT_PID"] = String(ProcessInfo.processInfo.processIdentifier)
            environment["DSH_DESKTOP_RUNTIME"] = Env.runtimeDir
            environment["DSH_DESKTOP_GITHUB"] = "hanger-source/dsh-desktop"
            environment["DSH_APP_VERSION"] = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.0.0"
            environment["DSH_APP_BUNDLE_PATH"] = Bundle.main.bundlePath
            environment["DSH_EXECUTABLE"] = launch.dsh
            if let npm = launch.npm { environment["DSH_NPM_EXECUTABLE"] = npm }

            let child = Process()
            child.executableURL = URL(fileURLWithPath: launch.dsh)
            child.arguments = ["--profile", "web", "--no-open"]
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

    func restart(launch: RuntimeLaunch, completion: @escaping (StartupResult) -> Void) {
        guard ownsServer else {
            completion(.failure("当前 DSH 服务不由此 App 持有，无法自动应用插件。"))
            return
        }
        stopOwnedServer()
        waitUntilAvailable(launch: launch, attempt: 0, completion: completion)
    }

    private func waitUntilAvailable(
        launch: RuntimeLaunch,
        attempt: Int,
        completion: @escaping (StartupResult) -> Void
    ) {
        if attempt >= 40 {
            completion(.failure("端口 3080 持续被现有服务占用。请先关闭该服务，再由 DSH.app 启动并持有它。"))
            return
        }
        isListening(timeout: 0.25) { listening in
            if !listening {
                self.launchServer(launch: launch, completion: completion)
                return
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
                self.waitUntilAvailable(launch: launch, attempt: attempt + 1, completion: completion)
            }
        }
    }

    private func serverLogTail() -> String {
        let path = Env.runtimeDir + "/server.log"
        guard let text = try? String(contentsOfFile: path, encoding: .utf8) else {
            return "没有生成 server.log"
        }
        return text.split(separator: "\n", omittingEmptySubsequences: false).suffix(40).joined(separator: "\n")
    }
}
