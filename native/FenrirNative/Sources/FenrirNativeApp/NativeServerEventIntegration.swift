import AgentInteraction
import FenrirNativeShared
import Foundation
import Notifications
import ServerConnection
import WorkflowControl
import WorkspaceCoordinator
import WorkspaceIndex

protocol NativeServerSessionReconnectHandling: Sendable {
    func handleTransportClose(_ input: ServerConnection.HandleServerTransportCloseInput) async -> Result<ServerConnection.Session, ServerConnection.ServerConnectionError>
    func reconnectSession(_ input: ServerConnection.ReconnectServerSessionInput) async -> Result<ServerConnection.Session, ServerConnection.ServerConnectionError>
}

protocol NativeWorkspaceExperienceReconnectHandling: Sendable {
    func reconnectWorkspaceExperience(_ input: WorkspaceCoordinator.ReconnectWorkspaceExperienceInput) async -> Result<WorkspaceCoordinator.ReconnectWorkspaceExperienceResult, WorkspaceCoordinator.WorkspaceCoordinatorError>
}

protocol NativeWorkflowProjectionRefreshing: Sendable {
    func listWorkflowRuns(_ input: WorkflowControl.ListWorkflowRunsInput) async -> Result<WorkflowControl.ListWorkflowRunsResult, WorkflowControl.WorkflowControlError>
    func observeWorkflowRunTimeline(_ input: WorkflowControl.ObserveWorkflowRunTimelineInput) async -> Result<WorkflowControl.ObserveWorkflowRunTimelineResult, WorkflowControl.WorkflowControlError>
}

protocol NativeNotificationProjectionRefreshing: Sendable {
    func recordWorkflowNotification(
        workspaceID: WorkspaceID,
        event: WorkflowControl.WorkflowTimelineEvent,
        source: ActionSource
    ) async -> Result<Notifications.CreateNotificationResult, Notifications.NotificationsError>
    func projectWorkspaceNotifications(_ input: Notifications.ProjectWorkspaceNotificationsInput) async -> Result<Notifications.ProjectWorkspaceNotificationsResult, Notifications.NotificationsError>
}

protocol NativeAgentInteractionRefreshing: Sendable {
    func refreshAgentInteractions(_ input: NativeAgentInteractionRefreshInput) async -> Result<NativeAgentInteractionRefreshResult, AgentInteraction.AgentInteractionError>
}

protocol NativeServerEventReconnectIntegrating: Sendable {
    func reconnectWorkspaceFromServerEvent(_ input: NativeServerWorkspaceReconnectEventInput) async -> Result<NativeServerReconnectProjection, ServerConnection.ServerConnectionError>
}

struct NativeServerWorkspaceReconnectEventInput: Codable, Equatable, Sendable {
    let requestID: RequestID
    let workspaceID: WorkspaceID
    let serverID: String
    let serverURL: String
    let sessionID: ServerConnection.SessionID
    let generation: UInt64

    init(
        requestID: RequestID,
        workspaceID: WorkspaceID,
        serverID: String,
        serverURL: String,
        sessionID: ServerConnection.SessionID,
        generation: UInt64
    ) {
        self.requestID = requestID
        self.workspaceID = workspaceID
        self.serverID = serverID
        self.serverURL = serverURL
        self.sessionID = sessionID
        self.generation = generation
    }
}

struct NativeAgentInteractionRefreshInput: Codable, Equatable, Sendable {
    let requestID: RequestID
    let workspaceID: WorkspaceID
    let activeComposerIDs: [AgentInteraction.AgentComposerID]
    let source: ActionSource
}

struct NativeAgentInteractionRefreshResult: Codable, Equatable, Sendable {
    let requestID: RequestID
    let workspaceID: WorkspaceID
    let activeComposerIDs: [AgentInteraction.AgentComposerID]
}

struct NativeServerEventGraphWorkspace: Codable, Equatable, Sendable {
    let identity: WorkspaceIndex.WorkspaceIdentity
    let serverSelection: WorkspaceCoordinator.ServerSelection

    init(
        identity: WorkspaceIndex.WorkspaceIdentity,
        serverSelection: WorkspaceCoordinator.ServerSelection = .local
    ) {
        self.identity = identity
        self.serverSelection = serverSelection
    }
}

struct NativeServerReconnectProjection: Equatable, Sendable {
    let requestID: RequestID
    let session: ServerConnection.Session
    let workspaces: [WorkspaceCoordinator.WorkspaceExperience]
    let workflowRuns: [WorkflowControl.WorkflowRunSnapshot]
    let workflowTimelines: [WorkflowControl.WorkflowRunTimeline]
    let notifications: [Notifications.WorkspaceNotificationProjection]
    let agentInteractions: [NativeAgentInteractionRefreshResult]
    let failures: [String]
}

