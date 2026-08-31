import AppKit
import Foundation
import WebKit

final class AppUpdateController {
    private weak var webView: WKWebView?

    func attach(to webView: WKWebView) {
        self.webView = webView
    }

    func handle(_ command: [String: Any]) -> Bool {
        guard command["action"] as? String == "updateApp" else { return false }
        guard let value = command["url"] as? String,
              let checksumValue = command["checksumUrl"] as? String,
              let version = command["version"] as? String,
              let url = URL(string: value),
              let checksumURL = URL(string: checksumValue) else {
            publish(AppUpdateEvent(state: "failed", message: "App 更新参数不完整。", progress: nil))
            return true
        }

        AppUpdater.shared.install(
            dmgURL: url,
            checksumURL: checksumURL,
            expectedVersion: version,
            status: { [weak self] event in self?.publish(event) },
            completion: { result in
                if case .success = result {
                    NSApp.terminate(nil)
                }
            }
        )
        return true
    }

    private func publish(_ event: AppUpdateEvent) {
        var detail: [String: Any] = [
            "state": event.state,
            "message": event.message,
        ]
        if let progress = event.progress { detail["progress"] = progress }
        guard let data = try? JSONSerialization.data(withJSONObject: detail),
              let json = String(data: data, encoding: .utf8) else { return }
        webView?.evaluateJavaScript(
            "window.dispatchEvent(new CustomEvent('dsh-app-update', { detail: \(json) }))"
        )
    }
}
