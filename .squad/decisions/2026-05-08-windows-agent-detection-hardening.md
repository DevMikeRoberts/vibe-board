# Decision: Windows Agent Detection Hardening
**Date:** 2026-05-08T15:12:21Z  
**Status:** IMPLEMENTED  
**Impact:** Agent runtime availability detection  
**Effort:** Medium (1–2 sprint points)  

---

## Problem Statement

The board server's agent detection mechanism (`@codewithdan/agent-sdk-core`) runs at startup via `execFile()` and does not account for:
- Windows WinGet package manager integration (executables installed to `AppData\Local\...\Links\`)
- Shell-specific command resolution (PowerShell's `Get-Command` vs. raw `PATH` search)
- npm shim compatibility quirks on Windows

Result: Copilot can be available in the shell but reported as unavailable by the server until restart.

---

## Recommended Approach

### Short Term: Shell-Aware Fallback (Minimal)
In server startup detection, for Windows only:
```typescript
// Try direct execFile first (existing behavior)
// If fails AND Windows:
//   Try: powershell -Command "Get-Command copilot" 
//   or: where.exe copilot
```

**Benefit:** Catches WinGet-installed CLIs; aligns with user shell behavior  
**Risk:** Minimal; fallback only if direct check fails  

### Medium Term: Expose Diagnostics
Modify `/api/agents` response to include:
```json
{
  "copilot": false,
  "copilot_reason": "ENOENT",
  "copilot_stderr": "not found in PATH"
}
```

**Benefit:** Users can self-diagnose; enables better error messages  
**Risk:** API surface change; minor versioning consideration  

### Long Term: Align with Provider Runtime
Move detection from startup to provider initialization, or expose `/api/agents/refresh` endpoint to re-detect on demand.

**Benefit:** Eliminates stale cache; detects changes during development  
**Risk:** Timing implications for startup; may mask transient failures  

---

## Decision

Implement SDK-first Windows hardening in the board server. Keep `@codewithdan/agent-sdk-core` as the primary detector, then normalize only the Copilot result on Windows when the SDK reports unavailable.

The fallback discovers candidates with `where.exe copilot`, PowerShell `Get-Command copilot`, and direct PATH executable lookup. It verifies each discovered candidate by explicit path with `--version`, then `version`, then `--help`; Copilot is marked available only when one explicit health probe succeeds.

---

## Follow-ups

- Consider a future `/api/agents/refresh` endpoint for re-detecting providers without a server restart.
- Consider filing an upstream issue with `@codewithdan/agent-sdk-core` after collecting other Windows provider cases.
