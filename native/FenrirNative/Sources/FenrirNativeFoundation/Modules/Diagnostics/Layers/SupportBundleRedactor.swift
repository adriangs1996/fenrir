import Foundation

extension Diagnostics {
    struct SupportBundleRedactor: DiagnosticsRedactor {
        private let secretPatterns: [(pattern: String, replacement: String)] = [
            (#"(?i)(bearer\s+)[A-Za-z0-9._\-]+"#, "$1[redacted]"),
            (#"(?i)(token=)[^&\s]+"#, "$1[redacted]"),
            (#"(?i)(password=)[^&\s]+"#, "$1[redacted]"),
            (#"(?i)(api[_-]?key=)[^&\s]+"#, "$1[redacted]"),
            (#"(?i)\b((?:https?|wss?)://)[^/@\s]+@([^/\s]+)"#, "$1[redacted]@$2")
        ]

        func safeEvent(from event: DiagnosticEvent, policy: DiagnosticsPolicy) -> SafeDiagnosticEvent {
            SafeDiagnosticEvent(
                id: event.id,
                workspaceID: event.workspaceID,
                category: event.category,
                severity: event.severity,
                title: redact(event.title),
                message: redact(event.message),
                metadata: redactedMetadata(event.metadata),
                terminalContentSummary: terminalContentSummary(event.terminalContent, policy: policy),
                occurredAt: event.occurredAt
            )
        }

        private func redactedMetadata(_ metadata: [String: String]) -> [String: String] {
            metadata.reduce(into: [:]) { result, entry in
                let key = entry.key.lowercased()
                if key.contains("token") || key.contains("password") || key.contains("secret") || key.contains("terminal") {
                    result[entry.key] = "[redacted]"
                } else {
                    result[entry.key] = redact(entry.value)
                }
            }
        }

        private func terminalContentSummary(_ content: String?, policy: DiagnosticsPolicy) -> String? {
            guard let content, !content.isEmpty else {
                return nil
            }

            guard policy.includeTerminalContent else {
                return "[redacted terminal content]"
            }

            return redact(content)
        }

        private func redact(_ value: String) -> String {
            var output = value
            for pattern in secretPatterns {
                output = output.replacingOccurrences(
                    of: pattern.pattern,
                    with: pattern.replacement,
                    options: .regularExpression
                )
            }
            return output
        }
    }
}
