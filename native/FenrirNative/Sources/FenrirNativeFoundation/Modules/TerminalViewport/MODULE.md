# TerminalViewport

Owns one native terminal viewport bound to one tmux pane. Renderer, clipboard,
runtime writing, and sizing are swappable ports. Public DTOs never expose raw
libGhostty, AppKit objects, server streams, auth secrets, or scrollback.

The render-input boundary strips the reserved Fenrir presence OSC (D-038) and
the standard terminal notification OSCs 9 / 99 / 777;notify (D-043) before
bytes reach the renderer, forwarding typed, sanitized signals through the
`TerminalReservedOSCForwarding` / `TerminalNotificationForwarding` ports.
Notifications are advisory UI signals only; title/body never appear on the
event stream (summaries carry counts and provenance).

Output ingest validates strict `previous + 1` sequencing. Server-declared
stream gaps (slow-client fast-forward, ring-buffer overflow) are acknowledged
via `HandleTerminalStreamGap`, which resets the sequence watermark and drops
partially buffered OSC bytes so the stream resumes cleanly; the server reseeds
screen content as a live repaint chunk. Hosts should ingest contiguous runs
through `IngestTerminalOutputBatch` (one store round trip, coalesced renderer
writes) rather than per-chunk `IngestTerminalOutput`.
