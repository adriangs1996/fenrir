import Foundation
import FenrirNativeShared
import WorkspaceIndex
import WorkspaceCoordinator

public extension ClientControl {
    struct OpenWorkspace: FenrirAction {
        public typealias Failure = ClientControlError

        let opening: any WorkspaceOpening

        public init(opening: any WorkspaceOpening) {
            self.opening = opening
        }

        public func run(_ input: OpenWorkspaceInput) async -> Result<OpenWorkspaceResult, ClientControlError> {
            do {
                let result = try await opening.openWorkspace(WorkspaceCoordinator.OpenWorkspaceInput(
                    requestID: input.requestID,
                    identity: input.identity,
                    mode: .focusExisting,
                    serverSelection: .local,
                    source: input.source
                ))
                return .success(OpenWorkspaceResult(
                    requestID: input.requestID,
                    workspace: result.experience.workspace,
                    windowID: result.experience.windowID,
                    didCreateWindow: result.didCreateWindow,
                    didFocusExistingWindow: result.didFocusExistingWindow,
                    timestamp: result.timestamp
                ))
            } catch {
                return .failure(ClientControl.from(error))
            }
        }
    }

    struct SwitchWorkspace: FenrirAction {
        public typealias Failure = ClientControlError

        let switching: any WorkspaceSwitching

        public init(switching: any WorkspaceSwitching) {
            self.switching = switching
        }

        public func run(_ input: SwitchWorkspaceInput) async -> Result<SwitchWorkspaceResult, ClientControlError> {
            do {
                let result = try await switching.switchWorkspace(WorkspaceCoordinator.SwitchWorkspaceInput(
                    requestID: input.requestID,
                    identity: input.identity,
                    source: input.source
                ))
                return .success(SwitchWorkspaceResult(
                    requestID: input.requestID,
                    workspace: result.experience.workspace,
                    windowID: result.experience.windowID,
                    timestamp: result.timestamp
                ))
            } catch {
                return .failure(ClientControl.from(error))
            }
        }
    }

    struct ListWorkspaces: FenrirAction {
        public typealias Failure = ClientControlError

        let listing: any WorkspaceListing

        public init(listing: any WorkspaceListing) {
            self.listing = listing
        }

        public func run(_ input: ListWorkspacesInput) async -> Result<ListWorkspacesResult, ClientControlError> {
            do {
                let result = try await listing.listWorkspaces(WorkspaceIndex.ListWorkspacesInput(
                    requestID: input.requestID,
                    includeServer: input.includeServer,
                    includeHidden: input.includeHidden,
                    surface: input.surface,
                    sort: input.sort,
                    source: input.source
                ))
                return .success(ListWorkspacesResult(
                    requestID: input.requestID,
                    workspaces: result.snapshot.workspaces,
                    timestamp: result.timestamp
                ))
            } catch {
                return .failure(ClientControl.from(error))
            }
        }
    }

    struct AttachWorkspace: FenrirAction {
        public typealias Failure = ClientControlError

        let opening: any WorkspaceOpening

        public init(opening: any WorkspaceOpening) {
            self.opening = opening
        }

        public func run(_ input: AttachWorkspaceInput) async -> Result<AttachWorkspaceResult, ClientControlError> {
            do {
                let result = try await opening.openWorkspace(WorkspaceCoordinator.OpenWorkspaceInput(
                    requestID: input.requestID,
                    identity: input.identity,
                    mode: .attach,
                    serverSelection: input.serverSelection,
                    source: input.source
                ))
                return .success(AttachWorkspaceResult(
                    requestID: input.requestID,
                    workspace: result.experience.workspace,
                    windowID: result.experience.windowID,
                    timestamp: result.timestamp
                ))
            } catch {
                return .failure(ClientControl.from(error))
            }
        }
    }

    struct RemoveWorkspace: FenrirAction {
        public typealias Failure = ClientControlError

        let removing: any WorkspaceRemoving

        public init(removing: any WorkspaceRemoving) {
            self.removing = removing
        }

        public func run(_ input: RemoveWorkspaceInput) async -> Result<RemoveWorkspaceResult, ClientControlError> {
            do {
                let result = try await removing.removeWorkspace(WorkspaceIndex.RemoveWorkspaceInput(
                    requestID: input.requestID,
                    workspaceID: input.workspaceID,
                    targetIdentity: input.targetIdentity,
                    source: input.source
                ))
                return .success(RemoveWorkspaceResult(
                    requestID: result.requestID,
                    workspaceID: result.workspaceID,
                    timestamp: result.timestamp
                ))
            } catch {
                return .failure(ClientControl.from(error))
            }
        }
    }

