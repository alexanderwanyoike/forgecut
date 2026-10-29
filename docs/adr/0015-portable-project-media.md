# Portable project media paths

## Decision

Project format 8 stores media inside the project document's folder using relative paths with forward slashes. Media outside that folder keeps its absolute path. Loading resolves relative media paths against the project document's folder before checking missing media or publishing the project. The live editor and its history keep absolute paths; saving changes only the serialized copy. Moving the whole folder preserves its local media. Moving only the project document requires those relative dependencies to accompany it.

This follows [Shotcut's documented project management pattern](https://forum.shotcut.org/t/project-management/12574/1). Use Node's existing path utilities and the existing atomic project/resource writer. No upstream code is copied and no dependency is added. Formats through 7 migrate to 8 while preserving project, sequence, item, asset and credit identities. Older editors reject format 8 rather than silently resolving its relative media from their working directory. Foreign Windows drive paths remain external on other systems so the existing missing-media and relink controls can handle them.

Owned artwork, fonts, notices and component source retain their existing project/resource persistence. This change does not copy recordings. Selected-media collection follows as a separate focused feature, using this save/load behavior. External recordings can still be intentionally excluded and relinked.

## Verification

A public persistence workflow saves local and external media without changing live state/history, moves the folder, reopens it, resolves local media and reports an unavailable external file. Existing history, recovery, credit and sequence migration tests remain supported, including version 7. The native desktop workflow imports actual video, saves, moves the folder, reopens through IPC and exports two frames from the moved media.
