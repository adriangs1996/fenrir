import AppKit
import Foundation
import FenrirNativeShared

public extension TerminalViewport {
    enum TerminalKeyRoutingDecision: Equatable, Sendable {
        case sentToTerminal
        case reservedForClient
        case ignored
    }

    struct TerminalKeyRoutingInput: Equatable, Sendable {
        public let bytes: Data?
        public let isOverlayActive: Bool
        public let isReservedByKeybinding: Bool

        public init(bytes: Data?, isOverlayActive: Bool = false, isReservedByKeybinding: Bool = false) {
            self.bytes = bytes
            self.isOverlayActive = isOverlayActive
            self.isReservedByKeybinding = isReservedByKeybinding
        }
    }
}

@MainActor
public protocol FenrirTerminalBackend: AnyObject {
    var descriptor: TerminalViewport.RendererDescriptor { get }

    func mount(in hostView: NSView)
    func unmount()
    func attach(streamID: StreamID)
    func detach(streamID: StreamID)
    func applyOutput(_ bytes: Data)
    func sendUserInput(_ bytes: Data)
    func resize(_ size: TerminalViewport.Size)
    func setFocused(_ focused: Bool)
    func captureSelection() -> TerminalViewport.CapturedTextBuffer
    func captureViewport() -> TerminalViewport.CapturedTextBuffer
    func captureLastLines(maxLines: Int?) -> TerminalViewport.CapturedTextBuffer
    /// The most recent surface geometry the renderer reported through the
    /// resize callback, if the backend tracks one. Hosts use it to re-announce
    /// the viewport size after a pane is (re)bound, closing the race where a
    /// resize fired before the pane existed in the grid.
    var lastReportedSurfaceSize: TerminalViewport.Size? { get }
    /// The renderer's live cell metrics in PIXELS, if the backend tracks
    /// them. Hosts prefer this over dividing view bounds by the grid, which
    /// folds renderer padding and sub-cell remainder into the estimate.
    var lastReportedCellPixelSize: CGSize? { get }
    /// True while the renderer's input method is composing marked text (IME
    /// preedit). Hosts must not intercept or consume key events in this state
    /// — the input method owns them (NSTextInputClient); stealing a key would
    /// strand or corrupt the composition.
    var hasMarkedText: Bool { get }
    /// True while the running program has enabled terminal MOUSE REPORTING
    /// (DECSET 1000/1002/1003/1006) — strictly mouse tracking, NOT the
    /// alternate screen. Hosts use it as the LIVE heuristic for vim-aware pane
    /// navigation (christoomey C-h/j/k/l): when active the navigation key is
    /// passed through to the app instead of moving native pane focus.
    ///
    /// Known limitation (libghostty exposes no alt-screen getter): a full-screen
    /// app that does NOT enable mouse reporting — classic vim, nvim with
    /// `set mouse=`, most pagers/TUIs — reports `false`, so the host will steal
    /// C-h/j/k/l and move pane focus instead of forwarding the key. Modern nvim
    /// (`mouse=nvi`) and fzf enable mouse and work. christoomey itself keys off
    /// the foreground process (a `ps` check) precisely because terminal modes
    /// are an unreliable proxy; that ground truth is not available here.
    var isMouseReportingActive: Bool { get }
}

public extension FenrirTerminalBackend {
    var lastReportedSurfaceSize: TerminalViewport.Size? { nil }
    var lastReportedCellPixelSize: CGSize? { nil }
    var hasMarkedText: Bool { false }
    var isMouseReportingActive: Bool { false }
}

@MainActor
public protocol FenrirTerminalSyntheticSelectionCapturing: AnyObject {
    func setSyntheticSelectionForTesting(_ text: String?)
}

@MainActor
public final class FenrirTerminalView: NSView {
    private let backend: any FenrirTerminalBackend
    public private(set) var attachedStreamID: StreamID?
    public private(set) var currentSize: TerminalViewport.Size?
    public private(set) var isTerminalFocused = false
    private var didUnmountBackend = false

    public init(backend: any FenrirTerminalBackend, frame frameRect: NSRect = .zero) {
        self.backend = backend
        super.init(frame: frameRect)
        wantsLayer = true
        backend.mount(in: self)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("FenrirTerminalView must be initialized with a terminal backend")
    }

    deinit {
        MainActor.assumeIsolated {
            dispose()
        }
    }

    public var rendererDescriptor: TerminalViewport.RendererDescriptor {
        backend.descriptor
    }

    public override var acceptsFirstResponder: Bool { true }

    public func dispose() {
        guard !didUnmountBackend else {
            return
        }
        didUnmountBackend = true
        backend.unmount()
    }

    public func attach(streamID: StreamID) {
        if attachedStreamID == streamID {
            return
        }
        if let attachedStreamID {
            backend.detach(streamID: attachedStreamID)
        }
        attachedStreamID = streamID
        backend.attach(streamID: streamID)
    }

    public func detach(streamID: StreamID) {
        guard attachedStreamID == streamID else {
            return
        }
        attachedStreamID = nil
        backend.detach(streamID: streamID)
    }

    public func applyRuntimeOutput(_ bytes: Data) {
        backend.applyOutput(bytes)
    }

    public func routeKeyboardInput(_ input: TerminalViewport.TerminalKeyRoutingInput) -> TerminalViewport.TerminalKeyRoutingDecision {
        guard !input.isOverlayActive, !input.isReservedByKeybinding else {
            return .reservedForClient
        }
        guard let bytes = input.bytes, !bytes.isEmpty else {
            return .ignored
        }
        backend.sendUserInput(bytes)
        return .sentToTerminal
    }

    public func resizeTerminal(to size: TerminalViewport.Size) throws {
        try TerminalViewport.validate(size)
        currentSize = size
        backend.resize(size)
    }

    public func setTerminalFocused(_ focused: Bool) {
        isTerminalFocused = focused
        backend.setFocused(focused)
    }

    public var lastReportedSurfaceSize: TerminalViewport.Size? {
        backend.lastReportedSurfaceSize
    }

    /// The renderer's live cell metrics in pixels (see the backend protocol).
    public var lastReportedCellPixelSize: CGSize? {
        backend.lastReportedCellPixelSize
    }

    /// True while the terminal's input method is composing marked text (IME
    /// preedit); key monitors must let such events through untouched.
    public var hasMarkedText: Bool {
        backend.hasMarkedText
    }

    /// True while the running program has enabled terminal MOUSE REPORTING
    /// (DECSET 1000/1002/1003/1006) — mouse tracking only, NOT the alternate
    /// screen. Drives vim-aware pane navigation passthrough (christoomey
    /// C-h/j/k/l). See the protocol declaration for the non-mouse full-screen
    /// app limitation.
    public var isMouseReportingActive: Bool {
        backend.isMouseReportingActive
    }

    public func captureSelection() -> TerminalViewport.CapturedTextBuffer {
        backend.captureSelection()
    }

    public func captureViewport() -> TerminalViewport.CapturedTextBuffer {
        backend.captureViewport()
    }

    public func captureLastLines(maxLines: Int?) -> TerminalViewport.CapturedTextBuffer {
        backend.captureLastLines(maxLines: maxLines)
    }

    @discardableResult
    public func setSyntheticSelectionForTesting(_ text: String?) -> Bool {
        guard let backend = backend as? any FenrirTerminalSyntheticSelectionCapturing else {
            return false
        }
        backend.setSyntheticSelectionForTesting(text)
        return true
    }
}
