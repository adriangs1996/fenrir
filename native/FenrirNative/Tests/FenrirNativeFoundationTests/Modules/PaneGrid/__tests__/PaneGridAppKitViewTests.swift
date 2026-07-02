import AppKit
import FenrirNativeShared
import NativeRuntime
import PaneGrid
import TerminalViewport
import Testing

@MainActor
@Suite("PaneGrid AppKit rendering", .serialized)
struct PaneGridAppKitViewTests {
    @Test("Renders only real tmux panes for the active tab")
    func rendersOnlyActiveTmuxPanes() {
        let factory = TerminalFactory()
        let view = PaneGrid.AppKitPaneGridView(state: appKitState(), terminalFactory: factory.makeTerminal)

        #expect(view.renderedPaneIDs() == ["pane-1", "pane-2"])
        #expect(view.renderedTmuxPaneIDs() == ["%1", "%2"])
        #expect(view.renderedViewportIDs() == ["viewport-pane-1", "viewport-pane-2"])
        #expect(factory.createdPaneIDs == ["pane-1", "pane-2"])
    }

    @Test("Focus emits the tmux pane target and updates terminal focus")
    func focusEmitsTargetAndUpdatesTerminalFocus() {
        let factory = TerminalFactory()
        let view = PaneGrid.AppKitPaneGridView(state: appKitState(), terminalFactory: factory.makeTerminal)
        var focused: [PaneGrid.PaneKernelTarget] = []
        view.onFocusPane = { focused.append($0) }

        #expect(view.focusPane("pane-2"))

        #expect(focused.map(\.paneID) == ["pane-2"])
        #expect(focused.map(\.tmuxPaneID.rawValue) == ["%2"])
        #expect(factory.backend(for: "pane-1")?.focusValues == [true, false])
        #expect(factory.backend(for: "pane-2")?.focusValues == [false, true])
    }

    @Test("Tab switching emits tmux window selection and waits for applied state")
    func tabSwitchingRendersSelectedWindow() {
        let factory = TerminalFactory()
        let view = PaneGrid.AppKitPaneGridView(state: appKitState(), terminalFactory: factory.makeTerminal)
        var selections: [PaneGrid.SelectTabWindowCommand] = []
        view.onSelectWindow = { selections.append($0) }

        #expect(view.selectWindow("window-2", requestID: "select-window-2"))

        #expect(selections.map(\.windowID) == ["window-2"])
        #expect(selections.map(\.tmuxWindowID) == ["tmux-window-2"])
        #expect(view.renderedPaneIDs() == ["pane-1", "pane-2"])

        view.apply(appKitState(activeWindowID: "window-2"))

        #expect(view.renderedPaneIDs() == ["pane-3"])
        #expect(view.renderedTmuxPaneIDs() == ["%3"])
    }

    @Test("Tab switching disposes stale terminal renderers")
    func tabSwitchingDisposesStaleTerminalRenderers() {
        let factory = TerminalFactory()
        let view = PaneGrid.AppKitPaneGridView(state: appKitState(), terminalFactory: factory.makeTerminal)

        view.apply(appKitState(activeWindowID: "window-2"))

        #expect(factory.backend(for: "pane-1")?.unmountCount == 1)
        #expect(factory.backend(for: "pane-2")?.unmountCount == 1)
        #expect(factory.backend(for: "pane-3")?.unmountCount == 0)
    }

    @Test("Resize integration emits allocation for the focused pane")
    func resizeAllocationUsesFocusedPane() {
        let view = PaneGrid.AppKitPaneGridView(state: appKitState(), terminalFactory: TerminalFactory().makeTerminal)
        var allocations: [PaneGrid.PaneResizeAllocation] = []
        view.onResizePane = { allocations.append($0) }

        let allocation = view.requestResizeFocusedPane(delta: 18, unit: .pixels, direction: .right)

        #expect(allocation == PaneGrid.PaneResizeAllocation(paneID: "pane-1", delta: 18, unit: .pixels, direction: .right))
        #expect(allocations == [allocation])
    }

