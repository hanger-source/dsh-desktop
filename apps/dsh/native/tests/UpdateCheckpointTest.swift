import Foundation

@main
struct UpdateCheckpointTest {
    static func main() throws {
        let package = "file:/tmp/hanger-source-dsh-desktop-runtime-0.3.28.tgz"
        guard DshPluginCommand.add(package) == [
            "plugin", "--profile", "web", "add",
            "--registry=https://registry.npmjs.org", package, "--save-exact",
        ] else {
            throw NSError(domain: "test", code: 10, userInfo: [NSLocalizedDescriptionKey: "dsh plugin add 没有固定使用 npmjs"])
        }

        let manager = FileManager.default
        let profile = URL(fileURLWithPath: Env.dshHome).appendingPathComponent("profiles/web", isDirectory: true)
        try manager.createDirectory(at: profile, withIntermediateDirectories: true)
        let preserved = profile.appendingPathComponent("preserved.txt")
        let introduced = profile.appendingPathComponent("introduced.txt")
        try "before".write(to: preserved, atomically: true, encoding: .utf8)

        let launch = RuntimeLaunch(
            dsh: "/usr/bin/false",
            dshVersion: "0.1.2-rc.1",
            node: "/usr/bin/false",
            npm: nil,
            pnpm: "/usr/bin/false"
        )

        let startupFinished = DispatchSemaphore(value: 0)
        var startupResult: StartupResult?
        ServerManager.shared.start(launch: launch) { result in
            startupResult = result
            startupFinished.signal()
        }
        let startupDeadline = Date(timeIntervalSinceNow: 5)
        while startupFinished.wait(timeout: .now() + 0.05) == .timedOut,
              Date() < startupDeadline {
            RunLoop.main.run(until: Date(timeIntervalSinceNow: 0.01))
        }
        switch startupResult {
        case .failure(let message) where message.contains("dsh web 已退出"): break
        case .failure(let message):
            throw NSError(domain: "test", code: 11, userInfo: [NSLocalizedDescriptionKey: "子进程退出被报告成其他失败：\(message)"])
        case .ready(let url):
            throw NSError(domain: "test", code: 12, userInfo: [NSLocalizedDescriptionKey: "已经退出的子进程被报告为就绪：\(url)"])
        case nil:
            throw NSError(domain: "test", code: 13, userInfo: [NSLocalizedDescriptionKey: "子进程退出后启动回调没有结束"])
        }

        let target = try UpdateTarget(command: [
            "kind": "plugin",
            "key": "conversation-experience",
            "version": "0.1.1",
            "package": "@hanger-source/dsh-conversation-experience",
            "channel": "stable",
            "spec": "github:hanger-source/dsh-desktop#plugin-conversation-experience-v0.1.1&path:/plugins/conversation-experience",
        ])
        try UpdateCheckpoint.shared.begin(launch: launch, targets: [target])
        guard !UpdateCheckpoint.shared.bootWasAttempted else {
            throw NSError(domain: "test", code: 8, userInfo: [NSLocalizedDescriptionKey: "更新开始时错误地带有启动记录"])
        }
        try UpdateCheckpoint.shared.markBootAttempted()
        guard UpdateCheckpoint.shared.bootWasAttempted else {
            throw NSError(domain: "test", code: 9, userInfo: [NSLocalizedDescriptionKey: "没有持久化启动记录"])
        }
        try "after".write(to: preserved, atomically: true, encoding: .utf8)
        try "new".write(to: introduced, atomically: true, encoding: .utf8)

        let finished = DispatchSemaphore(value: 0)
        var restored: Result<Bool, Error>?
        UpdateCheckpoint.shared.restore(launch: launch) { result in
            restored = result
            finished.signal()
        }
        while finished.wait(timeout: .now() + 0.05) == .timedOut {
            RunLoop.main.run(until: Date(timeIntervalSinceNow: 0.01))
        }
        switch restored {
        case .success(false): break
        case .success(true): throw NSError(domain: "test", code: 1, userInfo: [NSLocalizedDescriptionKey: "意外安排了 App 恢复"])
        case .failure(let error): throw error
        case nil: throw NSError(domain: "test", code: 2, userInfo: [NSLocalizedDescriptionKey: "恢复没有返回结果"])
        }
        let value = try String(contentsOf: preserved, encoding: .utf8)
        guard value == "before" else { throw NSError(domain: "test", code: 3, userInfo: [NSLocalizedDescriptionKey: "原文件没有恢复"])}
        guard !manager.fileExists(atPath: introduced.path) else { throw NSError(domain: "test", code: 4, userInfo: [NSLocalizedDescriptionKey: "新增文件没有移除"])}
        guard !UpdateCheckpoint.shared.isPending else { throw NSError(domain: "test", code: 5, userInfo: [NSLocalizedDescriptionKey: "恢复后仍有待确认事务"])}
        print("Update checkpoint restore passed")
    }
}
