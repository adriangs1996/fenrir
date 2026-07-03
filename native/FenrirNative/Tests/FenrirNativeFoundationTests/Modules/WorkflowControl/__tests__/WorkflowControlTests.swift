import Foundation
import AppKit
import Testing
import FenrirNativeShared
import WorkflowControl

@Suite("WorkflowControl module registration")
struct WorkflowControlTests {
    @Test("DescribeWorkflowControlModule exposes the WorkflowControl target")
    func describeModule() async throws {
        let action = WorkflowControl.DescribeWorkflowControlModule(clock: FixedClock())

        let result = try await action.run(.init(requestID: "workflow-control", source: .test)).get()

        #expect(result.summary.moduleName == "WorkflowControl")
        #expect(result.requestID == "workflow-control")
    }

    @Test("ProjectWorkflowRunState applies server timeline status transitions")
    func projectWorkflowRunStateAppliesStatusTransitions() async throws {
        let server = WorkflowServerFake(
            runs: [
                workflowRun(status: .queued)
            ],
            events: [
                workflowEvent(kind: .runPaused, sequence: 2),
                workflowEvent(kind: .runStarted, sequence: 1),
                workflowEvent(kind: .runResumed, sequence: 3),
                workflowEvent(kind: .runCompleted, sequence: 4)
            ]
        )
        let action = WorkflowControl.ProjectWorkflowRunState(clock: FixedClock(), serverClient: server)

        let result = try await action.run(.init(requestID: "project", runID: "run-1", source: .test)).get()

        #expect(result.projection.status == .completed)
        #expect(result.projection.canPause == false)
        #expect(result.projection.canStop == false)
        #expect(result.projection.canRerun)
        #expect(result.projection.isServerOwnedExecution)
    }

    @Test("ProjectWorkflowRunState does not regress terminal server snapshot status")
    func projectWorkflowRunStateDoesNotRegressTerminalSnapshotStatus() async throws {
        let server = WorkflowServerFake(
            runs: [
                workflowRun(status: .completed)
            ],
            events: [
                workflowEvent(kind: .runStarted, sequence: 1),
                workflowEvent(kind: .runPaused, sequence: 2)
            ]
        )
        let action = WorkflowControl.ProjectWorkflowRunState(clock: FixedClock(), serverClient: server)

        let result = try await action.run(.init(requestID: "project-terminal", runID: "run-1", source: .test)).get()

        #expect(result.projection.status == .completed)
        #expect(!result.projection.canPause)
        #expect(!result.projection.canStop)
        #expect(result.projection.canRerun)
    }

    @Test("ObserveWorkflowRunTimeline returns events ordered by sequence")
    func observeTimelineOrdersEventsBySequence() async throws {
        let server = WorkflowServerFake(
            runs: [workflowRun(status: .running)],
            events: [
                workflowEvent(eventID: "event-3", kind: .stepCompleted, sequence: 3),
                workflowEvent(eventID: "event-1", kind: .runStarted, sequence: 1),
                workflowEvent(eventID: "event-2", kind: .stepStarted, sequence: 2)
            ]
        )
        let action = WorkflowControl.ObserveWorkflowRunTimeline(clock: FixedClock(), serverClient: server)

        let result = try await action.run(.init(requestID: "timeline", runID: "run-1", source: .test)).get()

        #expect(result.timeline.events.map(\.eventID.rawValue) == ["event-1", "event-2", "event-3"])
        #expect(result.timeline.nextSequence == 4)
        #expect(result.timeline.projectedStatus == .running)
    }

