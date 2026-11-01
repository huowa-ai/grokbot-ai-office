import { Terminal } from '@xterm/xterm';
import type * as THREE from 'three';
import { CSS3DObject } from 'three/addons/renderers/CSS3DRenderer.js';

import { SCREEN_HEIGHT, SCREEN_WIDTH, SCREEN_WORLD_HEIGHT, SCREEN_WORLD_WIDTH } from './screen.js';

interface LiveTerminal {
  term: Terminal;
  element: HTMLDivElement;
  object: CSS3DObject;
  epoch: number;
  written: number;
  text: string;
  ready: boolean;
}

export interface ScreenSnapshot {
  text: string;
  epoch: number;
  fit: number;
  focused: boolean;
  width: number;
  height: number;
}

export function createTerminalPool(cssScene: THREE.Scene) {
  const lives = new Map<string, LiveTerminal>();

  return {
    sync(
      chosen: readonly string[],
      anchors: ReadonlyMap<string, THREE.Object3D>,
      screens: ReadonlyMap<string, ScreenSnapshot>,
    ) {
      const wanted = new Set(chosen);
      for (const [id, live] of lives) {
        if (!wanted.has(id)) {
          disposeLive(cssScene, live);
          lives.delete(id);
        }
      }
      for (const id of chosen) {
        const anchor = anchors.get(id);
        const screen = screens.get(id);
        if (!anchor || !screen) {
          continue;
        }
        let live = lives.get(id);
        if (!live) {
          live = openTerminal();
          lives.set(id, live);
          cssScene.add(live.object);
        }
        writeScreen(live, screen);
        live.element.classList.toggle('is-focus', screen.focused);
        anchor.updateWorldMatrix(true, false);
        anchor.getWorldPosition(live.object.position);
        anchor.getWorldQuaternion(live.object.quaternion);
        const fit = Math.max(0.04, screen.fit);
        const width = screen.width > 0 ? screen.width : SCREEN_WORLD_WIDTH;
        const height = screen.height > 0 ? screen.height : SCREEN_WORLD_HEIGHT;
        const scaleX = (width / SCREEN_WIDTH) * fit;
        const scaleY = (height / SCREEN_HEIGHT) * fit;
        live.object.scale.set(scaleX, scaleY, scaleX);
      }
    },
    dispose() {
      for (const live of lives.values()) {
        disposeLive(cssScene, live);
      }
      lives.clear();
    },
  };
}

function openTerminal(): LiveTerminal {
  const element = document.createElement('div');
  element.className = 'screen';
  element.style.width = `${SCREEN_WIDTH}px`;
  element.style.height = `${SCREEN_HEIGHT}px`;
  const term = new Terminal({
    cols: 40,
    rows: 11,
    fontSize: 20,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    cursorBlink: false,
    disableStdin: true,
    convertEol: false,
    scrollback: 200,
    theme: {
      background: '#1c1917',
      foreground: '#f6efe6',
      cursor: '#f6efe6',
    },
  });
  term.open(element);
  const object = new CSS3DObject(element);
  return { term, element, object, epoch: -1, written: 0, text: '', ready: false };
}

function writeScreen(live: LiveTerminal, screen: ScreenSnapshot): void {
  if (live.epoch !== screen.epoch || !screen.text.startsWith(live.text)) {
    live.term.reset();
    live.term.write(screen.text);
    live.epoch = screen.epoch;
    live.written = screen.text.length;
    live.text = screen.text;
    live.ready = false;
  } else if (screen.text.length !== live.written) {
    live.term.write(screen.text.slice(live.written));
    live.written = screen.text.length;
    live.text = screen.text;
  }
  if (live.element.isConnected && !live.ready) {
    live.term.refresh(0, Math.max(0, live.term.rows - 1));
    live.ready = true;
  }
}

function disposeLive(cssScene: THREE.Scene, live: LiveTerminal): void {
  cssScene.remove(live.object);
  live.term.dispose();
  live.element.remove();
}
