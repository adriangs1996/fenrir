import Foundation
import FenrirNativeShared

public extension WorkflowControl {
    struct WorkflowID: FenrirID, ExpressibleByStringLiteral {
        public let rawValue: String

        public init(rawValue: String) {
            self.rawValue = rawValue
        }

        public init(stringLiteral value: String) {
            self.init(rawValue: value)
        }
    }

    struct WorkflowRunID: FenrirID, ExpressibleByStringLiteral {
        public let rawValue: String

        public init(rawValue: String) {
            self.rawValue = rawValue
        }

        public init(stringLiteral value: String) {
            self.init(rawValue: value)
        }
    }

    struct WorkflowEventID: FenrirID, ExpressibleByStringLiteral {
        public let rawValue: String

        public init(rawValue: String) {
            self.rawValue = rawValue
        }

        public init(stringLiteral value: String) {
            self.init(rawValue: value)
        }
    }

    enum WorkflowControlError: Error, Codable, Equatable, Sendable {
        case unavailable
        case runNotFound(WorkflowRunID)
        case commandRejected(String)
        case serverFailure(String)
    }

    enum WorkflowRunStatus: String, Codable, Equatable, Sendable {
        case queued
        case running
        case paused
        case completed
        case failed
        case cancelled
        case interrupted

        public var isTerminal: Bool {
            switch self {
            case .completed, .failed, .cancelled, .interrupted:
                true
            case .queued, .running, .paused:
                false
            }
        }
    }

    enum WorkflowRunTrigger: String, Codable, Equatable, Sendable {
        case manual
        case thread
        case schedule
        case api
    }

    struct WorkflowControlCapabilities: Codable, Equatable, Sendable {
        public let canPauseRuns: Bool
        public let canStopRuns: Bool
        public let canRerunRuns: Bool
        public let canRespondToInputRequests: Bool
        public let canObserveEventStream: Bool

        public init(
            canPauseRuns: Bool = false,
            canStopRuns: Bool = true,
            canRerunRuns: Bool = true,
            canRespondToInputRequests: Bool = true,
            canObserveEventStream: Bool = false
        ) {
            self.canPauseRuns = canPauseRuns
            self.canStopRuns = canStopRuns
            self.canRerunRuns = canRerunRuns
            self.canRespondToInputRequests = canRespondToInputRequests
            self.canObserveEventStream = canObserveEventStream
        }

        public static let currentServerDefault = WorkflowControlCapabilities(
            canPauseRuns: false,
            canStopRuns: true,
            canRerunRuns: true,
            canRespondToInputRequests: true,
            canObserveEventStream: true
        )

        public static let unavailable = WorkflowControlCapabilities(
            canPauseRuns: false,
            canStopRuns: false,
            canRerunRuns: false,
            canRespondToInputRequests: false,
            canObserveEventStream: false
        )
    }

    enum WorkflowInputRequestStatus: String, Codable, Equatable, Sendable {
        case pending
        case resolved
        case cancelled
    }

    enum WorkflowEventKind: String, Codable, Equatable, Sendable {
        case runStarted = "workflow.run.started"
        case runPaused = "workflow.run.paused"
        case runResumed = "workflow.run.resumed"
        case runCompleted = "workflow.run.completed"
        case runFailed = "workflow.run.failed"
        case runCancelled = "workflow.run.cancelled"
        case runInterrupted = "workflow.run.interrupted"
        case stepStarted = "workflow.step.started"
        case stepCompleted = "workflow.step.completed"
        case stepFailed = "workflow.step.failed"
        case stepSkipped = "workflow.step.skipped"
        case agentCreated = "workflow.agent.created"
        case agentMessageSent = "workflow.agent.message.sent"
        case agentMessageCompleted = "workflow.agent.message.completed"
        case capabilityCalled = "workflow.capability.called"
        case promptBuilt = "workflow.prompt.built"
        case memorySelected = "workflow.memory.selected"
        case memoryRemembered = "workflow.memory.remembered"
        case memorySuppressed = "workflow.memory.suppressed"
        case stateUpdated = "workflow.state.updated"
        case noteAdded = "workflow.note.added"
        case taskProposed = "workflow.task.proposed"
        case taskAccepted = "workflow.task.accepted"
        case taskRejected = "workflow.task.rejected"
        case taskStarted = "workflow.task.started"
        case taskCompleted = "workflow.task.completed"
        case taskFailed = "workflow.task.failed"
        case inputRequested = "workflow.input.requested"
        case inputResolved = "workflow.input.resolved"
        case inputCancelled = "workflow.input.cancelled"
        case notificationEmitted = "workflow.notification.emitted"
    }