actor NativeServerEventIntegrationGraph {
    private let sessionHandler: any NativeServerSessionReconnectHandling
    private let workspaceHandler: any NativeWorkspaceExperienceReconnectHandling
    private let workflowRefresher: any NativeWorkflowProjectionRefreshing
    private let notificationRefresher: any NativeNotificationProjectionRefreshing
    private let agentRefresher: any NativeAgentInteractionRefreshing
    /// Each session-reconnect dispatch retries the transport probe internally
    /// with exponential backoff before giving up, so a transient link blip (a
    /// few hundred ms of packet loss on a remote link) recovers within one
    /// dispatch instead of relying on the next failing RPC to re-trigger.
    private let reconnectPolicy: ServerConnection.ReconnectPolicy

    private var workspacesByID: [WorkspaceID: NativeServerEventGraphWorkspace] = [:]
    private var workflowRunCursors: [WorkflowControl.WorkflowRunID: Int?] = [:]
    private var workflowRunsByID: [WorkflowControl.WorkflowRunID: WorkflowControl.WorkflowRunSnapshot] = [:]
    private var workflowTimelinesByID: [WorkflowControl.WorkflowRunID: WorkflowControl.WorkflowRunTimeline] = [:]
    private var notificationWorkspaceIDs: Set<WorkspaceID> = []
    private var agentComposersByWorkspace: [WorkspaceID: Set<AgentInteraction.AgentComposerID>] = [:]
    private var handledCloseGenerations: Set<String> = []

    init(
        sessionHandler: any NativeServerSessionReconnectHandling,
        workspaceHandler: any NativeWorkspaceExperienceReconnectHandling,
        workflowRefresher: any NativeWorkflowProjectionRefreshing,
        notificationRefresher: any NativeNotificationProjectionRefreshing,
        agentRefresher: any NativeAgentInteractionRefreshing,
        reconnectPolicy: ServerConnection.ReconnectPolicy = NativeServerEventIntegrationGraph.defaultReconnectPolicy
    ) {
        self.sessionHandler = sessionHandler
        self.workspaceHandler = workspaceHandler
        self.workflowRefresher = workflowRefresher
        self.notificationRefresher = notificationRefresher
        self.agentRefresher = agentRefresher
        self.reconnectPolicy = reconnectPolicy
    }

    /// Six probe attempts with 250 ms→4 s exponential backoff (~7.75 s of
    /// retrying) before a dispatch gives up. A remote link that drops briefly
    /// recovers inside one dispatch; a longer outage is re-armed by the next
    /// failing RPC (the once-per-generation guard clears when a dispatch ends).
    static let defaultReconnectPolicy = ServerConnection.ReconnectPolicy(
        maxAttempts: 6,
        backoff: ServerConnection.ReconnectBackoff(
            initialDelayMilliseconds: 250,
            maxDelayMilliseconds: 5_000,
            multiplier: 2
        )
    )

    func trackWorkspace(_ workspace: NativeServerEventGraphWorkspace, workspaceID: WorkspaceID) {
        workspacesByID[workspaceID] = workspace
        notificationWorkspaceIDs.insert(workspaceID)
    }

    func trackWorkflowRun(_ runID: WorkflowControl.WorkflowRunID, afterSequence: Int? = nil) {
        workflowRunCursors.updateValue(afterSequence, forKey: runID)
    }

    func trackAgentComposer(_ composerID: AgentInteraction.AgentComposerID, workspaceID: WorkspaceID) {
        var composers = agentComposersByWorkspace[workspaceID] ?? []
        composers.insert(composerID)
        agentComposersByWorkspace[workspaceID] = composers
    }

    func handleTransportCloseAndReconnect(
        _ input: ServerConnection.HandleServerTransportCloseInput
    ) async -> Result<NativeServerReconnectProjection, ServerConnection.ServerConnectionError> {
        let closeKey = "\(input.sessionID.rawValue):\(input.generation)"
        let fallbackSession: ServerConnection.Session?
        if handledCloseGenerations.contains(closeKey) {
            fallbackSession = nil
        } else {
            switch await sessionHandler.handleTransportClose(input) {
            case .failure(let error):
                return .failure(error)
            case .success(let session):
                fallbackSession = session
                handledCloseGenerations.insert(closeKey)
            }
        }

        let reconnectInput = ServerConnection.ReconnectServerSessionInput(
            requestID: input.requestID,
            sessionID: input.sessionID,
            policy: reconnectPolicy
        )
        switch await sessionHandler.reconnectSession(reconnectInput) {
        case .failure(let error):
            return .failure(error)
        case .success(let session):
            let projection = await rebuildProjection(
                requestID: input.requestID,
                session: session,
                fallbackSession: fallbackSession
            )
            return .success(projection)
        }
    }

    private func rebuildProjection(
        requestID: RequestID,
        session: ServerConnection.Session,
        fallbackSession: ServerConnection.Session?
    ) async -> NativeServerReconnectProjection {
        let workspaceProjection = await reconnectWorkspaces(requestID: requestID)
        let workflowProjection = await refreshWorkflowRunsAndTimelines(requestID: requestID)
        let notificationProjection = await refreshNotifications(requestID: requestID)
        let agentProjection = await refreshAgentInteractions(requestID: requestID)
        let failures = workspaceProjection.failures + workflowProjection.failures + notificationProjection.failures + agentProjection.failures

        return NativeServerReconnectProjection(
            requestID: requestID,
            session: session.status == .connected ? session : (fallbackSession ?? session),
            workspaces: workspaceProjection.experiences,
            workflowRuns: workflowProjection.runs,
            workflowTimelines: workflowProjection.timelines,
            notifications: notificationProjection.projections,
            agentInteractions: agentProjection.results,
            failures: failures
        )
    }

    private func reconnectWorkspaces(
        requestID: RequestID
    ) async -> (experiences: [WorkspaceCoordinator.WorkspaceExperience], failures: [String]) {
        var failures: [String] = []
        var experiencesByWorkspaceID: [WorkspaceID: WorkspaceCoordinator.WorkspaceExperience] = [:]
        for (workspaceID, tracked) in workspacesByID.sorted(by: { $0.key.rawValue < $1.key.rawValue }) {
            let input = WorkspaceCoordinator.ReconnectWorkspaceExperienceInput(
                requestID: requestID,
                identity: tracked.identity,
                serverSelection: tracked.serverSelection,
                source: .nativeHost
            )
            switch await workspaceHandler.reconnectWorkspaceExperience(input) {
            case .success(let result):
                experiencesByWorkspaceID[workspaceID] = result.experience
                notificationWorkspaceIDs.insert(result.experience.workspace.workspaceID)
            case .failure(let error):
                failures.append("workspace:\(workspaceID.rawValue):\(error.rawValue)")
            }
        }
        return (
            experiencesByWorkspaceID.values.sorted { $0.workspace.workspaceID.rawValue < $1.workspace.workspaceID.rawValue },
            failures
        )
    }

    private func refreshWorkflowRunsAndTimelines(
        requestID: RequestID
    ) async -> (runs: [WorkflowControl.WorkflowRunSnapshot], timelines: [WorkflowControl.WorkflowRunTimeline], failures: [String]) {
        var failures: [String] = []
        switch await workflowRefresher.listWorkflowRuns(WorkflowControl.ListWorkflowRunsInput(requestID: requestID, source: .nativeHost)) {
        case .success(let result):
            for run in result.runs {
                workflowRunsByID[run.runID] = run
                if workflowRunCursors[run.runID] == nil {
                    workflowRunCursors.updateValue(nil, forKey: run.runID)
                }
            }
        case .failure(let error):
            failures.append("workflow:list:\(error)")
        }

        for (runID, cursor) in workflowRunCursors.sorted(by: { $0.key.rawValue < $1.key.rawValue }) {
            let input = WorkflowControl.ObserveWorkflowRunTimelineInput(
                requestID: requestID,
                runID: runID,
                afterSequence: cursor ?? nil,
                source: .nativeHost
            )
            switch await workflowRefresher.observeWorkflowRunTimeline(input) {
            case .success(let result):
                if let workspaceID = workflowRunsByID[runID]?.projectID {
                    for event in result.timeline.events where event.kind == .notificationEmitted {
                        switch await notificationRefresher.recordWorkflowNotification(
                            workspaceID: WorkspaceID(rawValue: workspaceID),
                            event: event,
                            source: .nativeHost
                        ) {
                        case .success:
                            notificationWorkspaceIDs.insert(WorkspaceID(rawValue: workspaceID))
                        case .failure(let error):
                            failures.append("notification:\(workspaceID):record:\(error)")
                        }
                    }
                }
                workflowTimelinesByID[runID] = NativeServerEventIntegrationGraph.mergedTimeline(
                    existing: workflowTimelinesByID[runID],
                    replay: result.timeline
                )
                workflowRunCursors[runID] = result.timeline.nextSequence
            case .failure(let error):
                failures.append("workflow:\(runID.rawValue):\(error)")
            }
        }

        return (
            workflowRunsByID.values.sorted { $0.lastUpdatedAt > $1.lastUpdatedAt },
            workflowTimelinesByID.values.sorted { $0.runID.rawValue < $1.runID.rawValue },
            failures
        )
    }

    private func refreshNotifications(
        requestID: RequestID
    ) async -> (projections: [Notifications.WorkspaceNotificationProjection], failures: [String]) {
        var failures: [String] = []
        var projectionsByWorkspaceID: [WorkspaceID: Notifications.WorkspaceNotificationProjection] = [:]
        for workspaceID in notificationWorkspaceIDs.sorted(by: { $0.rawValue < $1.rawValue }) {
            let input = Notifications.ProjectWorkspaceNotificationsInput(
                requestID: requestID,
                workspaceID: workspaceID,
                source: .nativeHost
            )
            switch await notificationRefresher.projectWorkspaceNotifications(input) {
            case .success(let result):
                projectionsByWorkspaceID[workspaceID] = result.projection
            case .failure(let error):
                failures.append("notification:\(workspaceID.rawValue):\(error)")
            }
        }
        return (
            projectionsByWorkspaceID.values.sorted { $0.workspaceID.rawValue < $1.workspaceID.rawValue },
            failures
        )
    }

    private func refreshAgentInteractions(
        requestID: RequestID
    ) async -> (results: [NativeAgentInteractionRefreshResult], failures: [String]) {
        var failures: [String] = []
        var refreshedByWorkspaceID: [WorkspaceID: NativeAgentInteractionRefreshResult] = [:]
        for (workspaceID, composerIDs) in agentComposersByWorkspace.sorted(by: { $0.key.rawValue < $1.key.rawValue }) {
            let input = NativeAgentInteractionRefreshInput(
                requestID: requestID,
                workspaceID: workspaceID,
                activeComposerIDs: composerIDs.sorted { $0.rawValue < $1.rawValue },
                source: .nativeHost
            )
            switch await agentRefresher.refreshAgentInteractions(input) {
            case .success(let result):
                refreshedByWorkspaceID[workspaceID] = result
                agentComposersByWorkspace[workspaceID] = Set(result.activeComposerIDs)
            case .failure(let error):
                failures.append("agent:\(workspaceID.rawValue):\(error.rawValue)")
            }
        }
        return (
            refreshedByWorkspaceID.values.sorted { $0.workspaceID.rawValue < $1.workspaceID.rawValue },
            failures
        )
    }

    private static func mergedTimeline(
        existing: WorkflowControl.WorkflowRunTimeline?,
        replay: WorkflowControl.WorkflowRunTimeline
    ) -> WorkflowControl.WorkflowRunTimeline {
        guard let existing else {
            return replay
        }
        var eventsByID = Dictionary(uniqueKeysWithValues: existing.events.map { ($0.eventID, $0) })
        for event in replay.events {
            eventsByID[event.eventID] = event
        }
        let events = eventsByID.values.sorted {
            if $0.sequence == $1.sequence {
                return $0.eventID.rawValue < $1.eventID.rawValue
            }
            return $0.sequence < $1.sequence
        }
        return WorkflowControl.WorkflowRunTimeline(
            runID: replay.runID,
            events: events,
            projectedStatus: replay.projectedStatus,
            nextSequence: replay.nextSequence ?? existing.nextSequence,
            replayedFromSequence: replay.replayedFromSequence,
            replayIncludesHistoricalEvents: existing.replayIncludesHistoricalEvents || replay.replayIncludesHistoricalEvents
        )
    }
}