    @Test("ObserveWorkflowRunTimeline replays after reconnect cursor")
    func observeTimelineReplaysAfterReconnectCursor() async throws {
        let server = WorkflowServerFake(
            runs: [workflowRun(status: .running)],
            events: [
                workflowEvent(eventID: "event-1", kind: .runStarted, sequence: 1),
                workflowEvent(eventID: "event-2", kind: .stepStarted, sequence: 2),
                workflowEvent(eventID: "event-3", kind: .stepCompleted, sequence: 3)
            ]
        )
        let action = WorkflowControl.ObserveWorkflowRunTimeline(clock: FixedClock(), serverClient: server)

        let result = try await action.run(.init(
            requestID: "reconnect",
            runID: "run-1",
            afterSequence: 1,
            source: .test
        )).get()

        #expect(result.timeline.events.map(\.sequence) == [2, 3])
        #expect(result.timeline.replayedFromSequence == 1)
        #expect(!result.timeline.replayIncludesHistoricalEvents)
        #expect(result.timeline.nextSequence == 4)
    }

    @Test("ObserveWorkflowRunTimeline does not regress terminal server snapshot status")
    func observeTimelineDoesNotRegressTerminalSnapshotStatus() async throws {
        let server = WorkflowServerFake(
            runs: [workflowRun(status: .failed)],
            events: [
                workflowEvent(eventID: "event-1", kind: .runStarted, sequence: 1),
                workflowEvent(eventID: "event-2", kind: .runPaused, sequence: 2)
            ]
        )
        let action = WorkflowControl.ObserveWorkflowRunTimeline(clock: FixedClock(), serverClient: server)

        let result = try await action.run(.init(requestID: "observe-terminal", runID: "run-1", source: .test)).get()

        #expect(result.timeline.projectedStatus == .failed)
        #expect(result.timeline.events.map(\.sequence) == [1, 2])
    }

    @Test("WorkflowRunSnapshot decodes server ISO timestamp strings")
    func workflowRunSnapshotDecodesServerISOTimestampStrings() throws {
        let payload = Data("""
        {
          "runId": "run-iso",
          "workflowId": "workflow-iso",
          "projectId": "project-1",
          "originThreadId": "thread-1",
          "trigger": "manual",
          "name": "ISO workflow",
          "args": {},
          "runtimeContext": null,
          "status": "running",
          "summary": null,
          "startedAt": "2026-01-01T00:00:00Z",
          "completedAt": null,
          "lastUpdatedAt": "2026-01-01T00:00:01.250Z",
          "steps": [],
          "agents": [],
          "tasks": [],
          "inputRequests": []
        }
        """.utf8)

        let run = try JSONDecoder().decode(WorkflowControl.WorkflowRunSnapshot.self, from: payload)

        #expect(run.startedAt.date.timeIntervalSince1970 == 1_767_225_600)
        #expect(run.lastUpdatedAt.date.timeIntervalSince1970 == 1_767_225_601.25)
    }

    @Test("ListWorkflowRuns filters terminal runs and orders by server update time")
    func listWorkflowRunsFiltersAndOrders() async throws {
        let server = WorkflowServerFake(runs: [
            workflowRun(runID: "completed", status: .completed, updatedAtSeconds: 300),
            workflowRun(runID: "running-newer", status: .running, updatedAtSeconds: 200),
            workflowRun(runID: "running-older", status: .running, updatedAtSeconds: 100)
        ])
        let action = WorkflowControl.ListWorkflowRuns(clock: FixedClock(), serverClient: server)

        let result = try await action.run(.init(
            requestID: "list",
            filter: .init(includeTerminal: false),
            source: .test
        )).get()

        #expect(result.runs.map(\.runID.rawValue) == ["running-newer", "running-older"])
    }

    @Test("PauseWorkflowRun surfaces typed server command failures")
    func pauseWorkflowRunSurfacesCommandFailures() async throws {
        let server = WorkflowServerFake(
            runs: [workflowRun(status: .completed)],
            commandError: .commandRejected("completed runs cannot be paused")
        )
        let action = WorkflowControl.PauseWorkflowRun(clock: FixedClock(), serverClient: server)

        let result = await action.run(.init(requestID: "pause", runID: "run-1", source: .test))

        #expect(result == .failure(.commandRejected("completed runs cannot be paused")))
    }

