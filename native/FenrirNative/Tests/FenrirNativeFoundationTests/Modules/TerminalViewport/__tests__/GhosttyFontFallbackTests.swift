import Foundation
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
