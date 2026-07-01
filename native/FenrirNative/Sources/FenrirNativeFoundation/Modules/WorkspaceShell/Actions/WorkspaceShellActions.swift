import Foundation
import FenrirNativeShared
import WorkspaceIndex

public extension WorkspaceShell {
    enum CommandParser {
        public static func parse(requestID: RequestID, arguments: [String], source: ActionSource) -> Result<CommandRequest, WorkspaceShellError> {
            guard let command = arguments.first else {
                return .failure(.invalidCommand)
            }
            let outputFormat: CommandOutputFormat = arguments.contains("--json") ? .jsonLines : .text
            let values = arguments.filter { !$0.hasPrefix("--") }
            switch command {
            case "open":
                guard let ref = values.dropFirst().first else { return .failure(.invalidCommand) }
                return .success(CommandRequest(requestID: requestID, verb: .open, workspaceIdentity: identity(from: ref), outputFormat: outputFormat, source: source))
            case "list":
                return .success(CommandRequest(requestID: requestID, verb: .list, outputFormat: outputFormat, source: source))
            case "switch":
                guard let ref = values.dropFirst().first else { return .failure(.invalidCommand) }
                return .success(CommandRequest(requestID: requestID, verb: .switch, workspaceIdentity: identity(from: ref), outputFormat: outputFormat, source: source))
            case "attach":
                guard values.count >= 3 else { return .failure(.invalidCommand) }
                return .success(CommandRequest(requestID: requestID, verb: .attach, workspaceIdentity: identity(from: values[2]), remoteEndpointID: values[1], outputFormat: outputFormat, source: source))
            case "remove":
                guard let ref = values.dropFirst().first else { return .failure(.invalidCommand) }
                return .success(CommandRequest(requestID: requestID, verb: .remove, workspaceIdentity: identity(from: ref), outputFormat: outputFormat, source: source))
            default:
                return .failure(.invalidCommand)
            }
        }

        private static func identity(from value: String) -> WorkspaceIndex.WorkspaceIdentity {
            if value.hasPrefix("/") {
                WorkspaceIndex.WorkspaceIdentity(kind: .localPath, canonicalPath: value)
            } else if value.contains(":") {
                WorkspaceIndex.WorkspaceIdentity(kind: .remote, serverID: value)
            } else {
                WorkspaceIndex.WorkspaceIdentity(kind: .project, workspaceID: WorkspaceID(rawValue: value), projectID: value)
            }
        }
    }

    struct OpenWorkspace: FenrirAction {
        public typealias Failure = WorkspaceShellError

        let index: any WorkspaceIndexCommanding
        let windows: any WorkspaceWindowCommanding
        let clock: any WorkspaceShellClock
        let events: (any WorkspaceShellEventPublishing)?

        init(index: any WorkspaceIndexCommanding, windows: any WorkspaceWindowCommanding, clock: any WorkspaceShellClock, events: (any WorkspaceShellEventPublishing)? = nil) {
            self.index = index
            self.windows = windows
            self.clock = clock
            self.events = events
        }

        public func run(_ input: OpenWorkspaceInput) async -> Result<CommandResult, WorkspaceShellError> {
            do {
                let resolved = try await index.resolveWorkspace(requestID: input.requestID, identity: input.identity)
                let windowID = try await windows.openWorkspace(resolved.summary)
                _ = try await index.attachWorkspace(requestID: input.requestID, workspaceID: resolved.summary.workspaceID, windowID: windowID)
                _ = try await index.markRecent(requestID: input.requestID, workspaceID: resolved.summary.workspaceID)
                let timestamp = clock.now()
                await WorkspaceShell.publish(input.requestID, "WorkspaceOpened", timestamp, .workspaceOpened(resolved.summary.workspaceID), events)
                return .success(CommandResult(requestID: input.requestID, verb: .open, status: "opened", workspace: resolved.summary, nativeWindowID: windowID, timestamp: timestamp))
            } catch let error as WorkspaceShellError {
                return .failure(error)
            } catch {
                return .failure(.workspaceNotFound)
            }
        }
    }

    struct SwitchWorkspace: FenrirAction {
        public typealias Failure = WorkspaceShellError

        let index: any WorkspaceIndexCommanding
        let windows: any WorkspaceWindowCommanding
        let clock: any WorkspaceShellClock
        let events: (any WorkspaceShellEventPublishing)?

