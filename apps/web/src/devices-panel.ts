interface DeviceInfo {
  id: string;
  name: string;
  lastSeenAt: number | null;
  revokedAt: number | null;
  current: boolean;
}

interface AuditInfo {
  id: number;
  ts: number;
  type: string;
  detail: string | null;
}

const fmt = (ms: number | null) => (ms ? new Date(ms).toLocaleString() : 'never');

// Device names come from the client's user agent, so only textContent is used here.
function el<K extends keyof HTMLElementTagNameMap>(tag: K, text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.textContent = text;
  return node;
}

/** A button that opens a panel listing paired devices (with revoke) and recent audit events. */
export function mountDevicesPanel(onUnauthorized: () => void): { destroy: () => void } {
  const button = el('button', 'Devices');
  button.style.cssText = 'position:fixed;top:8px;right:8px;z-index:10;font-size:14px';
  const panel = el('div');
  panel.hidden = true;
  panel.style.cssText =
    'position:fixed;top:40px;right:8px;left:8px;max-width:420px;margin-left:auto;z-index:10;' +
    'max-height:70vh;overflow:auto;background:#222;color:#eee;font:14px sans-serif;padding:12px';

  async function refresh(): Promise<void> {
    const [devices, audit] = await Promise.all([fetch('/devices'), fetch('/audit?limit=10')]);
    if (devices.status === 401 || audit.status === 401) return onUnauthorized();
    render((await devices.json()) as DeviceInfo[], (await audit.json()) as AuditInfo[]);
  }

  async function revoke(device: DeviceInfo): Promise<void> {
    if (
      !confirm(
        `Revoke "${device.name}"?${device.current ? ' This is the device you are using.' : ''}`,
      )
    )
      return;
    await fetch(`/devices/${device.id}`, { method: 'DELETE' });
    if (device.current) location.reload();
    else await refresh();
  }

  function render(devices: DeviceInfo[], events: AuditInfo[]): void {
    panel.replaceChildren(el('h3', 'Paired devices'));
    for (const d of devices.filter((x) => !x.revokedAt)) {
      const row = el(
        'div',
        `${d.name}${d.current ? ' (this device)' : ''} - last seen ${fmt(d.lastSeenAt)} `,
      );
      const revokeButton = el('button', 'Revoke');
      revokeButton.onclick = () => void revoke(d);
      row.append(revokeButton);
      panel.append(row);
    }
    panel.append(el('h3', 'Recent events'));
    for (const e of events)
      panel.append(el('div', `${fmt(e.ts)} ${e.type}${e.detail ? ` ${e.detail}` : ''}`));
  }

  button.onclick = () => {
    panel.hidden = !panel.hidden;
    if (!panel.hidden) void refresh();
  };
  document.body.append(button, panel);
  return { destroy: () => (button.remove(), panel.remove()) };
}
