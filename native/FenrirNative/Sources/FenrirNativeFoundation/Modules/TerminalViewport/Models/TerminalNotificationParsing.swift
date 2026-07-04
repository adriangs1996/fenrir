import Foundation
import FenrirNativeShared

/// Pure payload parsing + sanitization for the standard terminal notification
/// OSC sequences handled at the render-input boundary (D-043):
///
/// - OSC 9  `; <body>`                    (iTerm2-style notification)
/// - OSC 99 `; <params> ; <body>`         (kitty notify; title/body basics)
/// - OSC 777 `; notify ; <title> ; <body>` (urxvt/ghostty style)
///
/// Discipline follows the reserved-presence channel's sanitizer shape: strip
/// control characters, cap title/body lengths, drop malformed payloads, never
/// crash. Notifications are advisory UI signals only — no authorization or
/// presence semantics.
///
/// Kitty (OSC 99) multi-chunk notifications reassemble here: a payload with
/// `i=<id>` and `d=1` buffers per id; `d=0` (or no `d`) finalizes the pending
/// id — merging the final chunk — and emits one notification. The buffer is
/// bounded (`maxPendingKittyNotificationChunkIDs` ids,
/// `maxPendingKittyNotificationChunkBytes` per id) and lives in the caller's
/// scanner state (like `pendingReservedOSCSequence`), keeping the parser pure.
enum TerminalNotificationParser {
    enum Outcome: Equatable, Sendable {
        /// A well-formed notification (already sanitized and capped).
        case notification(title: String?, body: String)
        /// Malformed or empty payload: strip the sequence, emit no
        /// notification, surface a typed drop record for diagnostics counts.
        case dropped(TerminalViewport.TerminalNotificationDropReason)
        /// A kitty chunk was absorbed into the reassembly buffer: strip the
        /// sequence, emit nothing yet.
        case buffered
        /// Not a notification for this channel (e.g. ConEmu progress on OSC 9,
        /// a non-notify OSC 777 module): leave the bytes for the renderer.
        case passThrough
    }

    /// Outcomes are emitted in order (evictions precede the outcome for the
    /// triggering payload); `passThrough` only ever appears alone.
    static func parse(
        source: TerminalViewport.TerminalNotificationSource,
        payloadBytes: [UInt8],
        pendingKittyChunks: [TerminalViewport.PendingKittyNotificationChunk]
    ) -> (outcomes: [Outcome], pendingKittyChunks: [TerminalViewport.PendingKittyNotificationChunk]) {
        let payload = String(decoding: payloadBytes, as: UTF8.self)
        switch source {
        case .osc9:
            return ([parseOSC9(payload)], pendingKittyChunks)
        case .osc99:
            return parseOSC99(payload, pendingChunks: pendingKittyChunks)
        case .osc777:
            return ([parseOSC777(payload)], pendingKittyChunks)
        }
    }

    /// OSC 9 carries the body directly. ConEmu-style progress reports
    /// (`OSC 9 ; 4 ; state ; progress`) are renderer state, not notifications,
    /// so they pass through untouched.
    private static func parseOSC9(_ payload: String) -> Outcome {
        if payload == "4" || payload.hasPrefix("4;") {
            return .passThrough
        }
        return notification(titleText: nil, bodyText: payload)
    }

    /// OSC 777 is a module dispatch; only the `notify` module is a
    /// notification. `notify;<title>;<body>` where the body keeps any further
    /// semicolons verbatim.
    private static func parseOSC777(_ payload: String) -> Outcome {
        let parts = payload.split(separator: ";", omittingEmptySubsequences: false)
        guard parts.first == "notify" else {
            return .passThrough
        }
        let title = parts.count > 1 ? String(parts[1]) : ""
        let body = parts.count > 2 ? parts[2...].joined(separator: ";") : ""
        return notification(titleText: title, bodyText: body)
    }

    private enum KittyPayloadField {
        case title
        case body
    }

