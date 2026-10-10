import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MAX_ATTACHMENT_BYTES, readLocalAttachmentDataUrl } from '@/lib/attachment-preview';

const h = vi.hoisted(() => ({ size: 0, read: vi.fn(), uris: [] as string[] }));
vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('expo-file-system', () => ({ File: class {
  constructor(uri: string) { h.uris.push(uri); }
  get size() { return h.size; }
  base64() { return h.read(); }
} }));

describe('native attachment byte reads', () => {
  beforeEach(() => { h.size = 0; h.uris = []; h.read.mockReset(); });

  it.each(['content://com.miui.gallery.open/raw/screenshot.jpg', 'file:///cache/photo.jpg'])('prepares server-readable bytes from %s', async (uri) => {
    h.read.mockResolvedValue('aGk=');
    await expect(readLocalAttachmentDataUrl(uri, 'image/jpeg')).resolves.toBe('data:image/jpeg;base64,aGk=');
    expect(h.uris).toEqual([uri]);
  });

  it('rejects known oversized files before reading', async () => {
    h.size = MAX_ATTACHMENT_BYTES + 1;
    await expect(readLocalAttachmentDataUrl('file:///big', 'image/png')).rejects.toThrow('10 MB');
    expect(h.read).not.toHaveBeenCalled();
  });

  it('checks actual byte size when the content provider omits metadata', async () => {
    h.read.mockResolvedValue('A'.repeat(Math.ceil((MAX_ATTACHMENT_BYTES + 3) / 3) * 4));
    await expect(readLocalAttachmentDataUrl('content://gallery/big', 'image/png')).rejects.toThrow('10 MB');
  });

  it('propagates revoked URI grants instead of returning empty attachment bytes', async () => {
    h.read.mockRejectedValue(new Error('Permission denied'));
    await expect(readLocalAttachmentDataUrl('content://ime/image', 'image/gif')).rejects.toThrow('Permission denied');
  });
});
