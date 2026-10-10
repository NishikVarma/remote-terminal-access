/** Control character for Ctrl+<ch>, or undefined if the key has none. */
export function ctrlChar(ch: string): string | undefined {
  if (ch.length !== 1) return undefined;
  const code = ch.toUpperCase().charCodeAt(0);
  // A-Z -> 1..26, and @ [ \ ] ^ _ -> 0, 27..31
  return code >= 64 && code <= 95 ? String.fromCharCode(code - 64) : undefined;
}

const KEYS: Array<[label: string, sequence: string]> = [
  ['Esc', '\x1b'],
  ['Tab', '\t'],
  ['↑', '\x1b[A'],
  ['↓', '\x1b[B'],
  ['←', '\x1b[D'],
  ['→', '\x1b[C'],
  ['|', '|'],
  ['/', '/'],
  ['-', '-'],
  ['~', '~'],
];

interface Options {
  onKey: (data: string) => void;
  focusTerminal: () => void;
  /** Element whose height is reduced to make room for the toolbar. */
  root: HTMLElement;
}

const HEIGHT_PX = 44;

/**
 * Soft keyboards on phones have no Esc, Tab, Ctrl or arrows. Shown only for touch devices.
 * `applyCtrl` must wrap typed input so a armed Ctrl button affects the next character.
 */
export function mountKeysToolbar({ onKey, focusTerminal, root }: Options): {
  applyCtrl: (data: string) => string;
  destroy: () => void;
} {
  if (!window.matchMedia('(pointer: coarse)').matches) {
    return { applyCtrl: (data) => data, destroy: () => {} };
  }

  let ctrlArmed = false;
  const bar = document.createElement('div');
  bar.style.cssText =
    `position:fixed;left:0;right:0;bottom:0;height:${HEIGHT_PX}px;display:flex;gap:4px;` +
    'padding:4px;background:#222;z-index:10;overflow-x:auto';
  root.style.height = `calc(100% - ${HEIGHT_PX}px)`;

  const add = (label: string, action: (button: HTMLButtonElement) => void) => {
    const button = document.createElement('button');
    button.textContent = label;
    button.style.cssText = 'min-width:44px;font-size:16px';
    // Keep focus on the terminal so the soft keyboard stays open.
    button.addEventListener('pointerdown', (e) => e.preventDefault());
    button.addEventListener('click', () => {
      action(button);
      focusTerminal();
    });
    bar.append(button);
  };

  add('Ctrl', (button) => {
    ctrlArmed = !ctrlArmed;
    button.style.background = ctrlArmed ? '#58f' : '';
  });
  for (const [label, sequence] of KEYS) add(label, () => onKey(sequence));
  document.body.append(bar);

  return {
    applyCtrl: (data) => {
      if (!ctrlArmed) return data;
      const control = ctrlChar(data);
      if (control === undefined) return data;
      ctrlArmed = false;
      bar.querySelector('button')!.style.background = '';
      return control;
    },
    destroy: () => bar.remove(),
  };
}
