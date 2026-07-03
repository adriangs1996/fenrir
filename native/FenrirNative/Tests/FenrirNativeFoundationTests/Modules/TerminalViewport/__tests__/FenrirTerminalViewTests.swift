import AppKit
import Foundation
import Testing
import FenrirNativeShared
@testable import TerminalViewport

@MainActor
@Suite("FenrirTerminalView boundary")
struct FenrirTerminalViewTests {
    @Test("Mounts and unmounts the swappable terminal backend")
    func lifecycleMountsAndUnmountsBackend() {
        let backend = FakeTerminalBackend()
        let view = FenrirTerminalView(backend: backend)

        #expect(backend.mountCount == 1)
        #expect(view.rendererDescriptor == TerminalViewport.RendererDescriptor(rendererID: "fake-terminal", status: .ready))

        view.dispose()
        view.dispose()

        #expect(backend.unmountCount == 1)
    }

    @Test("Attaches and detaches pane streams through the backend")
    func attachDetachStream() {
        let backend = FakeTerminalBackend()
        let view = FenrirTerminalView(backend: backend)

        view.attach(streamID: "stream-1")
        view.detach(streamID: "stream-other")
        view.detach(streamID: "stream-1")

        #expect(view.attachedStreamID == nil)
        #expect(backend.attachedStreams == ["stream-1"])
        #expect(backend.detachedStreams == ["stream-1"])
    }

    @Test("Replacing an attached stream detaches the old backend stream first")
    func replacingAttachedStreamDetachesPreviousStream() {
        let backend = FakeTerminalBackend()
        let view = FenrirTerminalView(backend: backend)

        view.attach(streamID: "stream-1")
        view.attach(streamID: "stream-1")
        view.attach(streamID: "stream-2")
        view.detach(streamID: "stream-1")

        #expect(view.attachedStreamID == "stream-2")
        #expect(backend.attachedStreams == ["stream-1", "stream-2"])
        #expect(backend.detachedStreams == ["stream-1"])
    }

    @Test("Routes runtime output and guards keyboard bytes from overlay and keybinding interception")
    func routesBytesWithExplicitGuards() {
        let backend = FakeTerminalBackend()
        let view = FenrirTerminalView(backend: backend)
        let output = Data("server output".utf8)
        let userInput = Data("ls\n".utf8)

        view.applyRuntimeOutput(output)
        let overlay = view.routeKeyboardInput(.init(bytes: userInput, isOverlayActive: true))
        let keybinding = view.routeKeyboardInput(.init(bytes: userInput, isReservedByKeybinding: true))
        let empty = view.routeKeyboardInput(.init(bytes: Data()))
        let terminal = view.routeKeyboardInput(.init(bytes: userInput))

        #expect(backend.outputs == [output])
        #expect(backend.userInputs == [userInput])
        #expect(overlay == .reservedForClient)
        #expect(keybinding == .reservedForClient)
        #expect(empty == .ignored)
        #expect(terminal == .sentToTerminal)
    }

    @Test("Resizes and focuses through explicit backend calls")
    func resizeAndFocus() throws {
        let backend = FakeTerminalBackend()
        let view = FenrirTerminalView(backend: backend)
        let size = TerminalViewport.Size(columns: 120, rows: 40, pixelWidth: 1440, pixelHeight: 900)

        try view.resizeTerminal(to: size)
        view.setTerminalFocused(true)
        view.setTerminalFocused(false)

        #expect(view.currentSize == size)
        #expect(backend.resizes == [size])
        #expect(backend.focusValues == [true, false])
    }

