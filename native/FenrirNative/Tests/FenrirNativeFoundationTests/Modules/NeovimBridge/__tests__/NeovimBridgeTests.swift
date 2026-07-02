import Foundation
import Testing
import FenrirNativeShared
import NativeRuntime
import WorkspaceOverlays
@testable import NeovimBridge

@Suite("NeovimBridge actions")
struct NeovimBridgeTests {
    @Test("Open file reports no active Neovim when policy requires one")
    func openFileRequiresActiveNeovim() async {
        let action = openAction(catalog: Catalog(panes: []))

        let result = await action.run(openInput(policy: .requireActivePane))

        #expect(result == .failure(.noActiveNeovimPane))
    }

    @Test("Open file rejects stale Neovim pane metadata")
    func openFileRejectsStalePane() async {
        let action = openAction(
            catalog: Catalog(panes: [neovimPane()]),
            enumerator: Enumerator(panes: [runtimePane("pane-2")])
        )

        let result = await action.run(openInput(policy: .requireActivePane))

        #expect(result == .failure(.stalePane("pane-1")))
    }

    @Test("Unsupported bridge focuses the active Neovim pane without rewriting input")
    func unsupportedBridgeFocusesPane() async throws {
        let bridge = BridgeClient()
        let focuser = Focuser()
        let action = openAction(
            catalog: Catalog(panes: [neovimPane(bridgeCapability: .unsupported)]),
            bridge: bridge,
            focuser: focuser
        )

        let result = try await action.run(openInput(policy: .requireActivePane)).get()

        #expect(result.route == .focusedWithoutBridge("pane-1"))
        #expect(await bridge.openedTargets.isEmpty)
        #expect(await focuser.focusedPaneIDs == ["pane-1"])
    }

    @Test("Open file uses bridge and focuses active Neovim pane")
    func openFileUsesBridge() async throws {
        let bridge = BridgeClient()
        let focuser = Focuser()
        let action = openAction(
            catalog: Catalog(panes: [neovimPane()]),
            bridge: bridge,
            focuser: focuser
        )

        let result = try await action.run(openInput(policy: .requireActivePane)).get()

        #expect(result.route == .bridge("pane-1"))
        #expect(result.activeState?.bufferPath == "/repo/App.swift")
        #expect(await bridge.openedTargets == [NeovimBridge.FileTarget(path: "/repo/App.swift", line: 12, column: 4)])
        #expect(await focuser.focusedPaneIDs == ["pane-1"])
    }

    @Test("Open file discovers active Neovim pane from runtime metadata")
    func openFileUsesRuntimeNeovimMetadata() async throws {
        let bridge = BridgeClient()
        let focuser = Focuser()
        let action = openAction(
            catalog: Catalog(panes: []),
            bridge: bridge,
            enumerator: Enumerator(panes: [runtimePane("pane-1", metadata: neovimRuntimeMetadata())]),
            focuser: focuser
        )

        let result = try await action.run(openInput(policy: .requireActivePane)).get()

        #expect(result.route == .bridge("pane-1"))
        #expect(result.pane.bridgeSocketPath == "/tmp/fenrir-nvim.sock")
        #expect(result.pane.bootstrapID == "nvim-bootstrap")
        #expect(await bridge.openedTargets == [NeovimBridge.FileTarget(path: "/repo/App.swift", line: 12, column: 4)])
    }

    @Test("Server creator sends tmux Neovim pane create request and reads metadata")
    func serverCreatorUsesTmuxNeovimPaneCreate() async throws {
        let transport = RuntimeTransport(response: neovimCreateSnapshot())
        let creator = ServerTmuxNeovimPaneCreator(transport: transport)

        let pane = try await creator.createNeovimPane(openInput(policy: .createIfNeeded), windowID: "window-1")

        #expect(pane.paneID == "pane-created")
        #expect(pane.bridgeSocketPath == "/tmp/fenrir-nvim-created.sock")
        #expect(await transport.methods == ["tmux.neovimPane.create"])
        #expect(await transport.stringPayloadValue(at: 0, key: "workspaceId") == "workspace-1")
        #expect(await transport.stringArrayPayloadValue(at: 0, key: "files") == ["/repo/App.swift"])
    }

