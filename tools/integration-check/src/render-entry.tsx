import React from 'react';
import { Composition, registerRoot } from 'remotion';
import { Graphic } from './Graphic';
import { UserGraphic } from './UserGraphic';

const Root = () => <>
  <Composition id="CheckGraphic" component={Graphic} durationInFrames={30} fps={30} width={640} height={360} defaultProps={{ title: 'After dark', accent: '#70a08b' }} />
  <Composition id="UserGraphic" component={UserGraphic} durationInFrames={30} fps={30} width={640} height={360} defaultProps={{ compiledCode: '' }} />
</>;
registerRoot(Root);
