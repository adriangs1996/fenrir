import Foundation
import FenrirNativeShared

public extension TerminalViewport {
    protocol TerminalViewportClock: Sendable {
        func now() -> FenrirTimestamp
    }

    protocol TerminalViewportStore: Sendable {
        func loadViewport(viewportID: ViewportID) async throws -> State?
        func saveViewport(_ state: State) async throws
        func deleteViewport(viewportID: ViewportID) async throws
    }

    protocol TerminalRendererHosting: Sendable {
        func createRenderer(_ input: CreateTerminalViewportInput) async throws -> RendererDescriptor
        func destroyRenderer(viewportID: ViewportID) async throws
        func focusRenderer(viewportID: ViewportID, focused: Bool) async throws
    }

    protocol TerminalRendererWriting: Sendable {
        func ingestOutput(viewportID: ViewportID, bytes: Data) async throws
    }

    protocol TerminalRendererSizing: Sendable {
        func resizeRenderer(viewportID: ViewportID, size: Size) async throws
    }

    protocol TerminalRendererContextReading: Sendable {
        func readSelection(viewportID: ViewportID) async throws -> CapturedTextBuffer
        func readViewport(viewportID: ViewportID) async throws -> CapturedTextBuffer
        func readLastLines(viewportID: ViewportID, maxLines: Int?) async throws -> CapturedTextBuffer
    }

    protocol TerminalContextRedacting: Sendable {
        func redactTerminalContext(_ context: CapturedContext) async throws -> RedactedCapture
    }

    protocol TerminalRuntimeWriting: Sendable {
        func writeTerminalInput(_ input: SendTerminalInputInput) async throws -> RuntimeWriteAcknowledgement
    }

    protocol TerminalRuntimeResizing: Sendable {
        func resizeTerminalPane(_ input: ResizeTerminalViewportInput) async throws -> RuntimeResizeAcknowledgement
    }

    protocol TerminalReservedOSCForwarding: Sendable {
        func forwardReservedOSC(_ signal: ReservedOSCSignal) async throws
    }

    protocol TerminalNotificationForwarding: Sendable {
        func forwardTerminalNotification(_ event: TerminalNotificationEvent) async throws
    }

    protocol TerminalViewportEventPublishing: Sendable {
        func publish(_ event: EventEnvelope<Event>) async
    }
}