    struct FocusWorkspace: FenrirAction {
        public typealias Failure = ClientControlError

        let switching: any WorkspaceSwitching

        public init(switching: any WorkspaceSwitching) {
            self.switching = switching
        }

        public func run(_ input: FocusWorkspaceInput) async -> Result<FocusWorkspaceResult, ClientControlError> {
            do {
                let result = try await switching.switchWorkspace(WorkspaceCoordinator.SwitchWorkspaceInput(
                    requestID: input.requestID,
                    identity: input.identity,
                    source: input.source
                ))
                return .success(FocusWorkspaceResult(
                    requestID: input.requestID,
                    workspace: result.experience.workspace,
                    windowID: result.experience.windowID,
                    timestamp: result.timestamp
                ))
            } catch {
                return .failure(ClientControl.from(error))
            }
        }
    }

    struct ControlWorkspace: FenrirAction {
        public typealias Failure = ClientControlError

        let controlling: any WorkspaceControlling

        public init(controlling: any WorkspaceControlling) {
            self.controlling = controlling
        }

        public func run(_ input: ControlWorkspaceInput) async -> Result<ControlWorkspaceResult, ClientControlError> {
            switch input.operation {
            case .close:
                guard let workspaceID = input.workspaceID ?? input.identity?.workspaceID else {
                    return .failure(.decodeError)
                }
                do {
                    let result = try await controlling.closeWorkspace(WorkspaceCoordinator.CloseWorkspaceExperienceInput(
                        requestID: input.requestID,
                        workspaceID: workspaceID,
                        targetIdentity: input.identity,
                        source: input.source
                    ))
                    return .success(ControlWorkspaceResult(
                        requestID: result.requestID,
                        operation: .close,
                        workspaceID: result.workspaceID,
                        timestamp: result.timestamp
                    ))
                } catch {
                    return .failure(ClientControl.from(error))
                }
            case .reconnect:
                guard let identity = input.identity else {
                    return .failure(.decodeError)
                }
                do {
                    let result = try await controlling.reconnectWorkspace(WorkspaceCoordinator.ReconnectWorkspaceExperienceInput(
                        requestID: input.requestID,
                        identity: identity,
                        serverSelection: input.serverSelection,
                        source: input.source
                    ))
                    return .success(ControlWorkspaceResult(
                        requestID: result.requestID,
                        operation: .reconnect,
                        workspaceID: result.experience.workspace.workspaceID,
                        workspace: result.experience.workspace,
                        timestamp: result.timestamp
                    ))
                } catch {
                    return .failure(ClientControl.from(error))
                }
            }
        }
    }

    private static func from(_ error: Error) -> ClientControlError {
        if let clientError = error as? ClientControlError {
            return clientError
        }

        if let indexError = error as? WorkspaceIndex.WorkspaceIndexError {
            return from(workspaceIndexError: indexError)
        }

        if let coordinatorError = error as? WorkspaceCoordinator.WorkspaceCoordinatorError {
            return from(workspaceCoordinatorError: coordinatorError)
        }

        return .unavailable
    }

    private static func from(workspaceIndexError: WorkspaceIndex.WorkspaceIndexError) -> ClientControlError {
        switch workspaceIndexError {
        case .workspaceNotFound:
            return .workspaceNotFound
        case .permissionDenied:
            return .permissionError
        case .serverUnavailable, .readFailed, .writeFailed, .decodeFailed, .duplicateIdentity, .ambiguousIdentity, .invalidIdentity:
            return .unavailable
        }
    }

    private static func from(workspaceCoordinatorError: WorkspaceCoordinator.WorkspaceCoordinatorError) -> ClientControlError {
        switch workspaceCoordinatorError {
        case .notFound, .resolutionFailed:
            return .workspaceNotFound
        case .notOpen:
            return .workspaceNotOpen
        case .permissionDenied:
            return .permissionError
        case .alreadyOpen:
            return .confirmationRequired
        case .serverSelectionFailed, .serverUnavailable, .creationFailed, .attachFailed, .focusFailed, .closeFailed, .reconnectFailed, .restoreFailed, .partialAttachFailed:
            return .unavailable
        }
    }
}
