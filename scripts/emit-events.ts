/**
 * Fire a burst of source-chain events on Sepolia so the relayer has a convoy to form.
 *
 * Usage: tsx scripts/emit-events.ts [count]
 *
 * The events deliberately rotate across all three subscribers, because the point being demonstrated
 * is that a batch fills with traffic belonging to applications that have nothing to do with each
 * other. The final transaction reverts on purpose, to show Convoy skipping a provable but failed
 * source transaction rather than delivering it as fact.
 */
import { Contract, parseEther, id as keccak } from 'ethers';
import { artifact, signer, need } from './lib.js';

const count = Number(process.argv[2] ?? '9');
const rpc = process.env.SOURCE_CHAIN_RPC_URL;
if (!rpc) throw new Error('Set SOURCE_CHAIN_RPC_URL in .env');

const wallet = signer(rpc, 'SOURCE_PRIVATE_KEY');
const emitter = new Contract(need('SOURCE_EMITTER_ADDRESS'), artifact('ConvoyEmitter').abi, wallet);

console.log(`emitting ${count} events from ${await emitter.getAddress()} as ${wallet.address}`);

for (let i = 0; i < count; i++) {
  const id = keccak(`convoy-demo-${Date.now()}-${i}`);
  let tx;
  if (i % 3 === 0) {
    tx = await emitter.repay(id, parseEther('250'), true);
  } else if (i % 3 === 1) {
    tx = await emitter.acceptDelivery(id, parseEther('1'));
  } else {
    tx = await emitter.signal(id, 1, BigInt(100 * (i + 1)));
  }
  const receipt = await tx.wait();
  console.log(`  ${i + 1}/${count} block ${receipt.blockNumber} ${receipt.hash}`);
}

console.log('\nnow the negative case: a transaction that reverts after emitting');
try {
  const tx = await emitter.repayThenRevert(keccak('reverting'), parseEther('999'), {
    gasLimit: 200_000,
  });
  const receipt = await tx.wait();
  console.log(`  included in block ${receipt.blockNumber} with status ${receipt.status}: ${receipt.hash}`);
} catch (err) {
  console.log(`  reverted as expected: ${(err as Error).message.slice(0, 120)}`);
}
