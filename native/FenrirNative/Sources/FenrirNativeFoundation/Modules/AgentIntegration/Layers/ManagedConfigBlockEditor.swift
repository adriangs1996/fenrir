import Foundation

public extension AgentIntegration {
    struct ManagedConfigEditResult: Codable, Equatable, Sendable {
        public let content: String
        public let changed: Bool

        public init(content: String, changed: Bool) {
            self.content = content
            self.changed = changed
        }
    }

    struct ManagedConfigBlockEditor: Sendable {
        public let ownership: ManagedConfigOwnership
        public let linePrefix: String

        public init(ownership: ManagedConfigOwnership, linePrefix: String = "#") {
            self.ownership = ownership
            self.linePrefix = linePrefix
        }

        public var beginMarker: String {
            "\(linePrefix) >>> \(ManagedConfigOwnership.markerNamespace):owner=\(ownership.owner) version=\(ownership.version.rawValue) id=\(ownership.blockID)"
        }

        public var endMarker: String {
            "\(linePrefix) <<< \(ManagedConfigOwnership.markerNamespace):id=\(ownership.blockID)"
        }

        public func install(into original: String, managedBody: String) throws -> ManagedConfigEditResult {
            let block = renderBlock(managedBody)
            let range = try managedBlockRange(in: original)
            let next: String
            if let range {
                next = original.replacingCharacters(in: range, with: block)
            } else if original.isEmpty {
                next = block
            } else if original.hasSuffix("\n") {
                next = original + block
            } else {
                next = original + "\n" + block
            }
            return ManagedConfigEditResult(content: next, changed: next != original)
        }

        public func remove(from original: String) throws -> ManagedConfigEditResult {
            guard let range = try managedBlockRange(in: original) else {
                return ManagedConfigEditResult(content: original, changed: false)
            }
            var next = original
            next.removeSubrange(range)
            if next.hasPrefix("\n") {
                next.removeFirst()
            }
            while next.contains("\n\n\n") {
                next = next.replacingOccurrences(of: "\n\n\n", with: "\n\n")
            }
            return ManagedConfigEditResult(content: next, changed: next != original)
        }

        private func renderBlock(_ body: String) -> String {
            var normalizedBody = body
            if normalizedBody.hasSuffix("\n") {
                normalizedBody.removeLast()
            }
            return "\(beginMarker)\n\(normalizedBody)\n\(endMarker)\n"
        }

        private func managedBlockRange(in content: String) throws -> Range<String.Index>? {
            let beginCandidates = content.ranges(of: "\(linePrefix) >>> \(ManagedConfigOwnership.markerNamespace):")
            let matchingBegins = beginCandidates.filter { markerRange in
                let lineEnd = content[markerRange.lowerBound...].firstIndex(of: "\n") ?? content.endIndex
                let line = String(content[markerRange.lowerBound..<lineEnd])
                return line.contains("owner=\(ManagedConfigOwnership.owner)") && line.contains("id=\(ownership.blockID)")
            }
            guard matchingBegins.count <= 1 else {
                throw AgentIntegrationError.configConflict("Multiple Fenrir-owned blocks found for \(ownership.blockID)")
            }
            guard let begin = matchingBegins.first else {
                return nil
            }
            guard let end = content.range(of: endMarker, range: begin.upperBound..<content.endIndex) else {
                throw AgentIntegrationError.configConflict("Fenrir-owned block is missing an end marker for \(ownership.blockID)")
            }
            let afterEndLine = content[end.upperBound...].firstIndex(of: "\n").map { content.index(after: $0) } ?? content.endIndex
            return begin.lowerBound..<afterEndLine
        }
    }
}
