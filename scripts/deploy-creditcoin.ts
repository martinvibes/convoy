/**
 * Deploy the Convoy stack to Creditcoin CC3 testnet and wire three unrelated subscribers onto the
 * same route table.
 */
import { parseEther, formatEther, id as keccak } from 'ethers';
import { deploy, signer, writeDeployments, need, CREDITCOIN_RPC } from './lib.js';

const CHAIN_KEY = Number(process.env.SOURCE_CHAIN_KEY ?? '1');

// Sized for a faucet-funded account. The Creditcoin testnet faucet hands out small amounts, and a
// demo that cannot be funded from the faucet is a demo nobody can reproduce. Raise these with env
// vars for anything resembling production.
const MIN_BOND = parseEther(process.env.MIN_BOND_CTC ?? '0.01');
const FEE = parseEther(process.env.DELIVERY_FEE_CTC ?? '0.0001');
const PREPAY = parseEther(process.env.PREPAY_CTC ?? '0.01');
const CALLBACK_GAS = 400_000;

const REPAYMENT_TOPIC = keccak('RepaymentMade(address,bytes32,uint256,bool)');
const DELIVERY_TOPIC = keccak('DeliveryAccepted(bytes32,address,uint256)');
const SIGNAL_TOPIC = keccak('TreasurySignal(bytes32,uint8,int256)');

const emitter = need('SOURCE_EMITTER_ADDRESS');
const wallet = signer(CREDITCOIN_RPC, 'CREDITCOIN_PRIVATE_KEY');

console.log(`deploying to Creditcoin CC3 testnet as ${wallet.address}`);
console.log(`source emitter on Sepolia: ${emitter}`);
console.log(
  `bond ${formatEther(MIN_BOND)} CTC | fee ${formatEther(FEE)} CTC/delivery | ` +
    `prepay ${formatEther(PREPAY)} CTC x3 subscriptions\n`,
);

const bond = await deploy('RelayerBond', wallet, [wallet.address, MIN_BOND]);
const registry = await deploy('SubscriptionRegistry', wallet, [wallet.address]);
const router = await deploy('ConvoyRouter', wallet, [
  await registry.getAddress(),
  await bond.getAddress(),
]);

await (await registry.setRouter(await router.getAddress())).wait();
console.log('  registry wired to router');

const routerAddress = await router.getAddress();
const passport = await deploy('PassportSubscriber', wallet, [routerAddress]);
const escrow = await deploy('EscrowSubscriber', wallet, [routerAddress]);
const council = await deploy('CouncilSubscriber', wallet, [routerAddress, wallet.address]);

console.log('\nsubscribing three unrelated dApps to the same emitter:');
for (const [name, callback, topic] of [
  ['passport', await passport.getAddress(), REPAYMENT_TOPIC],
  ['escrow', await escrow.getAddress(), DELIVERY_TOPIC],
  ['council', await council.getAddress(), SIGNAL_TOPIC],
] as const) {
  const tx = await registry.subscribe(callback, CHAIN_KEY, emitter, topic, FEE, CALLBACK_GAS, {
    value: PREPAY,
  });
  await tx.wait();
  console.log(`  ${name.padEnd(10)} ${topic.slice(0, 10)} prepaid ${formatEther(PREPAY)} CTC`);
}

writeDeployments({
  RELAYER_BOND_ADDRESS: await bond.getAddress(),
  SUBSCRIPTION_REGISTRY_ADDRESS: await registry.getAddress(),
  CONVOY_ROUTER_ADDRESS: routerAddress,
  PASSPORT_ADDRESS: await passport.getAddress(),
  ESCROW_ADDRESS: await escrow.getAddress(),
  COUNCIL_ADDRESS: await council.getAddress(),
});