    @Test("Palette open file creates Neovim pane when no active Neovim exists")
    func paletteOpenFileCreatesNeovimPane() async throws {
        let creator = Creator()
        let action = openAction(catalog: Catalog(panes: []), creator: creator)
        let provider = NeovimBridge.filePaletteProvider(files: [.init(path: "/repo/App.swift")])
        let search = try await provider.searchPalette(
            query: WorkspaceOverlays.PaletteQuery(rawText: "$ App", domain: .files, searchText: "App", prefix: .shell),
            workspaceID: "workspace-1"
        )
        let executor = NeovimBridge.paletteOpenFileExecutor(action: action, actor: actor())

        try await executor.executePaletteAction(search[0].action, workspaceID: "workspace-1", source: .test)

        #expect(search.map(\.action) == [.openFile("/repo/App.swift")])
        #expect(await creator.createdTargets == [NeovimBridge.FileTarget(path: "/repo/App.swift")])
    }

    @Test("Detect active state returns unsupported when bridge is unavailable")
    func detectActiveStateHandlesUnsupportedBridge() async throws {
        let action = NeovimBridge.DetectActiveNeovimState(
            catalog: Catalog(panes: [neovimPane(bridgeCapability: .unsupported)]),
            bridgeClient: BridgeClient(),
            enumerator: Enumerator(),
            clock: FixedClock()
        )

        let result = try await action.run(.init(requestID: "detect", workspaceID: "workspace-1", actor: actor(), source: .test)).get()

        #expect(result.pane?.paneID == "pane-1")
        #expect(result.state?.bridgeCapability == .unsupported)
    }
}

private func openAction(
    catalog: Catalog,
    bridge: BridgeClient = BridgeClient(),
    creator: Creator = Creator(),
    enumerator: Enumerator = Enumerator(),
    focuser: Focuser = Focuser()
) -> NeovimBridge.OpenFileInNeovim {
    NeovimBridge.OpenFileInNeovim(
        catalog: catalog,
        bridgeClient: bridge,
        creator: creator,
        enumerator: enumerator,
        focuser: focuser,
        clock: FixedClock()
    )
}

private func openInput(policy: NeovimBridge.OpenFilePolicy) -> NeovimBridge.OpenFileInNeovimInput {
    NeovimBridge.OpenFileInNeovimInput(
        requestID: "open",
        workspaceID: "workspace-1",
        actor: actor(),
        target: .init(path: "/repo/App.swift", line: 12, column: 4),
        policy: policy,
        source: .test
    )
}

private func actor() -> NativeRuntime.RuntimeActorIdentity {
    NativeRuntime.RuntimeActorIdentity(profileID: "local", authSessionID: "auth-user", subject: "user")
}

private func workspace(activePaneID: PaneID = "pane-1") -> NativeRuntime.WorkspaceRuntimeState {
    NativeRuntime.WorkspaceRuntimeState(
        workspaceID: "workspace-1",
        status: .attached,
        actor: actor(),
        tmuxSessionID: "tmux-session-1",
        windows: [
            .init(
                workspaceID: "workspace-1",
                windowID: "window-1",
                tmuxWindowID: "@1",
                index: 0,
                title: "editor",
                activePaneID: activePaneID,
                paneIDs: ["pane-1", "pane-2"]
            )
        ],
        activeWindowID: "window-1",
        attachedPaneIDs: ["pane-1", "pane-2"],
        generation: 1
    )
}

private func runtimePane(
    _ paneID: PaneID,
    status: NativeRuntime.PaneRuntimeStatus = .attached,
    metadata: NativeRuntime.PaneRuntimeMetadata? = nil
) -> NativeRuntime.PaneRuntimeState {
    NativeRuntime.PaneRuntimeState(
        workspaceID: "workspace-1",
        paneID: paneID,
        status: status,
        windowID: "window-1",
        tmuxPaneID: paneID == "pane-1" ? "%1" : "%2",
        stream: .init(paneID: paneID, streamID: StreamID(rawValue: "stream-\(paneID.rawValue)"), status: .live),
        metadata: metadata
    )
}

private func neovimRuntimeMetadata() -> NativeRuntime.PaneRuntimeMetadata {
    NativeRuntime.PaneRuntimeMetadata(
        kind: "neovim",
        title: "nvim",
        neovim: NativeRuntime.NeovimPaneRuntimeMetadata(
            bootstrapID: "nvim-bootstrap",
            bridgeSocketPath: "/tmp/fenrir-nvim.sock",
            profileID: "default",
            themeID: "fenrir-dark",
            keybindingProfileID: "native-compatible",
            files: ["/repo/App.swift"]
        )
    )
}

private func neovimPane(bridgeCapability: NeovimBridge.BridgeCapability = .supported) -> NeovimBridge.NeovimPaneDescriptor {
    NeovimBridge.NeovimPaneDescriptor(
        workspaceID: "workspace-1",
        windowID: "window-1",
        paneID: "pane-1",
        tmuxPaneID: "%1",
        bridgeSocketPath: "/tmp/fenrir-nvim.sock",
        bridgeCapability: bridgeCapability,
        bootstrapID: "nvim-bootstrap"
    )
}

