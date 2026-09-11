/**
 * The whole argument in one command.
 *
 * Emits traffic on Sepolia for three unrelated dApps plus one transaction that reverts, waits for
 * the attestor network to cover those blocks, then delivers all of it to Creditcoin as a single
 * convoy under one shared continuity proof.
 *
 * It bypasses the relayer's log scan on purpose: a reverted transaction emits no logs, so eth_getLogs
 * cannot see it, and the receipt-status gate is the thing worth showing. Delivering by transaction
 * hash is the only way to put a genuine failure in the same convoy as the successes.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { JsonRpcProvider, Contract, Wallet, keccak256, toUtf8Bytes, parseEther } from 'ethers';
import { proofProvider, chainInfo } from '@gluwa/usc-sdk';
import { config, abiOf } from '../relayer/config.js';
import { waitForAttestation } from '../relayer/attestation.js';
import { signer, need } from './lib.js';

const good = Number(process.argv[2] ?? 9);
if (good < 1 || good > 9) throw new Error('pass 1..9 successful transactions; one slot is the failure');

// Emitting is cheap but the attestation wait is not. If a run is interrupted after the source
// transactions land, --resume delivers those same transactions instead of paying for new ones.
const CACHE = 'demo-convoy.json';
const resume = process.argv.includes('--resume');

const source = new JsonRpcProvider(config.sourceRpc(), undefined, { staticNetwork: true });
const creditcoin = new JsonRpcProvider(config.creditcoinRpc, undefined, { staticNetwork: true });
const relayer = new Wallet(config.relayerKey(), creditcoin);
const router = new Contract(config.routerAddress(), abiOf('ConvoyRouter'), relayer);

const emitterAddress = need('SOURCE_EMITTER_ADDRESS');
const sourceWallet = signer(config.sourceRpc(), 'SOURCE_PRIVATE_KEY');
const emitter = new Contract(emitterAddress, abiOf('ConvoyEmitter'), sourceWallet);

const id = (s: string) => keccak256(toUtf8Bytes(`${s}-${Date.now()}`));

type Cache = { hashes: string[]; highestBlock: number };

let cached: Cache | null = null;
if (resume) {
  if (!existsSync(CACHE)) throw new Error(`--resume needs ${CACHE}, which an earlier run writes`);
  cached = JSON.parse(readFileSync(CACHE, 'utf8')) as Cache;
  console.log(`resuming with ${cached.hashes.length} transactions already on Sepolia`);
}

console.log(resume ? '' : `emitting ${good} events for three unrelated dApps from ${emitterAddress}`);
const hashes: string[] = cached?.hashes ?? [];
for (let i = 0; !resume && i < good; i++) {
  const which = i % 3;
  const tx =
    which === 0
      ? await emitter.repay(id(`loan${i}`), parseEther('1'), true)
      : which === 1
        ? await emitter.acceptDelivery(id(`order${i}`), parseEther('2'))
        : await emitter.signal(id(`signal${i}`), 1, 42);
  const r = await tx.wait();
  hashes.push(tx.hash);
  console.log(`  ${i + 1}/${good} block ${r.blockNumber} ${['repayment', 'delivery', 'treasury signal'][which]}`);
}

let highest = cached?.highestBlock ?? 0;
if (!resume) {
  console.log('\nand one transaction that reverts after emitting');
  const failing = await emitter.repayThenRevert(id('reverting'), parseEther('999'), {
    gasLimit: 200_000,
  });
  const failedReceipt = await sourceWallet.provider!.waitForTransaction(failing.hash);
  console.log(
    `  block ${failedReceipt!.blockNumber} status ${failedReceipt!.status} (reverted, as intended)`,
  );
  hashes.push(failing.hash);
  highest = failedReceipt!.blockNumber;
  writeFileSync(CACHE, JSON.stringify({ hashes, highestBlock: highest }, null, 2) + '\n');
  console.log(`  wrote ${CACHE}; rerun with --resume if the wait below is interrupted`);
}

const chainKey = config.sourceChainKey;
console.log(`\nwaiting for the attestor network to cover block ${highest}`);
await waitForAttestation(new chainInfo.PrecompileChainInfoProvider(creditcoin), chainKey, highest);

console.log(`building one proof for all ${hashes.length} transactions`);
const result = await new proofProvider.service.ProofBuilder(chainKey, config.proofBuilderUrl).getBatchProof(hashes);
if (!result.success || !result.data) throw new Error(`proof generation failed: ${result.error}`);
const data = result.data;

const heights: number[] = [];
const txBytes: string[] = [];
const merkleProofs: unknown[] = [];
for (const [headerNumber, proofsMap] of data.merkleProofs.entries()) {
  for (const [, entry] of proofsMap.entries()) {
    heights.push(headerNumber);
    txBytes.push(entry.txBytes);
    merkleProofs.push(entry.merkleProof);
  }
}

const shared = data.continuityProof.roots.length;
const alone = shared * heights.length;
console.log(`  ${shared} continuity hashes shared by ${heights.length} transactions`);
console.log(`  ${alone} hashes if each had been proven on its own (${(alone / shared).toFixed(1)}x)`);

const tx = await router.deliver(chainKey, heights, txBytes, merkleProofs, data.continuityProof);
const receipt = await tx.wait();

const parsed = receipt.logs
  .map((l: any) => {
    try {
      return router.interface.parseLog(l);
    } catch {
      return null;
    }
  })
  .filter(Boolean);

const delivered = parsed.filter((l: any) => l.name === 'FactDelivered').length;
const skipped = parsed.filter((l: any) => l.name === 'QuerySkipped');

console.log(`\ndelivered in ${receipt.hash} | gas ${receipt.gasUsed}`);
console.log(`  ${delivered} facts handed to subscribing apps`);
for (const ev of skipped) {
  console.log(`  refused ${ev.args.queryId.slice(0, 10)} reason ${ev.args.reason} (2 = source transaction failed)`);
}

const cost = (h: number, proofs: number) => 2.3e-5 * proofs + 2.9e-7 * h;
console.log(
  `\nmodelled cost  alone ${cost(alone, heights.length).toFixed(8)} CTC  ` +
    `vs convoy ${cost(shared, 1).toFixed(8)} CTC`,
);
