import Constants from 'expo-constants';
import { fetch as expoFetch } from 'expo/fetch';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

export type ConnectMetadata = {
  controlPlaneUrl: string;
  machineId: string;
  machineName: string;
  deviceId: string;
  expiresAt: string;
};
export type ConnectPairing = { controlPlaneUrl: string; pairingId: string; pairingToken: string; machineName: string };
export type ConnectClaim = { server_url: string; machine_id: string; machine_name: string; device_id: string; device_secret: string; expires_at: string };
export type ConnectMachine = { id: string; name: string; hostname: string; public_url: string; created_at: string };

export function isConnectEnabled() {
  const extra = Constants.expoConfig?.extra;
  return extra?.connectPilot?.enabled === true && (
    Platform.OS === 'ios' || Platform.OS === 'android' || (extra?.e2eMode === true && extra?.connectPilot?.testing === true)
  );
}

export function normalizeControlPlaneUrl(value: string) {
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Invalid control plane URL.');
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

export function getConnectControlPlanes(): string[] {
  const values: unknown = Constants.expoConfig?.extra?.connectPilot?.controlPlanes;
  if (!Array.isArray(values)) return [];
  return values.flatMap((value) => {
    if (typeof value !== 'string') return [];
    try {
      const url = normalizeControlPlaneUrl(value);
      return url === 'https://api.getopencode.app' ? [url] : [];
    } catch { return []; }
  });
}

function requireControlPlane(value: string) {
  if (!isConnectEnabled()) throw new Error('Connect is available only in development builds.');
  const url = normalizeControlPlaneUrl(value);
  if (!getConnectControlPlanes().includes(url)) throw new Error('This control plane is not trusted by this development build.');
  return url;
}

export function parseConnectPairing(value: string | Record<string, string | string[] | undefined>): ConnectPairing {
  try {
    const url = new URL(typeof value === 'string' ? value : 'opencodemobile://pair');
    if (typeof value !== 'string') {
      for (const [key, entries] of Object.entries(value)) for (const entry of Array.isArray(entries) ? entries : entries === undefined ? [] : [entries]) url.searchParams.append(key, entry);
    }
    if (url.protocol !== 'opencodemobile:' || url.hostname !== 'pair' || (url.pathname && url.pathname !== '/') || url.hash || url.username || url.password) throw new Error();
    const fields = ['v', 'cp', 'id', 't', 'n'];
    if (fields.some((field) => url.searchParams.getAll(field).length !== 1 || !url.searchParams.get(field)?.trim())) throw new Error();
    if (url.searchParams.get('v') !== '1') throw new Error();
    const pairingId = url.searchParams.get('id')!;
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(pairingId)) throw new Error();
    return {
      controlPlaneUrl: requireControlPlane(url.searchParams.get('cp')!),
      pairingId,
      pairingToken: url.searchParams.get('t')!,
      machineName: url.searchParams.get('n')!,
    };
  } catch (error) {
    if (error instanceof Error && /trusted|development builds/.test(error.message)) throw error;
    throw new Error('Invalid or unsupported pairing link. Open a fresh link from the connector.');
  }
}

export function parseConnectMetadata(value: unknown): ConnectMetadata | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  const keys = ['controlPlaneUrl', 'machineId', 'machineName', 'deviceId', 'expiresAt'] as const;
  if (keys.some((key) => typeof record[key] !== 'string' || !(record[key] as string).trim())) return undefined;
  try {
    const result = Object.fromEntries(keys.map((key) => [key, (record[key] as string).trim()])) as ConnectMetadata;
    result.controlPlaneUrl = normalizeControlPlaneUrl(result.controlPlaneUrl);
    if (!Number.isFinite(Date.parse(result.expiresAt))) return undefined;
    return result;
  } catch { return undefined; }
}

export function getConnectCredentialError(connect: ConnectMetadata | undefined, password: string, now = Date.now()) {
  if (!connect) return undefined;
  if (!parseConnectMetadata(connect)) return 'Invalid Connect profile. Pair this device again.';
  try { requireControlPlane(connect.controlPlaneUrl); } catch (error) { return (error as Error).message; }
  if (Date.parse(connect.expiresAt) <= now) return 'Connect credentials expired. Pair this device again.';
  if (!password) return 'Connect credentials are missing. Pair this device again.';
  return undefined;
}

// Web credentials exist only in the explicit development E2E build and vanish
// on reload. Product web builds continue to have no credential persistence.
const testSecrets = new Map<string, string>();
export function getConnectTestSecret(key: string) {
  return isConnectEnabled() && Platform.OS === 'web' ? testSecrets.get(key) ?? '' : '';
}
export function setConnectTestSecret(key: string, value: string) {
  if (isConnectEnabled() && Platform.OS === 'web') {
    if (value) testSecrets.set(key, value); else testSecrets.delete(key);
  }
}

