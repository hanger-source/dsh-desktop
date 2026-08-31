import Foundation
import CryptoKit

struct AppUpdateEvent {
    let state: String
    let message: String
    let progress: Double?
}

final class AppUpdater: NSObject, URLSessionDownloadDelegate, URLSessionTaskDelegate {
    static let shared = AppUpdater()

    private var status: ((AppUpdateEvent) -> Void)?
    private var completion: ((Result<Void, Error>) -> Void)?
    private var expectedVersion = ""
    private var expectedDigest = ""
    private var downloadFinished = false
    private var updating = false
    private lazy var session = URLSession(
        configuration: .ephemeral,
        delegate: self,
        delegateQueue: {
            let queue = OperationQueue()
            queue.maxConcurrentOperationCount = 1
            return queue
        }()
    )

    func install(
        dmgURL: URL,
        checksumURL: URL,
        expectedVersion: String,
        status: @escaping (AppUpdateEvent) -> Void,
        completion: @escaping (Result<Void, Error>) -> Void
    ) {
        guard !updating else {
            completion(.failure(error("App 更新已经在进行中。")))
            return
        }
        guard validReleaseURL(dmgURL, suffix: "/DSH.dmg"),
              validReleaseURL(checksumURL, suffix: "/SHA256SUMS.txt") else {
            completion(.failure(error("更新地址不是 DSH Desktop 的正式 GitHub Release。")))
            return
        }
        guard expectedVersion.split(separator: ".").count == 3 else {
            completion(.failure(error("目标 App 版本无效：\(expectedVersion)")))
            return
        }

        updating = true
        self.status = status
        self.completion = completion
        self.expectedVersion = expectedVersion
        emit(state: "checking", message: "正在读取 Release 校验信息…")

        var request = URLRequest(url: checksumURL)
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.timeoutInterval = 30
        URLSession.shared.dataTask(with: request) { [weak self] data, response, error in
            guard let self else { return }
            if let error {
                self.fail(self.error("读取 Release 校验信息失败：\(error.localizedDescription)"))
                return
            }
            guard let http = response as? HTTPURLResponse, http.statusCode == 200,
                  let data, let text = String(data: data, encoding: .utf8),
                  let digest = self.dmgDigest(from: text) else {
                self.fail(self.error("Release 的 SHA256SUMS.txt 无效。"))
                return
            }
            self.expectedDigest = digest
            self.emit(state: "downloading", message: "正在下载 DSH Desktop \(expectedVersion)…", progress: 0)
            var downloadRequest = URLRequest(url: dmgURL)
            downloadRequest.cachePolicy = .reloadIgnoringLocalCacheData
            downloadRequest.timeoutInterval = 300
            self.downloadFinished = false
            self.session.downloadTask(with: downloadRequest).resume()
        }.resume()
    }

