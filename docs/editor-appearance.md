# Editor appearance

The editor uses an aluminum surface palette with independent light/dark modes and five restrained accent colors. The choice is stored locally on this device. Content, project data and exported graphics do not change when the interface appearance changes.

Muzo's separation of material, mode and accent informed the theme tokens. Showbiz's clear panel zones and consistent icon/text controls informed the editor hierarchy. Auto-digger and Openbox were inspected as references for surface contrast and selection colors. Their code and assets were not copied.

Production controls use these established implementations:

- [Radix UI](https://www.radix-ui.com/primitives/docs/components/tooltip) provides keyboard-aware tooltips and the dismissible appearance popover, including focus management and collision handling. Both packages use the MIT license.
- [Lucide](https://lucide.dev/guide/packages/lucide-react) provides consistent SVG icons with accessible names supplied by the surrounding controls. Lucide uses ISC, with MIT notices for Feather-derived portions.
- [IBM Plex Sans](https://github.com/IBM/plex) supplies the offline interface typography under the SIL Open Font License.

The bundled licenses for these packages and their dependencies are shipped in `dist/ui-third-party-notices.txt` through Vite's public assets.

Application controls use `ActionButton` for fixed icon dimensions, text spacing, interaction states and tooltips. Layout styles remain separate from the appearance tokens, so an accent never changes geometry or hides a control.
