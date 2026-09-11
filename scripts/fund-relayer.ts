/**
 * Move a slice of CTC from the deployer to the relayer.
 *
 * The relayer is a separate key on purpose: Convoy's whole claim is that proof delivery is a third
 * party service, and a demo where the deployer relays its own convoys quietly assumes away the
 * thing being demonstrated. Funding it from the deployer keeps that separation while still only
 * needing one trip to the faucet.
 */
import { parseEther, formatEther } from 'ethers';
import { signer, CREDITCOIN_RPC } from './lib.js';
import { Wallet } from 'ethers';

const amount = parseEther(process.argv[2] ?? process.env.RELAYER_FUND_CTC ?? '0.05');

const deployer = signer(CREDITCOIN_RPC, 'CREDITCOIN_PRIVATE_KEY');
const relayerKey = process.env.RELAYER_PRIVATE_KEY;
if (!relayerKey) throw new Error('RELAYER_PRIVATE_KEY missing from .env');
const relayerAddress = new Wallet(relayerKey).address;

const balance = await deployer.provider!.getBalance(deployer.address);
console.log(`deployer ${deployer.address} holds ${formatEther(balance)} CTC`);
if (balance < amount) {
  throw new Error(
    `not enough CTC to send ${formatEther(amount)}. Fund the deployer from the Creditcoin Discord faucet first.`,
  );
}

console.log(`sending ${formatEther(amount)} CTC to relayer ${relayerAddress}`);
const tx = await deployer.sendTransaction({ to: relayerAddress, value: amount });
await tx.wait();

const after = await deployer.provider!.getBalance(relayerAddress);
console.log(`relayer now holds ${formatEther(after)} CTC  (${tx.hash})`);
