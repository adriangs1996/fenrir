# Module: ANSI Sanitizer (Shared)

> Pure functions for stripping/filtering ANSI escape sequences from terminal output.

## Public API

| Function                       | Input                          | Output                                    | Description                                          |
| ------------------------------ | ------------------------------ | ----------------------------------------- | ---------------------------------------------------- |
| `sanitizeTerminalHistoryChunk` | `pendingControlSequence, data` | `{ visibleText, pendingControlSequence }` | Incremental sanitization with partial sequence carry |
| `capHistory`                   | `history, maxLines`            | `string`                                  | Cap history to N lines from end                      |

### Internal Helpers (not exported)

- `isCsiFinalByte` — Detect CSI sequence terminator
- `shouldStripCsiSequence` — Filter device status reports, cursor position queries
- `shouldStripOscSequence` — Filter color query responses
- `findStringTerminatorIndex` — Locate ST/BEL terminators
- `stripStringTerminator` — Remove trailing terminator
- `isEscapeIntermediateByte` / `isEscapeFinalByte` — ESC sequence parsing

## Dependencies

None. Pure functions, zero imports.

## Usage

```typescript
import { sanitizeTerminalHistoryChunk, capHistory } from "@fenrir/shared/ansiSanitizer";
```

## File

```
packages/shared/src/ansiSanitizer.ts
```
