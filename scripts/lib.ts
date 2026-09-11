import 'dotenv/config';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JsonRpcProvider, Wallet, ContractFactory, Contract } from 'ethers';

const here = dirname(fileURLToPath(import.meta.url));
export const root = resolve(here, '..');

export function artifact(name: string): { abi: any[]; bytecode: string } {
  const path = resolve(root, 'out', `${name}.sol`, `${name}.json`);
  const j = JSON.parse(readFileSync(path, 'utf8'));
  return { abi: j.abi, bytecode: j.bytecode.object };
}

export async function deploy(
  name: string,
  wallet: Wallet,
  args: unknown[] = [],
  value?: bigint,
): Promise<Contract> {
  const { abi, bytecode } = artifact(name);
  const factory = new ContractFactory(abi, bytecode, wallet);
  const c = value === undefined
    ? await factory.deploy(...args)
    : await factory.deploy(...args, { value });
  await c.waitForDeployment();
  const address = await c.getAddress();
  console.log(`  ${name.padEnd(24)} ${address}`);
  return c as unknown as Contract;
}

export function signer(rpcUrl: string, keyVar: string): Wallet {
  const key = process.env[keyVar];
  if (!key) throw new Error(`Missing ${keyVar} in .env`);
  return new Wallet(key, new JsonRpcProvider(rpcUrl));
}

const DEPLOY_FILE = resolve(root, 'deployments.json');

export function readDeployments(): Record<string, string> {
  if (!existsSync(DEPLOY_FILE)) return {};
  return JSON.parse(readFileSync(DEPLOY_FILE, 'utf8'));
}

export function writeDeployments(patch: Record<string, string>): void {
  const merged = { ...readDeployments(), ...patch };
  writeFileSync(DEPLOY_FILE, JSON.stringify(merged, null, 2) + '\n');
  console.log(`\nwrote deployments.json`);
}

export function need(key: string): string {
  const d = readDeployments();
  const v = d[key] ?? process.env[key];
  if (!v) throw new Error(`${key} not found in deployments.json or .env — run the deploy scripts first`);
  return v;
}

export const CREDITCOIN_RPC =
  process.env.CREDITCOIN_RPC_URL ?? 'https://rpc.cc3-testnet.creditcoin.network';
