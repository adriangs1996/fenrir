import Foundation
import FenrirNativeShared

public extension Keybinding {
    protocol KeybindingClock: Sendable {
        func now() -> FenrirTimestamp
    }
}
