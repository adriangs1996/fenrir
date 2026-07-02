import AppKit
import Testing
@testable import FenrirNativeApp

@Suite("NativeHost AppKit termination bridge")
struct NativeHostApplicationTerminationBridgeTests {
    @Test("NativeHost terminate request delegates with terminateLater without waiting for shutdown")
    @MainActor
    func terminateRequestReturnsTerminateLaterWithoutWaitingForShutdown() async {
        let gate = SuspendedNativeHostShutdownGate()
        let coordinator = NativeApplicationBootstrapCoordinator(logMessage: { _ in })
        var terminateStarts = 0
        var replies: [Bool] = []
        let bridge = NativeApplicationTerminationBridge(
            terminate: { _, _ in
                terminateStarts += 1
                await gate.markStartedAndWait()
                return NativeApplicationShutdownSnapshot(
                    didRequestPreparedLocalServerShutdown: false,
                    shutdownError: nil
                )
            },
            replyToApplicationShouldTerminate: { shouldTerminate in
                replies.append(shouldTerminate)
            }
        )

        let reply = bridge.requestTermination(coordinator: coordinator, waitingFor: nil)

        #expect(reply == .terminateLater)
        #expect(replies.isEmpty)

        await gate.waitUntilStarted()
        #expect(terminateStarts == 1)
        #expect(replies.isEmpty)

        await gate.release()
        await waitForMainActorCondition { replies.count == 1 }
    }

    @Test("NativeHost completion replies exactly once after coordinator shutdown finishes")
    @MainActor
    func completionRepliesExactlyOnceAfterCoordinatorShutdownFinishes() async {
        let gate = SuspendedNativeHostShutdownGate()
        let coordinator = NativeApplicationBootstrapCoordinator(logMessage: { _ in })
        var events: [String] = []
        let bridge = NativeApplicationTerminationBridge(
            terminate: { _, _ in
                events.append("terminate-start")
                await gate.markStartedAndWait()
                events.append("terminate-finish")
                return NativeApplicationShutdownSnapshot(
                    didRequestPreparedLocalServerShutdown: false,
                    shutdownError: nil
                )
            },
            replyToApplicationShouldTerminate: { shouldTerminate in
                events.append("reply:\(shouldTerminate)")
            }
        )

        let reply = bridge.requestTermination(coordinator: coordinator, waitingFor: nil)
        await gate.waitUntilStarted()

        #expect(reply == .terminateLater)
        #expect(events == ["terminate-start"])

        await gate.release()
        await waitForMainActorCondition { events == ["terminate-start", "terminate-finish", "reply:true"] }

        #expect(events == ["terminate-start", "terminate-finish", "reply:true"])
    }

    @Test("NativeHost repeated terminate requests while shutdown is in flight do not duplicate shutdown or replies")
    @MainActor
    func repeatedTerminateRequestsWhileShutdownInFlightAreIdempotent() async {
        let gate = SuspendedNativeHostShutdownGate()
        let coordinator = NativeApplicationBootstrapCoordinator(logMessage: { _ in })
        var terminateStarts = 0
        var replies: [Bool] = []
        let bridge = NativeApplicationTerminationBridge(
            terminate: { _, _ in
                terminateStarts += 1
                await gate.markStartedAndWait()
                return NativeApplicationShutdownSnapshot(
                    didRequestPreparedLocalServerShutdown: false,
                    shutdownError: nil
                )
            },
            replyToApplicationShouldTerminate: { shouldTerminate in
                replies.append(shouldTerminate)
            }
        )

        let firstReply = bridge.requestTermination(coordinator: coordinator, waitingFor: nil)
        let secondReply = bridge.requestTermination(coordinator: coordinator, waitingFor: nil)
        let thirdReply = bridge.requestTermination(coordinator: coordinator, waitingFor: nil)

        await gate.waitUntilStarted()

        #expect(firstReply == .terminateLater)
        #expect(secondReply == .terminateLater)
        #expect(thirdReply == .terminateLater)
        #expect(terminateStarts == 1)
        #expect(replies.isEmpty)

        await gate.release()
        await waitForMainActorCondition { replies.count == 1 }

        #expect(terminateStarts == 1)
        #expect(replies == [true])
        #expect(bridge.requestTermination(coordinator: coordinator, waitingFor: nil) == .terminateNow)
        #expect(terminateStarts == 1)
        #expect(replies == [true])
    }
}

private actor SuspendedNativeHostShutdownGate {
    private var started = false
    private var startedContinuations: [CheckedContinuation<Void, Never>] = []
    private var releaseContinuation: CheckedContinuation<Void, Never>?

    func markStartedAndWait() async {
        started = true
        for continuation in startedContinuations {
            continuation.resume()
        }
        startedContinuations.removeAll()
        await withCheckedContinuation { continuation in
            releaseContinuation = continuation
        }
    }

    func waitUntilStarted() async {
        guard !started else {
            return
        }
        await withCheckedContinuation { continuation in
            startedContinuations.append(continuation)
        }
    }

    func release() {
        releaseContinuation?.resume()
        releaseContinuation = nil
    }
}

@MainActor
private func waitForMainActorCondition(_ condition: @escaping @MainActor () -> Bool) async {
    for _ in 0..<100 where !condition() {
        await Task.yield()
    }
}
