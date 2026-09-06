import Foundation

@main
struct UpdateCheckpointTest {
    static func main() throws {
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
