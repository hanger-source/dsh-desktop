import AppKit
import Foundation
import WebKit

struct UpdateTarget {
    enum Kind: String, Codable { case app, dsh, pluginManager, plugin }

    let kind: Kind
    let key: String
    let version: String
    let package: String?
    let channel: String?
    let spec: String?
    let url: URL?
    let checksumURL: URL?

    init(command: [String: Any]) throws {
        guard let kindValue = command["kind"] as? String,
              let kind = Kind(rawValue: kindValue),
              let key = command["key"] as? String,
              let version = command["version"] as? String,
              version.range(of: #"^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$"#, options: .regularExpression) != nil else {
            throw UpdateError("更新目标格式无效。")
        }
        self.kind = kind
        self.key = key
        self.version = version
        package = command["package"] as? String
        channel = command["channel"] as? String
        spec = command["spec"] as? String
        url = (command["url"] as? String).flatMap(URL.init(string:))
        checksumURL = (command["checksumUrl"] as? String).flatMap(URL.init(string:))

        switch kind {
        case .app:
            guard key == "app", let url, let checksumURL,
                  UpdateCoordinator.validAppReleaseURL(url, version: version, asset: "DSH.dmg"),
                  UpdateCoordinator.validAppReleaseURL(checksumURL, version: version, asset: "SHA256SUMS.txt") else {
                throw UpdateError("App 更新目标无效。")
            }
        case .dsh:
            guard key == "dsh" else { throw UpdateError("DSH 更新目标无效。") }
        case .pluginManager:
            guard key == "plugin-manager",
                  package == "@hanger-source/hang-dsh-plugins",
                  spec == "github:hanger-source/dsh-desktop#plugin-hang-dsh-plugins-v\(version)&path:/plugins/hang-dsh-plugins" else {
                throw UpdateError("Hang DSH Plugins 更新目标无效。")
            }
        case .plugin:
            guard key.range(of: #"^[a-z0-9-]+$"#, options: .regularExpression) != nil,
                  package?.range(of: #"^@hanger-source/[a-z0-9-]+$"#, options: .regularExpression) != nil,
                  channel == "stable" || channel == "beta",
                  spec == "github:hanger-source/dsh-desktop#plugin-\(key)-v\(version)&path:/plugins/\(key)" else {
                throw UpdateError("插件更新目标无效：\(key)")
            }
        }
    }
}

private struct UpdateError: LocalizedError {
    let text: String
    init(_ text: String) { self.text = text }
    var errorDescription: String? { text }
}

private struct UpdateCheckpointMetadata: Codable {
    struct Target: Codable { let kind: String; let key: String; let version: String }
    let createdAt: Date
    let profileExisted: Bool
    let dshVersion: String?
    let npmExecutable: String?
    let targets: [Target]
}

final class UpdateCheckpoint {
    static let shared = UpdateCheckpoint()

    private var root: URL { URL(fileURLWithPath: Env.runtimeDir).appendingPathComponent("update-checkpoint", isDirectory: true) }
    private var metadataURL: URL { root.appendingPathComponent("transaction.json") }
    private var bootAttemptURL: URL { root.appendingPathComponent("boot-attempted") }
    private var profileBackup: URL { root.appendingPathComponent("profile-web", isDirectory: true) }
    private var currentProfile: URL { URL(fileURLWithPath: Env.dshHome).appendingPathComponent("profiles/web", isDirectory: true) }
    private var appBackup: URL { Bundle.main.bundleURL.deletingLastPathComponent().appendingPathComponent(".DSH.app.previous", isDirectory: true) }

    var isPending: Bool { FileManager.default.fileExists(atPath: metadataURL.path) }
    var bootWasAttempted: Bool { FileManager.default.fileExists(atPath: bootAttemptURL.path) }
    var appInstallFailed: Bool {
        FileManager.default.fileExists(atPath: root.appendingPathComponent("app-install-failed").path)
    }

    func begin(launch: RuntimeLaunch, targets: [UpdateTarget]) throws {
        guard !isPending else { throw UpdateError("上一次更新尚未确认完成，请先恢复或重启。") }
        let dshVersion = launch.dshVersion
        let manager = FileManager.default
        if manager.fileExists(atPath: root.path) { try manager.removeItem(at: root) }
        try manager.createDirectory(at: root, withIntermediateDirectories: true)
        let profileExisted = manager.fileExists(atPath: currentProfile.path)
        if profileExisted { try manager.copyItem(at: currentProfile, to: profileBackup) }
        let metadata = UpdateCheckpointMetadata(
            createdAt: Date(),
            profileExisted: profileExisted,
            dshVersion: dshVersion,
            npmExecutable: launch.npm,
            targets: targets.map { .init(kind: $0.kind.rawValue, key: $0.key, version: $0.version) }
        )
        try JSONEncoder().encode(metadata).write(to: metadataURL, options: .atomic)
    }

    func commit() throws {
        let manager = FileManager.default
        if manager.fileExists(atPath: root.path) { try manager.removeItem(at: root) }
        if manager.fileExists(atPath: appBackup.path) { try manager.removeItem(at: appBackup) }
    }

    func markBootAttempted() throws {
        guard isPending else { return }
        try Data().write(to: bootAttemptURL, options: .atomic)
    }

    func restore(launch: RuntimeLaunch?, completion: @escaping (Result<Bool, Error>) -> Void) {
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                let metadata = try self.readMetadata()
                let manager = FileManager.default
                if manager.fileExists(atPath: self.currentProfile.path) { try manager.removeItem(at: self.currentProfile) }
                if metadata.profileExisted { try manager.copyItem(at: self.profileBackup, to: self.currentProfile) }

                if metadata.targets.contains(where: { $0.kind == UpdateTarget.Kind.dsh.rawValue }),
                   let version = metadata.dshVersion {
                    let currentVersion = launch?.dshVersion
                    if currentVersion != version {
                        let npm = launch?.npm ?? Self.findExecutable([
                            metadata.npmExecutable,
                            "/opt/homebrew/bin/npm",
                            "/usr/local/bin/npm",
                            Env.home + "/.local/share/fnm/aliases/default/bin/npm",
                        ].compactMap { $0 })
                        guard let npm else { throw UpdateError("找不到 npm，无法恢复 dsh \(version)。") }
                        try Self.run(
                            executable: npm,
                            arguments: ["install", "-g", "@deepseek-ai/dsh@\(version)", "--registry=https://registry.npmjs.org", "--loglevel=info"],
                            environment: Env.commandEnvironment(executable: npm),
                            logName: "update-restore.log",
                            timeout: 300
                        )
                    }
                }

                if manager.fileExists(atPath: self.appBackup.path) {
                    try self.scheduleAppRestore()
                    DispatchQueue.main.async { completion(.success(true)) }
                    return
                }
                try self.commit()
                DispatchQueue.main.async { completion(.success(false)) }
            } catch {
                DispatchQueue.main.async { completion(.failure(error)) }
            }
        }
    }

