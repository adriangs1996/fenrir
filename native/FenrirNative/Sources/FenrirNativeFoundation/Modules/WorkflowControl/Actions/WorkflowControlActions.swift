import Foundation
import FenrirNativeShared

public extension WorkflowControl {
    struct DescribeWorkflowControlModule: FenrirAction {
        public typealias Failure = WorkflowControlError

        public let clock: any WorkflowControlClock

        public init(clock: any WorkflowControlClock) {
            self.clock = clock
        }

        public func run(_ input: DescribeWorkflowControlModuleInput) async -> Result<DescribeWorkflowControlModuleResult, WorkflowControlError> {
            let timestamp = clock.now()
            return .success(DescribeWorkflowControlModuleResult(
                requestID: input.requestID,
                summary: ModuleSummary(registeredAt: timestamp),
                timestamp: timestamp
            ))
        }
    }

    struct ListWorkflowRuns: FenrirAction {
        public typealias Failure = WorkflowControlError

        public let clock: any WorkflowControlClock
        public let serverClient: any WorkflowServerClient

        public init(clock: any WorkflowControlClock, serverClient: any WorkflowServerClient) {
            self.clock = clock
            self.serverClient = serverClient
        }

        public func run(_ input: ListWorkflowRunsInput) async -> Result<ListWorkflowRunsResult, WorkflowControlError> {
            let timestamp = clock.now()

            do {
                let runs = try await serverClient.listWorkflowRuns(filter: input.filter)
                return .success(ListWorkflowRunsResult(
                    requestID: input.requestID,
                    runs: WorkflowControl.visibleRuns(runs, filter: input.filter),
                    timestamp: timestamp
                ))
            } catch let error as WorkflowControlError {
                return .failure(error)
            } catch {
                return .failure(.serverFailure(String(describing: error)))
            }
        }
    }

    struct ObserveWorkflowRunTimeline: FenrirAction {
        public typealias Failure = WorkflowControlError

        public let clock: any WorkflowControlClock
        public let serverClient: any WorkflowServerClient

        public init(clock: any WorkflowControlClock, serverClient: any WorkflowServerClient) {
            self.clock = clock
            self.serverClient = serverClient
        }

        public func run(_ input: ObserveWorkflowRunTimelineInput) async -> Result<ObserveWorkflowRunTimelineResult, WorkflowControlError> {
            let timestamp = clock.now()

            do {
                let run = try await serverClient.getWorkflowRun(runID: input.runID)
                let events = try await serverClient.getWorkflowTimeline(runID: input.runID)
                let replayedEvents = WorkflowControl.filteredTimeline(events, afterSequence: input.afterSequence)
                return .success(ObserveWorkflowRunTimelineResult(
                    requestID: input.requestID,
                    timeline: WorkflowRunTimeline(
                        runID: input.runID,
                        events: replayedEvents,
                        projectedStatus: WorkflowControl.projectedStatus(initialStatus: run.status, events: events),
                        nextSequence: WorkflowControl.nextSequence(after: events),
                        replayedFromSequence: input.afterSequence,
                        replayIncludesHistoricalEvents: input.afterSequence == nil
                    ),
                    timestamp: timestamp
                ))
            } catch let error as WorkflowControlError {
                return .failure(error)
            } catch {
                return .failure(.serverFailure(String(describing: error)))
            }
        }
    }

    struct PauseWorkflowRun: FenrirAction {
        public typealias Failure = WorkflowControlError

        public let clock: any WorkflowControlClock
        public let serverClient: any WorkflowServerClient

        public init(clock: any WorkflowControlClock, serverClient: any WorkflowServerClient) {
            self.clock = clock
            self.serverClient = serverClient
        }

        public func run(_ input: PauseWorkflowRunInput) async -> Result<WorkflowRunCommandResult, WorkflowControlError> {
            let timestamp = clock.now()

            do {
                return .success(WorkflowRunCommandResult(
                    requestID: input.requestID,
                    run: try await serverClient.pauseWorkflowRun(runID: input.runID),
                    timestamp: timestamp
                ))
            } catch let error as WorkflowControlError {
                return .failure(error)
            } catch {
                return .failure(.serverFailure(String(describing: error)))
            }
        }
    }

    struct StopWorkflowRun: FenrirAction {
        public typealias Failure = WorkflowControlError

        public let clock: any WorkflowControlClock
        public let serverClient: any WorkflowServerClient

