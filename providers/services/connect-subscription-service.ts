import type { Purchase } from 'expo-iap';

import { claimConnectSubscription, saveConnectSession, type ConnectSession, type ConnectStore } from '@/lib/connect';
import { connectPurchaseProof, type ConnectStoreApi } from '@/lib/connect-store';

// Checkpoint belongs to the provider. Retrying storage/finalization reuses the
// granted session; after restart the same native proof can be claimed again.
export type PendingConnectPurchase = { purchase: Purchase; session?: ConnectSession; persisted?: boolean };

export async function finalizeConnectPurchase(controlPlaneUrl: string, store: ConnectStore, pending: PendingConnectPurchase, api: ConnectStoreApi,
  onPhase: (phase: 'verifying' | 'savingSession' | 'finalizing') => void) {
  if (pending.purchase.purchaseState !== 'purchased') throw new Error('The store purchase is pending approval.');
  if (!pending.session) {
    onPhase('verifying');
    pending.session = await claimConnectSubscription(controlPlaneUrl, await connectPurchaseProof(pending.purchase, api, store));
  }
  if (!pending.persisted) {
    onPhase('savingSession');
    try { await saveConnectSession(controlPlaneUrl, store, pending.session); }
    catch { throw new Error('Subscription verified, but secure session saving failed. Retry saving without purchasing again.'); }
    pending.persisted = true;
  }
  onPhase('finalizing');
  try { await api.finishTransaction({ purchase: pending.purchase, isConsumable: false }); }
  catch { throw new Error('Session saved, but store finalization failed. Retry finalization without purchasing again.'); }
  return pending.session;
}
