import Foundation
import FenrirNativeShared

extension ServerConnection {
    actor BoundedServerConnectionEventBuffer: ServerConnectionEventPublishing {
        private let capacity: Int
        private var events: [EventEnvelope<Event>] = []
        private var droppedEventCount = 0

        init(capacity: Int) {
            self.capacity = max(1, capacity)
        }

        func publish(_ event: EventEnvelope<Event>) async {
            if events.count == capacity {
                events.removeFirst()
                droppedEventCount += 1
            }
            events.append(event)
        }

        func drain(maxCount: Int) -> [EventEnvelope<Event>] {
            let count = min(max(0, maxCount), events.count)
            let drained = Array(events.prefix(count))
            events.removeFirst(count)
            return drained
        }

        func snapshot() -> (events: [EventEnvelope<Event>], droppedEventCount: Int) {
            (events, droppedEventCount)
        }
    }
}
