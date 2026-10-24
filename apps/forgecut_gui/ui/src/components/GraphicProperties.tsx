import type { GraphicResource } from "../../electron/shared/graphic-resources";
import ResourceProperty from "./ResourceProperty";
import type {
  GraphicComponent,
  GraphicValue,
  RemotionGraphicItem,
} from "../../electron/shared/graphics";
import type {
  ProjectSnapshot,
  ItemPatch,
} from "../../electron/shared/ipc-contract";
import ColorProperty from "./ColorProperty";
import PropertyInput from "./PropertyInput";
import NumberProperty from "./NumberProperty";

type Props = {
  component: GraphicComponent;
  origin?: Pick<ProjectSnapshot, "sessionId" | "revision">;
  item: RemotionGraphicItem;
  resources: GraphicResource[];
  update: (patch: ItemPatch) => Promise<void>;
};
export default function GraphicProperties({
  component,
  origin,
  item,
  resources,
  update,
}: Props) {
  const change = (key: string, value: GraphicValue) =>
    update({ kind: "RemotionGraphic", changes: { props: { [key]: value } } });
  return (
    <>
      {Object.entries(component.properties).map(([key, property]) => {
        const value = item.props[key] ?? property.default;
        if (
          (property.type === "font" || property.type === "image") &&
          typeof value === "string"
        )
          return (
            <ResourceProperty
              key={`${item.id}:${property.id}`}
              kind={property.type === "font" ? "Font" : "Image"}
              origin={origin}
              itemId={item.id}
              property={key}
              label={property.label}
              value={value}
              resources={resources}
              onValueChange={(next) => {
                void change(key, next);
              }}
            />
          );
        if (property.type === "select" && typeof value === "string")
          return (
            <label key={property.id} className="inspector-row">
              <span className="inspector-label">{property.label}</span>
              <select
                className="inspector-input"
                value={value}
                onChange={(event) => {
                  void change(key, event.currentTarget.value);
                }}
              >
                {property.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          );
        if (property.type === "number" && typeof value === "number")
          return (
            <NumberProperty
              key={property.id}
              label={property.label}
              value={value}
              min={property.min}
              onValueChange={(next) => {
                if (property.max === undefined || next <= property.max)
                  return change(key, next);
                return undefined;
              }}
            />
          );
        if (property.type === "color" && typeof value === "string")
          return (
            <ColorProperty
              key={property.id}
              label={property.label}
              value={value}
              onValueChange={(next) => {
                void change(key, next);
              }}
            />
          );
        return (
          <label key={property.id} className="inspector-row">
            <span className="inspector-label">{property.label}</span>
            {property.type === "boolean" ? (
              <input
                type="checkbox"
                checked={value === true}
                onChange={(event) => {
                  void change(key, event.currentTarget.checked);
                }}
              />
            ) : (
              <PropertyInput
                className="inspector-input"
                type="text"
                value={String(value)}
                onValueChange={(next) => {
                  void change(key, next);
                }}
              />
            )}
          </label>
        );
      })}
    </>
  );
}
