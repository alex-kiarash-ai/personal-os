// Minimal stdio JSON-RPC client for powerbi-modeling-mcp. Usage: require, then run(steps).
const { spawn } = require('child_process');

function createClient() {
  const proc = spawn('cmd', ['/c', 'npx', '-y', '@microsoft/powerbi-modeling-mcp@latest', '--start'], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let buf = '';
  const pending = new Map();
  let nextId = 1;

  proc.stdout.on('data', (d) => {
    buf += d.toString();
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      const cb = pending.get(msg.id);
      if (cb) { pending.delete(msg.id); cb(msg); }
    }
  });
  proc.stderr.on('data', () => {});

  function send(method, params, isNotification) {
    const msg = { jsonrpc: '2.0', method, params };
    if (!isNotification) msg.id = nextId++;
    proc.stdin.write(JSON.stringify(msg) + '\n');
    return msg.id;
  }

  function call(method, params, timeoutMs) {
    return new Promise((resolve, reject) => {
      const id = send(method, params);
      pending.set(id, resolve);
      setTimeout(() => reject(new Error('timeout on ' + method)), timeoutMs || 120000);
    });
  }

  async function init() {
    await call('initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'alex-builder', version: '1.0' },
    });
    send('notifications/initialized', {}, true);
  }

  function toolText(res) {
    if (res.error) return 'RPC_ERROR: ' + JSON.stringify(res.error);
    const c = res.result && res.result.content;
    return (c || []).map((x) => x.text || '').join('\n');
  }

  async function tool(name, request, timeoutMs) {
    const res = await call('tools/call', { name, arguments: { request } }, timeoutMs);
    return toolText(res);
  }

  return { init, tool, kill: () => proc.kill() };
}

module.exports = { createClient };
