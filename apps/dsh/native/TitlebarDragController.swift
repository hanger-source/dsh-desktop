import AppKit
import Foundation
import WebKit

final class TitlebarDragController: NSObject, WKScriptMessageHandler {
    private static let webTitlebarHeight: CGFloat = 64
    private weak var window: NSWindow?

    func attach(to window: NSWindow, configuration: WKWebViewConfiguration, height: CGFloat) {
        self.window = window
        configuration.userContentController.add(self, name: "dshTitlebarDrag")

        let dragHeight = max(height, Self.webTitlebarHeight)
        let cssHeight = String(format: "%.1f", locale: Locale(identifier: "en_US_POSIX"), dragHeight)
        let script = WKUserScript(
            source: """
            (() => {
              const dragHeight = \(cssHeight)
              const interactiveSelector = [
                'a[href]',
                'button',
                'input',
                'textarea',
                'select',
                'summary',
                '[contenteditable]:not([contenteditable="false"])',
                '[draggable="true"]',
                '[role="button"]',
                '[role="link"]',
                '[role="menuitem"]',
                '[role="tab"]',
                '[tabindex]:not([tabindex="-1"])'
              ].join(',')

              const isInteractive = target => {
                if (!(target instanceof Element)) return false
                if (target.closest(interactiveSelector)) return true
                for (let node = target; node && node !== document.body; node = node.parentElement) {
                  if (getComputedStyle(node).cursor === 'pointer') return true
                }
                return false
              }

              const dragHoverClass = 'dsh-native-titlebar-drag-hover'
              const isDragTarget = event => {
                document.documentElement.classList.remove(dragHoverClass)
                return event.clientY <= dragHeight && !isInteractive(event.target)
              }

              const style = document.createElement('style')
              style.textContent = `
                html.dsh-native-titlebar-drag-hover,
                html.dsh-native-titlebar-drag-hover * {
                  cursor: default !important;
                }
              `
              const attachStyle = () => {
                if (!style.isConnected) document.head.appendChild(style)
              }
              if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', attachStyle, { once: true })
              } else {
                attachStyle()
              }

              document.addEventListener('mousemove', event => {
                document.documentElement.classList.toggle(dragHoverClass, isDragTarget(event))
              }, true)
              document.addEventListener('mouseleave', () => {
                document.documentElement.classList.remove(dragHoverClass)
              }, true)

              document.addEventListener('mousedown', event => {
                if (event.button !== 0 || !isDragTarget(event)) return
                event.preventDefault()
                event.stopImmediatePropagation()
                window.webkit?.messageHandlers?.dshTitlebarDrag?.postMessage({ clickCount: event.detail })
              }, true)
            })()
            """,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        )
        configuration.userContentController.addUserScript(script)
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "dshTitlebarDrag",
              let window,
              let event = NSApp.currentEvent,
              event.type == .leftMouseDown,
              event.window === window else {
            appendLog("ignored because the originating mouseDown event is unavailable")
            return
        }

        let clickCount = (message.body as? [String: Any])?["clickCount"] as? Int ?? event.clickCount
        appendLog("mouseDown x=\(Int(event.locationInWindow.x)) y=\(Int(event.locationInWindow.y)) clicks=\(clickCount)")
        if clickCount == 2 {
            window.performZoom(nil)
        } else {
            window.performDrag(with: event)
        }
    }

    private func appendLog(_ message: String) {
        let path = Env.runtimeDir + "/titlebar.log"
        let line = ISO8601DateFormatter().string(from: Date()) + " [TitlebarDrag] " + message + "\n"
        if let handle = FileHandle(forWritingAtPath: path) {
            handle.seekToEndOfFile()
            handle.write(line.data(using: .utf8)!)
            try? handle.close()
        } else {
            try? line.write(toFile: path, atomically: true, encoding: .utf8)
        }
    }
}
