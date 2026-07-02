import Foundation
import FenrirNativeShared
import NativeRuntime

public extension NeovimBridge {
    struct OpenFileInNeovim: FenrirAction {
        public typealias Failure = NeovimBridgeError

        public let catalog: any NeovimPaneCataloging
        public let bridgeClient: any NeovimBridgeClient
        public let creator: any NeovimPaneCreating
        public let enumerator: any NativeRuntime.WorkspaceRuntimeEnumerating
        public let focuser: any NativeRuntime.PaneRuntimeFocusing
        public let clock: any NeovimBridgeClock

        public init(
            catalog: any NeovimPaneCataloging,
            bridgeClient: any NeovimBridgeClient,
            creator: any NeovimPaneCreating,
            enumerator: any NativeRuntime.WorkspaceRuntimeEnumerating,
            focuser: any NativeRuntime.PaneRuntimeFocusing,
            clock: any NeovimBridgeClock
        ) {
            self.catalog = catalog
            self.bridgeClient = bridgeClient
            self.creator = creator
            self.enumerator = enumerator
            self.focuser = focuser
            self.clock = clock
        }

        public func run(_ input: OpenFileInNeovimInput) async -> Result<OpenFileInNeovimResult, NeovimBridgeError> {
            do {
                let snapshot = try await NeovimBridge.enumerateRuntime(enumerator, input: input)
                let panes = NeovimBridge.merge(
                    try await catalog.listNeovimPanes(workspaceID: input.workspaceID),
                    with: NeovimBridge.neovimPanes(from: snapshot.panes)
                )
                let timestamp = clock.now()

                guard let active = NeovimBridge.activeNeovimPane(in: snapshot.workspace, panes: panes, preferredWindowID: input.windowID) else {
                    guard input.policy == .createIfNeeded else {
                        return .failure(.noActiveNeovimPane)
                    }
                    guard let windowID = input.windowID ?? snapshot.workspace.activeWindowID ?? snapshot.workspace.windows.first?.windowID else {
                        return .failure(.createFailed("No tmux window is available for Neovim creation"))
                    }
                    let created = try await creator.createNeovimPane(input, windowID: windowID)
                    return .success(OpenFileInNeovimResult(requestID: input.requestID, route: .created(created.paneID), pane: created, activeState: nil, timestamp: timestamp))
                }

                try NeovimBridge.validate(active, in: snapshot)
                guard active.bridgeCapability != .unsupported else {
                    try await NeovimBridge.focus(active, input: input, focuser: focuser)
                    return .success(OpenFileInNeovimResult(requestID: input.requestID, route: .focusedWithoutBridge(active.paneID), pane: active, activeState: nil, timestamp: timestamp))
                }

                do {
                    let state = try await bridgeClient.openFile(input.target, in: active)
                    try await NeovimBridge.focus(active, input: input, focuser: focuser)
                    return .success(OpenFileInNeovimResult(requestID: input.requestID, route: .bridge(active.paneID), pane: active, activeState: state, timestamp: timestamp))
                } catch NeovimBridgeError.unsupportedBridge {
                    try await NeovimBridge.focus(active, input: input, focuser: focuser)
                    return .success(OpenFileInNeovimResult(requestID: input.requestID, route: .focusedWithoutBridge(active.paneID), pane: active, activeState: nil, timestamp: timestamp))
                }
            } catch let error as NeovimBridgeError {
                return .failure(error)
            } catch {
                return .failure(.bridgeFailure(String(describing: error)))
            }
        }
    }

    struct FocusNeovimPane: FenrirAction {
        public typealias Failure = NeovimBridgeError

        public let catalog: any NeovimPaneCataloging
        public let enumerator: any NativeRuntime.WorkspaceRuntimeEnumerating
        public let focuser: any NativeRuntime.PaneRuntimeFocusing
        public let clock: any NeovimBridgeClock

        public init(
            catalog: any NeovimPaneCataloging,
            enumerator: any NativeRuntime.WorkspaceRuntimeEnumerating,
            focuser: any NativeRuntime.PaneRuntimeFocusing,
            clock: any NeovimBridgeClock
        ) {
            self.catalog = catalog
            self.enumerator = enumerator
            self.focuser = focuser
            self.clock = clock
        }

