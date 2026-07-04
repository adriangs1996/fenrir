import Foundation
import Testing
import FenrirNativeShared
import WorkspaceIndex

@Suite("WorkspaceIndex git/PR probe contracts (D-045)")
struct WorkspaceGitProbeContractsTests {
    // MARK: - Contract decode fixtures (server workspace.gitProbe payloads)

    @Test("Decodes a full probe payload with an open passing PR")
    func decodesFullProbePayload() throws {
        let fixture = Data("""
        {
          "branch": "feature/probe",
          "ahead": 2,
          "behind": 1,
          "pr": {
            "number": 128,
            "state": "open",
            "checks": "pass",
            "url": "https://github.com/acme/fenrir/pull/128"
          }
        }
        """.utf8)

        let snapshot = try WorkspaceIndex.decodeWorkspaceGitProbeSnapshot(from: fixture)

        #expect(snapshot == WorkspaceIndex.WorkspaceGitProbeSnapshot(
            branch: "feature/probe",
            ahead: 2,
            behind: 1,
            pr: WorkspaceIndex.WorkspaceGitPullRequestStatus(
                number: 128,
                state: .open,
                checks: .pass,
                url: "https://github.com/acme/fenrir/pull/128"
            )
        ))
    }

    @Test("Decodes a repo-less probe payload (all nulls)")
    func decodesRepoLessProbePayload() throws {
        let fixture = Data(#"{"branch":null,"ahead":null,"behind":null,"pr":null}"#.utf8)

        let snapshot = try WorkspaceIndex.decodeWorkspaceGitProbeSnapshot(from: fixture)

        #expect(snapshot == WorkspaceIndex.WorkspaceGitProbeSnapshot())
    }

    @Test("Decodes a branch without a PR (gh absent or no PR)")
    func decodesBranchWithoutPullRequest() throws {
        let fixture = Data(#"{"branch":"main","ahead":0,"behind":3,"pr":null}"#.utf8)

        let snapshot = try WorkspaceIndex.decodeWorkspaceGitProbeSnapshot(from: fixture)

        #expect(snapshot.branch == "main")
        #expect(snapshot.ahead == 0)
        #expect(snapshot.behind == 3)
        #expect(snapshot.pr == nil)
    }

    @Test("Decodes every PR state and checks value the contract allows")
    func decodesAllStateAndChecksValues() throws {
        for (state, checks) in [("draft", "pending"), ("merged", "unknown"), ("closed", "fail")] {
            let fixture = Data("""
            {"branch":"b","ahead":null,"behind":null,
             "pr":{"number":7,"state":"\(state)","checks":"\(checks)","url":""}}
            """.utf8)

            let snapshot = try WorkspaceIndex.decodeWorkspaceGitProbeSnapshot(from: fixture)

            #expect(snapshot.pr?.state.rawValue == state)
            #expect(snapshot.pr?.checks.rawValue == checks)
        }
    }

    @Test("Rejects payloads with an unknown PR state")
    func rejectsUnknownPullRequestState() {
        let fixture = Data(#"{"branch":"b","ahead":null,"behind":null,"pr":{"number":7,"state":"reopened","checks":"pass","url":""}}"#.utf8)

        #expect(throws: (any Error).self) {
            _ = try WorkspaceIndex.decodeWorkspaceGitProbeSnapshot(from: fixture)
        }
    }

    // MARK: - Chip projection mapping (themed-token tones, D-041)

    @Test("Open PR with passing checks renders the ok tone")
    func openPassingIsOk() {
        let chip = WorkspaceIndex.pullRequestChip(from: snapshot(state: .open, checks: .pass))

        #expect(chip?.tone == .ok)
        #expect(chip?.glyph == "●")
        #expect(chip?.number == 42)
    }

    @Test("Open PR with unreported checks stays ok (open means healthy)")
    func openUnknownIsOk() {
        #expect(WorkspaceIndex.pullRequestChip(from: snapshot(state: .open, checks: .unknown))?.tone == .ok)
    }

    @Test("Merged PR renders the ok tone with the merged glyph")
    func mergedIsOk() {
        let chip = WorkspaceIndex.pullRequestChip(from: snapshot(state: .merged, checks: .unknown))

        #expect(chip?.tone == .ok)
        #expect(chip?.glyph == "✓")
    }

    @Test("Draft PRs and pending checks render the attention tone")
    func draftAndPendingAreAttention() {
        #expect(WorkspaceIndex.pullRequestChip(from: snapshot(state: .draft, checks: .pass))?.tone == .attention)
        #expect(WorkspaceIndex.pullRequestChip(from: snapshot(state: .draft, checks: .pass))?.glyph == "◌")
        #expect(WorkspaceIndex.pullRequestChip(from: snapshot(state: .open, checks: .pending))?.tone == .attention)
    }

    @Test("Failing checks and closed PRs render the failure tone")
    func failAndClosedAreFailure() {
        #expect(WorkspaceIndex.pullRequestChip(from: snapshot(state: .open, checks: .fail))?.tone == .failure)
        #expect(WorkspaceIndex.pullRequestChip(from: snapshot(state: .draft, checks: .fail))?.tone == .failure)
        let closed = WorkspaceIndex.pullRequestChip(from: snapshot(state: .closed, checks: .pass))
        #expect(closed?.tone == .failure)
        #expect(closed?.glyph == "✕")
    }

    @Test("No PR (or no snapshot) projects no chip")
    func absentPullRequestProjectsNoChip() {
        #expect(WorkspaceIndex.pullRequestChip(from: nil) == nil)
        #expect(WorkspaceIndex.pullRequestChip(from: WorkspaceIndex.WorkspaceGitProbeSnapshot(branch: "main")) == nil)
    }

    @Test("Accessibility label carries number, state and checks")
    func accessibilityLabelCarriesDetail() {
        let chip = WorkspaceIndex.pullRequestChip(from: snapshot(state: .open, checks: .pending))

        #expect(chip?.accessibilityLabel == "PR #42 open, checks pending")
    }

    private func snapshot(
        state: WorkspaceIndex.WorkspaceGitPullRequestState,
        checks: WorkspaceIndex.WorkspaceGitChecksState
    ) -> WorkspaceIndex.WorkspaceGitProbeSnapshot {
        WorkspaceIndex.WorkspaceGitProbeSnapshot(
            branch: "feature/probe",
            ahead: 1,
            behind: 0,
            pr: WorkspaceIndex.WorkspaceGitPullRequestStatus(
                number: 42,
                state: state,
                checks: checks,
                url: "https://github.com/acme/fenrir/pull/42"
            )
        )
    }
}
