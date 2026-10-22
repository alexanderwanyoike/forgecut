import React, { useMemo } from 'react';
import * as Remotion from 'remotion';

export function loadGraphic(compiledCode) {
  const module = { exports: {} };
  const require = (name) => {
    if (name === 'react') return React;
    if (name === 'remotion') return Remotion;
    throw new Error(`Unsupported component import: ${name}`);
  };
  new Function('require', 'module', 'exports', compiledCode)(require, module, module.exports);
  if (typeof module.exports.default !== 'function') throw new Error('A component must export a default function');
  return module.exports.default;
}

export const UserGraphic = ({ compiledCode }) => {
  const Component = useMemo(() => loadGraphic(compiledCode), [compiledCode]);
  return <Component />;
};
