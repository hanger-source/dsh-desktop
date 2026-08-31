import AppKit
import Foundation

final class DSHWindow: NSWindow {
    var dragRegionHeight: CGFloat = 0

    override func sendEvent(_ event: NSEvent) {
        if event.type == .leftMouseDown,
           dragRegionHeight > 0,
           let contentView {
            let point = contentView.convert(event.locationInWindow, from: nil)
            if point.y >= contentView.bounds.maxY - dragRegionHeight {
                appendDragLog("mouseDown x=\(Int(point.x)) y=\(Int(point.y)) clicks=\(event.clickCount)")
                if event.clickCount == 2 {
                    performZoom(nil)
                } else {
                    performDrag(with: event)
                }
                return
            }
        }
        super.sendEvent(event)
    }

    private func appendDragLog(_ message: String) {
        let path = Env.runtimeDir + "/titlebar.log"
        let line = ISO8601DateFormatter().string(from: Date()) + " [DSHWindow] " + message + "\n"
        if let handle = FileHandle(forWritingAtPath: path) {
            handle.seekToEndOfFile()
            handle.write(line.data(using: .utf8)!)
            try? handle.close()
        } else {
            try? line.write(toFile: path, atomically: true, encoding: .utf8)
        }
    }
}

final class TitlebarDragView: NSView {
    override var isOpaque: Bool { false }
    override var mouseDownCanMoveWindow: Bool { true }

    override func resetCursorRects() {
        discardCursorRects()
        addCursorRect(bounds, cursor: .arrow)
    }
}
