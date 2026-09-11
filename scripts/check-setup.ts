/**
 * Preflight. Needs no keys and no funds.
 *
 * Confirms the rail Convoy rides on is actually live: the Creditcoin RPC answers, the ChainInfo
 * precompile lists the source chains, and the attestor network is currently attesting them. Run
 * this before spending time on deployment.
 */
import { JsonRpcProvider, Contract } from 'ethers';
import { createRequire } from 'node:module';
import { CREDITCOIN_RPC } from './lib.js';

const require = createRequire(import.meta.url);
const chainInfoAbi = require('@gluwa/usc-sdk/dist/chain-info/chain_info.json');

const CHAIN_INFO_PRECOMPILE = '0x0000000000000000000000000000000000000fd3';
const BLOCK_PROVER_PRECOMPILE = '0x0000000000000000000000000000000000000FD2';

const provider = new JsonRpcProvider(CREDITCOIN_RPC);

const network = await provider.getNetwork();
const head = await provider.getBlockNumber();
console.log(`Creditcoin  chain id ${network.chainId}  head ${head}  ${CREDITCOIN_RPC}`);
console.log(`BlockProver precompile ${BLOCK_PROVER_PRECOMPILE}`);

const chainInfo = new Contract(CHAIN_INFO_PRECOMPILE, chainInfoAbi.abi ?? chainInfoAbi, provider);
const chains = await chainInfo.get_supported_chains();

console.log(`\nsource chains readable from here:`);
for (const c of chains) {
  const name = Buffer.from(String(c[2]).slice(2), 'hex').toString();
  const latest = await chainInfo.get_latest_attestation_height_and_hash(c[0]);
  console.log(
    `  chainKey ${String(c[0]).padEnd(3)} ${name.padEnd(18)} evm chain id ${String(c[1]).padEnd(10)}` +
      ` latest attestation ${latest[0]} (${latest[2] ? 'attestation' : 'checkpoint'})`,
  );
}

const sepolia = chains.find((c: unknown[]) => String(c[0]) === '1');
if (!sepolia) {
  console.log('\nSepolia (chainKey 1) is not currently attested here. Convoy expects chainKey 1.');
  process.exit(1);
}
console.log(`\nready: Convoy reads chainKey 1 (Sepolia). Attestations are current.`);