        init(index: any WorkspaceIndexCommanding, windows: any WorkspaceWindowCommanding, clock: any WorkspaceShellClock, events: (any WorkspaceShellEventPublishing)? = nil) {
            self.index = index
            self.windows = windows
            self.clock = clock
            self.events = events
        }

        public func run(_ input: SwitchWorkspaceInput) async -> Result<CommandResult, WorkspaceShellError> {
            do {
                let resolved = try await index.resolveWorkspace(requestID: input.requestID, identity: input.identity)
                guard resolved.summary.isOpenLocally else {
                    return .failure(.workspaceNotFound)
                }
                let windowID = try await windows.switchWorkspace(resolved.summary)
                _ = try await index.markRecent(requestID: input.requestID, workspaceID: resolved.summary.workspaceID)
                let timestamp = clock.now()
                await WorkspaceShell.publish(input.requestID, "WorkspaceSwitched", timestamp, .workspaceSwitched(resolved.summary.workspaceID), events)
                return .success(CommandResult(requestID: input.requestID, verb: .switch, status: "switched", workspace: resolved.summary, nativeWindowID: windowID, timestamp: timestamp))
            } catch let error as WorkspaceShellError {
                return .failure(error)
            } catch {
                return .failure(.workspaceNotFound)
            }
        }
    }

    struct AttachRemoteWorkspace: FenrirAction {
        public typealias Failure = WorkspaceShellError

        let index: any WorkspaceIndexCommanding
        let remoteAttacher: any RemoteWorkspaceAttaching
        let windows: any WorkspaceWindowCommanding
        let clock: any WorkspaceShellClock
        let events: (any WorkspaceShellEventPublishing)?

        init(index: any WorkspaceIndexCommanding, remoteAttacher: any RemoteWorkspaceAttaching, windows: any WorkspaceWindowCommanding, clock: any WorkspaceShellClock, events: (any WorkspaceShellEventPublishing)? = nil) {
            self.index = index
            self.remoteAttacher = remoteAttacher
            self.windows = windows
            self.clock = clock
            self.events = events
        }

        public func run(_ input: AttachRemoteWorkspaceInput) async -> Result<CommandResult, WorkspaceShellError> {
            do {
                let summary = try await remoteAttacher.attachRemoteWorkspace(endpointID: input.endpointID, identity: input.identity)
                _ = try await index.registerWorkspace(requestID: input.requestID, summary: summary)
                let windowID = try await windows.openWorkspace(summary)
                _ = try await index.attachWorkspace(requestID: input.requestID, workspaceID: summary.workspaceID, windowID: windowID)
                let timestamp = clock.now()
                await WorkspaceShell.publish(input.requestID, "RemoteWorkspaceAttached", timestamp, .remoteWorkspaceAttached(summary.workspaceID), events)
                return .success(CommandResult(requestID: input.requestID, verb: .attach, status: "attached", workspace: summary, nativeWindowID: windowID, timestamp: timestamp))
            } catch {
                return .failure(.remoteAttachFailed)
            }
        }
    }

    struct RemoveWorkspace: FenrirAction {
        public typealias Failure = WorkspaceShellError

        let index: any WorkspaceIndexCommanding
        let clock: any WorkspaceShellClock
        let events: (any WorkspaceShellEventPublishing)?

        init(index: any WorkspaceIndexCommanding, clock: any WorkspaceShellClock, events: (any WorkspaceShellEventPublishing)? = nil) {
            self.index = index
            self.clock = clock
            self.events = events
        }

        public func run(_ input: RemoveWorkspaceInput) async -> Result<CommandResult, WorkspaceShellError> {
            do {
                let resolved = try await index.resolveWorkspace(requestID: input.requestID, identity: input.identity)
                _ = try await index.removeWorkspace(requestID: input.requestID, workspaceID: resolved.summary.workspaceID)
                let timestamp = clock.now()
                await WorkspaceShell.publish(input.requestID, "WorkspaceRemoved", timestamp, .workspaceRemoved(resolved.summary.workspaceID), events)
                return .success(CommandResult(requestID: input.requestID, verb: .remove, status: "removed", workspace: resolved.summary, timestamp: timestamp))
            } catch {
                return .failure(.removeFailed)
            }
        }
    }

    struct ListShellWorkspaces: FenrirAction {
        public typealias Failure = WorkspaceShellError

        let index: any WorkspaceIndexCommanding
        let clock: any WorkspaceShellClock
        let events: (any WorkspaceShellEventPublishing)?

