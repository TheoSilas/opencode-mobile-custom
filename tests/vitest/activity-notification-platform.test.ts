import { afterEach, describe, expect, it, vi } from 'vitest';
import { isActivityCompletionManaged, manageActivityCompletion, updateActivityNotification } from '@/lib/activity-notifications';

const native = vi.hoisted(() => ({ update: vi.fn().mockResolvedValue(true), suppressesCompletion: vi.fn().mockReturnValue(true) }));
vi.mock('expo', () => ({ requireOptionalNativeModule: () => native }));
vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: {} } } }));
vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('@/lib/i18n', () => ({ i18n: { t: (key: string, args?: any) => args?.count ? `${args.count} tasks` : key } }));
afterEach(() => { manageActivityCompletion(); native.update.mockClear(); native.suppressesCompletion.mockReturnValue(true); });

describe('Android notification boundary', () => {
  it('builds a connection-scoped link and one combined notification', async () => {
    await updateActivityNotification({ sessionId: 'session/with spaces', projectPath: '/other project', connectionScope: 'https://other:alice', title: 'Task', action: 'Reading files', count: 2, key: 'cycle', active: true });
    const content = native.update.mock.calls[0][0];
    const link = new URL(content.link);
    expect(decodeURIComponent(link.pathname)).toBe('/session/with spaces');
    expect(link.searchParams.get('project')).toBe('/other project');
    expect(link.searchParams.get('connectionScope')).toBe('https://other:alice');
    expect(content).toMatchObject({ title: '2 tasks', body: 'Task · Reading files', key: 'cycle', active: true });
  });

  it('uses a fallback title and releases completion delivery after native monitoring ends', async () => {
    manageActivityCompletion('scope');
    expect(isActivityCompletionManaged('scope')).toBe(true);
    expect(isActivityCompletionManaged('other')).toBe(false);
    native.suppressesCompletion.mockReturnValue(false);
    expect(isActivityCompletionManaged('scope')).toBe(false);
    await updateActivityNotification({ sessionId: 's', projectPath: '/repo', connectionScope: 'scope', title: '  ', action: 'Ready to review', count: 0, key: 'cycle', active: false });
    expect(native.update.mock.calls[0][0]).toMatchObject({ title: 'notifications:activity.untitled', body: 'Ready to review', active: false });
  });
});
