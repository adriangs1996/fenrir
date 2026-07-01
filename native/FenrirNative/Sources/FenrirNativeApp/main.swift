import AppKit

let app = NSApplication.shared
let nativeApplicationDelegate = FenrirNativeApplication()
app.delegate = nativeApplicationDelegate
app.setActivationPolicy(.regular)
app.run()

final class FenrirNativeApplication: NSObject, NSApplicationDelegate {
    private var windowController: NSWindowController?

    func applicationDidFinishLaunching(_ notification: Notification) {
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1100, height: 760),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "Fenrir Native Terminal"
        window.center()
        window.contentViewController = NativeHostRootViewController()

        let controller = NSWindowController(window: window)
        controller.showWindow(nil)
        windowController = controller
        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }
}

final class NativeHostRootViewController: NSViewController {
    override func loadView() {
        view = NativeHostRootView()
    }
}

final class NativeHostRootView: NSView {
    private let label: NSTextField = {
        let field = NSTextField(labelWithString: "Fenrir NativeHost")
        field.font = NSFont.systemFont(ofSize: 18, weight: .semibold)
        field.textColor = .labelColor
        field.translatesAutoresizingMaskIntoConstraints = false
        return field
    }()

    private let detail: NSTextField = {
        let field = NSTextField(
            labelWithString: "AppKit composition shell. Product behavior lives behind native module actions."
        )
        field.font = NSFont.systemFont(ofSize: 13)
        field.textColor = .secondaryLabelColor
        field.translatesAutoresizingMaskIntoConstraints = false
        return field
    }()

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        wantsLayer = true
        layer?.backgroundColor = NSColor.windowBackgroundColor.cgColor
        addSubview(label)
        addSubview(detail)

        NSLayoutConstraint.activate([
            label.centerXAnchor.constraint(equalTo: centerXAnchor),
            label.centerYAnchor.constraint(equalTo: centerYAnchor, constant: -14),
            detail.topAnchor.constraint(equalTo: label.bottomAnchor, constant: 8),
            detail.centerXAnchor.constraint(equalTo: centerXAnchor)
        ])
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not supported")
    }
}
