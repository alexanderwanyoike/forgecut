import { useMemo } from "react";
import { Composition, registerRoot } from "remotion";
import { compiledComponent } from "./compiled-component";
import TitleCard, { type TitleCardProps } from "../TitleCard";

type Input = TitleCardProps & {
  code?: string;
  width: number;
  height: number;
  fps: number;
  duration: number;
};
function Graphic({ values, resources, layerStates, code }: Input) {
  const Component = useMemo(
    () => (code ? compiledComponent(code) : TitleCard),
    [code],
  );
  return (
    <Component
      values={values}
      resources={resources}
      layerStates={layerStates}
    />
  );
}
function Root() {
  return (
    <Composition
      id="Graphic"
      component={Graphic}
      width={1920}
      height={1080}
      fps={30}
      durationInFrames={30}
      defaultProps={{
        values: {},
        resources: {},
        width: 1920,
        height: 1080,
        fps: 30,
        duration: 30,
      }}
      calculateMetadata={({ props }) => ({
        width: props.width,
        height: props.height,
        fps: props.fps,
        durationInFrames: props.duration,
      })}
    />
  );
}
registerRoot(Root);
