import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import type { ClientMessage, ServerMessage } from '@rta/shared';

const KEY = 'sessionId';
const root = document.getElementById('terminal')!;

class NotPaired extends Error {}

const api = async (path: string, init?: RequestInit) => {
  const res = await fetch(path, init);
  if (res.status === 401) throw new NotPaired();
  return res;
};

async function getSessionId(cols: number, rows: number): Promise<string> {
  const saved = sessionStorage.getItem(KEY);
  if (saved && (await api(`/sessions/${saved}`)).ok) return saved;

  const res = await api('/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cols, rows }),
  });
  if (!res.ok) throw new Error(`could not start session (${res.status})`);
  const { id } = (await res.json()) as { id: string };
  sessionStorage.setItem(KEY, id);
  return id;
}

function showPairing(): void {
  root.innerHTML = `
    <form style="color:#eee;font:16px sans-serif;padding:16px;max-width:320px">
      <p>Enter the pairing code shown in the server console.</p>
      <input name="code" inputmode="numeric" autocomplete="off" placeholder="12345678" style="width:100%;font-size:18px" />
      <button style="margin-top:8px;font-size:16px">Pair this device</button>
      <p class="error" style="color:#f66"></p>
    </form>`;
  const form = root.querySelector('form')!;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = form.querySelector('input')!.value.trim();
    const res = await fetch('/pair', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, name: navigator.userAgent.slice(0, 50) }),
    });
    if (res.ok) location.reload();
    else form.querySelector('.error')!.textContent = 'Wrong or expired code.';
  });
}

function startTerminal(): void {
  const term = new Terminal({ cursorBlink: true, fontSize: 14 });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.open(root);
  fit.fit();
  window.addEventListener('resize', () => fit.fit());

  getSessionId(term.cols, term.rows)
    .then((id) => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${location.host}/ws/${id}`);
      const send = (m: ClientMessage) =>
        ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(m));

      ws.onopen = () => send({ type: 'resize', cols: term.cols, rows: term.rows });
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data) as ServerMessage;
        if (msg.type === 'output') term.write(msg.data);
        else {
          sessionStorage.removeItem(KEY);
          term.write(`\r\n[process exited with code ${msg.exitCode}]\r\n`);
        }
      };
      ws.onclose = () => term.write('\r\n[disconnected]\r\n');
      term.onData((data) => send({ type: 'input', data }));
      term.onResize(({ cols, rows }) => send({ type: 'resize', cols, rows }));
    })
    .catch((e: Error) => {
      if (e instanceof NotPaired) {
        term.dispose();
        showPairing();
      } else term.write(`\r\n${e.message}\r\n`);
    });
}

startTerminal();
