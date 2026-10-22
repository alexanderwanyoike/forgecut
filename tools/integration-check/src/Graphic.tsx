import React, { useEffect, useState } from 'react';
import { AbsoluteFill, Img, continueRender, delayRender, staticFile, useCurrentFrame } from 'remotion';

export const Graphic = ({ title = 'After dark', accent = '#70a08b' }) => {
  const frame = useCurrentFrame();
  const [handle] = useState(() => delayRender('Local check font'));
  useEffect(() => {
    document.fonts.load('32px CheckFont').then(() => continueRender(handle));
  }, [handle]);
  return <AbsoluteFill>
    <style>{`@font-face { font-family: CheckFont; src: url('${staticFile('check-font.ttf')}'); }`}</style>
    <Img src={staticFile('check-image.svg')} style={{ position: 'absolute', left: 24, top: 24, width: 80, height: 80 }} />
    <div data-title style={{ position: 'absolute', left: 120, top: 42, fontFamily: 'CheckFont', fontSize: 32, color: accent, opacity: Math.min(1, frame / 10) }}>{title}</div>
  </AbsoluteFill>;
};
