/**
 * Push a genuinely failed source transaction through the router, on chain.
 *
 * The BlockProver precompile proves a transaction was *included* in a block. It does not prove the
 * transaction *succeeded*, and a reverted transaction is included like any other. Every ASC has to
 * check receiptStatus itself, and the reference ASCBase does not do it for you.
 *
 * This is that footgun, live: a real Sepolia transaction that reverted, a real proof the precompile
 * accepts, and Convoy refusing to hand it to anybody. The router emits QuerySkipped with reason
 * SKIP_SOURCE_TX_FAILED instead of reverting, so the rest of a convoy is unaffected.
 */
import { JsonRpcProvider, Contract, Wallet } from 'ethers';
import { proofProvider, chainInfo } from '@gluwa/usc-sdk';
import { config, abiOf } from '../relayer/config.js';
import { waitForAttestation } from '../relayer/attestation.js';

const txHash = process.argv[2];
if (!txHash) throw new Error('usage: tsx scripts/prove-failure.ts <sepolia tx hash>');

const source = new JsonRpcProvider(config.sourceRpc(), undefined, { staticNetwork: true });
const creditcoin = new JsonRpcProvider(config.creditcoinRpc, undefined, { staticNetwork: true });
const wallet = new Wallet(config.relayerKey(), creditcoin);
const router = new Contract(config.routerAddress(), abiOf('ConvoyRouter'), wallet);

const receipt = await source.getTransactionReceipt(txHash);
if (!receipt) throw new Error(`${txHash} not found on the source chain`);
console.log(`source transaction ${txHash}`);
console.log(`  block ${receipt.blockNumber} index ${receipt.index} status ${receipt.status}`);
if (receipt.status !== 0) {
  throw new Error('that transaction succeeded. This script only makes sense for a failed one.');
}

const chainKey = config.sourceChainKey;
const provider = new chainInfo.PrecompileChainInfoProvider(creditcoin);
console.log(`waiting for block ${receipt.blockNumber} to be attested`);
await waitForAttestation(provider, chainKey, receipt.blockNumber);

const builder = new proofProvider.service.ProofBuilder(chainKey, config.proofBuilderUrl);
const result = await builder.getBatchProof([txHash]);
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

console.log(`the precompile accepts a proof for it: ${heights.length} inclusion proof(s) built`);
console.log('delivering to the router, which should refuse it');

const tx = await router.deliver(chainKey, heights, txBytes, merkleProofs, data.continuityProof);
const r = await tx.wait();

const skipped = r.logs
  .map((l: any) => {
    try {
      return router.interface.parseLog(l);
    } catch {
      return null;
    }
  })
  .filter((l: any) => l?.name === 'QuerySkipped');

console.log(`\ndelivered in ${r.hash} | gas ${r.gasUsed}`);
console.log(`verification succeeded: the transaction really is in that block.`);
for (const ev of skipped) {
  const reason = Number(ev!.args.reason);
  console.log(
    `router refused query ${ev!.args.queryId.slice(0, 10)} with reason ${reason}` +
      (reason === 2 ? ' (source transaction failed)' : ''),
  );
}
if (skipped.length === 0) console.log('nothing was skipped, which means the receipt gate did not fire');
