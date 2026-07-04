import Foundation
import FenrirNativeShared

/// D-045 workspace git/PR probe contracts.
///
/// Mirrors the server's `workspace.gitProbe` WS contract
/// (`WorkspaceGitProbeResult` in `packages/contracts`): branch, ahead/behind
/// and PR number/state/checks for a workspace row. The probe is served and
/// cached server-side — the native client only decodes these snapshots and
/// never shells out to `git`/`gh` or scrapes panes for this data.
public extension WorkspaceIndex {
    enum WorkspaceGitPullRequestState: String, Codable, Equatable, Sendable {
        case open
        case draft
        case merged
        case closed
    }

    enum WorkspaceGitChecksState: String, Codable, Equatable, Sendable {
        case pass
        case fail
        case pending
        case unknown
    }

    struct WorkspaceGitPullRequestStatus: Codable, Equatable, Sendable {
        public let number: Int
        public let state: WorkspaceGitPullRequestState
        public let checks: WorkspaceGitChecksState
        public let url: String?

        public init(
            number: Int,
            state: WorkspaceGitPullRequestState,
            checks: WorkspaceGitChecksState,
            url: String? = nil
        ) {
            self.number = number
            self.state = state
            self.checks = checks
            self.url = url
        }
    }

    struct WorkspaceGitProbeSnapshot: Codable, Equatable, Sendable {
        /// Current branch, or nil when detached / not a repository.
        public let branch: String?
        /// Commits ahead of upstream; nil when unknown (no upstream / no repo).
        public let ahead: Int?
        /// Commits behind upstream; nil when unknown (no upstream / no repo).
        public let behind: Int?
        /// PR for the current branch; nil when none or unknowable (gh absent).
        public let pr: WorkspaceGitPullRequestStatus?

        public init(
            branch: String? = nil,
            ahead: Int? = nil,
            behind: Int? = nil,
            pr: WorkspaceGitPullRequestStatus? = nil
        ) {
            self.branch = branch
            self.ahead = ahead
            self.behind = behind
            self.pr = pr
        }
    }

    /// Decodes a `workspace.gitProbe` response payload.
    static func decodeWorkspaceGitProbeSnapshot(from data: Data) throws -> WorkspaceGitProbeSnapshot {
        try JSONDecoder().decode(WorkspaceGitProbeSnapshot.self, from: data)
    }

    /// Sidebar PR chip tone. Maps 1:1 onto the `NativeShellThemeTokens`
    /// badge colors (D-041: all chrome colors flow through theme tokens).
    enum WorkspaceGitPullRequestChipTone: String, Equatable, Sendable {
        case ok
        case attention
        case failure
    }

    /// Render-ready projection of a probe snapshot for the workspace row
    /// (PR number + state glyph + tone), kept UI-framework-free so the
    /// mapping is testable in the Foundation target.
    struct WorkspaceGitPullRequestChip: Equatable, Sendable {
        public let number: Int
        public let glyph: String
        public let tone: WorkspaceGitPullRequestChipTone
        public let accessibilityLabel: String

        public init(
            number: Int,
            glyph: String,
            tone: WorkspaceGitPullRequestChipTone,
            accessibilityLabel: String
        ) {
            self.number = number
            self.glyph = glyph
            self.tone = tone
            self.accessibilityLabel = accessibilityLabel
        }
    }

    /// D-045 chip state mapping: ok = open with passing (or unreported)
    /// checks and merged PRs; attention = drafts and pending checks;
    /// failure = failing checks and closed PRs.
    static func pullRequestChip(
        from snapshot: WorkspaceGitProbeSnapshot?
    ) -> WorkspaceGitPullRequestChip? {
        guard let pr = snapshot?.pr else {
            return nil
        }

        let tone: WorkspaceGitPullRequestChipTone
        if pr.state == .closed || pr.checks == .fail {
            tone = .failure
        } else if pr.state == .draft || pr.checks == .pending {
            tone = .attention
        } else {
            tone = .ok
        }

        let glyph: String
        switch pr.state {
        case .open:
            glyph = "●"
        case .draft:
            glyph = "◌"
        case .merged:
            glyph = "✓"
        case .closed:
            glyph = "✕"
        }

        return WorkspaceGitPullRequestChip(
            number: pr.number,
            glyph: glyph,
            tone: tone,
            accessibilityLabel: "PR #\(pr.number) \(pr.state.rawValue), checks \(pr.checks.rawValue)"
        )
    }
}
