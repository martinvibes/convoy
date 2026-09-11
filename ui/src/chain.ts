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
  explorer: 'https://creditcoin-testnet.blockscout.com',
  sepoliaExplorer: 'https://sepolia.etherscan.io',
  router: d.CONVOY_ROUTER_ADDRESS ?? null,
  registry: d.SUBSCRIPTION_REGISTRY_ADDRESS ?? null,
  bond: d.RELAYER_BOND_ADDRESS ?? null,
  emitter: d.SOURCE_EMITTER_ADDRESS ?? null,
  // Creditcoin's public RPC rejects an unbounded eth_getLogs with "query timeout of 10 seconds
  // exceeded", so every scan on this page starts at the deployment block.
  fromBlock: Number(d.DEPLOY_BLOCK ?? 0),
  apps: [
    { key: 'passport', name: 'credit passport', address: d.PASSPORT_ADDRESS, fill: 'bg-passport' },
    { key: 'escrow', name: 'delivery escrow', address: d.ESCROW_ADDRESS, fill: 'bg-escrow' },
    { key: 'council', name: 'agent council', address: d.COUNCIL_ADDRESS, fill: 'bg-council' },
  ] as const,
};

export const ROUTER_ABI = [
  'event ConvoyDelivered(address indexed relayer, uint64 indexed chainKey, uint256 queries, uint256 facts, uint256 continuityHashes)',
  'event FactDelivered(bytes32 indexed factId, bytes32 indexed subId, address indexed callback, bool accepted)',
  'event QuerySkipped(bytes32 indexed queryId, uint8 reason)',
  'function totalBatches() view returns (uint256)',
  'function totalQueriesVerified() view returns (uint256)',
  'function totalContinuityHashes() view returns (uint256)',
  'function totalFactsDelivered() view returns (uint256)',
];

export const REGISTRY_ABI = [
  'event Subscribed(bytes32 indexed subId, bytes32 indexed routeKey, address indexed owner, address callback, uint96 feePerDelivery)',
  'function get(bytes32 subId) view returns (tuple(address owner,address callback,uint64 chainKey,address emitter,bytes32 topic0,uint96 feePerDelivery,uint96 balance,uint32 callbackGasLimit,bool active))',
];

export const provider = new JsonRpcProvider(chain.rpc, undefined, { staticNetwork: true });

export const routerContract = () =>
  chain.router ? new Contract(chain.router, ROUTER_ABI, provider) : null;

export const registryContract = () =>
  chain.registry ? new Contract(chain.registry, REGISTRY_ABI, provider) : null;

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
