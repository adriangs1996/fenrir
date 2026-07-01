import Foundation
import FenrirNativeShared

extension ServerConnection {
    struct ServerConnectionModel: Sendable {
        var session: Session?
        var generation: UInt64
    }
}