function tokenKey(controlPlaneUrl: string) {
  // Encode every byte as a SecureStore-safe key segment; never use the token.
  const segment = Array.from(controlPlaneUrl).map((char) => char.charCodeAt(0).toString(16)).join('-');
  return `opencode-mobile.connect-user-token.${segment}`;
}
export async function getConnectUserToken(controlPlaneUrl: string) {
  const key = tokenKey(requireControlPlane(controlPlaneUrl));
  const configured: unknown = Constants.expoConfig?.extra?.connectPilot?.testUserToken;
  if (typeof configured === 'string' && configured.trim()) {
    await saveConnectUserToken(controlPlaneUrl, configured);
    return configured.trim();
  }
  return Platform.OS === 'web' ? getConnectTestSecret(key) : (await SecureStore.getItemAsync(key)) ?? '';
}
export async function saveConnectUserToken(controlPlaneUrl: string, token: string) {
  const key = tokenKey(requireControlPlane(controlPlaneUrl));
  const value = token.trim();
  if (Platform.OS === 'web') { setConnectTestSecret(key, value); return; }
  if (value) await SecureStore.setItemAsync(key, value, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
  else await SecureStore.deleteItemAsync(key);
}

export class ConnectApiError extends Error {
  constructor(public status: number) {
    super({
      401: 'The development test token is invalid. Update the build configuration and restart the app.',
      403: 'This user has no active subscription. Update the test entitlement and try again.',
      404: 'Unknown pairing. Open a fresh link from the connector.',
      409: 'This pairing expired or was already claimed. Open a fresh link from the connector.',
      429: 'Too many requests. Wait before trying again.',
    }[status] ?? 'The control plane could not complete the request. Try again.');
  }
}

async function connectRequest(controlPlaneUrl: string, path: string, token: string, method = 'GET', body?: object) {
  const base = requireControlPlane(controlPlaneUrl);
  if (!token.trim()) throw new ConnectApiError(401);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    let response: Response;
    try {
      response = await expoFetch(`${base}${path}`, {
        method, signal: controller.signal, redirect: 'error',
        headers: { Authorization: `Bearer ${token.trim()}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch { throw new Error(method === 'POST' ? 'Could not reach the control plane. A claim may have completed; if retry returns a conflict, create a new pairing.' : 'Could not reach the control plane. Try again.'); }
    if (!response.ok) throw new ConnectApiError(response.status);
    if (response.status === 204) return undefined;
    try { return await response.json() as unknown; } catch { throw new Error('Invalid control plane response. Create a new pairing if the claim completed.'); }
  } finally { clearTimeout(timer); }
}

export async function claimConnectPairing(pairing: ConnectPairing, token: string, deviceName: string): Promise<ConnectClaim> {
  if (!deviceName.trim()) throw new Error('Enter a device name.');
  // Contract: the user bearer authenticates claim; t is not sent to this endpoint.
  const value = await connectRequest(pairing.controlPlaneUrl, `/v1/pairings/${encodeURIComponent(pairing.pairingId)}/claim`, token, 'POST', { device_name: deviceName.trim() });
  const result = value as ConnectClaim | undefined;
  const fields = ['server_url', 'machine_id', 'machine_name', 'device_id', 'device_secret', 'expires_at'] as const;
  if (!result || fields.some((key) => typeof result[key] !== 'string' || !result[key].trim()) || !Number.isFinite(Date.parse(result.expires_at))) throw new Error('Invalid pairing response. Create a new pairing.');
  let server: URL;
  try { server = new URL(result.server_url); } catch { throw new Error('The connector returned an unsafe server URL.'); }
  const local = new URL(pairing.controlPlaneUrl).protocol === 'http:';
  if ((server.protocol !== 'https:' && !(local && server.protocol === 'http:')) || server.username || server.password || server.search || server.hash) throw new Error('The connector returned an unsafe server URL.');
  if (Date.parse(result.expires_at) <= Date.now()) throw new Error('The connector returned expired credentials. Pair again.');
  return Object.fromEntries(fields.map((key) => [key, result[key]])) as ConnectClaim;
}

export async function listConnectMachines(controlPlaneUrl: string, token: string): Promise<ConnectMachine[]> {
  const value = await connectRequest(controlPlaneUrl, '/v1/machines', token) as { machines?: unknown } | undefined;
  if (!Array.isArray(value?.machines)) throw new Error('Invalid machine list response.');
  const fields = ['id', 'name', 'hostname', 'public_url', 'created_at'] as const;
  return value.machines.map((entry) => {
    if (!entry || fields.some((key) => typeof entry[key] !== 'string')) throw new Error('Invalid machine list response.');
    return Object.fromEntries(fields.map((key) => [key, entry[key]])) as ConnectMachine;
  });
}
export async function revokeConnectMachine(controlPlaneUrl: string, machineId: string, token: string) {
  await connectRequest(controlPlaneUrl, `/v1/machines/${encodeURIComponent(machineId)}`, token, 'DELETE');
}