    @Test("Split rendering preserves tmux pane proportions")
    func splitRenderingPreservesTmuxPaneProportions() {
        let view = PaneGrid.AppKitPaneGridView(state: nestedAppKitState(), terminalFactory: TerminalFactory().makeTerminal)
        view.frame = NSRect(x: 0, y: 0, width: 640, height: 400)
        view.layoutSubtreeIfNeeded()

        #expect(view.renderedPaneIDs() == ["pane-1", "pane-2", "pane-3"])
        #expect(view.renderedTmuxPaneIDs() == ["%1", "%2", "%3"])
        #expect(view.renderedSplitFractions() == [[0.25, 0.75], [0.5, 0.5]])
    }

    @Test("Pane layout resizes embedded terminal views")
    func paneLayoutResizesEmbeddedTerminalViews() {
        let factory = TerminalFactory()
        let view = PaneGrid.AppKitPaneGridView(state: appKitState(), terminalFactory: factory.makeTerminal)
        view.frame = NSRect(x: 0, y: 0, width: 640, height: 400)
        view.layoutSubtreeIfNeeded()

        #expect(factory.backend(for: "pane-1")?.resizes.isEmpty == false)
        #expect(factory.backend(for: "pane-2")?.resizes.isEmpty == false)
    }

    @Test("Pane layout emits measured tmux resize target")
    func paneLayoutEmitsMeasuredTmuxResizeTarget() {
        let view = PaneGrid.AppKitPaneGridView(state: appKitState(), terminalFactory: TerminalFactory().makeTerminal)
        var resizes: [(PaneGrid.PaneKernelTarget, TerminalViewport.Size)] = []
        view.onResizePaneToSize = { target, size in
            resizes.append((target, size))
        }

        view.frame = NSRect(x: 0, y: 0, width: 640, height: 400)
        view.layoutSubtreeIfNeeded()

        #expect(resizes.map { $0.0.tmuxPaneID.rawValue }.contains("%1"))
        #expect(resizes.map { $0.0.tmuxPaneID.rawValue }.contains("%2"))
        #expect(resizes.allSatisfy { $0.1.columns > 0 && $0.1.rows > 0 })
    }

    @Test("Keyboard focus movement targets adjacent tmux pane")
    func keyboardFocusMovementTargetsAdjacentPane() {
        let view = PaneGrid.AppKitPaneGridView(state: appKitState(), terminalFactory: TerminalFactory().makeTerminal)
        var focused: [PaneGrid.PaneKernelTarget] = []
        view.onFocusPane = { focused.append($0) }

        #expect(view.moveFocus(.right))

        #expect(focused.map(\.paneID) == ["pane-2"])
        #expect(focused.map(\.tmuxPaneID.rawValue) == ["%2"])
    }

    @Test("Compact desktop layout has stable constraints")
    func compactLayoutHasStableConstraints() {
        let view = PaneGrid.AppKitPaneGridView(state: appKitState(), terminalFactory: TerminalFactory().makeTerminal)
        view.frame = NSRect(x: 0, y: 0, width: 360, height: 260)
        view.layoutSubtreeIfNeeded()

        #expect(!hasAmbiguousLayout(view))
    }

    private func hasAmbiguousLayout(_ view: NSView) -> Bool {
        if view.hasAmbiguousLayout {
            return true
        }
        return view.subviews.contains { hasAmbiguousLayout($0) }
    }
}

@MainActor
private final class TerminalFactory {
    private(set) var createdPaneIDs: [PaneID] = []
    private var backends: [PaneID: TestTerminalBackend] = [:]

    func makeTerminal(_ pane: PaneGrid.PanePresentation) -> FenrirTerminalView {
        createdPaneIDs.append(pane.paneID)
        let backend = TestTerminalBackend()
        backends[pane.paneID] = backend
        return FenrirTerminalView(backend: backend)
    }

    func backend(for paneID: PaneID) -> TestTerminalBackend? {
        backends[paneID]
    }
}

@MainActor
private final class TestTerminalBackend: FenrirTerminalBackend {
    let descriptor = TerminalViewport.RendererDescriptor(rendererID: "pane-grid-test", status: .ready)
    private(set) var focusValues: [Bool] = []
    private(set) var resizes: [TerminalViewport.Size] = []
    private(set) var unmountCount = 0