        public func run(_ input: FocusNeovimPaneInput) async -> Result<FocusNeovimPaneResult, NeovimBridgeError> {
            do {
                let snapshot = try await NeovimBridge.enumerateRuntime(enumerator, input: input)
                let panes = NeovimBridge.merge(
                    try await catalog.listNeovimPanes(workspaceID: input.workspaceID),
                    with: NeovimBridge.neovimPanes(from: snapshot.panes)
                )
                let pane: NeovimPaneDescriptor?
                if let paneID = input.paneID {
                    pane = panes.first { $0.paneID == paneID }
                } else {
                    pane = NeovimBridge.activeNeovimPane(in: snapshot.workspace, panes: panes, preferredWindowID: nil)
                }
                guard let pane else {
                    return .failure(input.paneID.map { .paneNotFound($0) } ?? .noActiveNeovimPane)
                }
                try NeovimBridge.validate(pane, in: snapshot)
                try await NeovimBridge.focus(pane, input: input, focuser: focuser)
                return .success(FocusNeovimPaneResult(requestID: input.requestID, pane: pane, timestamp: clock.now()))
            } catch let error as NeovimBridgeError {
                return .failure(error)
            } catch {
                return .failure(.runtimeFailure(String(describing: error)))
            }
        }
    }

    struct DetectActiveNeovimState: FenrirAction {
        public typealias Failure = NeovimBridgeError

        public let catalog: any NeovimPaneCataloging
        public let bridgeClient: any NeovimBridgeClient
        public let enumerator: any NativeRuntime.WorkspaceRuntimeEnumerating
        public let clock: any NeovimBridgeClock

        public init(
            catalog: any NeovimPaneCataloging,
            bridgeClient: any NeovimBridgeClient,
            enumerator: any NativeRuntime.WorkspaceRuntimeEnumerating,
            clock: any NeovimBridgeClock
        ) {
            self.catalog = catalog
            self.bridgeClient = bridgeClient
            self.enumerator = enumerator
            self.clock = clock
        }

        public func run(_ input: DetectActiveNeovimStateInput) async -> Result<DetectActiveNeovimStateResult, NeovimBridgeError> {
            do {
                let snapshot = try await NeovimBridge.enumerateRuntime(enumerator, input: input)
                let panes = NeovimBridge.merge(
                    try await catalog.listNeovimPanes(workspaceID: input.workspaceID),
                    with: NeovimBridge.neovimPanes(from: snapshot.panes)
                )
                guard let active = NeovimBridge.activeNeovimPane(in: snapshot.workspace, panes: panes, preferredWindowID: nil) else {
                    return .success(DetectActiveNeovimStateResult(requestID: input.requestID, pane: nil, state: nil, timestamp: clock.now()))
                }
                try NeovimBridge.validate(active, in: snapshot)
                guard active.bridgeCapability != .unsupported else {
                    return .success(DetectActiveNeovimStateResult(requestID: input.requestID, pane: active, state: ActiveNeovimState(paneID: active.paneID, bridgeCapability: .unsupported), timestamp: clock.now()))
                }
                do {
                    return .success(DetectActiveNeovimStateResult(requestID: input.requestID, pane: active, state: try await bridgeClient.activeState(in: active), timestamp: clock.now()))
                } catch NeovimBridgeError.unsupportedBridge {
                    return .success(DetectActiveNeovimStateResult(requestID: input.requestID, pane: active, state: ActiveNeovimState(paneID: active.paneID, bridgeCapability: .unsupported), timestamp: clock.now()))
                }
            } catch let error as NeovimBridgeError {
                return .failure(error)
            } catch {
                return .failure(.bridgeFailure(String(describing: error)))
            }
        }
    }
}

private extension NeovimBridge {
    struct RuntimeSnapshot {
        let workspace: NativeRuntime.WorkspaceRuntimeState
        let panes: [NativeRuntime.PaneRuntimeState]
    }

    static func enumerateRuntime(_ enumerator: any NativeRuntime.WorkspaceRuntimeEnumerating, input: OpenFileInNeovimInput) async throws -> RuntimeSnapshot {
        let snapshot = try await enumerator.enumerateWorkspaceRuntime(NativeRuntime.EnumerateWorkspaceRuntimeInput(requestID: input.requestID, workspaceID: input.workspaceID, actor: input.actor, source: input.source))
        return RuntimeSnapshot(workspace: snapshot.workspace, panes: snapshot.panes)
    }