        init(index: any WorkspaceIndexCommanding, clock: any WorkspaceShellClock, events: (any WorkspaceShellEventPublishing)? = nil) {
            self.index = index
            self.clock = clock
            self.events = events
        }

        public func run(_ input: ListShellWorkspacesInput) async -> Result<CommandResult, WorkspaceShellError> {
            do {
                let list = try await index.listWorkspaces(requestID: input.requestID, includeRemote: input.includeRemote)
                let timestamp = clock.now()
                await WorkspaceShell.publish(input.requestID, "WorkspacesListed", timestamp, .workspacesListed(list.snapshot.workspaces.count), events)
                return .success(CommandResult(requestID: input.requestID, verb: .list, status: list.isDegraded ? "degraded" : "ok", workspaces: list.snapshot.workspaces, timestamp: timestamp))
            } catch {
                return .failure(.listFailed)
            }
        }
    }

    struct FormatCommandResult: FenrirAction {
        public typealias Failure = WorkspaceShellError

        let clock: any WorkspaceShellClock
        let events: (any WorkspaceShellEventPublishing)?

        init(clock: any WorkspaceShellClock, events: (any WorkspaceShellEventPublishing)? = nil) {
            self.clock = clock
            self.events = events
        }

        public func run(_ input: FormatCommandResultInput) async -> Result<FormatCommandResultResult, WorkspaceShellError> {
            let timestamp = clock.now()
            if let error = input.error {
                let output = input.outputFormat == .jsonLines
                    ? "{\"ok\":false,\"error\":\"\(error.rawValue)\"}"
                    : "error: \(error.rawValue)"
                await WorkspaceShell.publish(input.requestID, "CommandResultFormatted", timestamp, .commandResultFormatted(input.requestID), events)
                return .success(FormatCommandResultResult(requestID: input.requestID, exitCode: 1, output: output, timestamp: timestamp))
            }
            guard let result = input.result else {
                return .failure(.formatFailed)
            }
            let output: String
            switch input.outputFormat {
            case .text:
                output = WorkspaceShell.textOutput(result)
            case .jsonLines:
                output = WorkspaceShell.jsonLine(result)
            }
            await WorkspaceShell.publish(input.requestID, "CommandResultFormatted", timestamp, .commandResultFormatted(input.requestID), events)
            return .success(FormatCommandResultResult(requestID: input.requestID, exitCode: 0, output: output, timestamp: timestamp))
        }
    }

    struct ToggleWorkspaceSidebar: FenrirAction {
        public typealias Failure = WorkspaceShellError

        let toggling: any WorkspaceSidebarToggling

        init(toggling: any WorkspaceSidebarToggling) {
            self.toggling = toggling
        }

        public func run(_ input: ToggleWorkspaceSidebarInput) async -> Result<ToggleWorkspaceSidebarResult, WorkspaceShellError> {
            do {
                return .success(try await toggling.toggleSidebar(input))
            } catch let error as WorkspaceShellError {
                return .failure(error)
            } catch {
                return .failure(.switcherFailed)
            }
        }
    }
}

extension WorkspaceShell {
    static func publish(_ requestID: RequestID, _ kind: String, _ timestamp: FenrirTimestamp, _ event: Event, _ events: (any WorkspaceShellEventPublishing)?) async {
        await events?.publish(EventEnvelope(eventID: requestID, eventKind: kind, timestamp: timestamp, event: event))
    }

    static func textOutput(_ result: CommandResult) -> String {
        switch result.verb {
        case .list:
            return result.workspaces.map { "\($0.workspaceID.rawValue)\t\($0.displayName)\t\($0.status.rawValue)" }.joined(separator: "\n")
        case .open, .switch, .attach, .remove:
            guard let workspace = result.workspace else { return result.status }
            return "\(result.status): \(workspace.workspaceID.rawValue) \(workspace.displayName)"
        }
    }

    static func jsonLine(_ result: CommandResult) -> String {
        let workspaceID = result.workspace?.workspaceID.rawValue ?? ""
        let windowID = result.nativeWindowID?.rawValue ?? ""
        return "{\"ok\":true,\"verb\":\"\(result.verb.rawValue)\",\"status\":\"\(result.status)\",\"workspaceId\":\"\(workspaceID)\",\"windowId\":\"\(windowID)\",\"count\":\(result.workspaces.count)}"
    }
}
