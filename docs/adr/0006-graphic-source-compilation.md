# Graphic source compilation

Date: 24 October 2026.

Status: source checking implemented. Isolated custom preview, promotion and the code tab follow in Phase 6.

## Decision

Compile project TSX in a separate, bounded process. Use the existing pinned esbuild 0.25.12 plugin API to resolve only the supplied workspace files and the approved React, Remotion and font-loader imports. TypeScript 5.9.3 checks user files in strict mode through a virtual CompilerHost. Its only files are the supplied source and prepared type declarations; it does not fall back to reading the host filesystem. Vendor declaration checking is skipped, while user source checking remains strict.

The existing component workspace limits apply: 32 files, 128 KiB per file and 512 KiB total. Compiled code is limited to 2 MiB, compiler output to 4 MiB, diagnostics to 100 entries and checking to 15 seconds. Cancellation terminates the compiler process tree. The existing Linux user-scope CPU/memory budget also applies where available. Compilation parses and transforms source without executing it. This process separation does not substitute for the execution boundary required before custom preview or promotion is enabled.

The native check returns a typed compilation Result with located diagnostics. Operational failures retain the command Result boundary. MCP starts checking through the existing serial, cancellable job queue and returns diagnostics without returning the compiled bundle. The active project and its history remain unchanged.

Prepare the worker, esbuild executable, API module, type declarations and notices during the build. Keep esbuild's API external to the worker bundle, following its own packaging requirement, and supply its prepared executable explicitly. Package these files outside ASAR. Tests prepare this small runtime before running, so a fresh checkout does not depend on an earlier application build. No compiler or type-library downloads happen while checking a project.

## Upstream patterns and licences

The [TypeScript Compiler API](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API) informs the virtual host and diagnostics. TypeScript is Apache-2.0 licensed. The [esbuild plugin API](https://esbuild.github.io/plugins/) informs workspace resolution; esbuild is MIT licensed. The prepared runtime retains their licence texts and the notices for the shipped React, CSS and Remotion declarations. Remotion's own terms and the public-release requirements in ADR 0001 continue to apply.

## Verification

Maintained tests check a local TSX import, strict type errors, syntax errors and forbidden Node imports. A top-level sentinel proves source is not executed during checking. An official MCP SDK workflow checks the actual packaged title source through the running owner's job queue. The compiled STDIO/native Electron smoke also checks source from an unrelated working directory. These checks establish compilation and transport, not custom-code execution isolation.
