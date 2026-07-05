import Foundation
import Testing
import FenrirNativeShared
import Keybinding

@Suite("Tmux key spec parser")
struct TmuxKeySpecParserTests {
    @Test(
        "Parses tmux key syntax into KeyStrokes",
        arguments: [
            // plain characters
            ("a", Keybinding.KeyStroke("a")),
            ("%", Keybinding.KeyStroke("%")),
            ("0", Keybinding.KeyStroke("0")),
            ("[", Keybinding.KeyStroke("[")),
            ("~", Keybinding.KeyStroke("~")),
            // shell escapes as printed by list-keys
            ("\\;", Keybinding.KeyStroke(";")),
            ("\\\"", Keybinding.KeyStroke("\"")),
            ("\\{", Keybinding.KeyStroke("{")),
            ("\\'", Keybinding.KeyStroke("'")),
            // control
            ("C-s", Keybinding.KeyStroke.control("s")),
            ("C-S", Keybinding.KeyStroke.control("s")),
            ("^A", Keybinding.KeyStroke.control("a")),
            ("C-\\\\", Keybinding.KeyStroke.control("\\")),
            // meta / option
            ("M-1", Keybinding.KeyStroke("1", modifiers: [.option])),
            ("M-n", Keybinding.KeyStroke("n", modifiers: [.option])),
            // shift folds into letters, stays on named keys
            ("S-a", Keybinding.KeyStroke("A")),
            ("S-F5", Keybinding.KeyStroke("F5", modifiers: [.shift])),
            ("S-Up", Keybinding.KeyStroke("Up", modifiers: [.shift])),
            // stacked modifiers in any order
            ("C-M-x", Keybinding.KeyStroke("x", modifiers: [.control, .option])),
            ("M-C-x", Keybinding.KeyStroke("x", modifiers: [.control, .option])),
            ("C-Up", Keybinding.KeyStroke("Up", modifiers: [.control])),
            ("M-Right", Keybinding.KeyStroke("Right", modifiers: [.option])),
            // named keys and aliases
            ("Space", Keybinding.KeyStroke.space),
            ("Escape", Keybinding.KeyStroke.escape),
            ("Esc", Keybinding.KeyStroke.escape),
            ("Enter", Keybinding.KeyStroke("Enter")),
            ("Tab", Keybinding.KeyStroke("Tab")),
            ("BSpace", Keybinding.KeyStroke("BSpace")),
            ("BTab", Keybinding.KeyStroke("BTab")),
            ("DC", Keybinding.KeyStroke("DC")),
            ("IC", Keybinding.KeyStroke("IC")),
            ("Home", Keybinding.KeyStroke("Home")),
            ("End", Keybinding.KeyStroke("End")),
            ("Up", Keybinding.KeyStroke("Up")),
            ("Down", Keybinding.KeyStroke("Down")),
            ("Left", Keybinding.KeyStroke("Left")),
            ("Right", Keybinding.KeyStroke("Right")),
            ("PPage", Keybinding.KeyStroke("PPage")),
            ("NPage", Keybinding.KeyStroke("NPage")),
            ("PageUp", Keybinding.KeyStroke("PPage")),
            ("PgDn", Keybinding.KeyStroke("NPage")),
            ("F1", Keybinding.KeyStroke("F1")),
            ("F12", Keybinding.KeyStroke("F12"))
        ] as [(String, Keybinding.KeyStroke)]
    )
    func parsesKeySpecs(spec: String, expected: Keybinding.KeyStroke) {
        #expect(Keybinding.TmuxKeySpecParser.parse(spec) == .success(expected))
    }

    @Test(
        "Rejects unparseable specs",
        arguments: [
            "",
            "C-",
            "M-",
            "MouseDown1Pane",
            "MouseDown3Status",
            "WheelUpStatus",
            "WheelUpPane",
            "DoubleClick1Pane",
            "TripleClick1Pane",
            "MouseDrag1Border",
            "MouseDown1Control8",
            "M-MouseDown3Pane"
        ]
    )
    func rejectsUnparseableSpecs(spec: String) {
        switch Keybinding.TmuxKeySpecParser.parse(spec) {
        case .success:
            Issue.record("Expected \(spec) to be unparseable")
        case .failure:
            ()
        }
    }

    @Test("Mouse key names fail with unknownKeyName so importers can record diagnostics")
    func mouseKeysFailWithUnknownName() {
        #expect(Keybinding.TmuxKeySpecParser.parse("MouseDown1Pane")
            == .failure(.unknownKeyName("MouseDown1Pane")))
        #expect(Keybinding.TmuxKeySpecParser.parse("M-MouseDown3Pane")
            == .failure(.unknownKeyName("M-MouseDown3Pane")))
        #expect(Keybinding.TmuxKeySpecParser.parse("C-") == .failure(.danglingModifier("C-")))
        #expect(Keybinding.TmuxKeySpecParser.parse("") == .failure(.emptySpec))
    }

    @Test("KeyStrokes expose AppKit matching data for an NSEvent adapter")
    func keyStrokesExposeAppKitMatchingData() {
        #expect(Keybinding.KeyStroke("Up").appKitCharactersIgnoringModifiers == "\u{F700}")
        #expect(Keybinding.KeyStroke("Down").appKitCharactersIgnoringModifiers == "\u{F701}")
        #expect(Keybinding.KeyStroke("F5").appKitCharactersIgnoringModifiers == "\u{F708}")
        #expect(Keybinding.KeyStroke("PPage").appKitCharactersIgnoringModifiers == "\u{F72C}")
        #expect(Keybinding.KeyStroke.escape.appKitCharactersIgnoringModifiers == "\u{1B}")
        #expect(Keybinding.KeyStroke.space.character == " ")
        #expect(Keybinding.KeyStroke("s", modifiers: [.control]).appKitCharactersIgnoringModifiers == "s")
        #expect(Keybinding.KeyStroke("s").character == "s")
        #expect(Keybinding.KeyStroke("Escape").specialKey == .escape)
        #expect(Keybinding.KeyStroke("NotAKey").appKitCharactersIgnoringModifiers == nil)
    }
}
