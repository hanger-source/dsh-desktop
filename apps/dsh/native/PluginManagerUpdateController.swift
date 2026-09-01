import Foundation
import WebKit

final class PluginManagerUpdateController {
    private weak var webView: WKWebView?

    func attach(to webView: WKWebView) {
        self.webView = webView
    }

    func handle(
        _ command: [String: Any],
        launch: RuntimeLaunch?,
        onInstalled: @escaping () -> Void
    ) -> Bool {
        guard command["action"] as? String == "updatePluginManager" else { return false }
        guard let launch else {
            publish(state: "failed", message: "DSH 运行时尚未准备完成。")
            return true
        }
        guard let version = command["version"] as? String else {
            publish(state: "failed", message: "基础插件更新参数不完整。")
            return true
        }

        publish(state: "installing", message: "正在由 Desktop App 更新 Hang DSH Plugins…")
        RuntimeInstaller.shared.updatePluginManager(launch: launch, version: version) { [weak self] result in
            switch result {
            case .success:
                self?.publish(state: "installed", message: "基础插件已更新，正在重新加载…")
                onInstalled()
            case .failure(let error):
                self?.publish(state: "failed", message: error.localizedDescription)
            }
        }
        return true
    }

    private func publish(state: String, message: String) {
        let detail: [String: Any] = ["state": state, "message": message]
        guard let data = try? JSONSerialization.data(withJSONObject: detail),
              let json = String(data: data, encoding: .utf8) else { return }
        webView?.evaluateJavaScript(
            "window.dispatchEvent(new CustomEvent('dsh-plugin-manager-update', { detail: \(json) }))"
        )
    }
}