    func urlSession(
        _ session: URLSession,
        downloadTask: URLSessionDownloadTask,
        didWriteData bytesWritten: Int64,
        totalBytesWritten: Int64,
        totalBytesExpectedToWrite: Int64
    ) {
        let progress = totalBytesExpectedToWrite > 0
            ? min(1, Double(totalBytesWritten) / Double(totalBytesExpectedToWrite))
            : nil
        let percent = progress.map { " \(Int($0 * 100))%" } ?? ""
        emit(state: "downloading", message: "正在下载 DSH Desktop \(expectedVersion)…\(percent)", progress: progress)
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
        downloadFinished = true
        do {
            let work = FileManager.default.temporaryDirectory
                .appendingPathComponent("dsh-desktop-update-" + UUID().uuidString, isDirectory: true)
            try FileManager.default.createDirectory(at: work, withIntermediateDirectories: true)
            let dmg = work.appendingPathComponent("DSH.dmg")
            try FileManager.default.copyItem(at: location, to: dmg)
            emit(state: "verifying", message: "下载完成，正在校验并准备安装…")
            DispatchQueue.global(qos: .userInitiated).async { [weak self] in
                guard let self else { return }
                do {
                    try self.prepareInstallation(dmg: dmg, work: work)
                    self.emit(state: "restarting", message: "安装已准备完成，正在重启 APP…")
                    DispatchQueue.main.async {
                        self.completion?(.success(()))
                    }
                } catch {
                    self.fail(error)
                }
            }
        } catch {
            fail(error)
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let error, !downloadFinished else { return }
        fail(self.error("下载 DSH Desktop 失败：\(error.localizedDescription)"))
    }

    private func prepareInstallation(dmg: URL, work: URL) throws {
        let actualDigest = try sha256(of: dmg)
        guard actualDigest == expectedDigest else {
            throw error("DSH.dmg 的 SHA256 校验失败，已停止更新。")
        }

        let attach = try command("/usr/bin/hdiutil", ["attach", dmg.path, "-nobrowse", "-readonly", "-plist"])
        guard let plist = try PropertyListSerialization.propertyList(from: attach.output, format: nil) as? [String: Any],
              let entities = plist["system-entities"] as? [[String: Any]],
              let mountPath = entities.compactMap({ $0["mount-point"] as? String }).last else {
            throw error("DSH.dmg 已挂载，但没有可用的挂载目录。")
        }
        defer { _ = try? command("/usr/bin/hdiutil", ["detach", mountPath, "-quiet"]) }

        let source = URL(fileURLWithPath: mountPath).appendingPathComponent("DSH.app", isDirectory: true)
        try validate(app: source)

        let destination = Bundle.main.bundleURL
        let parent = destination.deletingLastPathComponent()
        guard FileManager.default.isWritableFile(atPath: parent.path) else {
            throw error("没有权限更新 \(destination.path)。请把 DSH.app 安装到当前用户的 Applications 目录。")
        }
        let staged = parent.appendingPathComponent(".DSH.app.update-" + UUID().uuidString, isDirectory: true)
        let copy = try command("/usr/bin/ditto", [source.path, staged.path])
        guard copy.status == 0 else { throw error("复制新版 DSH.app 失败。") }
        try validate(app: staged)
        try launchInstaller(staged: staged, destination: destination, work: work)
    }

    private func validate(app: URL) throws {
        guard let bundle = Bundle(url: app), bundle.bundleIdentifier == "com.hanger.dsh-desktop" else {
            throw error("Release 中的 App 不是 DSH Desktop。")
        }
        let version = bundle.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String
        guard version == expectedVersion else {
            throw error("Release App 版本不一致：期望 \(expectedVersion)，实际 \(version ?? "未知")。")
        }
        let verification = try command("/usr/bin/codesign", ["--verify", "--deep", "--strict", app.path])
        guard verification.status == 0 else {
            throw error("Release App 签名校验失败：\(verification.errorText)")
        }
    }

    private func launchInstaller(staged: URL, destination: URL, work: URL) throws {
        let parent = destination.deletingLastPathComponent()
        let backup = parent.appendingPathComponent(".DSH.app.previous", isDirectory: true)
        if FileManager.default.fileExists(atPath: backup.path) {
            try FileManager.default.removeItem(at: backup)
        }
        let log = Env.runtimeDir + "/app-update.log"
        let script = work.appendingPathComponent("install-update.sh")
        let pid = ProcessInfo.processInfo.processIdentifier
        let text = """
        #!/bin/bash
        set -eu
        exec >> \(shellQuote(log)) 2>&1
        while /bin/kill -0 \(pid) 2>/dev/null; do /bin/sleep 0.2; done
        if [ -e \(shellQuote(destination.path)) ]; then
          /bin/mv \(shellQuote(destination.path)) \(shellQuote(backup.path))
        fi
        if /bin/mv \(shellQuote(staged.path)) \(shellQuote(destination.path)); then
          /usr/bin/open \(shellQuote(destination.path))
          exit 0
        fi
        if [ -e \(shellQuote(backup.path)) ]; then
          /bin/mv \(shellQuote(backup.path)) \(shellQuote(destination.path))
          /usr/bin/open \(shellQuote(destination.path))
        fi
        exit 1
        """
        try text.write(to: script, atomically: true, encoding: .utf8)

        let helper = Process()
        helper.executableURL = URL(fileURLWithPath: "/usr/bin/nohup")
        helper.arguments = ["/bin/bash", script.path]
        helper.standardOutput = FileHandle.nullDevice
        helper.standardError = FileHandle.nullDevice
        try helper.run()
    }

    static func cleanupPreviousInstallation() {
        let backup = Bundle.main.bundleURL.deletingLastPathComponent()
            .appendingPathComponent(".DSH.app.previous", isDirectory: true)
        if FileManager.default.fileExists(atPath: backup.path) {
            try? FileManager.default.removeItem(at: backup)
        }
    }

    private func dmgDigest(from text: String) -> String? {
        for line in text.split(separator: "\n") {
            let fields = line.split(whereSeparator: { $0 == " " || $0 == "\t" })
            guard fields.count >= 2, fields.last == "DSH.dmg" else { continue }
            let digest = String(fields[0]).lowercased()
            if digest.count == 64, digest.allSatisfy({ $0.isHexDigit }) { return digest }
        }
        return nil
    }

    private func sha256(of url: URL) throws -> String {
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        var hasher = SHA256()
        while let data = try handle.read(upToCount: 1024 * 1024), !data.isEmpty {
            hasher.update(data: data)
        }
        return hasher.finalize().map { String(format: "%02x", $0) }.joined()
    }

    private func validReleaseURL(_ url: URL, suffix: String) -> Bool {
        url.scheme == "https"
            && url.host == "github.com"
            && url.path.hasPrefix("/hanger-source/dsh-desktop/releases/download/dsh-app-v")
            && url.path.hasSuffix(suffix)
    }

    private func command(_ executable: String, _ arguments: [String]) throws -> (status: Int32, output: Data, errorText: String) {
        let process = Process()
        let output = Pipe()
        let errors = Pipe()
        process.executableURL = URL(fileURLWithPath: executable)
        process.arguments = arguments
        process.standardOutput = output
        process.standardError = errors
        try process.run()
        process.waitUntilExit()
        let data = output.fileHandleForReading.readDataToEndOfFile()
        let errorText = String(data: errors.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
        guard process.terminationStatus == 0 else {
            throw error("命令失败（\(process.terminationStatus)）：\(executable)\n\(errorText)")
        }
        return (process.terminationStatus, data, errorText)
    }

    private func shellQuote(_ value: String) -> String {
        "'" + value.replacingOccurrences(of: "'", with: "'\"'\"'") + "'"
    }

    private func emit(state: String, message: String, progress: Double? = nil) {
        DispatchQueue.main.async { [weak self] in
            self?.status?(AppUpdateEvent(state: state, message: message, progress: progress))
        }
    }

    private func fail(_ failure: Error) {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.status?(AppUpdateEvent(state: "failed", message: failure.localizedDescription, progress: nil))
            self.completion?(.failure(failure))
            self.updating = false
        }
    }

    private func error(_ message: String) -> Error {
        NSError(domain: "DSHAppUpdater", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
    }
}
