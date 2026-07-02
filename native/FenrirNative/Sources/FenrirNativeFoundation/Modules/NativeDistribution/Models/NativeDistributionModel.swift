import Foundation

extension NativeDistribution {
    struct DistributionReadinessState: Sendable {
        var lastReport: StartupReadinessReport?

        init(lastReport: StartupReadinessReport? = nil) {
            self.lastReport = lastReport
        }
    }
}