    static func enumerateRuntime(_ enumerator: any NativeRuntime.WorkspaceRuntimeEnumerating, input: FocusNeovimPaneInput) async throws -> RuntimeSnapshot {
        let snapshot = try await enumerator.enumerateWorkspaceRuntime(NativeRuntime.EnumerateWorkspaceRuntimeInput(requestID: input.requestID, workspaceID: input.workspaceID, actor: input.actor, source: input.source))
        return RuntimeSnapshot(workspace: snapshot.workspace, panes: snapshot.panes)
    }

    static func enumerateRuntime(_ enumerator: any NativeRuntime.WorkspaceRuntimeEnumerating, input: DetectActiveNeovimStateInput) async throws -> RuntimeSnapshot {
        let snapshot = try await enumerator.enumerateWorkspaceRuntime(NativeRuntime.EnumerateWorkspaceRuntimeInput(requestID: input.requestID, workspaceID: input.workspaceID, actor: input.actor, source: input.source))
        return RuntimeSnapshot(workspace: snapshot.workspace, panes: snapshot.panes)
    }

    static func activeNeovimPane(
        in workspace: NativeRuntime.WorkspaceRuntimeState,
        panes: [NeovimPaneDescriptor],
        preferredWindowID: FenrirWindowID?
    ) -> NeovimPaneDescriptor? {
        let windowID = preferredWindowID ?? workspace.activeWindowID
        guard let window = workspace.windows.first(where: { $0.windowID == windowID }),
              let activePaneID = window.activePaneID
        else {
            return nil
        }
        return panes.first { $0.workspaceID == workspace.workspaceID && $0.windowID == window.windowID && $0.paneID == activePaneID }
    }

    static func validate(_ descriptor: NeovimPaneDescriptor, in snapshot: RuntimeSnapshot) throws {
        guard descriptor.workspaceID == snapshot.workspace.workspaceID,
              let pane = snapshot.panes.first(where: { $0.paneID == descriptor.paneID }),
              pane.status == .attached,
              pane.windowID == descriptor.windowID,
              snapshot.workspace.windows.contains(where: { $0.windowID == descriptor.windowID && $0.paneIDs.contains(descriptor.paneID) })
        else {
            throw NeovimBridgeError.stalePane(descriptor.paneID)
        }
    }

    static func neovimPanes(from panes: [NativeRuntime.PaneRuntimeState]) -> [NeovimPaneDescriptor] {
        panes.compactMap { pane in
            guard pane.metadata?.kind == "neovim",
                  let metadata = pane.metadata?.neovim,
                  let windowID = pane.windowID
            else {
                return nil
            }
            return NeovimPaneDescriptor(
                workspaceID: pane.workspaceID,
                windowID: windowID,
                paneID: pane.paneID,
                tmuxPaneID: pane.tmuxPaneID,
                bridgeSocketPath: metadata.bridgeSocketPath,
                bridgeCapability: .unknown,
                bootstrapID: metadata.bootstrapID
            )
        }
    }

    static func merge(_ primary: [NeovimPaneDescriptor], with runtime: [NeovimPaneDescriptor]) -> [NeovimPaneDescriptor] {
        var merged = primary
        for pane in runtime where !merged.contains(where: { $0.paneID == pane.paneID }) {
            merged.append(pane)
        }
        return merged
    }

    static func focus(_ pane: NeovimPaneDescriptor, input: OpenFileInNeovimInput, focuser: any NativeRuntime.PaneRuntimeFocusing) async throws {
        _ = try await focuser.focusPaneRuntime(NativeRuntime.FocusPaneRuntimeInput(requestID: input.requestID, workspaceID: input.workspaceID, windowID: pane.windowID, paneID: pane.paneID, actor: input.actor, source: input.source))
    }

    static func focus(_ pane: NeovimPaneDescriptor, input: FocusNeovimPaneInput, focuser: any NativeRuntime.PaneRuntimeFocusing) async throws {
        _ = try await focuser.focusPaneRuntime(NativeRuntime.FocusPaneRuntimeInput(requestID: input.requestID, workspaceID: input.workspaceID, windowID: pane.windowID, paneID: pane.paneID, actor: input.actor, source: input.source))
    }
}
