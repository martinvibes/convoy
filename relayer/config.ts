import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name}. Copy .env.example to .env and fill it in.`);
  return v;
}

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

export const config = {
  // Creditcoin CC3 testnet. chainId 102031.
  creditcoinRpc: optional('CREDITCOIN_RPC_URL', 'https://rpc.cc3-testnet.creditcoin.network'),
  proofBuilderUrl: optional('PROOF_BUILDER_URL', 'https://prover.cc3-testnet.creditcoin.network'),

  // Ethereum Sepolia. chainKey 1 on CC3 testnet, which is NOT its EVM chain id (11155111).
  sourceRpc: () => required('SOURCE_CHAIN_RPC_URL'),
  sourceChainKey: Number(optional('SOURCE_CHAIN_KEY', '1')),

  relayerKey: () => required('RELAYER_PRIVATE_KEY'),

  routerAddress: () => required('CONVOY_ROUTER_ADDRESS'),
  registryAddress: () => required('SUBSCRIPTION_REGISTRY_ADDRESS'),
  bondAddress: () => required('RELAYER_BOND_ADDRESS'),
  emitterAddress: () => required('SOURCE_EMITTER_ADDRESS'),

  // Batching policy. See relayer/batcher.ts for why these two numbers fight each other.
  maxBatchSize: Number(optional('MAX_BATCH_SIZE', '10')),
  maxBatchRange: Number(optional('MAX_BATCH_RANGE', '1000')),
  maxWaitMs: Number(optional('MAX_WAIT_MS', '180000')),
  pollIntervalMs: Number(optional('POLL_INTERVAL_MS', '12000')),
};

/** Load a compiled artifact's ABI from forge's output directory. */
export function abiOf(contract: string): any[] {
  const path = resolve(root, 'out', `${contract}.sol`, `${contract}.json`);
  return JSON.parse(readFileSync(path, 'utf8')).abi;
}
