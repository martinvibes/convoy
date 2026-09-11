import type { chainInfo } from '@gluwa/usc-sdk';
import { config } from './config.js';

/**
 * Wait for a source-chain height to be attested on Creditcoin.
 *
 * Two things make the SDK's waitUntilHeightAttested unusable as-is against the public testnet RPC.
 * Its default timeout is 60 seconds, and the measured lag between a Sepolia block and its
 * attestation is about 6.4 minutes. And its internal backoff gives up after five attempts, so one
 * slow response aborts a wait that was otherwise progressing normally.
 *
 * A timeout reaching a node is not the same as the height not being attested. Only the deadline
 * ends this loop.
 */
export async function waitForAttestation(
  provider: chainInfo.PrecompileChainInfoProvider,
  chainKey: number,
  height: number,
  log: (msg: string) => void = console.log,
): Promise<void> {
  const deadline = Date.now() + config.attestationWaitMs;
  let reported = -1;

  for (;;) {
    try {
      const latest = await provider.getLatestAttestedHeightAndHash(chainKey);
      if (latest.exists && latest.height >= height) {
        // The SDK waits after detection too: the attestation is on chain slightly before the proof
        // service can serve data for it.
        await sleep(15_000);
        return;
      }
      if (latest.exists && latest.height !== reported) {
        reported = latest.height;
        log(`attested to ${latest.height}, waiting for ${height} (${height - latest.height} behind)`);
      }
    } catch (err) {
      log(`attestation check failed, retrying: ${(err as Error).message}`);
    }

    if (Date.now() > deadline) {
      throw new Error(
        `gave up waiting for height ${height} on chain key ${chainKey} after ` +
          `${Math.round(config.attestationWaitMs / 1000)}s. Raise ATTESTATION_WAIT_MS.`,
      );
    }
    await sleep(config.attestationPollMs);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
