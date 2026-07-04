import AppKit
import CoreText
import Foundation
import GhosttyTerminal
import FenrirNativeShared

@MainActor
public final class FenrirGhosttyTerminalBackend: FenrirTerminalBackend, FenrirTerminalSyntheticSelectionCapturing {
    public static let defaultRendererID = "libghostty"

    public let descriptor = TerminalViewport.RendererDescriptor(
        rendererID: FenrirGhosttyTerminalBackend.defaultRendererID,
        status: .ready
    )

    private let controller: TerminalController
    private let session: InMemoryTerminalSession
    private let terminalView: TerminalView
    private var lastReceivedPlainText = ""
    private var syntheticSelection: String?

    private static let debugLoggingResolved: Bool = {
        let value = ProcessInfo.processInfo.environment["FENRIR_TERMINAL_DEBUG"] ?? ""
        guard !value.isEmpty, value != "0" else {
            return false
        }
        TerminalDebugLog.sink = { message in
            NSLog("%@", message)
        }
        TerminalDebugLog.enable(.standard)
        return true
    }()

    public init(
        fontSize: Float? = nil,
        workingDirectory: String? = nil,
        onUserInput: @escaping @Sendable (Data) -> Void,
        onResize: @escaping @Sendable (TerminalViewport.Size) -> Void = { _ in }
    ) {
        _ = Self.debugLoggingResolved
        session = InMemoryTerminalSession(
            write: onUserInput,
            resize: { viewport in
                onResize(TerminalViewport.Size(
                    columns: Int(viewport.columns),
                    rows: Int(viewport.rows),
                    pixelWidth: Int(viewport.widthPixels),
                    pixelHeight: Int(viewport.heightPixels)
                ))
            }
        )
        controller = TerminalController(configSource: Self.resolvedGhosttyConfigSource())
        terminalView = TerminalView(frame: .zero)
        terminalView.controller = controller
        terminalView.configuration = TerminalSurfaceOptions(
            backend: .inMemory(session),
            fontSize: fontSize,
            workingDirectory: workingDirectory,
            context: .window
        )
    }

    public func mount(in hostView: NSView) {
        guard terminalView.superview == nil else {
            return
        }
        terminalView.translatesAutoresizingMaskIntoConstraints = false
        hostView.addSubview(terminalView)
        NSLayoutConstraint.activate([
            terminalView.leadingAnchor.constraint(equalTo: hostView.leadingAnchor),
            terminalView.trailingAnchor.constraint(equalTo: hostView.trailingAnchor),
            terminalView.topAnchor.constraint(equalTo: hostView.topAnchor),
            terminalView.bottomAnchor.constraint(equalTo: hostView.bottomAnchor)
        ])
    }

    public func unmount() {
        terminalView.removeFromSuperview()
    }

    public func attach(streamID: StreamID) {
        _ = streamID
        terminalView.setSurfaceVisible(true)
    }

    public func detach(streamID: StreamID) {
        _ = streamID
    }

    public func applyOutput(_ bytes: Data) {
        lastReceivedPlainText.append(String(decoding: bytes, as: UTF8.self))
        trimPlainTextCache()
        session.receive(bytes)
    }

    public func sendUserInput(_ bytes: Data) {
        session.sendInput(bytes)
    }

    public func resize(_ size: TerminalViewport.Size) {
        _ = size
    }

    public func setFocused(_ focused: Bool) {
        if focused {
            terminalView.window?.makeFirstResponder(terminalView)
        }
    }

    public func captureSelection() -> TerminalViewport.CapturedTextBuffer {
        TerminalViewport.CapturedTextBuffer(text: terminalView.readSelectedText() ?? syntheticSelection ?? "")
    }

    public func captureViewport() -> TerminalViewport.CapturedTextBuffer {
        TerminalViewport.CapturedTextBuffer(text: session.readViewportText() ?? lastReceivedPlainText)
    }