    /// OSC 99 (kitty notify) basics: `<params> ; <text>` where params are
    /// colon-separated `key=value` pairs. Supported params: `p` (payload type
    /// `title` or `body`, default `body`), `e=1` (base64-encoded text), and
    /// the chunking pair `i=<id>` / `d` (`d=1` buffers, `d=0`/absent
    /// finalizes). Unknown keys are ignored; unsupported payload types are
    /// dropped.
    private static func parseOSC99(
        _ payload: String,
        pendingChunks: [TerminalViewport.PendingKittyNotificationChunk]
    ) -> (outcomes: [Outcome], pendingKittyChunks: [TerminalViewport.PendingKittyNotificationChunk]) {
        let metadata: Substring
        let value: Substring
        if let separator = payload.firstIndex(of: ";") {
            metadata = payload[..<separator]
            value = payload[payload.index(after: separator)...]
        } else {
            metadata = payload[...]
            value = ""
        }

        var parameters: [Substring: Substring] = [:]
        for pair in metadata.split(separator: ":", omittingEmptySubsequences: true) {
            guard let equals = pair.firstIndex(of: "=") else {
                continue
            }
            parameters[pair[..<equals]] = pair[pair.index(after: equals)...]
        }

        var text = String(value)
        if parameters["e"] == "1" {
            guard let decoded = Data(base64Encoded: text) else {
                return ([.dropped(.invalidEncoding)], pendingChunks)
            }
            text = String(decoding: decoded, as: UTF8.self)
        }

        let field: KittyPayloadField
        switch parameters["p"] ?? "body" {
        case "body":
            field = .body
        case "title":
            field = .title
        default:
            return ([.dropped(.unsupportedParameters)], pendingChunks)
        }

        let chunkID = parameters["i"].map(String.init)
        let moreChunksFollow = parameters["d"] == "1"

        if moreChunksFollow, let chunkID {
            return bufferKittyChunk(id: chunkID, text: text, field: field, pendingChunks: pendingChunks)
        }

        var pending = pendingChunks
        if let chunkID, let index = pending.firstIndex(where: { $0.chunkID == chunkID }) {
            let merged = appending(text, to: field, of: pending.remove(at: index))
            return ([notification(titleText: merged.title, bodyText: merged.body)], pending)
        }

        switch field {
        case .body:
            return ([notification(titleText: nil, bodyText: text)], pending)
        case .title:
            return ([notification(titleText: text, bodyText: "")], pending)
        }
    }

    private static func bufferKittyChunk(
        id: String,
        text: String,
        field: KittyPayloadField,
        pendingChunks: [TerminalViewport.PendingKittyNotificationChunk]
    ) -> (outcomes: [Outcome], pendingKittyChunks: [TerminalViewport.PendingKittyNotificationChunk]) {
        var pending = pendingChunks
        var outcomes: [Outcome] = []

        if let index = pending.firstIndex(where: { $0.chunkID == id }) {
            let merged = appending(text, to: field, of: pending[index])
            guard merged.accumulatedByteCount <= TerminalViewport.maxPendingKittyNotificationChunkBytes else {
                pending.remove(at: index)
                return ([.dropped(.chunkBufferOverflow)], pending)
            }
            pending[index] = merged
            return ([.buffered], pending)
        }

        let entry = appending(text, to: field, of: TerminalViewport.PendingKittyNotificationChunk(chunkID: id))
        guard entry.accumulatedByteCount <= TerminalViewport.maxPendingKittyNotificationChunkBytes else {
            return ([.dropped(.chunkBufferOverflow)], pending)
        }
        while pending.count >= TerminalViewport.maxPendingKittyNotificationChunkIDs {
            pending.removeFirst()
            outcomes.append(.dropped(.chunkBufferEvicted))
        }
        pending.append(entry)
        outcomes.append(.buffered)
        return (outcomes, pending)
    }

    private static func appending(
        _ text: String,
        to field: KittyPayloadField,
        of chunk: TerminalViewport.PendingKittyNotificationChunk
    ) -> TerminalViewport.PendingKittyNotificationChunk {
        switch field {
        case .title:
            TerminalViewport.PendingKittyNotificationChunk(chunkID: chunk.chunkID, title: chunk.title + text, body: chunk.body)
        case .body:
            TerminalViewport.PendingKittyNotificationChunk(chunkID: chunk.chunkID, title: chunk.title, body: chunk.body + text)
        }
    }

    private static func notification(titleText: String?, bodyText: String) -> Outcome {
        let title = titleText.map { sanitize($0, maxCharacters: TerminalViewport.maxTerminalNotificationTitleCharacters) } ?? ""
        let body = sanitize(bodyText, maxCharacters: TerminalViewport.maxTerminalNotificationBodyCharacters)
        guard !title.isEmpty || !body.isEmpty else {
            return .dropped(.emptyContent)
        }
        return .notification(title: title.isEmpty ? nil : title, body: body)
    }

    /// Strip control characters (C0, DEL, C1) — mapping tabs/newlines to a
    /// single space — then trim and cap by character count.
    static func sanitize(_ text: String, maxCharacters: Int) -> String {
        var scalars = String.UnicodeScalarView()
        for scalar in text.unicodeScalars {
            if scalar == "\n" || scalar == "\t" || scalar == "\r" {
                scalars.append(" ")
                continue
            }
            if scalar.value < 0x20 || scalar.value == 0x7F || (0x80...0x9F).contains(scalar.value) {
                continue
            }
            scalars.append(scalar)
        }
        let cleaned = String(scalars).trimmingCharacters(in: .whitespaces)
        return String(cleaned.prefix(max(0, maxCharacters)))
    }
}