extension NativeServerEventIntegrationGraph: NativeServerEventReconnectIntegrating {
    func reconnectWorkspaceFromServerEvent(
        _ input: NativeServerWorkspaceReconnectEventInput
    ) async -> Result<NativeServerReconnectProjection, ServerConnection.ServerConnectionError> {
        let identity = WorkspaceIndex.WorkspaceIdentity(
            kind: .remote,
            workspaceID: input.workspaceID,
            serverID: input.serverID
        )
        let endpoint = ServerConnection.Endpoint(
            kind: .remote,
            transport: .webSocketURL(input.serverURL),
            displayName: input.serverID
        )
        trackWorkspace(
            NativeServerEventGraphWorkspace(
                identity: identity,
                serverSelection: .remote(endpoint)
            ),
            workspaceID: input.workspaceID
        )
        return await handleTransportCloseAndReconnect(ServerConnection.HandleServerTransportCloseInput(
            requestID: input.requestID,
            sessionID: input.sessionID,
            generation: input.generation,
            closeCode: .serverRestart,
            reason: "server event reconnect"
        ))
    }
}

struct NativeServerSessionReconnectActions: NativeServerSessionReconnectHandling {
    let closeAction: ServerConnection.HandleServerTransportClose
    let reconnectAction: ServerConnection.ReconnectServerSession

