/** Post the relayer's slashable bond so the router will accept its convoys. */
import { Contract, parseEther } from 'ethers';
import { artifact, signer, need, CREDITCOIN_RPC } from './lib.js';

const wallet = signer(CREDITCOIN_RPC, 'RELAYER_PRIVATE_KEY');
const bond = new Contract(need('RELAYER_BOND_ADDRESS'), artifact('RelayerBond').abi, wallet);

const min = await bond.MIN_BOND();
console.log(`bonding ${min} wei as ${wallet.address}`);
await (await bond.bondUp({ value: min })).wait();
console.log(`bonded: ${await bond.isBonded(wallet.address)}`);
