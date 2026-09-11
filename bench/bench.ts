/**
 * Convoy's claim, measured.
 *
 * The claim: delivering n source transactions as one convoy costs materially less than delivering
 * them one at a time, because on-chain verification cost is dominated by the continuity proof and a
 * convoy buys exactly one of those for the whole group.
 *
 * The method: emit two disjoint, equally shaped sets of source-chain events inside the same block
 * window. Deliver set A through `deliverSingle`, which is the path `ASCBase.execute` puts every
 * dApp on today, one continuity proof per transaction. Deliver set B through `deliver`, one shared
 * continuity proof for the group. Both sets run identical downstream fan-out work on the same
 * router and the same subscribers, so the difference between them is the thing under test and
 * nothing else.
 *
 * Usage: tsx bench/bench.ts [n]     (default 5, so 10 source transactions in total)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Contract, JsonRpcProvider, parseEther, id as keccak } from 'ethers';
import { chainInfo, proofProvider } from '@gluwa/usc-sdk';
import { artifact, signer, need, root, CREDITCOIN_RPC } from '../scripts/lib.js';
import { modelledCostCtc } from '../relayer/batcher.js';
import { waitForAttestation } from '../relayer/attestation.js';

const n = Number(process.argv[2] ?? '5');
const CHAIN_KEY = Number(process.env.SOURCE_CHAIN_KEY ?? '1');
const PROOF_URL = process.env.PROOF_BUILDER_URL ?? 'https://prover.cc3-testnet.creditcoin.network';
const sourceRpc = process.env.SOURCE_CHAIN_RPC_URL;
if (!sourceRpc) throw new Error('Set SOURCE_CHAIN_RPC_URL in .env');

const sourceWallet = signer(sourceRpc, 'SOURCE_PRIVATE_KEY');
const relayerWallet = signer(CREDITCOIN_RPC, 'RELAYER_PRIVATE_KEY');

const emitter = new Contract(need('SOURCE_EMITTER_ADDRESS'), artifact('ConvoyEmitter').abi, sourceWallet);
const router = new Contract(need('CONVOY_ROUTER_ADDRESS'), artifact('ConvoyRouter').abi, relayerWallet);

const builder = new proofProvider.service.ProofBuilder(CHAIN_KEY, PROOF_URL);
const chainInfoProvider = new chainInfo.PrecompileChainInfoProvider(
  new JsonRpcProvider(CREDITCOIN_RPC, undefined, { staticNetwork: true }),
);

interface Emitted {
  txHash: string;
  blockNumber: number;
}

async function emitSet(label: string, count: number): Promise<Emitted[]> {
  const out: Emitted[] = [];
  for (let i = 0; i < count; i++) {
    const tx = await emitter.repay(keccak(`${label}-${Date.now()}-${i}`), parseEther('100'), true);
    const r = await tx.wait();
    out.push({ txHash: r.hash, blockNumber: r.blockNumber });
    console.log(`  ${label} ${i + 1}/${count} block ${r.blockNumber}`);
  }
  return out;
}

async function main(): Promise<void> {
  console.log(`emitting ${n * 2} source transactions on Sepolia\n`);
  const setA = await emitSet('alone', n);
  const setB = await emitSet('convoy', n);

  const highest = Math.max(...[...setA, ...setB].map((e) => e.blockNumber));
  console.log(`\nwaiting for Sepolia block ${highest} to be attested on Creditcoin`);
  await waitForAttestation(chainInfoProvider, CHAIN_KEY, highest);

  // --- path A: one continuity proof per transaction, the ASCBase default ---
  console.log('\npath A: delivering one at a time');
  let gasAlone = 0n;
  let hashesAlone = 0;
  for (const e of setA) {
    const res = await builder.getProof(e.txHash);
    if (!res.success || !res.data) throw new Error(`proof failed: ${res.error}`);
    const d = res.data;
    const tx = await router.deliverSingle(
      CHAIN_KEY,
      d.headerNumber,
      d.txBytes,
      d.merkleProof,
      d.continuityProof,
    );
    const receipt = await tx.wait();
    gasAlone += receipt.gasUsed;
    hashesAlone += d.continuityProof.roots.length;
    console.log(`  gas ${receipt.gasUsed}  continuity hashes ${d.continuityProof.roots.length}`);
  }

  // --- path B: one continuity proof for the whole group ---
  console.log('\npath B: delivering as one convoy');
  const batch = await builder.getBatchProof(setB.map((e) => e.txHash));
  if (!batch.success || !batch.data) throw new Error(`batch proof failed: ${batch.error}`);
  const d = batch.data;

  const heights: number[] = [];
  const txBytes: string[] = [];
  const merkleProofs: unknown[] = [];
  for (const [headerNumber, proofsMap] of d.merkleProofs.entries()) {
    for (const [, entry] of proofsMap.entries()) {
      heights.push(headerNumber);
      txBytes.push(entry.txBytes);
      merkleProofs.push(entry.merkleProof);
    }
  }

  const tx = await router.deliver(CHAIN_KEY, heights, txBytes, merkleProofs, d.continuityProof);
  const receipt = await tx.wait();
  const gasConvoy: bigint = receipt.gasUsed;
  const hashesConvoy = d.continuityProof.roots.length;
  console.log(`  gas ${gasConvoy}  continuity hashes ${hashesConvoy}  transactions ${heights.length}`);

  const results = {
    measuredAt: new Date().toISOString(),
    network: 'Creditcoin CC3 testnet',
    sourceChain: 'Ethereum Sepolia',
    transactionsPerPath: n,
    alone: {
      totalGas: gasAlone.toString(),
      gasPerTransaction: (gasAlone / BigInt(n)).toString(),
      continuityHashes: hashesAlone,
      continuityProofs: n,
      modelledCtc: hashesAlone === 0 ? 0 : modelledCostCtc(hashesAlone / n) * n,
    },
    convoy: {
      totalGas: gasConvoy.toString(),
      gasPerTransaction: (gasConvoy / BigInt(heights.length)).toString(),
      continuityHashes: hashesConvoy,
      continuityProofs: 1,
      modelledCtc: modelledCostCtc(hashesConvoy),
    },
    gasSavedPercent: Number(((gasAlone - gasConvoy) * 10000n) / gasAlone) / 100,
  };

  mkdirSync(resolve(root, 'bench/results'), { recursive: true });
  const path = resolve(root, 'bench/results', `bench-${Date.now()}.json`);
  writeFileSync(path, JSON.stringify(results, null, 2) + '\n');

  console.log(`\n| path | transactions | continuity proofs | continuity hashes | total gas |`);
  console.log(`| --- | --- | --- | --- | --- |`);
  console.log(`| one at a time | ${n} | ${n} | ${hashesAlone} | ${gasAlone} |`);
  console.log(`| one convoy | ${heights.length} | 1 | ${hashesConvoy} | ${gasConvoy} |`);
  console.log(`\ngas saved: ${results.gasSavedPercent}%`);
  console.log(`results written to ${path}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