    func handleTransportClose(_ input: ServerConnection.HandleServerTransportCloseInput) async -> Result<ServerConnection.Session, ServerConnection.ServerConnectionError> {
        await closeAction.run(input).map(\.session)
    }

    func reconnectSession(_ input: ServerConnection.ReconnectServerSessionInput) async -> Result<ServerConnection.Session, ServerConnection.ServerConnectionError> {
        await reconnectAction.run(input).map(\.session)
    }
}

struct NativeWorkspaceExperienceReconnectAction: NativeWorkspaceExperienceReconnectHandling {
    let action: WorkspaceCoordinator.ReconnectWorkspaceExperience

    func reconnectWorkspaceExperience(_ input: WorkspaceCoordinator.ReconnectWorkspaceExperienceInput) async -> Result<WorkspaceCoordinator.ReconnectWorkspaceExperienceResult, WorkspaceCoordinator.WorkspaceCoordinatorError> {
        await action.run(input)
    }
}

struct NativeWorkflowProjectionRefreshActions: NativeWorkflowProjectionRefreshing {
    let listAction: WorkflowControl.ListWorkflowRuns
    let observeAction: WorkflowControl.ObserveWorkflowRunTimeline

    func listWorkflowRuns(_ input: WorkflowControl.ListWorkflowRunsInput) async -> Result<WorkflowControl.ListWorkflowRunsResult, WorkflowControl.WorkflowControlError> {
        await listAction.run(input)
    }

