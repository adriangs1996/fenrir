import Foundation
import FenrirNativeShared

extension NativeRuntime {
    protocol NativeRuntimeClock: Sendable {
        func now() -> FenrirTimestamp
    }

    protocol RuntimeCapabilityQuerying: Sendable {
        func discoverRuntimeCapabilities(_ input: DiscoverRuntimeCapabilitiesInput) async throws -> RuntimeCapabilities
    }

    protocol WorkspaceRuntimeAttaching: Sendable {
        func attachWorkspaceRuntime(_ input: AttachWorkspaceRuntimeInput) async throws -> WorkspaceRuntimeState
    }

    protocol WorkspaceRuntimeDetaching: Sendable {
        func detachWorkspaceRuntime(_ input: DetachWorkspaceRuntimeInput) async throws
    }

    protocol WorkspaceRuntimeReconnecting: Sendable {
        func reconnectWorkspaceRuntime(_ input: ReconnectWorkspaceRuntimeInput) async throws -> WorkspaceRuntimeState
    }

    protocol PaneRuntimeAttaching: Sendable {
        func attachPaneRuntime(_ input: AttachPaneRuntimeInput, backfill: BackfillMode) async throws -> PaneRuntimeState
    }

    protocol PaneStreamSubscribing: Sendable {
        func reconnectPaneStream(_ input: ReconnectPaneStreamInput, stream: PaneStreamState, backfill: BackfillMode) async throws -> [PaneStreamEnvelope]
    }

    protocol PaneInputWriting: Sendable {
        func writePaneInput(_ input: SendPaneInputInput) async throws -> PaneWriteAck
    }

    protocol PaneRuntimeResizing: Sendable {
        func resizePaneRuntime(_ input: ResizePaneRuntimeInput) async throws -> PaneResizeAck
    }

    protocol PaneRuntimeClosing: Sendable {
        func closePaneRuntime(_ input: ClosePaneRuntimeInput) async throws
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
