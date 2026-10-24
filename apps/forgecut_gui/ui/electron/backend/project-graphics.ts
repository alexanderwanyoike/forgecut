import type { Project } from "../shared/ipc-contract.js";
import { validateGraphicProperties } from "../domain/graphic-properties.js";
import { componentVersion } from "./graphic-component.js";

export function validateProjectGraphics(project: Project): void {
  const versions = new Set<string>();
  for (const component of project.components ?? []) {
    const key = `${component.id}:${component.version}`;
    if (versions.has(key)) throw new Error("Duplicate component version");
    versions.add(key);
    if (
      !Object.prototype.hasOwnProperty.call(
        component.source.files,
        component.source.entry,
      )
    )
      throw new Error("Missing component entry file");
    if (component.version !== componentVersion(component))
      throw new Error("Component content hash does not match its version");
    const ids = new Set<string>();
    for (const property of Object.values(component.properties)) {
      if (ids.has(property.id))
        throw new Error("Duplicate graphic property ID");
      ids.add(property.id);
      if (property.type === "font") requireFont(project, property.default);
    }
    const names = new Set<string>();
    for (const layer of component.layers) {
      if (ids.has(layer.id) || names.has(layer.name))
        throw new Error("Duplicate graphic layer identity");
      ids.add(layer.id);
      names.add(layer.name);
      for (const [binding, name] of Object.entries(layer.bindings)) {
        const property = component.properties[name];
        let expected = "number";
        if (binding === "text") expected = "text";
        if (binding === "color") expected = "color";
        if (property?.type !== expected)
          throw new Error(`Invalid layer property binding: ${name}`);
      }
    }
    const defaults = validateGraphicProperties(component, {});
    if (!defaults.ok) throw new Error(defaults.error.message);
  }
  for (const track of project.timeline.tracks)
    for (const item of track.items) {
      if (!("RemotionGraphic" in item)) continue;
      const graphic = item.RemotionGraphic;
      const component = project.components?.find(
        (candidate) =>
          candidate.id === graphic.component_id &&
          candidate.version === graphic.component_version,
      );
      if (!component) throw new Error("Missing graphic component version");
      const props = validateGraphicProperties(component, graphic.props);
      if (!props.ok) throw new Error(props.error.message);
      for (const [key, property] of Object.entries(component.properties))
        if (property.type === "font") requireFont(project, props.value[key]);
      graphic.props = props.value;
    }
}

function requireFont(project: Project, id: unknown): void {
  if (id === "") return;
  if (
    typeof id !== "string" ||
    !project.resources?.some(
      (resource) => resource.id === id && resource.kind === "Font",
    )
  )
    throw new Error(`Missing font resource: ${String(id)}`);
}
