/**
 * Serves the dashboard and injects the deployed addresses.
 *
 * The dashboard reads Creditcoin directly from the browser — the CC3 testnet RPC sends
 * `access-control-allow-origin: *`, so there is no backend here and nothing to trust between the
 * page and the chain. This server only hands over static files and a generated config.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const port = Number(process.env.UI_PORT ?? 5178);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function config() {
  const file = resolve(root, 'deployments.json');
  const d = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  return `window.CONVOY = ${JSON.stringify(
    {
      rpc: process.env.CREDITCOIN_RPC_URL ?? 'https://rpc.cc3-testnet.creditcoin.network',
      explorer: 'https://explorer.usc-testnet.creditcoin.network',
      sepoliaExplorer: 'https://sepolia.etherscan.io',
      router: d.CONVOY_ROUTER_ADDRESS ?? null,
      registry: d.SUBSCRIPTION_REGISTRY_ADDRESS ?? null,
      bond: d.RELAYER_BOND_ADDRESS ?? null,
      emitter: d.SOURCE_EMITTER_ADDRESS ?? null,
      passport: d.PASSPORT_ADDRESS ?? null,
      escrow: d.ESCROW_ADDRESS ?? null,
      council: d.COUNCIL_ADDRESS ?? null,
    },
    null,
    2,
  )};\n`;
}

createServer(async (req, res) => {
  const url = (req.url ?? '/').split('?')[0];
  if (url === '/config.js') {
    res.writeHead(200, { 'content-type': TYPES['.js'], 'cache-control': 'no-store' });
    res.end(config());
    return;
  }
  const path = resolve(here, '.' + (url === '/' ? '/index.html' : url));
  if (!path.startsWith(here)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  try {
    const body = await readFile(path);
    res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(port, () => {
  console.log(`Convoy dashboard  http://localhost:${port}`);
  const d = JSON.parse(config().replace('window.CONVOY = ', '').replace(/;\n$/, ''));
  if (!d.router) {
    console.log('No router in deployments.json yet — run npm run deploy:creditcoin first.');
  }
});
