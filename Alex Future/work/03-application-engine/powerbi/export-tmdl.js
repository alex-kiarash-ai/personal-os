const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const OUT = 'C:\\Users\\Thinkpad\\Desktop\\personal-os\\work\\03-application-engine\\powerbi\\job-pipeline-dashboard\\job-pipeline-dashboard.SemanticModel\\definition';

const proc = spawn('cmd', ['/c', 'npx', '-y', '@microsoft/powerbi-modeling-mcp@latest', '--start'], { stdio: ['pipe', 'pipe', 'pipe'] });
let buf = '';
const pending = new Map();
let nextId = 1;
function send(method, params, isNotification) {
  const msg = { jsonrpc: '2.0', method, params };
  if (!isNotification) msg.id = nextId++;
  proc.stdin.write(JSON.stringify(msg) + '\n');
  return msg.id;
}
proc.stdout.on('data', (d) => {
  buf += d.toString();
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let msg; try { msg = JSON.parse(line); } catch { continue; }
    const cb = pending.get(msg.id);
    if (cb) { pending.delete(msg.id); cb(msg); }
  }
});
proc.stderr.on('data', () => {});
function call(method, params, t) {
  return new Promise((res, rej) => { const id = send(method, params); pending.set(id, res); setTimeout(() => rej(new Error('timeout')), t || 180000); });
}
(async () => {
  await call('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'x', version: '1' } });
  send('notifications/initialized', {}, true);
  const instRes = await call('tools/call', { name: 'connection_operations', arguments: { request: { operation: 'ListLocalInstances' } } });
  const inst = JSON.parse(instRes.result.content[0].text);
  await call('tools/call', { name: 'connection_operations', arguments: { request: { operation: 'Connect', connectionString: 'Data Source=localhost:' + inst.data[0].port } } });
  const exp = await call('tools/call', { name: 'model_operations', arguments: { request: { Operation: 'ExportTMDL', OutputPath: OUT } } });
  for (const item of exp.result.content) {
    if (item.type === 'text') console.log('TEXT:', item.text.slice(0, 500));
    if (item.type === 'resource') {
      console.log('RESOURCE URI:', item.resource.uri, 'len:', (item.resource.text || '').length);
      // mirror resource files into OUT, preserving relative layout under the served folder
      const uriPath = decodeURIComponent(item.resource.uri.replace('file:///', '')).replace(/\//g, '\\');
      const ix = uriPath.toLowerCase().indexOf('\\definition\\');
      const rel = ix >= 0 ? uriPath.slice(ix + '\\definition\\'.length) : path.basename(uriPath);
      const dest = path.join(OUT, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, item.resource.text || '');
      console.log('WROTE:', dest);
    }
  }
  proc.kill();
  process.exit(0);
})().catch((e) => { console.error('FAIL:', e.message); proc.kill(); process.exit(1); });