    func mount(in hostView: NSView) {}
    func unmount() { unmountCount += 1 }
    func attach(streamID: StreamID) {}
    func detach(streamID: StreamID) {}
    func applyOutput(_ bytes: Data) {}
    func sendUserInput(_ bytes: Data) {}
    func resize(_ size: TerminalViewport.Size) { resizes.append(size) }
    func setFocused(_ focused: Bool) { focusValues.append(focused) }
    func captureSelection() -> TerminalViewport.CapturedTextBuffer { .init(text: "") }
    func captureViewport() -> TerminalViewport.CapturedTextBuffer { .init(text: "") }
    func captureLastLines(maxLines: Int?) -> TerminalViewport.CapturedTextBuffer { .init(text: "") }
}

private func appKitState(activeWindowID: FenrirWindowID = "window-1") -> PaneGrid.State {
    PaneGrid.State(
        workspaceID: "workspace-1",
        tmuxSessionID: "tmux-session-1",
        activeWindowID: activeWindowID,
        windows: [
            PaneGrid.WindowPresentation(
                windowID: "window-1",
                tmuxWindowID: "tmux-window-1",
                index: 0,
                title: "main",
                root: .split(axis: .horizontal, children: [
                    .pane(pane("pane-1", tmuxPaneID: "%1", viewportID: "viewport-pane-1", focused: true, x: 0, y: 0)),
                    .pane(pane("pane-2", tmuxPaneID: "%2", viewportID: "viewport-pane-2", focused: false, x: 80, y: 0))
                ]),
                activePaneID: "pane-1",
                panes: [
                    pane("pane-1", tmuxPaneID: "%1", viewportID: "viewport-pane-1", focused: true, x: 0, y: 0),
                    pane("pane-2", tmuxPaneID: "%2", viewportID: "viewport-pane-2", focused: false, x: 80, y: 0)
                ]
            ),
            PaneGrid.WindowPresentation(
                windowID: "window-2",
                tmuxWindowID: "tmux-window-2",
                index: 1,
                title: "logs",
                root: .pane(pane("pane-3", tmuxPaneID: "%3", viewportID: "viewport-pane-3", focused: true, x: 0, y: 0)),
                activePaneID: "pane-3",
                panes: [
                    pane("pane-3", tmuxPaneID: "%3", viewportID: "viewport-pane-3", focused: true, x: 0, y: 0)
                ]
            )
        ]
    )
}

private func nestedAppKitState() -> PaneGrid.State {
    let pane1 = pane("pane-1", tmuxPaneID: "%1", viewportID: "viewport-pane-1", focused: true, x: 0, y: 0, columns: 40, rows: 48)
    let pane2 = pane("pane-2", tmuxPaneID: "%2", viewportID: "viewport-pane-2", focused: false, x: 40, y: 0, columns: 120, rows: 24)
    let pane3 = pane("pane-3", tmuxPaneID: "%3", viewportID: "viewport-pane-3", focused: false, x: 40, y: 24, columns: 120, rows: 24)
    return PaneGrid.State(
        workspaceID: "workspace-1",
        tmuxSessionID: "tmux-session-1",
        activeWindowID: "window-1",
        windows: [
            PaneGrid.WindowPresentation(
                windowID: "window-1",
                tmuxWindowID: "tmux-window-1",
                index: 0,
                title: "main",
                root: .split(axis: .horizontal, children: [
                    .pane(pane1),
                    .split(axis: .vertical, children: [.pane(pane2), .pane(pane3)])
                ]),
                activePaneID: "pane-1",
                panes: [pane1, pane2, pane3]
            )
        ]
    )
}

private func pane(
    _ paneID: PaneID,
    tmuxPaneID: String,
    viewportID: ViewportID,
    focused: Bool,
    x: Int,
    y: Int,
    columns: Int = 80,
    rows: Int = 24
) -> PaneGrid.PanePresentation {
    PaneGrid.PanePresentation(
        paneID: paneID,
        tmuxPaneID: NativeRuntime.TmuxPaneID(rawValue: tmuxPaneID),
        viewportID: viewportID,
        title: "\(paneID.rawValue)-title",
        rect: PaneGrid.PaneRect(x: x, y: y, columns: columns, rows: rows),
        isFocused: focused
    )
}