    @Test("RespondToWorkflowInputRequest routes response through server-owned run state")
    func respondToWorkflowInputRequestRoutesThroughServer() async throws {
        let input = WorkflowControl.WorkflowInputRequestSnapshot(
            requestID: "input-1",
            runID: "run-1",
            title: "Approve",
            status: .pending,
            createdAt: FixedClock().timestamp
        )
        let server = WorkflowServerFake(runs: [
            workflowRun(status: .paused, inputRequests: [input])
        ])
        let action = WorkflowControl.RespondToWorkflowInputRequest(clock: FixedClock(), serverClient: server)

        let result = try await action.run(.init(
            requestID: "respond",
            runID: "run-1",
            inputRequestID: "input-1",
            response: .object(["approved": .bool(true)]),
            source: .test
        )).get()

        #expect(result.run.status == .running)
        #expect(result.run.inputRequests.first?.status == .resolved)
        #expect(await server.responses == ["run-1:input-1"])
    }

    @Test("ProjectWorkflowRunState respects server command capabilities")
    func projectWorkflowRunStateRespectsServerCapabilities() async throws {
        let server = WorkflowServerFake(runs: [workflowRun(status: .running)])
        let action = WorkflowControl.ProjectWorkflowRunState(clock: FixedClock(), serverClient: server)

        let result = try await action.run(.init(requestID: "project-capabilities", runID: "run-1", source: .test)).get()

        #expect(!result.projection.canPause)
        #expect(result.projection.canStop)
        #expect(!result.projection.canRerun)
    }

    @Test("ObserveWorkflowEventStream filters live workflow stream items")
    func observeWorkflowEventStreamFiltersItems() async throws {
        let stream = WorkflowEventStreamFake(items: [
            WorkflowControl.WorkflowEventStreamItem(kind: .runChanged, run: workflowRun(runID: "run-1", status: .running)),
            WorkflowControl.WorkflowEventStreamItem(kind: .runChanged, run: workflowRun(runID: "run-b", status: .running)),
            WorkflowControl.WorkflowEventStreamItem(kind: .eventAppended, event: workflowEvent(eventID: "event-a", kind: .stepStarted, sequence: 1)),
            WorkflowControl.WorkflowEventStreamItem(kind: .eventAppended, event: WorkflowControl.WorkflowTimelineEvent(
                eventID: "event-b",
                workflowID: "workflow-1",
                runID: "run-b",
                kind: .stepStarted,
                title: WorkflowControl.WorkflowEventKind.stepStarted.rawValue,
                sequence: 2,
                createdAt: FenrirTimestamp(Date(timeIntervalSince1970: 2))
            ))
        ])
        let action = WorkflowControl.ObserveWorkflowEventStream(eventStream: stream)
        let output = await action.run(.init(
            requestID: "stream",
            filter: WorkflowControl.WorkflowEventStreamFilter(runIDs: ["run-1"]),
            source: .test
        ))
        var received: [WorkflowControl.WorkflowEventStreamItem] = []

        for try await item in output {
            received.append(item)
        }

        #expect(received.map { $0.runID?.rawValue } == ["run-1", "run-1"])
        #expect(await stream.filters == [WorkflowControl.WorkflowEventStreamFilter(runIDs: ["run-1"])])
    }

    @Test("ObserveWorkflowEventStream allows event-only items through project filters")
    func observeWorkflowEventStreamAllowsEventOnlyItemsThroughProjectFilters() async throws {
        let stream = WorkflowEventStreamFake(items: [
            WorkflowControl.WorkflowEventStreamItem(kind: .eventAppended, event: workflowEvent(eventID: "event-projectless", kind: .stepStarted, sequence: 1)),
            WorkflowControl.WorkflowEventStreamItem(kind: .runChanged, run: workflowRun(runID: "run-other", status: .running))
        ])
        let action = WorkflowControl.ObserveWorkflowEventStream(eventStream: stream)
        let output = await action.run(.init(
            requestID: "stream-project",
            filter: WorkflowControl.WorkflowEventStreamFilter(projectID: "project-1"),
            source: .test
        ))
        var received: [WorkflowControl.WorkflowEventStreamItem] = []

        for try await item in output {
            received.append(item)
        }

        #expect(received.map { $0.runID?.rawValue } == ["run-1", "run-other"])
    }

