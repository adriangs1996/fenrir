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
