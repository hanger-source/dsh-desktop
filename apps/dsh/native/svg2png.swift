// 把白色鲸鱼 SVG 渲染成透明背景 PNG（WebKit 离屏 + drawsBackground=false）。
// 用法: swift svg2png.swift <in.svg> <out.png> [size]
import AppKit
import WebKit
import ImageIO
import UniformTypeIdentifiers
import Foundation

final class Nav: NSObject, WKNavigationDelegate {
    let cb: (Bool) -> Void
    init(_ cb: @escaping (Bool) -> Void) { self.cb = cb }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { cb(true) }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { cb(false) }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { cb(false) }
}

let args = CommandLine.arguments
guard args.count >= 3 else { print("用法: swift svg2png.swift <in.svg> <out.png> [size]"); exit(2) }
let size = args.count >= 4 ? Int(args[4]) ?? 1024 : 1024
let svg = try! String(contentsOf: URL(fileURLWithPath: args[1]), encoding: .utf8)

let webView = WKWebView(frame: NSRect(x: 0, y: 0, width: size, height: size),
                        configuration: WKWebViewConfiguration())
webView.setValue(false, forKey: "drawsBackground")   // 透明背景，白鲸可见
var finished = false
var failed = false
webView.navigationDelegate = Nav { ok in
    finished = true
    failed = !ok
}
let dataURL = "data:image/svg+xml;base64," + Data(svg.utf8).base64EncodedString()
webView.load(URLRequest(url: URL(string: dataURL)!))
let runloop = RunLoop.current
let limit = Date(timeIntervalSinceNow: 10)
while !finished && Date() < limit {
    runloop.run(mode: .default, before: Date(timeIntervalSinceNow: 0.05))
}
if failed {
    print("svg2png: WebKit 加载失败")
    exit(1)
}
webView.takeSnapshot(with: nil) { img, _ in
    guard let img = img else { print("svg2png: 无快照"); exit(1) }
    var cg: CGImage? = nil
    img.cgImage(forProposedRect: nil, context: nil, hints: nil).flatMap { cg = $0 }
    guard let cg = cg else { print("svg2png: 无 CGImage"); exit(1) }
    guard let dest = CGImageDestinationCreateWithURL(
        URL(fileURLWithPath: args[2]) as CFURL, UTType.png.identifier as CFString, 1, nil
    ) else { print("svg2png: 无法创建输出"); exit(1) }
    CGImageDestinationAddImage(dest, cg, nil)
    if CGImageDestinationFinalize(dest) {
        print("svg2png: 写入 \(args[2])")
        exit(0)
    } else {
        print("svg2png: 写出失败")
        exit(1)
    }
}
runloop.run(mode: .default, before: Date(timeIntervalSinceNow: 5))
exit(1)