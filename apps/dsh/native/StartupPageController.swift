import Foundation
import WebKit

final class StartupPageController {
    private weak var webView: WKWebView?
    private var timer: Timer?
    private var startedAt = Date()
    private var logName: String?

    init(webView: WKWebView) {
        self.webView = webView
    }

    func showProgress(title: String, detail: String, logName: String?) {
        stop()
        startedAt = Date()
        self.logName = logName
        let html = """
        <!doctype html><meta charset="utf-8"><style>
        :root{color-scheme:light dark;--bg:#fff;--layer:#f7f7f8;--primary:#0f1115;--secondary:#61666b;--tertiary:#81858c;--border:rgb(0 0 0 / 10%);--brand:#0f1115}
        @media(prefers-color-scheme:dark){:root{--bg:#151517;--layer:#1d1d20;--primary:#f9fafb;--secondary:#cfd3d6;--tertiary:#adb2b8;--border:rgb(255 255 255 / 12%);--brand:#f9fafb}}
        *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--primary);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif;-webkit-font-smoothing:antialiased}
        main{width:min(520px,calc(100vw - 48px));margin:0 auto;padding:12vh 0 48px}.brand{font-size:16px;line-height:24px;font-weight:600;letter-spacing:.08em;margin-bottom:48px}
        .activity{display:grid;grid-template-columns:20px minmax(0,1fr);gap:14px;align-items:start}.spinner{position:relative;width:20px;height:20px;margin-top:1px;border-radius:50%;border:2px solid var(--border);animation:spin .8s linear infinite}
        .spinner:after{content:"";position:absolute;inset:-2px;border-radius:inherit;background:conic-gradient(var(--brand) 72deg,transparent 0);-webkit-mask:radial-gradient(farthest-side,transparent calc(100% - 2px),#000 0)}@keyframes spin{to{transform:rotate(360deg)}}
        h1{font-size:14px;line-height:22px;font-weight:600;margin:0 0 4px}.detail{font-size:12px;line-height:18px;color:var(--secondary);margin:0}.meta{display:flex;justify-content:space-between;gap:16px;margin:22px 0 10px;font-size:12px;line-height:18px;color:var(--tertiary)}
        .log{min-height:132px;max-height:250px;overflow:auto;margin:0;padding:12px 14px;border:1px solid var(--border);border-radius:12px;background:var(--layer);color:var(--secondary);white-space:pre-wrap;word-break:break-word;font:12px/18px "SF Mono","JetBrains Mono",Menlo,monospace}
        @media(prefers-reduced-motion:reduce){.spinner{animation-duration:1.6s}}
        </style><main><div class="brand">DEEPSEEK HARNESS</div><section class="activity"><div class="spinner" aria-hidden="true"></div><div><h1>\(escapeHTML(title))</h1><p class="detail">\(escapeHTML(detail))</p></div></section><div class="meta"><span>启动链正在运行</span><span id="elapsed">已用时 0 秒</span></div><pre class="log" id="live-log">正在等待进程输出…</pre></main>
        <script>window.dshUpdateProgress=function(s){document.getElementById('elapsed').textContent=s.elapsed;var box=document.getElementById('live-log');box.textContent=s.log||'进程仍在运行，暂时没有新输出…';box.scrollTop=box.scrollHeight}</script>
        """
        webView?.loadHTMLString(html, baseURL: nil)
        timer = Timer.scheduledTimer(withTimeInterval: 0.75, repeats: true) { [weak self] _ in
            self?.refresh()
        }
        refresh()
    }

    func showStatus(title: String, detail: String, isError: Bool = false) {
        stop()
        let html = """
        <!doctype html><meta charset="utf-8"><style>
        :root{color-scheme:light dark;--bg:#fff;--layer:#f7f7f8;--primary:#0f1115;--secondary:#61666b;--border:rgb(0 0 0 / 10%);--error:#d92d20}
        @media(prefers-color-scheme:dark){:root{--bg:#151517;--layer:#1d1d20;--primary:#f9fafb;--secondary:#cfd3d6;--border:rgb(255 255 255 / 12%);--error:#ff6b63}}
        *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--primary);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif;-webkit-font-smoothing:antialiased}
        main{width:min(520px,calc(100vw - 48px));margin:0 auto;padding:12vh 0 48px}.brand{font-size:16px;line-height:24px;font-weight:600;letter-spacing:.08em;margin-bottom:48px}
        .status{display:flex;align-items:center;gap:10px;margin-bottom:14px}.mark{width:8px;height:8px;border-radius:50%;background:\(isError ? "var(--error)" : "var(--primary)")}.status h1{font-size:14px;line-height:22px;font-weight:600;margin:0}
        pre{margin:0;padding:12px 14px;border:1px solid var(--border);border-radius:12px;background:var(--layer);color:var(--secondary);white-space:pre-wrap;word-break:break-word;font:12px/18px "SF Mono","JetBrains Mono",Menlo,monospace}
        </style><main><div class="brand">DEEPSEEK HARNESS</div><div class="status"><span class="mark"></span><h1>\(escapeHTML(title))</h1></div><pre>\(escapeHTML(detail))</pre></main>
        """
        webView?.loadHTMLString(html, baseURL: nil)
    }

    func stop() {
        timer?.invalidate()
        timer = nil
        logName = nil
    }

    private func refresh() {
        let seconds = max(0, Int(Date().timeIntervalSince(startedAt)))
        let elapsed = seconds < 60 ? "已用时 \(seconds) 秒" : String(format: "已用时 %d:%02d", seconds / 60, seconds % 60)
        var log = "正在等待进程输出…"
        if let name = logName {
            let path = Env.runtimeDir + "/" + name
            if let text = try? String(contentsOfFile: path, encoding: .utf8), !text.isEmpty {
                log = text.split(separator: "\n", omittingEmptySubsequences: false).suffix(18).joined(separator: "\n")
            }
        }
        guard let data = try? JSONSerialization.data(withJSONObject: ["elapsed": elapsed, "log": log]),
              let json = String(data: data, encoding: .utf8) else { return }
        webView?.evaluateJavaScript("window.dshUpdateProgress && window.dshUpdateProgress(\(json))")
    }

    private func escapeHTML(_ value: String) -> String {
        value.replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
    }
}