    func observeWorkflowRunTimeline(_ input: WorkflowControl.ObserveWorkflowRunTimelineInput) async -> Result<WorkflowControl.ObserveWorkflowRunTimelineResult, WorkflowControl.WorkflowControlError> {
        await observeAction.run(input)
    }
}

struct NativeNotificationProjectionRefreshAction: NativeNotificationProjectionRefreshing {
    let createAction: Notifications.CreateNotification?
    let projectAction: Notifications.ProjectWorkspaceNotifications

    init(clock: any Notifications.NotificationsClock, store: any Notifications.NotificationStore) {
        createAction = Notifications.CreateNotification(clock: clock, store: store)
        projectAction = Notifications.ProjectWorkspaceNotifications(clock: clock, store: store)
    }

    init(action: Notifications.ProjectWorkspaceNotifications) {
        createAction = nil
        projectAction = action
    }

    func recordWorkflowNotification(
        workspaceID: WorkspaceID,
        event: WorkflowControl.WorkflowTimelineEvent,
        source: ActionSource
    ) async -> Result<Notifications.CreateNotificationResult, Notifications.NotificationsError> {
        guard let createAction else {
            return .failure(.storeFailure("workflow notification create action unavailable"))
        }
        return await createAction.run(Notifications.CreateNotificationInput(
            requestID: RequestID(rawValue: "workflow-notification-\(event.eventID.rawValue)"),
            workspaceID: workspaceID,
            source: .workflow(runID: event.runID.rawValue),
            severity: NativeNotificationProjectionRefreshAction.severity(for: event),
            title: event.title,
            message: event.body ?? event.title,
            dedupeKey: Notifications.NotificationDedupeKey(rawValue: "workflow:\(event.eventID.rawValue)"),
            sourceAction: source
        ))
    }

    func projectWorkspaceNotifications(_ input: Notifications.ProjectWorkspaceNotificationsInput) async -> Result<Notifications.ProjectWorkspaceNotificationsResult, Notifications.NotificationsError> {
        await projectAction.run(input)
    }

    private static func severity(for event: WorkflowControl.WorkflowTimelineEvent) -> Notifications.NotificationSeverity {
        guard case .object(let payload) = event.payload,
              case .string(let level)? = payload["level"]
        else {
            return .info
        }
        switch level {
        case "critical", "error":
            return .critical
        case "warning", "warn":
            return .warning
        default:
            return .info
        }
    }
}
