import Foundation
import Cocoa
import WebKit

let rootDir = FileManager.default.currentDirectoryPath
let svgPath = "\(rootDir)/icons/logo.svg"
let iconsDir = "\(rootDir)/icons"

guard let svgData = try? Data(contentsOf: URL(fileURLWithPath: svgPath)),
      let svgString = String(data: svgData, encoding: .utf8) else {
    print("无法读取 logo.svg")
    exit(1)
}

let sizes = [16, 32, 48, 128, 512]

let app = NSApplication.shared

class RenderDelegate: NSObject, WKNavigationDelegate {
    let size: Int
    let outputPath: String
    var webView: WKWebView?
    let completion: () -> Void

    init(size: Int, outputPath: String, completion: @escaping () -> Void) {
        self.size = size
        self.outputPath = outputPath
        self.completion = completion
        super.init()
    }

    func render(html: String) {
        let config = WKWebViewConfiguration()
        let wv = WKWebView(frame: NSRect(x: 0, y: 0, width: size, height: size), configuration: config)
        self.webView = wv
        wv.navigationDelegate = self
        wv.loadHTMLString(html, baseURL: nil)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
            let config = WKSnapshotConfiguration()
            config.rect = CGRect(x: 0, y: 0, width: self.size, height: self.size)
            webView.takeSnapshot(with: config) { image, error in
                if let image = image,
                   let tiffData = image.tiffRepresentation,
                   let bitmapImage = NSBitmapImageRep(data: tiffData),
                   let pngData = bitmapImage.representation(using: .png, properties: [:]) {
                    try? pngData.write(to: URL(fileURLWithPath: self.outputPath))
                    print("✓ 生成图标：\(self.outputPath) (\(self.size)x\(self.size))")
                } else {
                    print("生成失败：\(self.outputPath)")
                }
                self.completion()
            }
        }
    }
}

let htmlTemplate = """
<!DOCTYPE html>
<html>
<head>
<style>
  * { margin: 0; padding: 0; }
  body { width: 100vw; height: 100vh; overflow: hidden; background: transparent; display: flex; align-items: center; justify-content: center; }
  svg { width: 100%; height: 100%; display: block; }
</style>
</head>
<body>
\(svgString)
</body>
</html>
"""

var currentIndex = 0

func processNext() {
    if currentIndex >= sizes.count {
        print("所有尺寸图标生成完毕！")
        exit(0)
    }
    let s = sizes[currentIndex]
    let outPath = "\(iconsDir)/icon\(s).png"
    currentIndex += 1
    let delegate = RenderDelegate(size: s, outputPath: outPath) {
        processNext()
    }
    // Retain delegate during render
    objc_setAssociatedObject(app, "delegate_\(s)", delegate, .OBJC_ASSOCIATION_RETAIN)
    delegate.render(html: htmlTemplate)
}

processNext()
RunLoop.main.run()
