import type {
  GraphicComponent,
  GraphicValue,
  RemotionGraphicItem,
} from "../../electron/shared/graphics";
import type { ItemPatch } from "../../electron/shared/ipc-contract";
import PropertyInput from "./PropertyInput";
import NumberProperty from "./NumberProperty";

type Props = {
  component: GraphicComponent;
  item: RemotionGraphicItem;
  update: (patch: ItemPatch) => Promise<void>;
};
export default function GraphicProperties({ component, item, update }: Props) {
  const change = (key: string, value: GraphicValue) =>
    update({ kind: "RemotionGraphic", changes: { props: { [key]: value } } });
  return (
    <>
      {Object.entries(component.properties).map(([key, property]) => {
        const value = item.props[key] ?? property.default;
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
                type={property.type === "color" ? "color" : "text"}
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
