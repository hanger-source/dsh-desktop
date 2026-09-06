import Foundation
import Darwin

private struct HelperFailure: Error, CustomStringConvertible {
    let description: String
}

private func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(1)
}

private func waitForExit(pid: pid_t) {
    while kill(pid, 0) == 0 || errno == EPERM {
        usleep(200_000)
    }
}

private func openApplication(_ url: URL) throws {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/usr/bin/open")
    process.arguments = [url.path]
    try process.run()
    process.waitUntilExit()
    guard process.terminationStatus == 0 else {
        throw HelperFailure(description: "open 退出码 \(process.terminationStatus)")
    }
}

private func touch(_ url: URL) {
    FileManager.default.createFile(atPath: url.path, contents: Data())
}

private func install(arguments: ArraySlice<String>) throws {
    guard arguments.count == 6,
          let pid = pid_t(arguments[arguments.startIndex]) else {
        throw HelperFailure(description: "install 参数无效")
    }
    let values = arguments.dropFirst().map { URL(fileURLWithPath: $0) }
    let staged = values[0]
    let destination = values[1]
    let backup = values[2]
    let failureMarker = values[3]
    let workDirectory = values[4]
    let files = FileManager.default

    waitForExit(pid: pid)
    defer { try? files.removeItem(at: workDirectory) }
    do {
        if files.fileExists(atPath: destination.path) {
            try files.moveItem(at: destination, to: backup)
        }
        try files.moveItem(at: staged, to: destination)
        try openApplication(destination)
    } catch {
        touch(failureMarker)
        if files.fileExists(atPath: destination.path) {
            try? files.removeItem(at: destination)
        }
        if files.fileExists(atPath: backup.path) {
            try? files.moveItem(at: backup, to: destination)
        }
        if files.fileExists(atPath: destination.path) {
            try? openApplication(destination)
        }
        throw error
    }
}

private func restore(arguments: ArraySlice<String>) throws {
    guard arguments.count == 4,
          let pid = pid_t(arguments[arguments.startIndex]) else {
        throw HelperFailure(description: "restore 参数无效")
    }
    let values = arguments.dropFirst().map { URL(fileURLWithPath: $0) }
    let destination = values[0]
    let backup = values[1]
    let checkpoint = values[2]
    let files = FileManager.default

    waitForExit(pid: pid)
    if files.fileExists(atPath: destination.path) {
        try files.removeItem(at: destination)
    }
    try files.moveItem(at: backup, to: destination)
    try openApplication(destination)
    try files.removeItem(at: checkpoint)
}

let arguments = CommandLine.arguments.dropFirst()
guard let mode = arguments.first else { fail("缺少更新模式") }
do {
    switch mode {
    case "install": try install(arguments: arguments.dropFirst())
    case "restore": try restore(arguments: arguments.dropFirst())
    default: throw HelperFailure(description: "未知更新模式：\(mode)")
    }
} catch {
    fail("DSH 更新 helper 失败：\(error)")
}
