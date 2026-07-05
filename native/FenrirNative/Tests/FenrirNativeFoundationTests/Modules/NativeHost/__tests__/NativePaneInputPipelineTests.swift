import Foundation
import Testing
import FenrirNativeShared
import NativeRuntime
import PaneGrid
@testable import FenrirNativeApp

@Suite("NativePaneInputPipeline coalescing keystroke pipeline")
@MainActor
struct NativePaneInputPipelineTests {
    /// Records each coalesced write and holds every call open until released,
    /// so a test can accumulate keystrokes behind an in-flight write.
    @MainActor
    private final class GatedWriter {
        private(set) var writes: [(pane: String, text: String)] = []
        var blocked = true

        func write(_ bytes: Data, _ target: PaneGrid.PaneKernelTarget) async {
            writes.append((target.paneID.rawValue, String(decoding: bytes, as: UTF8.self)))
            while blocked {
                await Task.yield()
            }
        }
    }

    private static func target(pane: String) -> PaneGrid.PaneKernelTarget {
        PaneGrid.PaneKernelTarget(
            workspaceID: "workspace-a",
            windowID: "window-a",
            tmuxWindowID: "@1",
            paneID: PaneID(rawValue: pane),
            tmuxPaneID: NativeRuntime.TmuxPaneID(rawValue: "%1")
        )
    }

    private func yieldUntil(_ condition: @MainActor () -> Bool) async {
        var spins = 0
        while !condition() {
            await Task.yield()
            spins += 1
            if spins > 100_000 {
                Issue.record("condition never became true")
                return
            }
        }
    }

    @Test("Keystrokes typed during an in-flight write coalesce into one round trip and keep order")
    func coalescesBurstBehindInflightWrite() async {
        let writer = GatedWriter()
        let pipeline = NativePaneInputPipeline { bytes, target in
            await writer.write(bytes, target)
        }

        // First keystroke starts a write that stays in flight (blocked).
        pipeline.submit(Data("a".utf8), to: Self.target(pane: "pane-a"))
        await yieldUntil { writer.writes.count == 1 }

        // Everything typed while that write is in flight accumulates.
        pipeline.submit(Data("b".utf8), to: Self.target(pane: "pane-a"))
        pipeline.submit(Data("c".utf8), to: Self.target(pane: "pane-a"))
        pipeline.submit(Data("d".utf8), to: Self.target(pane: "pane-a"))

        // Still only the first write has gone out.
        #expect(writer.writes.count == 1)

        writer.blocked = false
        await pipeline.waitForIdleForTesting()

        // Two round trips total: "a", then the coalesced "bcd" — in order.
        #expect(writer.writes.map(\.text) == ["a", "bcd"])
        #expect(writer.writes.allSatisfy { $0.pane == "pane-a" })
    }

    @Test("Distinct panes drain independently and concurrently")
    func distinctPanesDrainConcurrently() async {
        let writer = GatedWriter()
        let pipeline = NativePaneInputPipeline { bytes, target in
            await writer.write(bytes, target)
        }

        pipeline.submit(Data("x".utf8), to: Self.target(pane: "pane-a"))
        pipeline.submit(Data("y".utf8), to: Self.target(pane: "pane-b"))

        // Both panes have a write in flight at the same time — neither blocks
        // the other.
        await yieldUntil { writer.writes.count == 2 }
        #expect(Set(writer.writes.map(\.pane)) == ["pane-a", "pane-b"])

        writer.blocked = false
        await pipeline.waitForIdleForTesting()
    }

    @Test("A quiet pane drains fully and can start a fresh write later")
    func drainsFullyThenRestarts() async {
        let writer = GatedWriter()
        writer.blocked = false
        let pipeline = NativePaneInputPipeline { bytes, target in
            await writer.write(bytes, target)
        }

        pipeline.submit(Data("first".utf8), to: Self.target(pane: "pane-a"))
        await pipeline.waitForIdleForTesting()

        pipeline.submit(Data("second".utf8), to: Self.target(pane: "pane-a"))
        await pipeline.waitForIdleForTesting()

        #expect(writer.writes.map(\.text) == ["first", "second"])
    }

    @Test("Empty submissions are ignored")
    func ignoresEmptySubmissions() async {
        let writer = GatedWriter()
        writer.blocked = false
        let pipeline = NativePaneInputPipeline { bytes, target in
            await writer.write(bytes, target)
        }

        pipeline.submit(Data(), to: Self.target(pane: "pane-a"))
        await pipeline.waitForIdleForTesting()

        #expect(writer.writes.isEmpty)
    }
}
