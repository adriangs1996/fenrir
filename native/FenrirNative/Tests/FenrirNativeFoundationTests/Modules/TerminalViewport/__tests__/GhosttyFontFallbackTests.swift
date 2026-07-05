import Foundation
import GhosttyTerminal
import Testing
@testable import TerminalViewport

@Suite("Ghostty config font fallback chain")
struct GhosttyFontFallbackTests {
    @Test("Fallback lines cover both families when installed, in priority order")
    func fallbackLinesForAllInstalledFamilies() {
        let lines = FenrirGhosttyTerminalBackend.ghosttyFontFallbackConfigLines { _ in true }

        #expect(lines == [
            "font-family = \"JetBrainsMonoNL Nerd Font\"",
            "font-family = \"Menlo\""
        ])
    }

    @Test("Only installed families are appended")
    func fallbackLinesSkipMissingFamilies() {
        let lines = FenrirGhosttyTerminalBackend.ghosttyFontFallbackConfigLines { $0 == "Menlo" }

        #expect(lines == ["font-family = \"Menlo\""])
    }

    @Test("No installed fallback family means no appended lines")
    func fallbackLinesEmptyWhenNothingInstalled() {
        let lines = FenrirGhosttyTerminalBackend.ghosttyFontFallbackConfigLines { _ in false }

        #expect(lines.isEmpty)
    }

    @Test("Fallback lines are appended after the user's config so user entries keep priority")
    func fallbackAppendsAfterUserConfig() {
        let userConfig = "font-family = JetBrainsMono Nerd Font\nfont-size = 13"

        let combined = FenrirGhosttyTerminalBackend.ghosttyConfigAppendingFontFallback(to: userConfig) { _ in true }

        #expect(combined == """
        font-family = JetBrainsMono Nerd Font
        font-size = 13
        font-family = "JetBrainsMonoNL Nerd Font"
        font-family = "Menlo"
        """)
    }

    @Test("User config is returned untouched when no fallback family is installed")
    func userConfigUntouchedWithoutInstalledFallbacks() {
        let userConfig = "font-family = Custom\n"

        let combined = FenrirGhosttyTerminalBackend.ghosttyConfigAppendingFontFallback(to: userConfig) { _ in false }

        #expect(combined == userConfig)
    }
}

@Suite("Ghostty cell-exact surface sizing")
struct GhosttyExactSurfaceSizeTests {
    @Test("Target pixel size lands the derived grid exactly on the tmux grid")
    func exactSizePreservesRemainderBelowOneCell() {
        // Reported: 90x30 grid, 20x40px cells, 8px h-padding, 12px v-padding.
        let reported = InMemoryTerminalViewport(
            columns: 90, rows: 30,
            widthPixels: 90 * 20 + 8, heightPixels: 30 * 40 + 12,
            cellWidthPixels: 20, cellHeightPixels: 40
        )
        let target = FenrirGhosttyTerminalBackend.exactSurfacePixelSize(
            desired: TerminalViewport.Size(columns: 84, rows: 14, pixelWidth: 1, pixelHeight: 1),
            reported: reported
        )

        #expect(target?.width == CGFloat(84 * 20 + 8))
        #expect(target?.height == CGFloat(14 * 40 + 12))
        // The remainder stays below one cell, so ghostty derives exactly 84x14.
        #expect(Int((target!.width - 8) / 20) == 84)
        #expect(Int((target!.height - 12) / 40) == 14)
    }

    @Test("Missing cell metrics produce no target")
    func exactSizeRequiresCellMetrics() {
        let target = FenrirGhosttyTerminalBackend.exactSurfacePixelSize(
            desired: TerminalViewport.Size(columns: 84, rows: 14, pixelWidth: 1, pixelHeight: 1),
            reported: InMemoryTerminalViewport(columns: 90, rows: 30)
        )

        #expect(target == nil)
    }
}