    enum WorkflowJSONValue: Codable, Equatable, Sendable {
        case null
        case bool(Bool)
        case number(Double)
        case string(String)
        case array([WorkflowJSONValue])
        case object([String: WorkflowJSONValue])

        public init(from decoder: Decoder) throws {
            let container = try decoder.singleValueContainer()
            if container.decodeNil() {
                self = .null
            } else if let value = try? container.decode(Bool.self) {
                self = .bool(value)
            } else if let value = try? container.decode(Double.self) {
                self = .number(value)
            } else if let value = try? container.decode(String.self) {
                self = .string(value)
            } else if let value = try? container.decode([WorkflowJSONValue].self) {
                self = .array(value)
            } else {
                self = .object(try container.decode([String: WorkflowJSONValue].self))
            }
        }

        public func encode(to encoder: Encoder) throws {
            var container = encoder.singleValueContainer()
            switch self {
            case .null:
                try container.encodeNil()
            case let .bool(value):
                try container.encode(value)
            case let .number(value):
                try container.encode(value)
            case let .string(value):
                try container.encode(value)
            case let .array(value):
                try container.encode(value)
            case let .object(value):
                try container.encode(value)
            }
        }
    }

    struct ModuleSummary: Codable, Equatable, Sendable {
        public let moduleName: String
        public let registeredAt: FenrirTimestamp

        public init(moduleName: String = "WorkflowControl", registeredAt: FenrirTimestamp) {
            self.moduleName = moduleName
            self.registeredAt = registeredAt
        }
    }

    struct DescribeWorkflowControlModuleInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let source: ActionSource

