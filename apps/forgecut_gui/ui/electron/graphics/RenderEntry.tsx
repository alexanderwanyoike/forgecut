import { Composition, registerRoot } from "remotion";
import TitleCard, { type TitleCardProps } from "./TitleCard";

type Input = TitleCardProps & {
  width: number;
  height: number;
  fps: number;
  duration: number;
};
function Graphic({ values, resources }: Input) {
  return <TitleCard values={values} resources={resources} />;
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