    public func captureLastLines(maxLines: Int?) -> TerminalViewport.CapturedTextBuffer {
        let text = session.readViewportText() ?? lastReceivedPlainText
        guard let maxLines, maxLines > 0 else {
            return TerminalViewport.CapturedTextBuffer(text: text)
        }
        return TerminalViewport.CapturedTextBuffer(text: text.split(separator: "\n", omittingEmptySubsequences: false).suffix(maxLines).joined(separator: "\n"))
    }

    public static func resolvedGhosttyConfigFilePaths(
        environment: [String: String] = ProcessInfo.processInfo.environment,
        fileManager: FileManager = .default
    ) -> [String] {
        guard let home = environment["HOME"], !home.isEmpty else {
            return []
        }
        let xdgRoot = environment["XDG_CONFIG_HOME"].flatMap { $0.isEmpty ? nil : $0 } ?? "\(home)/.config"
        let candidates = [
            "\(xdgRoot)/ghostty/config.ghostty",
            "\(xdgRoot)/ghostty/config",
            "\(home)/Library/Application Support/com.mitchellh.ghostty/config.ghostty",
            "\(home)/Library/Application Support/com.mitchellh.ghostty/config"
        ]
        return candidates.filter { fileManager.fileExists(atPath: $0) }
    }

    public func setSyntheticSelectionForTesting(_ text: String?) {
        syntheticSelection = text
    }

    /// Fallback families appended after the user's own `font-family` entries.
    /// Ghostty treats repeated `font-family` entries as a fallback chain, so
    /// styled glyphs missing from the primary family's installed faces (e.g.
    /// bold U+276F when only JetBrainsMono-Regular is installed) resolve to a
    /// full-coverage installed family instead of a synthesized/wrong glyph.
    nonisolated static let ghosttyFallbackFontFamilies = [
        "JetBrainsMonoNL Nerd Font",
        "Menlo"
    ]

    /// The `font-family` config lines to append, restricted to families that
    /// are actually installed (an entry naming a missing family is useless).
    /// The availability check is injectable for tests.
    nonisolated static func ghosttyFontFallbackConfigLines(
        isFontFamilyInstalled: (String) -> Bool
    ) -> [String] {
        ghosttyFallbackFontFamilies
            .filter(isFontFamilyInstalled)
            .map { "font-family = \"\($0)\"" }
    }

    /// Appends the installed fallback `font-family` lines after the inlined
    /// user config so the user's own entries keep priority in the chain.
    nonisolated static func ghosttyConfigAppendingFontFallback(
        to contents: String,
        isFontFamilyInstalled: (String) -> Bool
    ) -> String {
        let lines = ghosttyFontFallbackConfigLines(isFontFamilyInstalled: isFontFamilyInstalled)
        guard !lines.isEmpty else {
            return contents
        }
        return ([contents] + lines).joined(separator: "\n")
    }

    nonisolated static func installedFontFamilyNames() -> Set<String> {
        Set(CTFontManagerCopyAvailableFontFamilyNames() as? [String] ?? [])
    }

    private static func resolvedGhosttyConfigSource() -> TerminalController.ConfigSource {
        let paths = resolvedGhosttyConfigFilePaths()
        guard !paths.isEmpty else {
            return .none
        }
        // Inline the file contents: the embedded libghostty build does not
        // follow `config-file` directives from a generated config, which
        // silently discards the user's font settings.
        let contents = paths
            .compactMap { try? String(contentsOfFile: $0, encoding: .utf8) }
            .joined(separator: "\n")
        guard !contents.isEmpty else {
            return .none
        }
        let installed = installedFontFamilyNames()
        let combined = ghosttyConfigAppendingFontFallback(to: contents) { installed.contains($0) }
        return .generated("\(combined)\n")
    }

    private static func quotedGhosttyConfigPath(_ path: String) -> String {
        let escaped = path
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
        return "\"\(escaped)\""
    }

    private func trimPlainTextCache() {
        let maximumCharacters = 200_000
        guard lastReceivedPlainText.count > maximumCharacters else {
            return
        }
        lastReceivedPlainText = String(lastReceivedPlainText.suffix(maximumCharacters))
    }
}