    @Test("WorkflowControlView renders runs, agents, tasks, inputs, and timeline replay")
    @MainActor
    func workflowControlViewRendersWorkflowState() {
        let input = WorkflowControl.WorkflowInputRequestSnapshot(
            requestID: "input-1",
            runID: "run-1",
            title: "Approve release",
            status: .pending,
            createdAt: FixedClock().timestamp
        )
        let run = workflowRun(
            status: .running,
            steps: [WorkflowControl.WorkflowStepSnapshot(stepID: "step-1", name: "Build", status: "running")],
            agents: [WorkflowControl.WorkflowAgentSnapshot(agentID: "agent-1", name: "Planner", role: "Planning", status: "running")],
            tasks: [WorkflowControl.WorkflowTaskSnapshot(taskID: "task-1", title: "Review diff", status: "accepted")],
            inputRequests: [input]
        )
        let view = WorkflowControl.WorkflowControlView(runs: [run])
        view.applyTimeline(WorkflowControl.WorkflowRunTimeline(
            runID: "run-1",
            events: [
                workflowEvent(eventID: "event-2", kind: .stepCompleted, sequence: 2),
                workflowEvent(eventID: "event-1", kind: .runStarted, sequence: 1)
            ],
            projectedStatus: .running,
            nextSequence: 3,
            replayedFromSequence: 1,
            replayIncludesHistoricalEvents: false
        ))

        let labels = allLabelStrings(in: view)

        #expect(labels.contains { $0.contains("Steps: 1") })
        #expect(labels.contains { $0.contains("Agents: 1") })
        #expect(labels.contains { $0.contains("Tasks: 1") })
        #expect(labels.contains { $0.contains("Input: Approve release") })
        #expect(labels.contains { $0.contains("Timeline replayed after sequence 1") })
        #expect(labels.contains { $0.contains("#1: workflow.run.started") })
        #expect(view.pendingInputRequests.map(\.requestID.rawValue) == ["input-1"])
    }

    @Test("WorkflowControlView emits typed control commands without executing locally")
    @MainActor
    func workflowControlViewEmitsTypedCommands() {
        let view = WorkflowControl.WorkflowControlView(runs: [workflowRun(status: .running)])
        var commands: [WorkflowControl.WorkflowViewCommand.Kind] = []
        view.onCommand = { commands.append($0.kind) }

        view.refresh(requestID: "refresh")
        view.observeSelectedTimeline(requestID: "observe")

        #expect(commands == [
            .refreshRuns,
            .observeTimeline(runID: "run-1", afterSequence: nil)
        ])
    }

    @Test("WorkflowControlView disables pause unless the server capability is available")
    @MainActor
    func workflowControlViewDisablesPauseWithoutCapability() {
        let view = WorkflowControl.WorkflowControlView(runs: [workflowRun(status: .running)])

        #expect(!view.isPauseControlEnabled)

        view.supportsPauseControl = true
        view.applyRuns([workflowRun(status: .running)])

        #expect(view.isPauseControlEnabled)
    }

    @Test("WorkflowControlView caps rendered rows under high workflow event volume")
    @MainActor
    func workflowControlViewCapsRenderedRowsUnderLoad() {
        let runs = (0..<120).map { index in
            workflowRun(
                runID: WorkflowControl.WorkflowRunID(rawValue: "run-\(index)"),
                status: .running,
                updatedAtSeconds: TimeInterval(index)
            )
        }
        let events = (1...250).map { sequence in
            workflowEvent(kind: .stateUpdated, sequence: sequence)
        }
        let view = WorkflowControl.WorkflowControlView(runs: runs)

        view.applyTimeline(WorkflowControl.WorkflowRunTimeline(
            runID: "run-0",
            events: events,
            projectedStatus: .running,
            nextSequence: 251,
            replayedFromSequence: nil,
            replayIncludesHistoricalEvents: true
        ))

        let labels = allLabelStrings(in: view)

        #expect(labels.contains("Showing 50 of 120 runs"))
        #expect(labels.contains("Showing latest 100 of 250 timeline events"))
        #expect(labels.contains { $0.hasPrefix("#151:") })
        #expect(!labels.contains { $0.hasPrefix("#150:") })
    }

    @Test("Actions and contracts do not expose a generic workflow command handler")
    func actionsAndContractsDoNotExposeGenericCommandHandler() throws {
        let root = URL(filePath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appending(path: "Sources/FenrirNativeFoundation/Modules/WorkflowControl")
        let checkedFiles = [
            root.appending(path: "Contracts/WorkflowControlContracts.swift"),
            root.appending(path: "Actions/WorkflowControlActions.swift"),
            root.appending(path: "Services/WorkflowControlServices.swift")
        ]

        for file in checkedFiles {
            let contents = try String(contentsOf: file)
            #expect(!contents.contains("HandleCommand"))
            #expect(!contents.contains("handleCommand"))
            #expect(!contents.contains("AnyWorkflowCommand"))
        }
    }
}

