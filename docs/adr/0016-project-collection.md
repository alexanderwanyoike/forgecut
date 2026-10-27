# Selected-media project collection

## Decision

`collect_project` and MCP `start_project_collection` capture an explicitly identified project revision into a new folder. Choose up to 1,000 distinct asset IDs to copy; unchecked assets keep their external references. The serial media queue provides progress, cancellation, request replay and a 15-minute deadline. Editing or opening another project after admission does not alter the frozen captured revision or the collection. Completing never opens it or changes live history.

Copy one regular file at a time using Node's established [`stream.pipeline`](https://nodejs.org/api/stream.html#streampipelinesource-transforms-destination-options) pattern with an AbortSignal and 64 KiB read/write watermarks. File sizes are checked after streaming, without reading entire recordings into memory. POSIX nonblocking opens reject pipes before they can stall. No dependency or upstream code is copied. This uses the existing Node runtime APIs and its MIT-licensed implementation.

Create the destination exclusively; an existing directory is never adopted or deleted. Cancellation or failure removes only the newly owned incomplete collection. Commit begins after media copies finish. The existing atomic project writer saves component source, owned artwork/fonts and embedded notices, then publishes `project.forgecut` last. Format 8 writes copied media relative to that document. Unselected external media can use the existing missing-media/relink workflow. Interrupted collection does not resume automatically; its unpublished partial directory may need a new destination after a hard process crash.

## Verification

Public command workflows collect selected media and graphic source from a queued captured revision, preserve later manual edits and asset licences, carry actual artwork/font bytes and notices, remove the original resource cache, move the folder and reopen it. Further workflows cover cancellation during destination preparation, stale/unknown inputs and preservation of an existing directory. The official MCP SDK verifies collection, request replay after later edits and the activity label. A native desktop workflow collects actual video, moves the folder, removes its private original source, reopens and exports two frames. Visual collection controls are a separate focused delivery.
