/** Deploy the source-chain emitter to Ethereum Sepolia. */
import { deploy, signer, writeDeployments } from './lib.js';

const rpc = process.env.SOURCE_CHAIN_RPC_URL;
if (!rpc) throw new Error('Set SOURCE_CHAIN_RPC_URL in .env');

const wallet = signer(rpc, 'SOURCE_PRIVATE_KEY');
console.log(`deploying to Sepolia as ${wallet.address}`);

const emitter = await deploy('ConvoyEmitter', wallet);

writeDeployments({ SOURCE_EMITTER_ADDRESS: await emitter.getAddress() });