private actor WorkflowEventStreamFake: WorkflowControl.WorkflowEventStreaming {
    private let items: [WorkflowControl.WorkflowEventStreamItem]
    private(set) var filters: [WorkflowControl.WorkflowEventStreamFilter] = []

    init(items: [WorkflowControl.WorkflowEventStreamItem]) {
        self.items = items
    }

    func observeWorkflowEvents(filter: WorkflowControl.WorkflowEventStreamFilter) async -> AsyncThrowingStream<WorkflowControl.WorkflowEventStreamItem, Error> {
        filters.append(filter)
        return AsyncThrowingStream { continuation in
            for item in items {
                continuation.yield(item)
            }
            continuation.finish()
        }
    }
}

private actor WorkflowServerFake: WorkflowControl.WorkflowServerClient {
    private var runs: [WorkflowControl.WorkflowRunSnapshot]
    private let events: [WorkflowControl.WorkflowTimelineEvent]
    private let commandError: WorkflowControl.WorkflowControlError?
    private(set) var responses: [String] = []

    init(
        runs: [WorkflowControl.WorkflowRunSnapshot],
        events: [WorkflowControl.WorkflowTimelineEvent] = [],
        commandError: WorkflowControl.WorkflowControlError? = nil
    ) {
        self.runs = runs
        self.events = events
        self.commandError = commandError
    }

    func listWorkflowRuns(filter: WorkflowControl.WorkflowRunListFilter) async throws -> [WorkflowControl.WorkflowRunSnapshot] {
        runs
    }

    func getWorkflowRun(runID: WorkflowControl.WorkflowRunID) async throws -> WorkflowControl.WorkflowRunSnapshot {
        guard let run = runs.first(where: { $0.runID == runID }) else {
            throw WorkflowControl.WorkflowControlError.runNotFound(runID)
        }

        return run
    }

    func getWorkflowTimeline(runID: WorkflowControl.WorkflowRunID) async throws -> [WorkflowControl.WorkflowTimelineEvent] {
        events.filter { $0.runID == runID }
    }

    func pauseWorkflowRun(runID: WorkflowControl.WorkflowRunID) async throws -> WorkflowControl.WorkflowRunSnapshot {
        try commandResult(runID: runID, status: .paused)
    }

    func stopWorkflowRun(runID: WorkflowControl.WorkflowRunID) async throws -> WorkflowControl.WorkflowRunSnapshot {
        try commandResult(runID: runID, status: .cancelled)
    }

    func rerunWorkflowRun(runID: WorkflowControl.WorkflowRunID) async throws -> WorkflowControl.WorkflowRunSnapshot {
        if let commandError {
            throw commandError
        }

        let original = try await getWorkflowRun(runID: runID)
        let rerun = workflowRun(
            runID: WorkflowControl.WorkflowRunID(rawValue: "\(runID.rawValue)-rerun"),
            workflowID: original.workflowID,
            status: .queued
        )
        runs.append(rerun)
        return rerun
    }

    func respondToWorkflowInput(
        runID: WorkflowControl.WorkflowRunID,
        inputRequestID: WorkflowControl.WorkflowInputRequestID,
        response: WorkflowControl.WorkflowJSONValue
    ) async throws -> WorkflowControl.WorkflowRunSnapshot {
        responses.append("\(runID.rawValue):\(inputRequestID.rawValue)")
        guard let index = runs.firstIndex(where: { $0.runID == runID }) else {
            throw WorkflowControl.WorkflowControlError.runNotFound(runID)
        }
        let current = runs[index]
        let resolvedInputs = current.inputRequests.map { request in
            request.requestID == inputRequestID
                ? WorkflowControl.WorkflowInputRequestSnapshot(
                    requestID: request.requestID,
                    runID: request.runID,
                    title: request.title,
                    body: request.body,
                    fields: request.fields,
                    status: .resolved,
                    response: response,
                    createdAt: request.createdAt,
                    resolvedAt: FixedClock().timestamp
                )
                : request
        }
        let updated = workflowRun(
            runID: current.runID,
            workflowID: current.workflowID,
            status: .running,
            inputRequests: resolvedInputs
        )
        runs[index] = updated
        return updated
    }

    private func commandResult(
        runID: WorkflowControl.WorkflowRunID,
        status: WorkflowControl.WorkflowRunStatus
    ) throws -> WorkflowControl.WorkflowRunSnapshot {
        if let commandError {
            throw commandError
        }

        guard let index = runs.firstIndex(where: { $0.runID == runID }) else {
            throw WorkflowControl.WorkflowControlError.runNotFound(runID)
        }

        let current = runs[index]
        let updated = workflowRun(
            runID: current.runID,
            workflowID: current.workflowID,
            status: status
        )
        runs[index] = updated
        return updated
    }
}