        public init(clock: any WorkflowControlClock, serverClient: any WorkflowServerClient) {
            self.clock = clock
            self.serverClient = serverClient
        }

        public func run(_ input: StopWorkflowRunInput) async -> Result<WorkflowRunCommandResult, WorkflowControlError> {
            let timestamp = clock.now()

            do {
                return .success(WorkflowRunCommandResult(
                    requestID: input.requestID,
                    run: try await serverClient.stopWorkflowRun(runID: input.runID),
                    timestamp: timestamp
                ))
            } catch let error as WorkflowControlError {
                return .failure(error)
            } catch {
                return .failure(.serverFailure(String(describing: error)))
            }
        }
    }

    struct RerunWorkflowRun: FenrirAction {
        public typealias Failure = WorkflowControlError

        public let clock: any WorkflowControlClock
        public let serverClient: any WorkflowServerClient

        public init(clock: any WorkflowControlClock, serverClient: any WorkflowServerClient) {
            self.clock = clock
            self.serverClient = serverClient
        }

        public func run(_ input: RerunWorkflowRunInput) async -> Result<WorkflowRunCommandResult, WorkflowControlError> {
            let timestamp = clock.now()

            do {
                return .success(WorkflowRunCommandResult(
                    requestID: input.requestID,
                    run: try await serverClient.rerunWorkflowRun(runID: input.runID),
                    timestamp: timestamp
                ))
            } catch let error as WorkflowControlError {
                return .failure(error)
            } catch {
                return .failure(.serverFailure(String(describing: error)))
            }
        }
    }

    struct RespondToWorkflowInputRequest: FenrirAction {
        public typealias Failure = WorkflowControlError

        public let clock: any WorkflowControlClock
        public let serverClient: any WorkflowServerClient

        public init(clock: any WorkflowControlClock, serverClient: any WorkflowServerClient) {
            self.clock = clock
            self.serverClient = serverClient
        }

        public func run(_ input: RespondToWorkflowInputRequestInput) async -> Result<WorkflowRunCommandResult, WorkflowControlError> {
            let timestamp = clock.now()

            do {
                return .success(WorkflowRunCommandResult(
                    requestID: input.requestID,
                    run: try await serverClient.respondToWorkflowInput(
                        runID: input.runID,
                        inputRequestID: input.inputRequestID,
                        response: input.response
                    ),
                    timestamp: timestamp
                ))
            } catch let error as WorkflowControlError {
                return .failure(error)
            } catch {
                return .failure(.serverFailure(String(describing: error)))
            }
        }
    }

    struct ObserveWorkflowEventStream {
        public let eventStream: any WorkflowEventStreaming

        public init(eventStream: any WorkflowEventStreaming) {
            self.eventStream = eventStream
        }

        public func run(_ input: ObserveWorkflowEventStreamInput) async -> AsyncThrowingStream<WorkflowEventStreamItem, Error> {
            let upstream = await eventStream.observeWorkflowEvents(filter: input.filter)
            return AsyncThrowingStream { continuation in
                let task = Task {
                    do {
                        for try await item in upstream {
                            guard WorkflowControl.streamItem(item, matches: input.filter) else {
                                continue
                            }
                            continuation.yield(item)
                        }
                        continuation.finish()
                    } catch {
                        continuation.finish(throwing: error)
                    }
                }
                continuation.onTermination = { _ in task.cancel() }
            }
        }
    }

    struct ProjectWorkflowRunState: FenrirAction {
        public typealias Failure = WorkflowControlError

        public let clock: any WorkflowControlClock
        public let serverClient: any WorkflowServerClient

        public init(clock: any WorkflowControlClock, serverClient: any WorkflowServerClient) {
            self.clock = clock
            self.serverClient = serverClient
        }

        public func run(_ input: ProjectWorkflowRunStateInput) async -> Result<ProjectWorkflowRunStateResult, WorkflowControlError> {
            let timestamp = clock.now()

            do {
                let run = try await serverClient.getWorkflowRun(runID: input.runID)
                let events = try await serverClient.getWorkflowTimeline(runID: input.runID)
                return .success(ProjectWorkflowRunStateResult(
                    requestID: input.requestID,
                    projection: WorkflowControl.projection(run: run, events: events),
                    timestamp: timestamp
                ))
            } catch let error as WorkflowControlError {
                return .failure(error)
            } catch {
                return .failure(.serverFailure(String(describing: error)))
            }
        }
    }
}
