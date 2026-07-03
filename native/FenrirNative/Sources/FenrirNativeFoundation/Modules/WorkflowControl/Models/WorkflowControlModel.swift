import Foundation
import FenrirNativeShared

extension WorkflowControl {
    struct WorkflowControlState: Sendable {
        var loadedAt: FenrirTimestamp?
    }

    static func orderedTimeline(_ events: [WorkflowTimelineEvent]) -> [WorkflowTimelineEvent] {
        events.sorted {
            if $0.sequence == $1.sequence {
                $0.createdAt < $1.createdAt
            } else {
                $0.sequence < $1.sequence
            }
        }
    }

    static func projectedStatus(
        initialStatus: WorkflowRunStatus?,
        events: [WorkflowTimelineEvent]
    ) -> WorkflowRunStatus? {
        if initialStatus?.isTerminal == true {
            return initialStatus
        }

        return orderedTimeline(events).reduce(initialStatus) { status, event in
            switch event.kind {
            case .runStarted, .runResumed:
                .running
            case .runPaused:
                .paused
            case .runCompleted:
                .completed
            case .runFailed:
                .failed
            case .runCancelled:
                .cancelled
            case .runInterrupted:
                .interrupted
            default:
                status
            }
        }
    }

    static func filteredTimeline(
        _ events: [WorkflowTimelineEvent],
        afterSequence: Int?
    ) -> [WorkflowTimelineEvent] {
        let ordered = orderedTimeline(events)
        guard let afterSequence else {
            return ordered
        }

        return ordered.filter { $0.sequence > afterSequence }
    }

    static func nextSequence(after events: [WorkflowTimelineEvent]) -> Int? {
        orderedTimeline(events).last.map { $0.sequence + 1 }
    }

    static func projection(
        run: WorkflowRunSnapshot,
        events: [WorkflowTimelineEvent],
        capabilities: WorkflowControlCapabilities = .currentServerDefault
    ) -> WorkflowRunProjection {
        let timeline = orderedTimeline(events)
        let status = projectedStatus(initialStatus: run.status, events: timeline) ?? run.status
        return WorkflowRunProjection(
            run: run,
            status: status,
            timeline: timeline,
            canPause: capabilities.canPauseRuns && (status == .running || status == .queued),
            canStop: capabilities.canStopRuns && !status.isTerminal,
            canRerun: capabilities.canRerunRuns && status.isTerminal
        )
    }

    static func streamItem(_ item: WorkflowEventStreamItem, matches filter: WorkflowEventStreamFilter) -> Bool {
        if !filter.runIDs.isEmpty {
            guard let runID = item.runID, filter.runIDs.contains(runID) else {
                return false
            }
        }
        if let projectID = filter.projectID, let itemProjectID = item.projectID, itemProjectID != projectID {
            return false
        }
        return item.run != nil || item.event != nil
    }

    static func visibleRuns(
        _ runs: [WorkflowRunSnapshot],
        filter: WorkflowRunListFilter
    ) -> [WorkflowRunSnapshot] {
        runs
            .filter { run in
                if let projectID = filter.projectID, run.projectID != projectID {
                    return false
                }
                if !filter.statuses.isEmpty, !filter.statuses.contains(run.status) {
                    return false
                }
                if !filter.includeTerminal, run.status.isTerminal {
                    return false
                }
                return true
            }
            .sorted {
                if $0.lastUpdatedAt == $1.lastUpdatedAt {
                    return $0.runID.rawValue < $1.runID.rawValue
                }
                return $0.lastUpdatedAt > $1.lastUpdatedAt
            }
    }
}
