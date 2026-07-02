import Foundation
import AppKit
import Testing
import FenrirNativeShared
import TerminalViewport

@Suite("TerminalViewport public API")
struct TerminalViewportPublicAPITests {
    @Test("Capture actions and renderer context ports are constructible from normal imports")
    func captureActionsAreAvailableThroughPublicSurface() {
        let store = PublicTerminalStore()
        let reader = PublicContextReader()
        let redactor = PublicContextRedactor()
        let clock = FixedClock()

        let selection = TerminalViewport.CaptureTerminalSelection(store: store, reader: reader, redactor: redactor, clock: clock)
        let viewport = TerminalViewport.CaptureTerminalViewport(store: store, reader: reader, redactor: redactor, clock: clock)
        let lastLines = TerminalViewport.CaptureTerminalLastLines(store: store, reader: reader, redactor: redactor, clock: clock)

        #expect(String(describing: type(of: selection)).contains("CaptureTerminalSelection"))
        #expect(String(describing: type(of: viewport)).contains("CaptureTerminalViewport"))
        #expect(String(describing: type(of: lastLines)).contains("CaptureTerminalLastLines"))
    }

    @Test("FenrirTerminalView is available as the public AppKit host boundary")
    @MainActor
    func terminalHostBoundaryIsAvailableThroughPublicSurface() {
        let backend = PublicTerminalBackend()
        let view = FenrirTerminalView(backend: backend)

        view.attach(streamID: "stream-public")
        view.applyRuntimeOutput(Data("output".utf8))
        let routed = view.routeKeyboardInput(.init(bytes: Data("input".utf8)))

        #expect(view.rendererDescriptor == TerminalViewport.RendererDescriptor(rendererID: "public-terminal", status: .ready))
        #expect(view.attachedStreamID == "stream-public")
        #expect(routed == .sentToTerminal)
        #expect(backend.calls == ["mount", "attach:stream-public", "output:output", "input:input"])
    }
}

private actor PublicTerminalStore: TerminalViewport.TerminalViewportStore {
    func loadViewport(viewportID: ViewportID) async throws -> TerminalViewport.State? {
        nil
    }

    func saveViewport(_ state: TerminalViewport.State) async throws {}

    func deleteViewport(viewportID: ViewportID) async throws {}
}

private struct PublicContextReader: TerminalViewport.TerminalRendererContextReading {
    func readSelection(viewportID: ViewportID) async throws -> TerminalViewport.CapturedTextBuffer {
        TerminalViewport.CapturedTextBuffer(text: "")
    }

    func readViewport(viewportID: ViewportID) async throws -> TerminalViewport.CapturedTextBuffer {
        TerminalViewport.CapturedTextBuffer(text: "")
    }

    func readLastLines(viewportID: ViewportID, maxLines: Int?) async throws -> TerminalViewport.CapturedTextBuffer {
        TerminalViewport.CapturedTextBuffer(text: "")
    }
}

private struct PublicContextRedactor: TerminalViewport.TerminalContextRedacting {
    func redactTerminalContext(_ context: TerminalViewport.CapturedContext) async throws -> TerminalViewport.RedactedCapture {
        TerminalViewport.RedactedCapture(text: context.text)
    }
}

@MainActor
private final class PublicTerminalBackend: FenrirTerminalBackend {
    let descriptor = TerminalViewport.RendererDescriptor(rendererID: "public-terminal", status: .ready)
    private(set) var calls: [String] = []

    func mount(in hostView: NSView) {
        calls.append("mount")
    }

    func unmount() {
        calls.append("unmount")
    }

    func attach(streamID: StreamID) {
        calls.append("attach:\(streamID.rawValue)")
    }

    func detach(streamID: StreamID) {
        calls.append("detach:\(streamID.rawValue)")
    }

    func applyOutput(_ bytes: Data) {
        calls.append("output:\(String(decoding: bytes, as: UTF8.self))")
    }

    func sendUserInput(_ bytes: Data) {
        calls.append("input:\(String(decoding: bytes, as: UTF8.self))")
    }

    func resize(_ size: TerminalViewport.Size) {
        calls.append("resize:\(size.columns)x\(size.rows)")
    }

    func setFocused(_ focused: Bool) {
        calls.append("focus:\(focused)")
    }

    func captureSelection() -> TerminalViewport.CapturedTextBuffer {
        TerminalViewport.CapturedTextBuffer(text: "")
    }

    func captureViewport() -> TerminalViewport.CapturedTextBuffer {
        TerminalViewport.CapturedTextBuffer(text: "")
    }

    func captureLastLines(maxLines: Int?) -> TerminalViewport.CapturedTextBuffer {
        TerminalViewport.CapturedTextBuffer(text: "")
    }
}