    private func readMetadata() throws -> UpdateCheckpointMetadata {
        guard isPending else { throw UpdateError("没有可恢复的更新。") }
        return try JSONDecoder().decode(UpdateCheckpointMetadata.self, from: Data(contentsOf: metadataURL))
    }

    private func scheduleAppRestore() throws {
        let destination = Bundle.main.bundleURL
        guard let helperURL = Bundle.main.resourceURL?.appendingPathComponent("tools/DSHUpdateHelper"),
              FileManager.default.isExecutableFile(atPath: helperURL.path) else {
            throw UpdateError("App 缺少更新 helper，无法恢复 App。")
        }
        let logPath = Env.runtimeDir + "/app-update.log"
        if !FileManager.default.fileExists(atPath: logPath) {
            FileManager.default.createFile(atPath: logPath, contents: nil)
        }
        guard let log = FileHandle(forWritingAtPath: logPath) else {
            throw UpdateError("无法写入 App 更新日志。")
        }
        log.seekToEndOfFile()
        let helper = Process()
        helper.executableURL = helperURL
        helper.arguments = [
            "restore",
            String(ProcessInfo.processInfo.processIdentifier),
            destination.path,
            appBackup.path,
            root.path,
        ]
        helper.standardOutput = log
        helper.standardError = log
        try helper.run()
    }

    static func run(
        executable: String,
        arguments: [String],
        environment: [String: String],
        logName: String,
        timeout: TimeInterval
    ) throws {
        try FileManager.default.createDirectory(atPath: Env.runtimeDir, withIntermediateDirectories: true)
        let logPath = Env.runtimeDir + "/" + logName
        if !FileManager.default.fileExists(atPath: logPath) { FileManager.default.createFile(atPath: logPath, contents: nil) }
        guard let log = FileHandle(forWritingAtPath: logPath) else { throw UpdateError("无法写入日志：\(logPath)") }
        defer { try? log.close() }
        log.seekToEndOfFile()
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
            throw UpdateError("更新命令超时：\(executable)")
        }
        guard child.terminationStatus == 0 else {
            throw UpdateError("更新命令失败（\(child.terminationStatus)）。\n\n" + Self.logTail(logPath))
        }
    }

    private static func findExecutable(_ candidates: [String]) -> String? {
        candidates.first { FileManager.default.isExecutableFile(atPath: $0) }
    }

    private static func logTail(_ path: String) -> String {
        guard let text = try? String(contentsOfFile: path, encoding: .utf8) else { return "" }
        return text.split(separator: "\n", omittingEmptySubsequences: false).suffix(40).joined(separator: "\n")
    }

}

final class UpdateCoordinator {
    private weak var webView: WKWebView?
    private var updating = false

    func attach(to webView: WKWebView) { self.webView = webView }

