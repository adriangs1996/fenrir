import Foundation
import FenrirNativeShared

public extension NativeRuntime {
    protocol NativeRuntimeClock: Sendable {
        func now() -> FenrirTimestamp
    }

    struct ServerRPCRequest: Equatable, Sendable {
        public let requestID: RequestID
        public let method: String
        public let payload: Data

        public init(requestID: RequestID, method: String, payload: Data) {
            self.requestID = requestID
            self.method = method
            self.payload = payload
        }
    }

    protocol ServerRPCTransport: Sendable {
        func request(_ request: ServerRPCRequest) async throws -> Data
        func stream(_ request: ServerRPCRequest) async -> AsyncThrowingStream<Data, Error>
    }

    protocol RuntimeCapabilityQuerying: Sendable {
        func discoverRuntimeCapabilities(_ input: DiscoverRuntimeCapabilitiesInput) async throws -> RuntimeCapabilities
    }

    protocol WorkspaceRuntimeAttaching: Sendable {
        func attachWorkspaceRuntime(_ input: AttachWorkspaceRuntimeInput) async throws -> WorkspaceRuntimeState
    }

    protocol WorkspaceRuntimeOpening: Sendable {
        func openWorkspaceRuntime(_ input: OpenWorkspaceRuntimeInput) async throws -> WorkspaceRuntimeState
    }

    protocol WorkspaceRuntimeClosing: Sendable {
        func closeWorkspaceRuntime(_ input: CloseWorkspaceRuntimeInput) async throws
    }

    protocol WorkspaceRuntimeSwitching: Sendable {
        func switchWorkspaceRuntime(_ input: SwitchWorkspaceRuntimeInput) async throws -> WorkspaceRuntimeState
    }

    protocol WorkspaceRuntimeDetaching: Sendable {
        func detachWorkspaceRuntime(_ input: DetachWorkspaceRuntimeInput) async throws
    }

    protocol WorkspaceRuntimeReconnecting: Sendable {
        func reconnectWorkspaceRuntime(_ input: ReconnectWorkspaceRuntimeInput) async throws -> WorkspaceRuntimeState
    }

    protocol WorkspaceRuntimeEnumerating: Sendable {
        func enumerateWorkspaceRuntime(_ input: EnumerateWorkspaceRuntimeInput) async throws -> (workspace: WorkspaceRuntimeState, panes: [PaneRuntimeState])
    }

    protocol PaneRuntimeAttaching: Sendable {
        func attachPaneRuntime(_ input: AttachPaneRuntimeInput, backfill: BackfillMode) async throws -> PaneRuntimeState
    }

    protocol PaneRuntimeFocusing: Sendable {
        func focusPaneRuntime(_ input: FocusPaneRuntimeInput) async throws -> WorkspaceRuntimeState
    }

    protocol PaneStreamSubscribing: Sendable {
        func reconnectPaneStream(_ input: ReconnectPaneStreamInput, stream: PaneStreamState, backfill: BackfillMode) async -> AsyncThrowingStream<PaneStreamEnvelope, Error>
    }

    protocol PaneInputWriting: Sendable {
        func writePaneInput(_ input: SendPaneInputInput) async throws -> PaneWriteAck
    }

    protocol PaneRuntimeResizing: Sendable {
        func resizePaneRuntime(_ input: ResizePaneRuntimeInput) async throws -> PaneResizeAck
    }

    protocol PaneRuntimeCreating: Sendable {
        func createPaneRuntime(_ input: CreatePaneRuntimeInput) async throws -> PaneRuntimeState
    }

    /// D-044: creates a NEW tmux pane running a validated agent resume
    /// command, carrying agent pane metadata instead of managed-process.
    protocol AgentPaneRuntimeCreating: Sendable {
        func createAgentPaneRuntime(_ input: CreateAgentPaneRuntimeInput) async throws -> PaneRuntimeState
    }

    /// D-044: attaches {agentID, sessionID} to an existing pane record via
    /// the server's `tmux.pane.attachMetadata` contract.
    protocol PaneAgentMetadataAttaching: Sendable {
        func attachAgentPaneMetadata(_ input: AttachAgentPaneMetadataInput) async throws -> PaneRuntimeState
    }

    protocol PaneRuntimeClosing: Sendable {
        func closePaneRuntime(_ input: ClosePaneRuntimeInput) async throws
    }

    /// D-028 keymap window actions: create (`tmux.window.create`), rename
    /// (`tmux.window.rename`), focus (`tmux.window.focus`), and close
    /// (`tmux.window.close`) map the prefix-table `n`/`r`/M-1..M-9/`&`
    /// bindings onto typed server RPCs.
    protocol WindowRuntimeCreating: Sendable {
        func createWindowRuntime(_ input: CreateWindowRuntimeInput) async throws -> WorkspaceRuntimeState
    }

    protocol WindowRuntimeRenaming: Sendable {
        func renameWindowRuntime(_ input: RenameWindowRuntimeInput) async throws -> WindowRuntimeState
    }

    protocol WindowRuntimeFocusing: Sendable {
        func focusWindowRuntime(_ input: FocusWindowRuntimeInput) async throws -> WorkspaceRuntimeState
    }

    protocol WindowRuntimeClosing: Sendable {
        func closeWindowRuntime(_ input: CloseWindowRuntimeInput) async throws -> WorkspaceRuntimeState
    }

    /// D-028 zoom keymap action (`resize-pane -Z` toggle) via `tmux.pane.zoom`.
    protocol PaneRuntimeZooming: Sendable {
        func zoomPaneRuntime(_ input: ZoomPaneRuntimeInput) async throws -> WorkspaceRuntimeState
    }

    protocol NativeRuntimeStore: Sendable {
        func loadCapabilities() async throws -> RuntimeCapabilities?
        func saveCapabilities(_ capabilities: RuntimeCapabilities) async throws
        func loadWorkspace(workspaceID: WorkspaceID) async throws -> WorkspaceRuntimeState?
        func saveWorkspace(_ workspace: WorkspaceRuntimeState) async throws
        func deleteWorkspace(workspaceID: WorkspaceID) async throws
        func loadPane(paneID: PaneID) async throws -> PaneRuntimeState?
        func savePane(_ pane: PaneRuntimeState) async throws
        func deletePane(paneID: PaneID) async throws
    }

    protocol NativeRuntimeEventPublishing: Sendable {
        func publish(_ event: EventEnvelope<Event>) async
    }
}
