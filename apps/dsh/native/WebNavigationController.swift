import AppKit
import Foundation
import WebKit

/// Owns the boundary between the embedded DSH origin and links that belong in
/// the user's default browser. It is both delegates because WebKit routes
/// ordinary links through WKNavigationDelegate while target=_blank/window.open
/// requests arrive through WKUIDelegate.
final class WebNavigationController: NSObject, WKNavigationDelegate, WKUIDelegate {
    private let onFinish: (WKWebView) -> Void
    private let onFailure: (Error) -> Void

    init(onFinish: @escaping (WKWebView) -> Void, onFailure: @escaping (Error) -> Void) {
        self.onFinish = onFinish
        self.onFailure = onFailure
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        onFinish(webView)
    }

    func webView(
        _ webView: WKWebView,
        didFailProvisionalNavigation navigation: WKNavigation!,
        withError error: Error
    ) {
        onFailure(error)
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        guard navigationAction.navigationType == .linkActivated,
              navigationAction.targetFrame?.isMainFrame != false,
              let url = navigationAction.request.url,
              openExternallyIfNeeded(url, relativeTo: webView.url) else {
            decisionHandler(.allow)
            return
        }
        decisionHandler(.cancel)
    }

    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        guard navigationAction.targetFrame == nil,
              let url = navigationAction.request.url else { return nil }

        if openExternallyIfNeeded(url, relativeTo: webView.url) { return nil }

        // DSH does not own a second native window. Keep a same-origin
        // target=_blank navigation in the existing view instead of dropping it.
        if isWebURL(url), sameOrigin(url, webView.url) {
            webView.load(URLRequest(url: url))
        }
        return nil
    }

    private func openExternallyIfNeeded(_ url: URL, relativeTo currentURL: URL?) -> Bool {
        if isWebURL(url) {
            guard !sameOrigin(url, currentURL) else { return false }
        } else {
            let supportedSchemes = Set(["mailto", "tel", "sms", "facetime", "facetime-audio"])
            guard let scheme = url.scheme?.lowercased(), supportedSchemes.contains(scheme) else { return false }
        }

        let opened = NSWorkspace.shared.open(url)
        appendLog("url=\(url.absoluteString) opened=\(opened)")
        return opened
    }

    private func isWebURL(_ url: URL) -> Bool {
        guard let scheme = url.scheme?.lowercased() else { return false }
        return scheme == "http" || scheme == "https"
    }

    private func sameOrigin(_ lhs: URL, _ rhs: URL?) -> Bool {
        guard let rhs,
              let leftScheme = lhs.scheme?.lowercased(),
              let rightScheme = rhs.scheme?.lowercased(),
              let leftHost = lhs.host?.lowercased(),
              let rightHost = rhs.host?.lowercased() else { return false }
        return leftScheme == rightScheme
            && leftHost == rightHost
            && effectivePort(lhs) == effectivePort(rhs)
    }

    private func effectivePort(_ url: URL) -> Int? {
        if let port = url.port { return port }
        switch url.scheme?.lowercased() {
        case "http": return 80
        case "https": return 443
        default: return nil
        }
    }

    private func appendLog(_ message: String) {
        let path = Env.runtimeDir + "/external-links.log"
        let line = ISO8601DateFormatter().string(from: Date()) + " [WebNavigation] " + message + "\n"
        if let handle = FileHandle(forWritingAtPath: path) {
            handle.seekToEndOfFile()
            handle.write(line.data(using: .utf8)!)
            try? handle.close()
        } else {
            try? line.write(toFile: path, atomically: true, encoding: .utf8)
        }
    }
}