    func handle(_ command: [String: Any], launch: RuntimeLaunch?, restart: @escaping () -> Void) -> Bool {
        guard command["action"] as? String == "applyUpdates" else { return false }
        guard !updating else {
            publish(state: "failed", message: "已有更新正在进行。")
            return true
        }
        guard let launch else {
            publish(state: "failed", message: "DSH 运行时尚未准备完成。")
            return true
        }
        do {
            guard let rows = command["targets"] as? [[String: Any]], !rows.isEmpty else { throw UpdateError("没有选择更新。") }
            let targets = try rows.map(UpdateTarget.init(command:))
            guard Set(targets.map { $0.key }).count == targets.count else { throw UpdateError("更新目标重复。") }
            updating = true
            try UpdateCheckpoint.shared.begin(launch: launch, targets: targets)
            publish(state: "installing", message: "正在安装所选的 \(targets.count) 项更新…")
            apply(targets: targets, launch: launch, restart: restart)
        } catch {
            updating = false
            publish(state: "failed", message: error.localizedDescription)
        }
        return true
    }

    private func apply(targets: [UpdateTarget], launch: RuntimeLaunch, restart: @escaping () -> Void) {
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                let executables = [launch.node, launch.pnpm] + (launch.npm.map { [$0] } ?? [])
                let environment = Env.commandEnvironment(executable: launch.dsh, additionalExecutables: executables)
                for target in targets where target.kind == .pluginManager || target.kind == .plugin {
                    try UpdateCheckpoint.run(
                        executable: launch.dsh,
                        arguments: ["plugin", "--profile", "web", "add", target.spec!, "--save-exact"],
                        environment: environment,
                        logName: "update-install.log",
                        timeout: 300
                    )
                    if target.kind == .plugin { try self.rememberPluginChannel(target) }
                }
                if let target = targets.first(where: { $0.kind == .dsh }) {
                    guard let npm = launch.npm else { throw UpdateError("找不到 npm，无法更新 dsh。") }
                    try UpdateCheckpoint.run(
                        executable: npm,
                        arguments: ["install", "-g", "@deepseek-ai/dsh@\(target.version)", "--registry=https://registry.npmjs.org", "--loglevel=info"],
                        environment: Env.commandEnvironment(executable: npm, additionalExecutables: [launch.node]),
                        logName: "update-install.log",
                        timeout: 300
                    )
                }
                DispatchQueue.main.async {
                    if let target = targets.first(where: { $0.kind == .app }) {
                        self.installApp(target: target, launch: launch)
                    } else {
                        self.publish(state: "restarting", message: "更新已安装，正在重启 APP…")
                        restart()
                    }
                }
            } catch {
                self.rollbackAfterFailure(error, launch: launch)
            }
        }
    }

    private func installApp(target: UpdateTarget, launch: RuntimeLaunch) {
        AppUpdater.shared.install(
            dmgURL: target.url!,
            checksumURL: target.checksumURL!,
            expectedVersion: target.version,
            status: { [weak self] event in self?.publish(state: event.state, message: event.message) },
            completion: { [weak self] result in
                switch result {
                case .success: NSApp.terminate(nil)
                case .failure(let error): self?.rollbackAfterFailure(error, launch: launch)
                }
            }
        )
    }

    private func rollbackAfterFailure(_ failure: Error, launch: RuntimeLaunch) {
        UpdateCheckpoint.shared.restore(launch: launch) { [weak self] result in
            self?.updating = false
            switch result {
            case .success(let relaunching):
                self?.publish(state: "failed", message: failure.localizedDescription + (relaunching ? "\n正在恢复更新前的 App。" : "\n已恢复到更新前。"))
                if relaunching { NSApp.terminate(nil) }
            case .failure(let rollbackError):
                self?.publish(state: "failed", message: failure.localizedDescription + "\n恢复失败：" + rollbackError.localizedDescription)
            }
        }
    }

    private func rememberPluginChannel(_ target: UpdateTarget) throws {
        guard let channel = target.channel else { return }
        let path = URL(fileURLWithPath: Env.dshHome).appendingPathComponent("profiles/web/.dsh-desktop-plugins.json")
        var state: [String: Any] = [:]
        if let data = try? Data(contentsOf: path), let current = try? JSONSerialization.jsonObject(with: data) as? [String: Any] { state = current }
        var channels = state["channels"] as? [String: String] ?? [:]
        channels[target.key] = channel
        state["channels"] = channels
        let data = try JSONSerialization.data(withJSONObject: state, options: [.prettyPrinted, .sortedKeys])
        try data.write(to: path, options: .atomic)
    }

    func publish(state: String, message: String) {
        let detail: [String: Any] = ["state": state, "message": message]
        guard let data = try? JSONSerialization.data(withJSONObject: detail),
              let json = String(data: data, encoding: .utf8) else { return }
        webView?.evaluateJavaScript("window.dispatchEvent(new CustomEvent('dsh-update-transaction', { detail: \(json) }))")
    }

    static func validAppReleaseURL(_ url: URL, version: String, asset: String) -> Bool {
        url.scheme == "https" && url.host == "github.com"
            && url.path == "/hanger-source/dsh-desktop/releases/download/dsh-app-v\(version)/\(asset)"
    }
}
