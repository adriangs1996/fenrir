import Foundation
import FenrirNativeShared

public extension WorkflowControl {
    protocol WorkflowControlClock: Sendable {
        func now() -> FenrirTimestamp
    }

    protocol WorkflowEventStreaming: Sendable {
        func observeWorkflowEvents(filter: WorkflowEventStreamFilter) async -> AsyncThrowingStream<WorkflowEventStreamItem, Error>
    }

    protocol WorkflowServerClient: Sendable {
        func listWorkflowRuns(filter: WorkflowRunListFilter) async throws -> [WorkflowRunSnapshot]
        func getWorkflowRun(runID: WorkflowRunID) async throws -> WorkflowRunSnapshot
        func getWorkflowTimeline(runID: WorkflowRunID) async throws -> [WorkflowTimelineEvent]
        func pauseWorkflowRun(runID: WorkflowRunID) async throws -> WorkflowRunSnapshot
        func stopWorkflowRun(runID: WorkflowRunID) async throws -> WorkflowRunSnapshot
        func rerunWorkflowRun(runID: WorkflowRunID) async throws -> WorkflowRunSnapshot
        func respondToWorkflowInput(runID: WorkflowRunID, inputRequestID: WorkflowInputRequestID, response: WorkflowJSONValue) async throws -> WorkflowRunSnapshot
    }
}