private struct Catalog: NeovimBridge.NeovimPaneCataloging {
    let panes: [NeovimBridge.NeovimPaneDescriptor]

    func listNeovimPanes(workspaceID _: WorkspaceID) async throws -> [NeovimBridge.NeovimPaneDescriptor] {
        panes
    }
}

private struct Enumerator: NativeRuntime.WorkspaceRuntimeEnumerating {
    let state: NativeRuntime.WorkspaceRuntimeState
    let panes: [NativeRuntime.PaneRuntimeState]

    init(
        state: NativeRuntime.WorkspaceRuntimeState = workspace(),
        panes: [NativeRuntime.PaneRuntimeState] = [runtimePane("pane-1"), runtimePane("pane-2")]
    ) {
        self.state = state
        self.panes = panes
    }

    func enumerateWorkspaceRuntime(_ input: NativeRuntime.EnumerateWorkspaceRuntimeInput) async throws -> (workspace: NativeRuntime.WorkspaceRuntimeState, panes: [NativeRuntime.PaneRuntimeState]) {
        (state, panes)
    }
}

private actor BridgeClient: NeovimBridge.NeovimBridgeClient {
    private(set) var openedTargets: [NeovimBridge.FileTarget] = []

    func openFile(_ target: NeovimBridge.FileTarget, in pane: NeovimBridge.NeovimPaneDescriptor) async throws -> NeovimBridge.ActiveNeovimState {
        openedTargets.append(target)
        return NeovimBridge.ActiveNeovimState(paneID: pane.paneID, bufferPath: target.path, cursorLine: target.line, cursorColumn: target.column, bridgeCapability: .supported)
    }

    func activeState(in pane: NeovimBridge.NeovimPaneDescriptor) async throws -> NeovimBridge.ActiveNeovimState {
        NeovimBridge.ActiveNeovimState(paneID: pane.paneID, bufferPath: "/repo/App.swift", cursorLine: 12, cursorColumn: 4, bridgeCapability: pane.bridgeCapability)
    }
}

private actor Creator: NeovimBridge.NeovimPaneCreating {
    private(set) var createdTargets: [NeovimBridge.FileTarget] = []

    func createNeovimPane(_ input: NeovimBridge.OpenFileInNeovimInput, windowID: FenrirWindowID) async throws -> NeovimBridge.NeovimPaneDescriptor {
        createdTargets.append(input.target)
        return NeovimBridge.NeovimPaneDescriptor(workspaceID: input.workspaceID, windowID: windowID, paneID: "pane-created", tmuxPaneID: "%3", bridgeCapability: .unknown)
    }
}

private actor Focuser: NativeRuntime.PaneRuntimeFocusing {
    private(set) var focusedPaneIDs: [PaneID] = []

    func focusPaneRuntime(_ input: NativeRuntime.FocusPaneRuntimeInput) async throws -> NativeRuntime.WorkspaceRuntimeState {
        focusedPaneIDs.append(input.paneID)
        return workspace(activePaneID: input.paneID)
    }
}

private actor RuntimeTransport: NativeRuntime.ServerRPCTransport {
    private(set) var methods: [String] = []
    private var payloads: [[String: Any]] = []
    private let response: String

    init(response: String) {
        self.response = response
    }

    func request(_ request: NativeRuntime.ServerRPCRequest) async throws -> Data {
        methods.append(request.method)
        if let payload = try JSONSerialization.jsonObject(with: request.payload) as? [String: Any] {
            payloads.append(payload)
        }
        return Data(response.utf8)
    }

    func stream(_ request: NativeRuntime.ServerRPCRequest) async -> AsyncThrowingStream<Data, Error> {
        AsyncThrowingStream { continuation in
            continuation.finish()
        }
    }

    func stringPayloadValue(at index: Int, key: String) -> String? {
        payloads.indices.contains(index) ? payloads[index][key] as? String : nil
    }

    func stringArrayPayloadValue(at index: Int, key: String) -> [String]? {
        payloads.indices.contains(index) ? payloads[index][key] as? [String] : nil
    }
}

private func neovimCreateSnapshot() -> String {
    """
    {
      "panes": [
        {
          "paneId": "pane-created",
          "workspaceId": "workspace-1",
          "windowId": "window-1",
          "tmuxPaneId": "%3",
          "metadata": {
            "kind": "neovim",
            "neovim": {
              "bootstrapId": "nvim-created",
              "bridgeSocketPath": "/tmp/fenrir-nvim-created.sock"
            }
          }
        }
      ]
    }
    """
}
