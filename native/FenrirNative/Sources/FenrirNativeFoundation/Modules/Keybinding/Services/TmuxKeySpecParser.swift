import Foundation
import FenrirNativeShared

public extension Keybinding {
    /// Parses tmux key syntax — the key column of `list-keys` output — into a
    /// `KeyStroke` an AppKit adapter can later match against NSEvents.
    ///
    /// Supported forms:
    /// - modifier prefixes `C-`, `M-`, `S-`, stacked in any order (`C-M-x`)
    /// - caret control form `^A`
    /// - shell escapes as printed by `list-keys` (`\;`, `\"`, `C-\\`)
    /// - named keys (case-insensitive, incl. aliases): Escape/Esc, Space,
    ///   Enter, Tab, BSpace, BTab, IC, DC, Home, End, PPage/PageUp/PgUp,
    ///   NPage/PageDown/PgDn, Up/Down/Left/Right, F1–F12
    /// - plain single characters
    ///
    /// Normalization mirrors tmux: `C-S` equals `C-s` (control keys are
    /// case-folded) and `S-a` becomes `A` (shift folds into the character for
    /// letters; it is kept for named keys such as `S-F5`).
    ///
    /// Unparseable specs (tmux mouse key names like `MouseDown1Pane`,
    /// dangling modifiers, empty strings) are rejected with a typed error so
    /// importers can record diagnostics instead of guessing.
    enum TmuxKeySpecParser {
        public static func parse(_ spec: String) -> Result<KeyStroke, TmuxKeySpecError> {
            guard !spec.isEmpty else {
                return .failure(.emptySpec)
            }

            var working = Substring(spec)
            var modifiers: Set<KeyModifier> = []

            var strippedModifier = true
            while strippedModifier {
                strippedModifier = false
                for (prefix, modifier) in modifierPrefixes where working.count > 2 && working.hasPrefix(prefix) {
                    modifiers.insert(modifier)
                    working.removeFirst(2)
                    strippedModifier = true
                    break
                }
            }

            if working.count == 2, working.hasPrefix("^") {
                modifiers.insert(.control)
                working.removeFirst()
            }

            if working.count == 2,
               working.hasSuffix("-"),
               let first = working.first,
               ["C", "M", "S"].contains(String(first)) {
                return .failure(.danglingModifier(spec))
            }

            if working.count == 2, working.hasPrefix("\\") {
                working.removeFirst()
            }

            if working.count == 1 {
                var character = String(working)
                if modifiers.contains(.control) {
                    character = character.lowercased()
                }
                if modifiers.contains(.shift),
                   let scalar = character.unicodeScalars.first,
                   CharacterSet.letters.contains(scalar) {
                    character = character.uppercased()
                    modifiers.remove(.shift)
                }
                return .success(KeyStroke(character, modifiers: modifiers))
            }

            if let special = KeyStroke.SpecialKey.canonical(named: String(working)) {
                return .success(KeyStroke(special.rawValue, modifiers: modifiers))
            }

            return .failure(.unknownKeyName(spec))
        }

        public static func reason(for error: TmuxKeySpecError) -> String {
            switch error {
            case .emptySpec:
                return "Empty tmux key spec"
            case let .danglingModifier(spec):
                return "Dangling modifier in tmux key spec: \(spec)"
            case let .unknownKeyName(spec):
                return "Unknown tmux key name (not matchable by a keyboard adapter): \(spec)"
            }
        }

        private static let modifierPrefixes: [(String, KeyModifier)] = [
            ("C-", .control),
            ("M-", .option),
            ("S-", .shift)
        ]
    }
}
