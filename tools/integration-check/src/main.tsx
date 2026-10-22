import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Player } from '@remotion/player';
import * as monaco from 'monaco-editor/editor/editor.api';
import 'monaco-editor/languages/definitions/typescript/register';
import * as typescript from 'monaco-editor/language/typescript/monaco.contribution';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import TypeScriptWorker from 'monaco-editor/language/typescript/ts.worker?worker';
import { Graphic } from './Graphic';

self.MonacoEnvironment = {
  getWorker: (_id, label) => label === 'typescript' || label === 'javascript' ? new TypeScriptWorker() : new EditorWorker(),
};

const tick = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
const assert = (condition, message) => { if (!condition) throw new Error(message); };

const App = () => {
  const player = useRef(null);
  const editorHost = useRef(null);
  const [title, setTitle] = useState('After dark');
  useEffect(() => {
    typescript.typescriptDefaults.setCompilerOptions({
      target: typescript.ScriptTarget.ES2022,
      module: typescript.ModuleKind.ESNext,
      jsx: typescript.JsxEmit.React,
    });
    const model = monaco.editor.createModel('export const Title = () => <span>After dark</span>;', 'typescript', monaco.Uri.parse('file:///sample.tsx'));
    const editor = monaco.editor.create(editorHost.current, { model, theme: 'vs-dark', automaticLayout: true });
    window.integrationCheck = {
      setTitle,
      verify: async () => {
        // Language activation loads a separate chunk after the editor mounts.
        const deadline = performance.now() + 10_000;
        let factory;
        while (!factory) {
          try { factory = await typescript.getTypeScriptWorker(); }
          catch (error) {
            if (String(error) !== 'TypeScript not registered!' || performance.now() > deadline) throw error;
            await tick();
          }
        }
        const worker = await factory(model.uri);
        assert((await worker.getSyntacticDiagnostics(model.uri.toString())).length === 0, 'Valid TSX was rejected');
        const emitted = await worker.getEmitOutput(model.uri.toString());
        assert(emitted.outputFiles.some((f) => f.text.includes('React.createElement')), 'TSX compiler did not emit JavaScript');
        model.setValue('export const broken = ;');
        assert((await worker.getSyntacticDiagnostics(model.uri.toString())).length > 0, 'Syntax error was not reported');
        model.setValue('export const Title = () => <span>After dark</span>;');
        await document.fonts.load('32px CheckFont');
        await Promise.all([...document.images].map((img) => img.decode()));
        player.current.seekTo(15);
        await tick();
        assert(player.current.getCurrentFrame() === 15, 'Player frame seek failed');
        assert(document.querySelector('[data-title]').textContent === 'After dark', 'Initial graphic missing');
        setTitle('Your build');
        await tick();
        assert(document.querySelector('[data-title]').textContent === 'Your build', 'Property edit was not previewed');
        assert(document.fonts.check('32px CheckFont'), 'Local font did not load');
        return { origin: location.origin, playerFrame: player.current.getCurrentFrame(), propertyUpdate: true, localFont: true, localImage: true, typeScriptWorker: true, tsxCompilation: true, syntaxDiagnostics: true };
      },
    };
    return () => { delete window.integrationCheck; editor.dispose(); model.dispose(); };
  }, []);
  return <main style={{ background: '#171a1c', color: '#e8e8e8', padding: 24 }}>
    <h1 style={{ font: '18px sans-serif' }}>ForgeCut integration check</h1>
    <Player ref={player} component={Graphic} inputProps={{ title }} durationInFrames={30} fps={30} compositionWidth={640} compositionHeight={360} style={{ width: 640, background: '#24292c' }} controls />
    <div ref={editorHost} style={{ width: 640, height: 180, marginTop: 20 }} />
  </main>;
};

createRoot(document.getElementById('root')).render(<App />);