        public init(requestID: RequestID, source: ActionSource) {
            self.requestID = requestID
            self.source = source
        }
    }

    struct DescribeWorkflowControlModuleResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let summary: ModuleSummary
        public let timestamp: FenrirTimestamp

        public init(requestID: RequestID, summary: ModuleSummary, timestamp: FenrirTimestamp) {
            self.requestID = requestID
            self.summary = summary
            self.timestamp = timestamp
        }
    }

    struct WorkflowRunSnapshot: Codable, Equatable, Sendable {
        public let runID: WorkflowRunID
        public let workflowID: WorkflowID
        public let projectID: String
        public let originThreadID: String
        public let trigger: WorkflowRunTrigger?
        public let name: String
        public let args: WorkflowJSONValue
        public let runtimeContext: WorkflowJSONValue?
        public let status: WorkflowRunStatus
        public let summary: String?
        public let startedAt: FenrirTimestamp
        public let completedAt: FenrirTimestamp?
        public let lastUpdatedAt: FenrirTimestamp
        public let steps: [WorkflowStepSnapshot]
        public let agents: [WorkflowAgentSnapshot]
        public let tasks: [WorkflowTaskSnapshot]
        public let inputRequests: [WorkflowInputRequestSnapshot]

        public init(
            runID: WorkflowRunID,
            workflowID: WorkflowID,
            projectID: String,
            originThreadID: String,
            trigger: WorkflowRunTrigger?,
            name: String,
            args: WorkflowJSONValue = .object([:]),
            runtimeContext: WorkflowJSONValue? = nil,
            status: WorkflowRunStatus,
            summary: String? = nil,
            startedAt: FenrirTimestamp,
            completedAt: FenrirTimestamp? = nil,
            lastUpdatedAt: FenrirTimestamp,
            steps: [WorkflowStepSnapshot] = [],
            agents: [WorkflowAgentSnapshot] = [],
            tasks: [WorkflowTaskSnapshot] = [],
            inputRequests: [WorkflowInputRequestSnapshot] = []
        ) {
            self.runID = runID
            self.workflowID = workflowID
            self.projectID = projectID
            self.originThreadID = originThreadID
            self.trigger = trigger
            self.name = name
            self.args = args
            self.runtimeContext = runtimeContext
            self.status = status
            self.summary = summary
            self.startedAt = startedAt
            self.completedAt = completedAt
            self.lastUpdatedAt = lastUpdatedAt
            self.steps = steps
            self.agents = agents
            self.tasks = tasks
            self.inputRequests = inputRequests
        }

        enum CodingKeys: String, CodingKey {
            case runID = "runId"
            case workflowID = "workflowId"
            case projectID = "projectId"
            case originThreadID = "originThreadId"
            case trigger
            case name
            case args
            case runtimeContext
            case status
            case summary
            case startedAt
            case completedAt
            case lastUpdatedAt
            case steps
            case agents
            case tasks
            case inputRequests
        }
    }

    struct WorkflowStepSnapshot: Codable, Equatable, Identifiable, Sendable {
        public let stepID: String
        public let name: String
        public let status: String
        public let summary: String?

        public init(stepID: String, name: String, status: String, summary: String? = nil) {
            self.stepID = stepID
            self.name = name
            self.status = status
            self.summary = summary
        }

        public var id: String { stepID }

        enum CodingKeys: String, CodingKey {
            case stepID = "stepId"
            case name = "stepKey"
            case status
            case summary = "error"
        }
    }

    struct WorkflowAgentSnapshot: Codable, Equatable, Identifiable, Sendable {
        public let agentID: String
        public let name: String
        public let role: String
        public let status: String

        public init(agentID: String, name: String, role: String, status: String) {
            self.agentID = agentID
            self.name = name
            self.role = role
            self.status = status
        }

        public var id: String { agentID }

        enum CodingKeys: String, CodingKey {
            case agentID = "agentId"
            case name
            case role
            case status
        }
    }

    struct WorkflowTaskSnapshot: Codable, Equatable, Identifiable, Sendable {
        public let taskID: String
        public let title: String
        public let status: String

        public init(taskID: String, title: String, status: String) {
            self.taskID = taskID
            self.title = title
            self.status = status
        }

        public var id: String { taskID }

        enum CodingKeys: String, CodingKey {
            case taskID = "taskId"
            case title
            case status
        }
    }

    struct WorkflowInputRequestID: FenrirID, ExpressibleByStringLiteral {
        public let rawValue: String

        public init(rawValue: String) {
            self.rawValue = rawValue
        }

        public init(stringLiteral value: String) {
            self.init(rawValue: value)
        }
    }

    struct WorkflowInputRequestSnapshot: Codable, Equatable, Identifiable, Sendable {
        public let requestID: WorkflowInputRequestID
        public let runID: WorkflowRunID
        public let title: String
        public let body: String?
        public let fields: WorkflowJSONValue
        public let status: WorkflowInputRequestStatus
        public let response: WorkflowJSONValue?
        public let createdAt: FenrirTimestamp
        public let resolvedAt: FenrirTimestamp?

        public init(
            requestID: WorkflowInputRequestID,
            runID: WorkflowRunID,
            title: String,
            body: String? = nil,
            fields: WorkflowJSONValue = .null,
            status: WorkflowInputRequestStatus,
            response: WorkflowJSONValue? = nil,
            createdAt: FenrirTimestamp,
            resolvedAt: FenrirTimestamp? = nil
        ) {
            self.requestID = requestID
            self.runID = runID
            self.title = title
            self.body = body
            self.fields = fields
            self.status = status
            self.response = response
            self.createdAt = createdAt
            self.resolvedAt = resolvedAt
        }

        public var id: WorkflowInputRequestID { requestID }

        enum CodingKeys: String, CodingKey {
            case requestID = "requestId"
            case runID = "runId"
            case title
            case body
            case fields
            case status
            case response
            case createdAt
            case resolvedAt
        }
    }

    struct WorkflowTimelineEvent: Codable, Equatable, Sendable {
        public let eventID: WorkflowEventID
        public let workflowID: WorkflowID
        public let runID: WorkflowRunID
        public let kind: WorkflowEventKind
        public let title: String
        public let body: String?
        public let payload: WorkflowJSONValue
        public let sequence: Int
        public let createdAt: FenrirTimestamp

        public init(
            eventID: WorkflowEventID,
            workflowID: WorkflowID,
            runID: WorkflowRunID,
            kind: WorkflowEventKind,
            title: String,
            body: String? = nil,
            payload: WorkflowJSONValue = .object([:]),
            sequence: Int,
            createdAt: FenrirTimestamp
        ) {
            self.eventID = eventID
            self.workflowID = workflowID
            self.runID = runID
            self.kind = kind
            self.title = title
            self.body = body
            self.payload = payload
            self.sequence = sequence
            self.createdAt = createdAt
        }

        enum CodingKeys: String, CodingKey {
            case eventID = "eventId"
            case workflowID = "workflowId"
            case runID = "runId"
            case kind
            case title
            case body
            case payload
            case sequence
            case createdAt
        }
    }

    struct WorkflowEventStreamFilter: Codable, Equatable, Sendable {
        public let projectID: String?
        public let runIDs: [WorkflowRunID]

        public init(projectID: String? = nil, runIDs: [WorkflowRunID] = []) {
            self.projectID = projectID
            self.runIDs = runIDs
        }
    }

    struct WorkflowEventStreamItem: Codable, Equatable, Sendable {
        public enum Kind: String, Codable, Equatable, Sendable {
            case runChanged = "workflow.run.changed"
            case eventAppended = "workflow.event.appended"
        }

        public let kind: Kind
        public let run: WorkflowRunSnapshot?
        public let event: WorkflowTimelineEvent?

        public init(kind: Kind, run: WorkflowRunSnapshot? = nil, event: WorkflowTimelineEvent? = nil) {
            self.kind = kind
            self.run = run
            self.event = event
        }

        public var runID: WorkflowRunID? {
            run?.runID ?? event?.runID
        }

        public var projectID: String? {
            run?.projectID
        }
    }

    struct ObserveWorkflowEventStreamInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let filter: WorkflowEventStreamFilter
        public let source: ActionSource

        public init(requestID: RequestID, filter: WorkflowEventStreamFilter = .init(), source: ActionSource) {
            self.requestID = requestID
            self.filter = filter
            self.source = source
        }
    }

    struct WorkflowRunListFilter: Codable, Equatable, Sendable {
        public let projectID: String?
        public let statuses: [WorkflowRunStatus]
        public let includeTerminal: Bool

        public init(
            projectID: String? = nil,
            statuses: [WorkflowRunStatus] = [],
            includeTerminal: Bool = true
        ) {
            self.projectID = projectID
            self.statuses = statuses
            self.includeTerminal = includeTerminal
        }
    }

    struct WorkflowRunTimeline: Codable, Equatable, Sendable {
        public let runID: WorkflowRunID
        public let events: [WorkflowTimelineEvent]
        public let projectedStatus: WorkflowRunStatus?
        public let nextSequence: Int?
        public let replayedFromSequence: Int?
        public let replayIncludesHistoricalEvents: Bool

        public init(
            runID: WorkflowRunID,
            events: [WorkflowTimelineEvent],
            projectedStatus: WorkflowRunStatus?,
            nextSequence: Int?,
            replayedFromSequence: Int?,
            replayIncludesHistoricalEvents: Bool
        ) {
            self.runID = runID
            self.events = events
            self.projectedStatus = projectedStatus
            self.nextSequence = nextSequence
            self.replayedFromSequence = replayedFromSequence
            self.replayIncludesHistoricalEvents = replayIncludesHistoricalEvents
        }
    }

    struct WorkflowRunProjection: Codable, Equatable, Sendable {
        public let run: WorkflowRunSnapshot
        public let status: WorkflowRunStatus
        public let timeline: [WorkflowTimelineEvent]
        public let isServerOwnedExecution: Bool
        public let canPause: Bool
        public let canStop: Bool
        public let canRerun: Bool

        public init(
            run: WorkflowRunSnapshot,
            status: WorkflowRunStatus,
            timeline: [WorkflowTimelineEvent],
            isServerOwnedExecution: Bool = true,
            canPause: Bool,
            canStop: Bool,
            canRerun: Bool
        ) {
            self.run = run
            self.status = status
            self.timeline = timeline
            self.isServerOwnedExecution = isServerOwnedExecution
            self.canPause = canPause
            self.canStop = canStop
            self.canRerun = canRerun
        }
    }

    struct ListWorkflowRunsInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let filter: WorkflowRunListFilter
        public let source: ActionSource

        public init(requestID: RequestID, filter: WorkflowRunListFilter = .init(), source: ActionSource) {
            self.requestID = requestID
            self.filter = filter
            self.source = source
        }
    }

    struct ListWorkflowRunsResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let runs: [WorkflowRunSnapshot]
        public let timestamp: FenrirTimestamp

        public init(requestID: RequestID, runs: [WorkflowRunSnapshot], timestamp: FenrirTimestamp) {
            self.requestID = requestID
            self.runs = runs
            self.timestamp = timestamp
        }
    }

    struct ObserveWorkflowRunTimelineInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let runID: WorkflowRunID
        public let afterSequence: Int?
        public let source: ActionSource

        public init(requestID: RequestID, runID: WorkflowRunID, afterSequence: Int? = nil, source: ActionSource) {
            self.requestID = requestID
            self.runID = runID
            self.afterSequence = afterSequence
            self.source = source
        }
    }

    struct ObserveWorkflowRunTimelineResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let timeline: WorkflowRunTimeline
        public let timestamp: FenrirTimestamp

        public init(requestID: RequestID, timeline: WorkflowRunTimeline, timestamp: FenrirTimestamp) {
            self.requestID = requestID
            self.timeline = timeline
            self.timestamp = timestamp
        }
    }

    struct PauseWorkflowRunInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let runID: WorkflowRunID
        public let source: ActionSource

        public init(requestID: RequestID, runID: WorkflowRunID, source: ActionSource) {
            self.requestID = requestID
            self.runID = runID
            self.source = source
        }
    }

    struct StopWorkflowRunInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let runID: WorkflowRunID
        public let source: ActionSource

        public init(requestID: RequestID, runID: WorkflowRunID, source: ActionSource) {
            self.requestID = requestID
            self.runID = runID
            self.source = source
        }
    }

    struct RerunWorkflowRunInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let runID: WorkflowRunID
        public let source: ActionSource

        public init(requestID: RequestID, runID: WorkflowRunID, source: ActionSource) {
            self.requestID = requestID
            self.runID = runID
            self.source = source
        }
    }

    struct RespondToWorkflowInputRequestInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let runID: WorkflowRunID
        public let inputRequestID: WorkflowInputRequestID
        public let response: WorkflowJSONValue
        public let source: ActionSource

        public init(
            requestID: RequestID,
            runID: WorkflowRunID,
            inputRequestID: WorkflowInputRequestID,
            response: WorkflowJSONValue,
            source: ActionSource
        ) {
            self.requestID = requestID
            self.runID = runID
            self.inputRequestID = inputRequestID
            self.response = response
            self.source = source
        }
    }

    struct ProjectWorkflowRunStateInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let runID: WorkflowRunID
        public let source: ActionSource

        public init(requestID: RequestID, runID: WorkflowRunID, source: ActionSource) {
            self.requestID = requestID
            self.runID = runID
            self.source = source
        }
    }

    struct WorkflowRunCommandResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let run: WorkflowRunSnapshot
        public let timestamp: FenrirTimestamp

        public init(requestID: RequestID, run: WorkflowRunSnapshot, timestamp: FenrirTimestamp) {
            self.requestID = requestID
            self.run = run
            self.timestamp = timestamp
        }
    }

    struct ProjectWorkflowRunStateResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let projection: WorkflowRunProjection
        public let timestamp: FenrirTimestamp

        public init(requestID: RequestID, projection: WorkflowRunProjection, timestamp: FenrirTimestamp) {
            self.requestID = requestID
            self.projection = projection
            self.timestamp = timestamp
        }
    }

    enum Event: Codable, Equatable, Sendable {
        case moduleRegistered(String)
        case runAttentionRequested(WorkflowRunID)
    }
}
