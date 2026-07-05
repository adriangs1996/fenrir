import AppKit
import CoreText
import Foundation
import GhosttyTerminal
import GhosttyTheme
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
    /// Fallback capture buffer (used only when the ghostty surface cannot be
    /// read). Kept as raw bytes: appending `Data` and trimming by byte count
    /// are O(chunk), whereas the previous `String` cache paid an O(cache)
    /// grapheme-cluster `count` on every output chunk.
    private var lastReceivedOutputBytes = Data()
    private var syntheticSelection: String?

    /// Cell-exact surface sizing (D-011/D-019): the server-assigned tmux grid
    /// requested through `resize(_:)`. The ghostty view is constrained to
    /// exactly this many cells (in pixels, using ghostty's live cell metrics)
    /// so ghostty's self-measured grid equals the tmux pane grid. Without it
    /// ghostty derives a grid from the pane box's point size, which drifts
    /// from tmux's allocation by rows/columns — nvim then leaves a dead band
    /// under its statusline and long lines wrap/clip mid-character.
    private var requestedGridSize: TerminalViewport.Size?
    private var lastViewportMetrics: InMemoryTerminalViewport?
    private var exactWidthConstraint: NSLayoutConstraint?
    private var exactHeightConstraint: NSLayoutConstraint?
    private var fillConstraints: [NSLayoutConstraint] = []
    private let viewportMetricsRelay = ViewportMetricsRelay()

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
        let metricsRelay = viewportMetricsRelay
        session = InMemoryTerminalSession(
            write: onUserInput,
            resize: { viewport in
                onResize(TerminalViewport.Size(
                    columns: Int(viewport.columns),
                    rows: Int(viewport.rows),
                    pixelWidth: Int(viewport.widthPixels),
                    pixelHeight: Int(viewport.heightPixels)
                ))
                metricsRelay.dispatch(viewport)
            }
        )
        let configSource = Self.resolvedGhosttyConfigSource()
        // The bundled Afterglow/Alabaster theme renders AFTER the base config,
        // so it would silently override the user's own ghostty colors
        // (background, palette, cursor). Apply it only when the user has no
        // ghostty config of their own to honor.
        controller = TerminalController(
            configSource: configSource,
            theme: configSource == .none ? .default : TerminalTheme()
        )
        terminalView = TerminalView(frame: .zero)
        terminalView.controller = controller
        terminalView.configuration = TerminalSurfaceOptions(
            backend: .inMemory(session),
            fontSize: fontSize,
            workingDirectory: workingDirectory,
            context: .window
        )
        viewportMetricsRelay.onMetrics = { [weak self] viewport in
            self?.handleViewportMetrics(viewport)
        }
    }

    public func mount(in hostView: NSView) {
        guard terminalView.superview == nil else {
            return
        }
        terminalView.translatesAutoresizingMaskIntoConstraints = false
        hostView.addSubview(terminalView)
        // Anchored top-leading; trailing/bottom never overflow the host. The
        // fill constraints size the surface to the host until a tmux grid is
        // assigned; the exact-size constraints (priority above fill, below
        // the required edges) then take over so ghostty's grid matches tmux's
        // and any leftover points show as background at the bottom/right.
        //
        // PRIORITY CONTRACT: both fill and exact sit BELOW the pane grid's
        // split-fraction constraints (750) AND below NSWindow's user-frame
        // resistance (~500). An exact size larger than the pane box must lose
        // to the box — above the fractions it pushes split dividers around,
        // and above ~500 an absolute-constant size constraint RESIZES THE
        // WHOLE WINDOW to fit the tmux grid, inflating the window, the
        // measured viewport, and the tmux window in an unbounded feedback
        // loop (the "trembling app" failure).
        let fillWidth = terminalView.widthAnchor.constraint(equalTo: hostView.widthAnchor)
        fillWidth.priority = NSLayoutConstraint.Priority(rawValue: 480)
        let fillHeight = terminalView.heightAnchor.constraint(equalTo: hostView.heightAnchor)
        fillHeight.priority = NSLayoutConstraint.Priority(rawValue: 480)
        fillConstraints = [fillWidth, fillHeight]
        NSLayoutConstraint.activate([
            terminalView.leadingAnchor.constraint(equalTo: hostView.leadingAnchor),
            terminalView.topAnchor.constraint(equalTo: hostView.topAnchor),
            terminalView.trailingAnchor.constraint(lessThanOrEqualTo: hostView.trailingAnchor),
            terminalView.bottomAnchor.constraint(lessThanOrEqualTo: hostView.bottomAnchor),
            fillWidth,
            fillHeight
        ])
        applyExactSurfaceSizeIfPossible()
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
        lastReceivedOutputBytes.append(bytes)
        trimOutputBytesCache()
        session.receive(bytes)
    }

    public func sendUserInput(_ bytes: Data) {
        session.sendInput(bytes)
    }

    public func resize(_ size: TerminalViewport.Size) {
        guard size.columns > 0, size.rows > 0 else {
            return
        }
        if requestedGridSize?.columns == size.columns, requestedGridSize?.rows == size.rows {
            return
        }
        requestedGridSize = size
        applyExactSurfaceSizeIfPossible()
    }

    private func handleViewportMetrics(_ viewport: InMemoryTerminalViewport) {
        // Only a CELL-SIZE change (font config) or the very first metrics
        // report may recompute the exact-size constraints. Size-only reports
        // are downstream of our own constraint layout — recomputing the
        // remainder from them re-triggers layout → sync → metrics in a local
        // busy loop whenever the desired grid does not fit the pane box
        // (clamped surfaces never converge to the desired grid).
        let previous = lastViewportMetrics
        lastViewportMetrics = viewport
        guard previous == nil
            || previous?.cellWidthPixels != viewport.cellWidthPixels
            || previous?.cellHeightPixels != viewport.cellHeightPixels
        else {
            return
        }
        applyExactSurfaceSizeIfPossible()
    }

    /// Pixel size that makes ghostty's self-measured grid equal `desired`:
    /// desired cells at the live cell metrics, plus the reported surface's
    /// non-cell remainder (ghostty padding + sub-cell slack, always smaller
    /// than one cell per axis, so the derived grid lands exactly on
    /// `desired`). Returns nil until ghostty has reported real cell metrics.
    nonisolated static func exactSurfacePixelSize(
        desired: TerminalViewport.Size,
        reported: InMemoryTerminalViewport
    ) -> (width: CGFloat, height: CGFloat)? {
        guard reported.cellWidthPixels > 0, reported.cellHeightPixels > 0,
              reported.columns > 0, reported.rows > 0,
              desired.columns > 0, desired.rows > 0
        else {
            return nil
        }
        let remainderX = CGFloat(reported.widthPixels) - CGFloat(reported.columns) * CGFloat(reported.cellWidthPixels)
        let remainderY = CGFloat(reported.heightPixels) - CGFloat(reported.rows) * CGFloat(reported.cellHeightPixels)
        guard remainderX >= 0, remainderY >= 0 else {
            return nil
        }
        return (
            width: CGFloat(desired.columns) * CGFloat(reported.cellWidthPixels) + remainderX,
            height: CGFloat(desired.rows) * CGFloat(reported.cellHeightPixels) + remainderY
        )
    }

    private func applyExactSurfaceSizeIfPossible() {
        guard terminalView.superview != nil,
              let requestedGridSize,
              let metrics = lastViewportMetrics,
              let target = Self.exactSurfacePixelSize(desired: requestedGridSize, reported: metrics)
        else {
            return
        }
        // Converged: ghostty already derives exactly the requested grid.
        // Touching the constraints again (the remainder estimate can move a
        // few pixels between reports) would re-trigger layout → metrics →
        // re-apply in a local busy loop. The grid being right is the goal;
        // once it is, hold still.
        if exactWidthConstraint != nil,
           Int(metrics.columns) == requestedGridSize.columns,
           Int(metrics.rows) == requestedGridSize.rows {
            return
        }
        let scale = terminalView.window?.backingScaleFactor
            ?? NSScreen.main?.backingScaleFactor ?? 2
        guard scale > 0 else {
            return
        }
        let widthPoints = target.width / scale
        let heightPoints = target.height / scale

        if exactWidthConstraint == nil || exactHeightConstraint == nil {
            let width = terminalView.widthAnchor.constraint(equalToConstant: widthPoints)
            width.priority = NSLayoutConstraint.Priority(rawValue: 490)
            let height = terminalView.heightAnchor.constraint(equalToConstant: heightPoints)
            height.priority = NSLayoutConstraint.Priority(rawValue: 490)
            exactWidthConstraint = width
            exactHeightConstraint = height
            NSLayoutConstraint.activate([width, height])
            return
        }
        // Sub-point churn would loop layout <-> metrics; only move on real change.
        if abs((exactWidthConstraint?.constant ?? 0) - widthPoints) >= 0.5 {
            exactWidthConstraint?.constant = widthPoints
        }
        if abs((exactHeightConstraint?.constant ?? 0) - heightPoints) >= 0.5 {
            exactHeightConstraint?.constant = heightPoints
        }
    }

    public func setFocused(_ focused: Bool) {
        if focused {
            terminalView.window?.makeFirstResponder(terminalView)
        }
    }

    /// Ghostty's live cell metrics in PIXELS, straight from the surface's
    /// last resize dispatch. Preferred over dividing view bounds by the grid
    /// (which folds ghostty padding + sub-cell remainder into the estimate).
    public var lastReportedCellPixelSize: CGSize? {
        guard let viewport = session.lastDispatchedViewport,
              viewport.cellWidthPixels > 0, viewport.cellHeightPixels > 0
        else {
            return nil
        }
        return CGSize(width: CGFloat(viewport.cellWidthPixels), height: CGFloat(viewport.cellHeightPixels))
    }

    public var lastReportedSurfaceSize: TerminalViewport.Size? {
        guard let viewport = session.lastDispatchedViewport else {
            return nil
        }
        return TerminalViewport.Size(
            columns: Int(viewport.columns),
            rows: Int(viewport.rows),
            pixelWidth: Int(viewport.widthPixels),
            pixelHeight: Int(viewport.heightPixels)
        )
    }

    /// IME preedit state straight from the ghostty view's NSTextInputClient
    /// (`AppTerminalView.hasMarkedText()`).
    public var hasMarkedText: Bool {
        terminalView.hasMarkedText()
    }

    /// MOUSE-REPORTING state (DECSET 1000/1002/1003/1006) straight from
    /// libghostty's surface (`ghostty_surface_mouse_captured` via
    /// `AppTerminalView.isMouseReportingActive`) — mouse tracking only, NOT the
    /// alternate screen (libghostty exposes no alt-screen getter). Live at
    /// keypress: the moment an app enables mouse tracking this flips true, so
    /// vim-aware navigation passes the key through instead of moving focus. An
    /// app that never enables mouse reporting reads false (see the protocol
    /// declaration for the resulting key-stealing limitation).
    public var isMouseReportingActive: Bool {
        terminalView.isMouseReportingActive
    }

    public func captureSelection() -> TerminalViewport.CapturedTextBuffer {
        TerminalViewport.CapturedTextBuffer(text: terminalView.readSelectedText() ?? syntheticSelection ?? "")
    }

    public func captureViewport() -> TerminalViewport.CapturedTextBuffer {
        TerminalViewport.CapturedTextBuffer(text: session.readViewportText() ?? fallbackPlainText())
    }

    public func captureLastLines(maxLines: Int?) -> TerminalViewport.CapturedTextBuffer {
        let text = session.readViewportText() ?? fallbackPlainText()
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
        let themed = ghosttyConfigResolvingNamedThemes(contents)
        let installed = installedFontFamilyNames()
        let combined = ghosttyConfigAppendingFontFallback(to: themed) { installed.contains($0) }
        return .generated("\(combined)\n")
    }

    /// The embedded libghostty build ships no `themes/` resource directory, so
    /// `theme = <name>` in the user's config resolves to nothing and the
    /// terminal falls back to Ghostty's default background. Replace each
    /// `theme = <name>` line with the named theme's explicit color directives
    /// from the bundled 485-theme catalog, at the SAME position, so ordering
    /// semantics match Ghostty (later user overrides still win) and the
    /// terminal renders the user's chosen theme (e.g. Catppuccin Mocha).
    /// Unresolvable names (or `theme = /path/to/file`) are left untouched.
    nonisolated static func ghosttyConfigResolvingNamedThemes(
        _ contents: String,
        lookup: (String) -> GhosttyThemeDefinition? = { GhosttyThemeCatalog.theme(named: $0) }
    ) -> String {
        contents
            .split(separator: "\n", omittingEmptySubsequences: false)
            .map { line -> String in
                guard let name = parsedThemeDirectiveName(String(line)),
                      let theme = lookup(name)
                else {
                    return String(line)
                }
                return ghosttyThemeColorDirectives(theme).joined(separator: "\n")
            }
            .joined(separator: "\n")
    }

    /// Extracts the theme name from a `theme = <value>` line, or nil if the
    /// line is not a theme directive. Handles quotes and the
    /// `theme = dark:<A>,light:<B>` split form (the native shell is a dark
    /// surface, so the dark variant is chosen).
    nonisolated static func parsedThemeDirectiveName(_ line: String) -> String? {
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        guard !trimmed.hasPrefix("#"),
              let equals = trimmed.firstIndex(of: "="),
              trimmed[trimmed.startIndex ..< equals].trimmingCharacters(in: .whitespaces) == "theme"
        else {
            return nil
        }
        let value = trimmed[trimmed.index(after: equals)...].trimmingCharacters(in: .whitespaces)
        let resolved: String
        if value.contains("dark:") || value.contains("light:") {
            resolved = value
                .split(separator: ",")
                .compactMap { part -> String? in
                    let piece = part.trimmingCharacters(in: .whitespaces)
                    return piece.hasPrefix("dark:") ? String(piece.dropFirst("dark:".count)) : nil
                }
                .first ?? value
        } else {
            resolved = value
        }
        let unquoted = resolved.trimmingCharacters(in: CharacterSet(charactersIn: "\"'")).trimmingCharacters(in: .whitespaces)
        // A path-style theme value is Ghostty's own concern; only names map.
        return unquoted.isEmpty || unquoted.contains("/") ? nil : unquoted
    }

    private nonisolated static func ghosttyThemeColorDirectives(_ theme: GhosttyThemeDefinition) -> [String] {
        var lines = [
            "background = \(theme.background)",
            "foreground = \(theme.foreground)"
        ]
        if let cursorColor = theme.cursorColor {
            lines.append("cursor-color = \(cursorColor)")
        }
        if let cursorText = theme.cursorText {
            lines.append("cursor-text = \(cursorText)")
        }
        if let selectionBackground = theme.selectionBackground {
            lines.append("selection-background = \(selectionBackground)")
        }
        if let selectionForeground = theme.selectionForeground {
            lines.append("selection-foreground = \(selectionForeground)")
        }
        for index in theme.palette.keys.sorted() {
            if let color = theme.palette[index] {
                lines.append("palette = \(index)=#\(color)")
            }
        }
        return lines
    }

    private static func quotedGhosttyConfigPath(_ path: String) -> String {
        let escaped = path
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
        return "\"\(escaped)\""
    }

    private static let maximumOutputCacheBytes = 200_000

    /// Amortized O(1) per byte: trims only once the cache doubles the cap,
    /// dropping down to the cap in one memmove instead of shifting the whole
    /// buffer on every chunk at steady state.
    private func trimOutputBytesCache() {
        guard lastReceivedOutputBytes.count > Self.maximumOutputCacheBytes * 2 else {
            return
        }
        lastReceivedOutputBytes = Data(lastReceivedOutputBytes.suffix(Self.maximumOutputCacheBytes))
    }

    /// Decodes the fallback buffer only when actually captured; a leading
    /// partial UTF-8 sequence from trimming decodes to a single replacement
    /// character at worst.
    private func fallbackPlainText() -> String {
        String(decoding: lastReceivedOutputBytes, as: UTF8.self)
    }
}

/// Bridges the in-memory session's `@Sendable` resize callback (fires off the
/// main thread) onto the MainActor backend without retaining it.
private final class ViewportMetricsRelay: @unchecked Sendable {
    @MainActor var onMetrics: (@MainActor (InMemoryTerminalViewport) -> Void)?

    func dispatch(_ viewport: InMemoryTerminalViewport) {
        Task { @MainActor [weak self] in
            self?.onMetrics?(viewport)
        }
    }
}