    @Test("Rejects invalid resize dimensions before crossing the backend")
    func rejectsInvalidResizeBeforeBackend() {
        let backend = FakeTerminalBackend()
        let view = FenrirTerminalView(backend: backend)

        #expect(throws: TerminalViewport.TerminalViewportError.invalidDimensions) {
            try view.resizeTerminal(to: TerminalViewport.Size(columns: 0, rows: 24, pixelWidth: 800, pixelHeight: 600))
        }
        #expect(backend.resizes.isEmpty)
    }

    @Test("Exposes context capture hooks through backend DTOs only")
    func contextCaptureHooks() {
        let backend = FakeTerminalBackend()
        backend.selection = .init(text: "selected")
        backend.viewport = .init(text: "alternate", screen: .alternate)
        backend.lastLines = .init(text: "line 2")
        let view = FenrirTerminalView(backend: backend)

        #expect(view.captureSelection() == .init(text: "selected"))
        #expect(view.captureViewport() == .init(text: "alternate", screen: .alternate))
        #expect(view.captureLastLines(maxLines: 1) == .init(text: "line 2"))
        #expect(backend.lastLineRequests == [1])
    }

    @Test("Ghostty backend resolves user config files in Ghostty load order")
    func ghosttyBackendResolvesUserConfigFiles() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("fenrir-ghostty-config-test-\(UUID().uuidString)", isDirectory: true)
        defer {
            try? FileManager.default.removeItem(at: root)
        }
        let xdg = root.appendingPathComponent("xdg", isDirectory: true)
        let home = root.appendingPathComponent("home", isDirectory: true)
        let paths = [
            xdg.appendingPathComponent("ghostty/config.ghostty"),
            xdg.appendingPathComponent("ghostty/config"),
            home.appendingPathComponent("Library/Application Support/com.mitchellh.ghostty/config.ghostty"),
            home.appendingPathComponent("Library/Application Support/com.mitchellh.ghostty/config")
        ]
        for path in paths {
            try FileManager.default.createDirectory(at: path.deletingLastPathComponent(), withIntermediateDirectories: true)
            try "font-size = 13\n".write(to: path, atomically: true, encoding: .utf8)
        }

        #expect(FenrirGhosttyTerminalBackend.resolvedGhosttyConfigFilePaths(environment: [
            "HOME": home.path,
            "XDG_CONFIG_HOME": xdg.path
        ]) == paths.map(\.path))
    }

    @Test("Public TerminalViewport surface does not expose Ghostty implementation names")
    func publicSurfaceDoesNotExposeGhostty() throws {
        let root = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("Sources/FenrirNativeFoundation/Modules/TerminalViewport")
        let publicSurface = [
            "index.swift",
            "Contracts/TerminalViewportContracts.swift",
            "Services/TerminalViewportServices.swift"
        ]

        let source = try publicSurface
            .map { root.appendingPathComponent($0) }
            .map { try String(contentsOf: $0, encoding: .utf8) }
            .joined(separator: "\n")

        #expect(!source.contains("Ghostty"))
        #expect(!source.contains("ghostty"))
        #expect(!source.contains("libGhostty"))
    }
}

@MainActor
private final class FakeTerminalBackend: FenrirTerminalBackend {
    let descriptor = TerminalViewport.RendererDescriptor(rendererID: "fake-terminal", status: .ready)
    var selection = TerminalViewport.CapturedTextBuffer(text: "")
    var viewport = TerminalViewport.CapturedTextBuffer(text: "")
    var lastLines = TerminalViewport.CapturedTextBuffer(text: "")
    private(set) var mountCount = 0
    private(set) var unmountCount = 0
    private(set) var attachedStreams: [StreamID] = []
    private(set) var detachedStreams: [StreamID] = []
    private(set) var outputs: [Data] = []
    private(set) var userInputs: [Data] = []
    private(set) var resizes: [TerminalViewport.Size] = []
    private(set) var focusValues: [Bool] = []
    private(set) var lastLineRequests: [Int?] = []

    func mount(in hostView: NSView) {
        mountCount += 1
    }

    func unmount() {
        unmountCount += 1
    }

    func attach(streamID: StreamID) {
        attachedStreams.append(streamID)
    }

    func detach(streamID: StreamID) {
        detachedStreams.append(streamID)
    }

    func applyOutput(_ bytes: Data) {
        outputs.append(bytes)
    }

    func sendUserInput(_ bytes: Data) {
        userInputs.append(bytes)
    }

    func resize(_ size: TerminalViewport.Size) {
        resizes.append(size)
    }

    func setFocused(_ focused: Bool) {
        focusValues.append(focused)
    }

    func captureSelection() -> TerminalViewport.CapturedTextBuffer {
        selection
    }

    func captureViewport() -> TerminalViewport.CapturedTextBuffer {
        viewport
    }

    func captureLastLines(maxLines: Int?) -> TerminalViewport.CapturedTextBuffer {
        lastLineRequests.append(maxLines)
        return lastLines
    }
}
