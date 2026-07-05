import Foundation
import GhosttyTheme
import Testing
@testable import TerminalViewport

@Suite("Ghostty named-theme resolution")
struct GhosttyThemeResolutionTests {
    private let catppuccin = GhosttyThemeDefinition(
        name: "Catppuccin Mocha",
        background: "1e1e2e",
        foreground: "cdd6f4",
        cursorColor: "f5e0dc",
        cursorText: "1e1e2e",
        selectionBackground: "585b70",
        selectionForeground: "cdd6f4",
        palette: [0: "45475a", 1: "f38ba8"]
    )

    private func lookup(_ name: String) -> GhosttyThemeDefinition? {
        name == "Catppuccin Mocha" ? catppuccin : nil
    }

    @Test("theme = <name> is replaced with the catalog theme's color directives, in place")
    func replacesThemeLineWithColorDirectives() {
        let input = "font-size = 17\ntheme = Catppuccin Mocha\nbackground-opacity = 1"
        let output = FenrirGhosttyTerminalBackend.ghosttyConfigResolvingNamedThemes(input, lookup: lookup)

        #expect(output.contains("background = 1e1e2e"))
        #expect(output.contains("foreground = cdd6f4"))
        #expect(output.contains("cursor-color = f5e0dc"))
        #expect(output.contains("selection-background = 585b70"))
        #expect(output.contains("palette = 0=#45475a"))
        #expect(output.contains("palette = 1=#f38ba8"))
        #expect(!output.contains("theme = Catppuccin Mocha"))
        // Ordering preserved: unrelated lines stay, and a later user override
        // would still win because directives land at the theme line's position.
        #expect(output.hasPrefix("font-size = 17\n"))
        #expect(output.hasSuffix("\nbackground-opacity = 1"))
    }

    @Test("Unresolvable theme names are left untouched")
    func leavesUnknownThemeUntouched() {
        let input = "theme = Some Unknown Theme"
        #expect(FenrirGhosttyTerminalBackend.ghosttyConfigResolvingNamedThemes(input, lookup: lookup) == input)
    }

    @Test("Path-style and commented theme lines are ignored")
    func ignoresPathsAndComments() {
        #expect(FenrirGhosttyTerminalBackend.parsedThemeDirectiveName("theme = /home/me/mytheme") == nil)
        #expect(FenrirGhosttyTerminalBackend.parsedThemeDirectiveName("# theme = Catppuccin Mocha") == nil)
        #expect(FenrirGhosttyTerminalBackend.parsedThemeDirectiveName("font-family = theme") == nil)
    }

    @Test("Quoted and dark:/light: split theme values parse to the dark name")
    func parsesQuotedAndSplitForms() {
        #expect(FenrirGhosttyTerminalBackend.parsedThemeDirectiveName("theme = \"Catppuccin Mocha\"") == "Catppuccin Mocha")
        #expect(FenrirGhosttyTerminalBackend.parsedThemeDirectiveName("theme = dark:Catppuccin Mocha,light:Catppuccin Latte") == "Catppuccin Mocha")
    }

    @Test("The real bundled catalog resolves Catppuccin Mocha to base #1e1e2e")
    func realCatalogResolvesCatppuccinBase() {
        let output = FenrirGhosttyTerminalBackend.ghosttyConfigResolvingNamedThemes("theme = Catppuccin Mocha")
        #expect(output.contains("background = 1e1e2e"))
    }
}
