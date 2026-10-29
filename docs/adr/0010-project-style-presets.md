# Project style presets

## Decision

A project style preset is a named snapshot of an editable graphic: an exact component ID/version, validated property values, layer settings, optional placement, and the canvas size it was saved on. Its purpose is a card or ending. Presets share approved project font/image resources with their instances.

This follows [Remotion's parameterized rendering model](https://www.remotion.dev/docs/parameterized-rendering): validated defaults are copied into an instance and explicit input values take precedence. The reference informs the props policy; no implementation is copied and no dependency is added.

`save_style_preset` reads an explicitly identified source sequence and graphic. It creates a preset, or replaces the explicitly supplied preset ID. Saving and deleting styles are global history actions. `delete_style_preset` removes the saved style without changing existing instances.

`add_graphic_from_preset` creates a new independent timeline item in the explicitly targeted sequence. Geometry bindings scale from the captured canvas to the destination, with typography scaled by the smaller axis ratio and existing property bounds respected. Placement scales on each axis. Explicit property overrides are applied last. Layer settings are copied. Editing either the instance or the saved preset does not update the other.

Presets pin component versions. Shared source promotion retains any prior version still referenced by a preset, even when no timeline item uses it. The complete project validator checks preset identities, component versions, properties, layer identities and font/image references before publication. Invalid edits leave state and history unchanged.

Project format 6 adds `style_presets`, limited to 100 records. Supported older formats migrate with an empty list while preserving their established sequence identities and content. Older editors reject format 6 before replacing their open project. Names are limited to 200 characters; existing component, property and resource limits apply.

## Verification

Native editing workflows cover save/reopen, independent instance values and overrides, portrait geometry, layer settings and placement, invalid property rollback, explicit replacement/deletion with global undo, and component retention during shared source promotion. Existing project migration tests include format 5.

The bounded MCP read surface pages up to 20 style identities/layout records or five saved property values. The lower value-page limit accommodates maximum-length text without exceeding local transport bounds. Existing guarded edit batches expose the native style commands through the common command schema. The Inspector saves the applied graphic or explicitly replaces a chosen style. The timeline graphic picker lists project styles with templates and can delete a saved style without selecting an item. Open form drafts survive agent replacement/deletion of their destination; replacement requires explicitly reloading changed saved details. Deleting a destination can become a new style without losing typed metadata.

The packaged UI workflow exercises style creation, timeline insertion, manual wording, explicit replacement/deletion and undo. Aluminum layout checks cover the open style form in both themes at 1280 and 1024 pixels.
