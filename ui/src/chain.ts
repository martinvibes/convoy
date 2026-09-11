import { JsonRpcProvider, Contract } from 'ethers';
import deployments from '../../deployments.json';

/**
 * The board reads Creditcoin straight from the browser. The public RPC sends
 * access-control-allow-origin: *, so there is no server here and nothing to keep in sync: the
 * addresses come from the same deployments.json the deploy script writes.
 */
const d = deployments as Record<string, string>;

export const chain = {
  rpc: 'https://rpc.cc3-testnet.creditcoin.network',
  sourceRpc: 'https://ethereum-sepolia-rpc.publicnode.com',
  explorer: 'https://creditcoin-testnet.blockscout.com',
  sepoliaExplorer: 'https://sepolia.etherscan.io',
  router: d.CONVOY_ROUTER_ADDRESS ?? null,
  registry: d.SUBSCRIPTION_REGISTRY_ADDRESS ?? null,
  bond: d.RELAYER_BOND_ADDRESS ?? null,
  emitter: d.SOURCE_EMITTER_ADDRESS ?? null,
  // Creditcoin's public RPC rejects an unbounded eth_getLogs with "query timeout of 10 seconds
  // exceeded", so every scan on this page starts at the deployment block.
  fromBlock: Number(d.DEPLOY_BLOCK ?? 0),
  // Sepolia's key in Creditcoin's attestation registry. It is not the EVM chain id.
  sourceChainKey: 1,
  // Sepolia's slot time. Used only to turn a block gap into a number of minutes.
  sourceBlockSeconds: 12,
  apps: [
    { key: 'passport', name: 'credit passport', address: d.PASSPORT_ADDRESS, fill: 'bg-passport' },
    { key: 'escrow', name: 'delivery escrow', address: d.ESCROW_ADDRESS, fill: 'bg-escrow' },
    { key: 'council', name: 'agent council', address: d.COUNCIL_ADDRESS, fill: 'bg-council' },
  ] as const,
};

export const ROUTER_ABI = [
  'event ConvoyDelivered(address indexed relayer, uint64 indexed chainKey, uint256 queries, uint256 facts, uint256 continuityHashes)',
  'event FactDelivered(bytes32 indexed factId, bytes32 indexed subId, address indexed callback, bool accepted, uint64 height, uint64 txIndex)',
  'event QuerySkipped(bytes32 indexed queryId, uint8 reason, uint64 height, uint64 txIndex)',
  'function totalBatches() view returns (uint256)',
  'function totalQueriesVerified() view returns (uint256)',
  'function totalContinuityHashes() view returns (uint256)',
  'function totalFactsDelivered() view returns (uint256)',
];

/** Creditcoin's attestation registry, readable by anyone with an eth_call. */
export const CHAIN_INFO_ADDRESS = '0x0000000000000000000000000000000000000fd3';

export const CHAIN_INFO_ABI = [
  'function get_latest_attestation_height_and_hash(uint64 chainKey) view returns (tuple(uint64 height, bytes32 hash, bool isAttestation, bool exists))',
];

export const REGISTRY_ABI = [
  'event Subscribed(bytes32 indexed subId, bytes32 indexed routeKey, address indexed owner, address callback, uint96 feePerDelivery)',
  'function get(bytes32 subId) view returns (tuple(address owner,address callback,uint64 chainKey,address emitter,bytes32 topic0,uint96 feePerDelivery,uint96 balance,uint32 callbackGasLimit,bool active))',
];

export const provider = new JsonRpcProvider(chain.rpc, undefined, { staticNetwork: true });

/**
 * Sepolia, read directly from the browser as well. A fact carries the height and index of the
 * transaction it was built from, not its hash, because the router never sees a hash. Resolving the
 * pair against the source chain is what turns an internal id into a link anyone can check.
 */
export const sourceProvider = new JsonRpcProvider(chain.sourceRpc, undefined, {
  staticNetwork: true,
});

const blockCache = new Map<number, Promise<readonly string[]>>();

export async function sourceTxHash(height: number, txIndex: number): Promise<string | null> {
  if (!blockCache.has(height)) {
    // getBlock without prefetch returns hashes only, which is one small response per block rather
    // than every transaction in it.
    blockCache.set(
      height,
      sourceProvider.getBlock(height).then((b) => b?.transactions ?? []),
    );
  }
  try {
    return (await blockCache.get(height)!)[txIndex] ?? null;
  } catch {
    return null;
  }
}

/**
 * When a Creditcoin block was mined, cached for the life of the page.
 *
 * A block's timestamp never changes, so this is fetched once per block and never again, which keeps
 * a fifteen-second refresh from re-asking the public RPC for the same fourteen answers.
 */
const timeCache = new Map<number, Promise<number | null>>();

export function blockTime(n: number): Promise<number | null> {
  if (!timeCache.has(n)) {
    timeCache.set(
      n,
      provider
        .getBlock(n)
        .then((b) => (b ? b.timestamp * 1000 : null))
        .catch(() => null),
    );
  }
  return timeCache.get(n)!;
}

export const routerContract = () =>
  chain.router ? new Contract(chain.router, ROUTER_ABI, provider) : null;

export const registryContract = () =>
  chain.registry ? new Contract(chain.registry, REGISTRY_ABI, provider) : null;

export const chainInfoContract = () => new Contract(CHAIN_INFO_ADDRESS, CHAIN_INFO_ABI, provider);

/** The published per-verification cost model: a flat call cost plus one term per continuity hash. */
export const costCtc = (hashes: number, proofs: number) =>
  2.3e-5 * proofs + 2.9e-7 * hashes;

export const appFor = (address?: string) => {
  const hit = chain.apps.find(
    (a) => a.address && address && a.address.toLowerCase() === address.toLowerCase(),
  );
  return hit ?? { key: 'unknown', name: 'unknown app', address, fill: 'bg-paper' };
};

export const SKIP_REASON: Record<number, string> = {
  1: 'already delivered',
  2: 'source transaction failed',
  3: 'unsupported transaction type',
};

export const shortHash = (h: string) => `${h.slice(0, 8)}…${h.slice(-4)}`;
export const commas = (n: number | bigint) => Number(n).toLocaleString('en-US');

export const txUrl = (hash: string) => `${chain.explorer}/tx/${hash}`;
export const addressUrl = (a: string) => `${chain.explorer}/address/${a}`;
export const sourceTxUrl = (hash: string) => `${chain.sepoliaExplorer}/tx/${hash}`;
export const sourceBlockUrl = (n: number) => `${chain.sepoliaExplorer}/block/${n}`;

/** A block gap on the source chain, said as a length of time. */
export function blocksAsTime(blocks: number): string {
  const s = Math.max(0, blocks) * chain.sourceBlockSeconds;
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min` : `${(m / 60).toFixed(1)} h`;
}

export function ago(ms: number): string {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}
