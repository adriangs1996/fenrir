import Foundation
import FenrirNativeShared

extension AuthSession {
    enum LayerBoundary {
        static let secureStorageOwner = "Keychain-backed implementations stay behind AuthSecureStorage."
    }
}
