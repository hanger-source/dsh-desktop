import Foundation
import Darwin
import CryptoKit

enum Env {
    static var port: Int {
        Int(ProcessInfo.processInfo.environment["DSH_PORT"] ?? "") ?? 3080
    }
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
    let dshVersion: String
    let node: String
    let npm: String?
    let pnpm: String
}

enum StepResult {
    case success
    case failure(String)
}

enum CaptureResult {
    case success(Data)
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
                        self.ensureBundledPackages(tools: prepared, status: status) { runtimeResult in
                            switch runtimeResult {
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
                                        self.resolvePackageMetadata(
                                            ["@deepseek-ai/dsh"],
                                            from: prepared.dsh,
                                            tools: prepared
                                        ) { metadataResult in
                                            switch metadataResult {
                                            case .failure(let error): completion(.failure(error))
                                            case .success(let packages):
                                                guard let version = packages["@deepseek-ai/dsh"]?.version else {
                                                    completion(.failure(self.messageError("无法解析当前 dsh 版本。")))
                                                    return
                                                }
                                                completion(.success(RuntimeLaunch(
                                                    dsh: prepared.dsh,
                                                    dshVersion: version,
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

    private struct BundledPackage: Decodable {
        let name: String
        let version: String
        let archive: String
        let sha256: String
    }

    private struct BundledPackages: Decodable {
        let schemaVersion: Int
        let desktopRuntime: BundledPackage
        let pluginManager: BundledPackage
    }

    private struct ProfilePackage {
        let version: String?
        let path: String
    }

    private let legacyDesktopRuntimeNames = ["@hanger/dsh-desktop-runtime"]

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

    private func ensureBundledPackages(
        tools: Tools,
        status: @escaping (String, String, String?) -> Void,
        completion: @escaping (Result<Void, Error>) -> Void
    ) {
        let packages: BundledPackages
        let desktopRuntimeArchive: URL
        let pluginManagerArchive: URL
        do {
            packages = try bundledPackages()
            desktopRuntimeArchive = try materializeBundledPackage(packages.desktopRuntime)
            pluginManagerArchive = try materializeBundledPackage(packages.pluginManager)
            try bindDesktopRuntimeDependency(packages.desktopRuntime, to: desktopRuntimeArchive)
        } catch {
            completion(.failure(error))
            return
        }
        loadProfilePackages(tools: tools) { result in
            switch result {
            case .failure(let error):
                completion(.failure(error))
            case .success(let installed):
                let manager = installed[packages.pluginManager.name]
                let needsManagerInstall: Bool
                do {
                    needsManagerInstall = try manager.map(self.isLegacyPluginManager) ?? true
                } catch {
                    completion(.failure(error))
                    return
                }
                if needsManagerInstall {
                    self.installBundledPackage(
                        packages.pluginManager,
                        archive: pluginManagerArchive,
                        tools: tools,
                        title: "正在准备插件管理器",
                        detail: "正在安装 App 随附的独立插件管理器…",
                        logName: "plugin-manager-install.log",
                        status: status
                    ) { result in
                        switch result {
                        case .failure(let error): completion(.failure(error))
                        case .success:
                            self.ensureDesktopRuntime(
                                packages.desktopRuntime,
                                archive: desktopRuntimeArchive,
                                tools: tools,
                                status: status,
                                completion: completion
                            )
                        }
                    }
                    return
                }
                self.ensureDesktopRuntime(
                    packages.desktopRuntime,
                    archive: desktopRuntimeArchive,
                    tools: tools,
                    status: status,
                    completion: completion
                )
            }
        }
    }

    private func ensureDesktopRuntime(
        _ package: BundledPackage,
        archive: URL,
        tools: Tools,
        status: @escaping (String, String, String?) -> Void,
        completion: @escaping (Result<Void, Error>) -> Void
    ) {
        loadProfilePackages(tools: tools) { result in
            switch result {
            case .failure(let error): completion(.failure(error))
            case .success(let installed):
                if installed[package.name]?.version == package.version && self.profileBundles().contains(package.name) {
                    self.migrateLegacyDesktopRuntime(tools: tools, completion: completion)
                    return
                }
                self.installBundledPackage(
                    package,
                    archive: archive,
                    tools: tools,
                    title: "正在准备 Desktop",
                    detail: "正在安装当前 App 自带的管理界面…",
                    logName: "desktop-runtime-install.log",
                    status: status
                ) { result in
                    switch result {
                    case .failure(let error): completion(.failure(error))
                    case .success: self.migrateLegacyDesktopRuntime(tools: tools, completion: completion)
                    }
                }
            }
        }
    }

    private func installBundledPackage(
        _ package: BundledPackage,
        archive: URL,
        tools: Tools,
        title: String,
        detail: String,
        logName: String,
        status: @escaping (String, String, String?) -> Void,
        completion: @escaping (Result<Void, Error>) -> Void
    ) {
        guard tools.pnpm != nil else {
            completion(.failure(messageError("pnpm 尚未准备完成。")))
            return
        }
        status(title, detail, logName)
        runCommand(
            executable: tools.dsh,
            arguments: ["plugin", "--profile", "web", "add", "file:" + archive.path, "--save-exact"],
            environment: commandEnvironment(tools),
            logName: logName,
            timeout: 300
        ) { result in
            if case .failure(let reason) = result {
                completion(.failure(self.messageError("安装 \(package.name) 失败：\(reason)\n\n" + self.logTail(logName))))
                return
            }
            self.loadProfilePackages(tools: tools) { installedResult in
                switch installedResult {
                case .failure(let error): completion(.failure(error))
                case .success(let installed):
                    guard installed[package.name]?.version == package.version,
                          self.profileBundles().contains(package.name) else {
                        completion(.failure(self.messageError("dsh plugin 已退出成功，但 \(package.name) 没有以 \(package.version) 进入 web profile。\n\n" + self.logTail(logName))))
                        return
                    }
                    completion(.success(()))
                }
            }
        }
    }

    private func materializeBundledPackage(_ package: BundledPackage) throws -> URL {
        guard let resourceURL = Bundle.main.resourceURL else {
            throw messageError("App 没有 Resources 目录。")
        }
        let source = resourceURL
            .appendingPathComponent("packages", isDirectory: true)
            .appendingPathComponent(package.archive)
        guard FileManager.default.fileExists(atPath: source.path) else {
            throw messageError("App 随附的软件包不存在：\n\(source.path)")
        }
        return try materialize(package: package, from: source)
    }

    private func bindDesktopRuntimeDependency(_ package: BundledPackage, to archive: URL) throws {
        let manifestURL = URL(fileURLWithPath: Env.dshHome)
            .appendingPathComponent("profiles/web/package.json")
        guard FileManager.default.fileExists(atPath: manifestURL.path) else { return }

        let data = try Data(contentsOf: manifestURL)
        guard var manifest = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              var dependencies = manifest["dependencies"] as? [String: Any],
              dependencies[package.name] != nil else { return }

        let source = "file:" + archive.path
        guard dependencies[package.name] as? String != source else { return }
        dependencies[package.name] = source
        manifest["dependencies"] = dependencies
        let updated = try JSONSerialization.data(withJSONObject: manifest, options: [.prettyPrinted, .sortedKeys])
        try updated.write(to: manifestURL, options: .atomic)
    }

    private func bundledPackages() throws -> BundledPackages {
        guard let resourceURL = Bundle.main.resourceURL else { throw messageError("App 没有 Resources 目录。") }
        let manifestURL = resourceURL.appendingPathComponent("packages/manifest.json")
        let manifest = try JSONDecoder().decode(BundledPackages.self, from: Data(contentsOf: manifestURL))
        guard manifest.schemaVersion == 1,
              manifest.desktopRuntime.name == "@hanger-source/dsh-desktop-runtime",
              manifest.pluginManager.name == "@hanger-source/hang-dsh-plugins",
              validBundledPackage(manifest.desktopRuntime),
              validBundledPackage(manifest.pluginManager) else {
            throw messageError("App 随附的软件包清单无效。")
        }
        return manifest
    }

    private func validBundledPackage(_ package: BundledPackage) -> Bool {
        !package.version.isEmpty
            && package.archive == URL(fileURLWithPath: package.archive).lastPathComponent
            && package.archive.hasSuffix(".tgz")
            && package.sha256.count == 64
            && package.sha256.allSatisfy(\.isHexDigit)
    }

    private func materialize(package: BundledPackage, from source: URL) throws -> URL {
        let data = try Data(contentsOf: source)
        let digest = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
        guard digest == package.sha256 else {
            throw messageError("App 随附的软件包校验失败：\(package.name)")
        }
        let directory = URL(fileURLWithPath: Env.runtimeDir).appendingPathComponent("packages", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let destination = directory.appendingPathComponent(package.archive)
        if let existing = try? Data(contentsOf: destination), existing == data { return destination }
        try data.write(to: destination, options: .atomic)
        return destination
    }

    private func isLegacyPluginManager(_ package: ProfilePackage) throws -> Bool {
        let manifestURL = URL(fileURLWithPath: package.path).appendingPathComponent("package.json")
        let data = try Data(contentsOf: manifestURL)
        guard let manifest = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let dsh = manifest["dsh"] as? [String: Any] else {
            throw messageError("Hang DSH Plugins 的 package.json 无效。")
        }
        return dsh["client"] != nil
    }

    private func migrateLegacyDesktopRuntime(
        tools: Tools,
        completion: @escaping (Result<Void, Error>) -> Void
    ) {
        migrateLegacyPluginState()
        removeLegacyDesktopRuntime(at: 0, tools: tools, completion: completion)
    }

    private func removeLegacyDesktopRuntime(
        at index: Int,
        tools: Tools,
        completion: @escaping (Result<Void, Error>) -> Void
    ) {
        guard index < legacyDesktopRuntimeNames.count else {
            completion(.success(()))
            return
        }
        let packageName = legacyDesktopRuntimeNames[index]
        guard profileDeclaresPackage(packageName) else {
            removeLegacyDesktopRuntime(at: index + 1, tools: tools, completion: completion)
            return
        }
        runCommand(
            executable: tools.dsh,
            arguments: ["plugin", "--profile", "web", "remove", packageName],
            environment: commandEnvironment(tools),
            logName: "desktop-runtime-migration.log",
            timeout: 300
        ) { result in
            if case .failure(let reason) = result {
                completion(.failure(self.messageError("移除旧 Desktop 管理包失败：\(reason)\n\n" + self.logTail("desktop-runtime-migration.log"))))
                return
            }
            self.removeLegacyDesktopRuntime(at: index + 1, tools: tools, completion: completion)
        }
    }

    private func migrateLegacyPluginState() {
        let profile = Env.dshHome + "/profiles/web"
        let old = profile + "/.hang-dsh-plugins.json"
        let current = profile + "/.dsh-desktop-plugins.json"
        guard FileManager.default.fileExists(atPath: old) else { return }
        if !FileManager.default.fileExists(atPath: current) {
            try? FileManager.default.moveItem(atPath: old, toPath: current)
        } else {
            try? FileManager.default.removeItem(atPath: old)
        }
    }
    private func reconcilePluginActivationState(
        node: String,
        dsh: String,
        pnpm: String,
        npm: String?,
        completion: @escaping (Result<Void, Error>) -> Void
    ) {
        let tools = Tools(dsh: dsh, node: node, npm: npm, pnpm: pnpm)
        loadProfilePackages(tools: tools) { result in
            switch result {
            case .failure(let error): completion(.failure(error))
            case .success(let installed):
                guard let managerPath = installed["@hanger-source/hang-dsh-plugins"]?.path else {
                    completion(.failure(self.messageError("web profile 中没有 Hang DSH Plugins。")))
                    return
                }
                let script = URL(fileURLWithPath: managerPath).appendingPathComponent("host/reconcile.js").path
                guard FileManager.default.fileExists(atPath: script) else {
                    completion(.failure(self.messageError("插件管理器缺少状态入口：\n\(script)")))
                    return
                }
                var environment = self.commandEnvironment(tools)
                environment["DSH_HOME"] = Env.dshHome
                environment["DSH_EXECUTABLE"] = dsh
                self.runCommand(
                    executable: node,
                    arguments: [script],
                    environment: environment,
                    logName: "plugin-activation.log",
                    timeout: 30
                ) { commandResult in
                    if case .failure(let reason) = commandResult {
                        completion(.failure(self.messageError("应用插件启用状态失败：\(reason)\n\n" + self.logTail("plugin-activation.log"))))
                        return
                    }
                    completion(.success(()))
                }
            }
        }
    }

    private func profileManifest() -> [String: Any]? {
        let path = Env.dshHome + "/profiles/web/package.json"
        guard let data = FileManager.default.contents(atPath: path) else { return nil }
        return try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    }

    private func profileBundles() -> [String] {
        guard let dsh = profileManifest()?["dsh"] as? [String: Any],
              let profile = dsh["profile"] as? [String: Any],
              let bundles = profile["bundles"] as? [String] else { return [] }
        return bundles
    }

    private func profileDeclaresPackage(_ name: String) -> Bool {
        let dependencies = profileManifest()?["dependencies"] as? [String: Any] ?? [:]
        return dependencies[name] != nil || profileBundles().contains(name)
    }

    private func commandEnvironment(_ tools: Tools) -> [String: String] {
        Env.commandEnvironment(
            executable: tools.dsh,
            additionalExecutables: [tools.node] + (tools.pnpm.map { [$0] } ?? []) + (tools.npm.map { [$0] } ?? [])
        )
    }

    private func loadProfilePackages(
        tools: Tools,
        completion: @escaping (Result<[String: ProfilePackage], Error>) -> Void
    ) {
        runCommandCapture(
            executable: tools.dsh,
            arguments: ["plugin", "--profile", "web", "list", "--json", "--depth=0"],
            environment: commandEnvironment(tools),
            timeout: 30
        ) { result in
            switch result {
            case .failure(let reason):
                completion(.failure(self.messageError("读取 web profile 安装包失败：\(reason)")))
            case .success(let data):
                do {
                    guard let rows = try JSONSerialization.jsonObject(with: data) as? [[String: Any]],
                          let profile = rows.first else {
                        throw self.messageError("dsh plugin list 没有返回有效的 profile。")
                    }
                    let dependencies = profile["dependencies"] as? [String: [String: Any]] ?? [:]
                    if dependencies.isEmpty {
                        completion(.success([:]))
                        return
                    }
                    self.resolvePackageMetadata(
                        Array(dependencies.keys),
                        from: Env.dshHome + "/profiles/web",
                        tools: tools
                    ) { metadataResult in
                        switch metadataResult {
                        case .failure(let error): completion(.failure(error))
                        case .success(let packages): completion(.success(packages))
                        }
                    }
                } catch {
                    completion(.failure(error))
                }
            }
        }
    }

    private func resolvePackageMetadata(
        _ names: [String],
        from resolutionBase: String,
        tools: Tools,
        completion: @escaping (Result<[String: ProfilePackage], Error>) -> Void
    ) {
        guard let resourceURL = Bundle.main.resourceURL else {
            completion(.failure(messageError("App 没有 Resources 目录。")))
            return
        }
        let resolver = resourceURL.appendingPathComponent("tools/package-metadata.mjs").path
        guard FileManager.default.fileExists(atPath: resolver) else {
            completion(.failure(messageError("App 缺少 Node 包解析器。")))
            return
        }
        runCommandCapture(
            executable: tools.node,
            arguments: [resolver, resolutionBase] + names,
            environment: commandEnvironment(tools),
            timeout: 30
        ) { result in
            switch result {
            case .failure(let reason): completion(.failure(self.messageError("解析 Node 包失败：\(reason)")))
            case .success(let data):
                do {
                    guard let rows = try JSONSerialization.jsonObject(with: data) as? [String: [String: String]] else {
                        throw self.messageError("Node 包解析器没有返回有效结果。")
                    }
                    var packages: [String: ProfilePackage] = [:]
                    for name in names {
                        guard let row = rows[name], let version = row["version"], let path = row["path"] else {
                            throw self.messageError("Node 包解析器没有返回 \(name)。")
                        }
                        packages[name] = ProfilePackage(version: version, path: path)
                    }
                    completion(.success(packages))
                } catch {
                    completion(.failure(error))
                }
            }
        }
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

    private func runCommandCapture(
        executable: String,
        arguments: [String],
        environment: [String: String],
        timeout: TimeInterval,
        completion: @escaping (CaptureResult) -> Void
    ) {
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                let work = FileManager.default.temporaryDirectory.appendingPathComponent("dsh-command-" + UUID().uuidString, isDirectory: true)
                try FileManager.default.createDirectory(at: work, withIntermediateDirectories: true)
                defer { try? FileManager.default.removeItem(at: work) }
                let outputURL = work.appendingPathComponent("stdout")
                let errorURL = work.appendingPathComponent("stderr")
                _ = FileManager.default.createFile(atPath: outputURL.path, contents: nil)
                _ = FileManager.default.createFile(atPath: errorURL.path, contents: nil)
                let output = try FileHandle(forWritingTo: outputURL)
                let errors = try FileHandle(forWritingTo: errorURL)
                defer {
                    try? output.close()
                    try? errors.close()
                }
                let child = Process()
                child.executableURL = URL(fileURLWithPath: executable)
                child.arguments = arguments
                child.environment = environment
                child.standardOutput = output
                child.standardError = errors
                let finished = DispatchSemaphore(value: 0)
                child.terminationHandler = { _ in finished.signal() }
                try child.run()
                if finished.wait(timeout: .now() + timeout) == .timedOut {
                    child.terminate()
                    _ = finished.wait(timeout: .now() + 5)
                    DispatchQueue.main.async { completion(.failure("命令超时：\(executable)")) }
                    return
                }
                try output.synchronize()
                try errors.synchronize()
                let data = try Data(contentsOf: outputURL)
                let errorData = try Data(contentsOf: errorURL)
                guard child.terminationStatus == 0 else {
                    let detail = String(data: errorData.isEmpty ? data : errorData, encoding: .utf8) ?? ""
                    DispatchQueue.main.async { completion(.failure("命令退出码 \(child.terminationStatus)：\(detail)")) }
                    return
                }
                DispatchQueue.main.async { completion(.success(data)) }
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
        probeRoot(timeout: timeout) { response in
            completion(response != nil)
        }
    }

    private func probeRoot(timeout: TimeInterval = 2, completion: @escaping (HTTPURLResponse?) -> Void) {
        var request = URLRequest(url: Env.rootURL)
        request.timeoutInterval = timeout
        URLSession.shared.dataTask(with: request) { _, response, _ in
            DispatchQueue.main.async { completion(response as? HTTPURLResponse) }
        }.resume()
    }

    func start(launch: RuntimeLaunch, completion: @escaping (StartupResult) -> Void) {
        isListening(timeout: 0.25) { listening in
            if listening {
                completion(.failure("端口 \(Env.port) 已被现有服务占用。请先关闭该服务，再由 DSH.app 启动并持有它。"))
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
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: logPath)
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
            environment["DSH_VERSION"] = launch.dshVersion
            if let npm = launch.npm { environment["DSH_NPM_EXECUTABLE"] = npm }

            let child = Process()
            child.executableURL = URL(fileURLWithPath: launch.dsh)
            child.arguments = ["--profile", "web", "--no-open", "--port", String(Env.port)]
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
            poll(completion: completion)
        } catch {
            completion(.failure("启动 dsh web 失败：\(error.localizedDescription)"))
        }
    }

    private func poll(completion: @escaping (StartupResult) -> Void) {
        if process?.isRunning == false {
            completion(.failure("dsh web 已退出。\n\n" + serverLogTail()))
            return
        }
        probeRoot { response in
            if let status = response?.statusCode, (200..<400).contains(status) {
                completion(.ready(Env.rootURL))
                return
            }
            if let status = response?.statusCode,
               status == 401 || status == 403,
               let launchURL = self.announcedAuthenticatedLaunchURL() {
                // 需要鉴权时不预先访问一次性启动 URL；交给 WebKit 换取持久会话 cookie。
                completion(.ready(launchURL))
                return
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                self.poll(completion: completion)
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
        guard ownsServer, let child = process, child.isRunning else {
            completion(.failure("当前 DSH 服务不由此 App 持有，无法自动应用插件。"))
            return
        }
        Darwin.kill(child.processIdentifier, SIGTERM)
        DispatchQueue.global(qos: .userInitiated).async {
            child.waitUntilExit()
            DispatchQueue.main.async {
                self.process = nil
                self.ownsServer = false
                try? self.logHandle?.close()
                self.logHandle = nil
                self.isListening(timeout: 0.25) { listening in
                    if listening {
                        completion(.failure("原 DSH 服务退出后，端口 \(Env.port) 被其他服务占用。"))
                        return
                    }
                    self.launchServer(launch: launch, completion: completion)
                }
            }
        }
    }

    private func serverLogTail() -> String {
        let path = Env.runtimeDir + "/server.log"
        guard let text = try? String(contentsOfFile: path, encoding: .utf8) else {
            return "没有生成 server.log"
        }
        let tail = text.split(separator: "\n", omittingEmptySubsequences: false).suffix(40).joined(separator: "\n")
        return tail.replacingOccurrences(
            of: #"([?&]token=)[^&\s]+"#,
            with: "$1<redacted>",
            options: .regularExpression
        )
    }

    private func announcedAuthenticatedLaunchURL() -> URL? {
        let path = Env.runtimeDir + "/server.log"
        guard let text = try? String(contentsOfFile: path, encoding: .utf8) else { return nil }
        for line in text.split(separator: "\n").reversed() {
            let value = String(line).trimmingCharacters(in: .whitespacesAndNewlines)
            guard value.hasPrefix("dsh web: ") else { continue }
            let rawURL = String(value.dropFirst("dsh web: ".count)).split(whereSeparator: { $0.isWhitespace }).first.map(String.init)
            guard let rawURL,
                  let components = URLComponents(string: rawURL),
                  components.scheme == "http",
                  components.host == "127.0.0.1",
                  components.port == Env.port,
                  components.path == "/",
                  let token = components.queryItems?.first(where: { $0.name == "token" })?.value,
                  !token.isEmpty,
                  let url = components.url else { continue }
            return url
        }
        return nil
    }
}
