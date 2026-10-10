import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import type { ClientMessage, ServerMessage } from '@rta/shared';

const KEY = 'sessionId';

async function getSessionId(cols: number, rows: number): Promise<string> {
  const saved = sessionStorage.getItem(KEY);
  if (saved && (await fetch(`/sessions/${saved}`)).ok) return saved;

  const res = await fetch('/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cols, rows }),
  });
  if (!res.ok) throw new Error(`could not start session (${res.status})`);
  const { id } = (await res.json()) as { id: string };
  sessionStorage.setItem(KEY, id);
  return id;
}

const term = new Terminal({ cursorBlink: true, fontSize: 14 });
const fit = new FitAddon();
term.loadAddon(fit);
term.open(document.getElementById('terminal')!);
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
  .catch((e: Error) => term.write(`\r\n${e.message}\r\n`));
