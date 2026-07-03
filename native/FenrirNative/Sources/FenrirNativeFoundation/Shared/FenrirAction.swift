import Foundation

public protocol FenrirAction: Sendable {
    associatedtype Input: Sendable
    associatedtype Output: Sendable
    associatedtype Failure: Error & Sendable

    func run(_ input: Input) async -> Result<Output, Failure>
}

public struct FenrirTimestamp: Codable, Equatable, Sendable, Comparable {
    public let date: Date

    public init(_ date: Date) {
        self.date = date
    }

    public init(from decoder: Decoder) throws {
        let singleValue = try decoder.singleValueContainer()
        if let string = try? singleValue.decode(String.self),
           let parsed = FenrirTimestamp.parseISO8601(string) {
            date = parsed
            return
        }

        let keyed = try decoder.container(keyedBy: FenrirTimestampCodingKeys.self)
        date = try keyed.decode(Date.self, forKey: .date)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: FenrirTimestampCodingKeys.self)
        try container.encode(date, forKey: .date)
    }

    public static func < (lhs: FenrirTimestamp, rhs: FenrirTimestamp) -> Bool {
        lhs.date < rhs.date
    }

    private static func parseISO8601(_ value: String) -> Date? {
        let fractionalFormatter = ISO8601DateFormatter()
        fractionalFormatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let parsed = fractionalFormatter.date(from: value) {
            return parsed
        }

        let internetDateFormatter = ISO8601DateFormatter()
        internetDateFormatter.formatOptions = [.withInternetDateTime]
        return internetDateFormatter.date(from: value)
    }

    private enum FenrirTimestampCodingKeys: String, CodingKey {
        case date
    }
}

public protocol FenrirClock: Sendable {
    func now() -> FenrirTimestamp
}

public struct SystemFenrirClock: FenrirClock {
    public init() {}

    public func now() -> FenrirTimestamp {
        FenrirTimestamp(Date())
    }
}

public protocol FenrirID: Codable, Hashable, Sendable, RawRepresentable where RawValue == String {}

public struct RequestID: FenrirID, ExpressibleByStringLiteral {
    public let rawValue: String

    public init(rawValue: String) {
        self.rawValue = rawValue
    }

    public init(stringLiteral value: String) {
        self.init(rawValue: value)
    }

    public static func generated() -> RequestID {
        RequestID(rawValue: UUID().uuidString)
    }
}

public struct WorkspaceID: FenrirID, ExpressibleByStringLiteral {
    public let rawValue: String

    public init(rawValue: String) {
        self.rawValue = rawValue
    }

    public init(stringLiteral value: String) {
        self.init(rawValue: value)
    }
}

public struct FenrirWindowID: FenrirID, ExpressibleByStringLiteral {
    public let rawValue: String

    public init(rawValue: String) {
        self.rawValue = rawValue
    }

    public init(stringLiteral value: String) {
        self.init(rawValue: value)
    }
}

public struct PaneID: FenrirID, ExpressibleByStringLiteral {
    public let rawValue: String

    public init(rawValue: String) {
        self.rawValue = rawValue
    }

    public init(stringLiteral value: String) {
        self.init(rawValue: value)
    }
}

public struct ViewportID: FenrirID, ExpressibleByStringLiteral {
    public let rawValue: String

    public init(rawValue: String) {
        self.rawValue = rawValue
    }

    public init(stringLiteral value: String) {
        self.init(rawValue: value)
    }
}

public struct StreamID: FenrirID, ExpressibleByStringLiteral {
    public let rawValue: String

    public init(rawValue: String) {
        self.rawValue = rawValue
    }

    public init(stringLiteral value: String) {
        self.init(rawValue: value)
    }
}

public struct ProfileID: FenrirID, ExpressibleByStringLiteral {
    public let rawValue: String

    public init(rawValue: String) {
        self.rawValue = rawValue
    }

    public init(stringLiteral value: String) {
        self.init(rawValue: value)
    }
}

public enum WorkspaceRef: Codable, Equatable, Sendable {
    case workspaceId(WorkspaceID)
    case projectId(String)
    case canonicalPath(String)
    case alias(String)
}

public enum ActionSource: Codable, Equatable, Sendable {
    case nativeHost
    case clientControl
    case workspaceShell
    case paneGrid
    case terminalViewport
    case test
}

public struct ActionResultEnvelope<Payload: Codable & Equatable & Sendable>: Codable, Equatable, Sendable {
    public let requestID: RequestID
    public let resultKind: String
    public let timestamp: FenrirTimestamp
    public let payload: Payload

    public init(
        requestID: RequestID,
        resultKind: String,
        timestamp: FenrirTimestamp,
        payload: Payload
    ) {
        self.requestID = requestID
        self.resultKind = resultKind
        self.timestamp = timestamp
        self.payload = payload
    }
}

public struct EventEnvelope<Event: Codable & Equatable & Sendable>: Codable, Equatable, Sendable {
    public let eventID: RequestID
    public let eventKind: String
    public let timestamp: FenrirTimestamp
    public let event: Event

    public init(
        eventID: RequestID,
        eventKind: String,
        timestamp: FenrirTimestamp,
        event: Event
    ) {
        self.eventID = eventID
        self.eventKind = eventKind
        self.timestamp = timestamp
        self.event = event
    }
}
