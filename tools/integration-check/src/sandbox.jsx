import React from 'react';
import { createRoot } from 'react-dom/client';
import { Player } from '@remotion/player';
import { loadGraphic } from './UserGraphic';

const root = createRoot(document.getElementById('root'));
window.componentCheck = {
  mount(compiledCode) {
    const Component = loadGraphic(compiledCode);
    root.render(<Player component={Component} durationInFrames={30} fps={30} compositionWidth={640} compositionHeight={360} style={{ width: 640 }} />);
  },
};