private func workflowRun(
    runID: WorkflowControl.WorkflowRunID = "run-1",
    workflowID: WorkflowControl.WorkflowID = "workflow-1",
    status: WorkflowControl.WorkflowRunStatus,
    updatedAtSeconds: TimeInterval = 100,
    steps: [WorkflowControl.WorkflowStepSnapshot] = [],
    agents: [WorkflowControl.WorkflowAgentSnapshot] = [],
    tasks: [WorkflowControl.WorkflowTaskSnapshot] = [],
    inputRequests: [WorkflowControl.WorkflowInputRequestSnapshot] = []
) -> WorkflowControl.WorkflowRunSnapshot {
    WorkflowControl.WorkflowRunSnapshot(
        runID: runID,
        workflowID: workflowID,
        projectID: "project-1",
        originThreadID: "thread-1",
        trigger: .manual,
        name: "Test workflow",
        status: status,
        startedAt: FenrirTimestamp(Date(timeIntervalSince1970: 1)),
        completedAt: status.isTerminal ? FenrirTimestamp(Date(timeIntervalSince1970: updatedAtSeconds)) : nil,
        lastUpdatedAt: FenrirTimestamp(Date(timeIntervalSince1970: updatedAtSeconds)),
        steps: steps,
        agents: agents,
        tasks: tasks,
        inputRequests: inputRequests
    )
}

private func workflowEvent(
    eventID: WorkflowControl.WorkflowEventID? = nil,
    kind: WorkflowControl.WorkflowEventKind,
    sequence: Int
) -> WorkflowControl.WorkflowTimelineEvent {
    WorkflowControl.WorkflowTimelineEvent(
        eventID: eventID ?? WorkflowControl.WorkflowEventID(rawValue: "event-\(sequence)"),
        workflowID: "workflow-1",
        runID: "run-1",
        kind: kind,
        title: kind.rawValue,
        sequence: sequence,
        createdAt: FenrirTimestamp(Date(timeIntervalSince1970: TimeInterval(sequence)))
    )
}

@MainActor
private func allLabelStrings(in view: NSView) -> [String] {
    var labels: [String] = []
    if let label = view as? NSTextField, !label.stringValue.isEmpty {
        labels.append(label.stringValue)
    }
    for subview in view.subviews {
        labels.append(contentsOf: allLabelStrings(in: subview))
    }
    return labels
}
