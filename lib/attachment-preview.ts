import { decode } from 'base-64';
import { Platform } from 'react-native';

import type { PromptAttachment } from '@/lib/opencode/prompt-inbox';

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export function pickedAttachment(asset: { uri: string; base64?: string; mimeType?: string; name: string }): PromptAttachment {
  const mime = asset.mimeType || 'application/octet-stream';
  const uri = asset.base64 ? asset.base64.startsWith('data:') ? asset.base64 : `data:${mime};base64,${asset.base64}` : asset.uri;
  if (Platform.OS === 'web' && asset.base64 && asset.uri.startsWith('blob:')) URL.revokeObjectURL(asset.uri);
  return { uri, mime, filename: asset.name };
}

export function attachmentKind(attachment: PromptAttachment) {
  const mime = attachment.mime || attachment.uri.match(/^data:([^;,]+)/i)?.[1] || '';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/') || /\.(mp4|mov|m4v|webm)$/i.test(attachment.filename || '')) return 'video';
  if (mime.startsWith('text/') || /^(application\/(json|xml|javascript))$/.test(mime)
    || /\.(txt|md|csv|json|xml|log|js|ts|tsx|py|yaml|yml)$/i.test(attachment.filename || '')) return 'text';
  return 'document';
}

export function dataUrlBytes(uri: string) {
  const match = uri.match(/^data:([^,]*),([\s\S]*)$/i);
  if (!match) throw new Error('Invalid attachment data.');
  const body: string | undefined = /;base64$/i.test(match[1]) ? decode(match[2]) : undefined;
  const bytes = body !== undefined
    ? Uint8Array.from(body, (character) => character.charCodeAt(0))
    : new TextEncoder().encode(decodeURIComponent(match[2]));
  if (bytes.length > MAX_ATTACHMENT_BYTES) throw new Error('File exceeds the 10 MB attachment limit.');
  return bytes;
}

export function validateAttachmentUri(uri: string) {
  if (!/^(data:|https?:\/\/|file:\/\/|content:\/\/|blob:)/i.test(uri)) {
    throw new Error('Attachment content is unavailable.');
  }
}

export async function readAttachmentText(attachment: PromptAttachment) {
  validateAttachmentUri(attachment.uri);
  if (attachment.uri.startsWith('data:')) return new TextDecoder().decode(dataUrlBytes(attachment.uri));
  if (Platform.OS !== 'web' && /^(file|content):/i.test(attachment.uri)) {
    const { File } = await import('expo-file-system');
    const file = new File(attachment.uri);
    if (file.size > MAX_ATTACHMENT_BYTES) throw new Error('File exceeds the 10 MB attachment limit.');
    return file.text();
  }
  const response = await fetch(attachment.uri);
  if (!response.ok) throw new Error('Could not read attachment.');
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > MAX_ATTACHMENT_BYTES) throw new Error('File exceeds the 10 MB attachment limit.');
  return new TextDecoder().decode(bytes);
}

let previewCounter = 0;
export async function prepareAttachmentFile(attachment: PromptAttachment) {
  validateAttachmentUri(attachment.uri);
  if (Platform.OS === 'web' || /^(file|content):/i.test(attachment.uri)) {
    return { uri: attachment.uri, release: () => {} };
  }
  const { File, Paths } = await import('expo-file-system');
  const name = (attachment.filename || 'attachment').replace(/[^\w.-]/g, '_');
  const file = new File(Paths.cache, `preview-${Date.now()}-${++previewCounter}-${name}`);
  try {
    if (attachment.uri.startsWith('data:')) {
      file.create();
      file.write(dataUrlBytes(attachment.uri));
    } else {
      await File.downloadFileAsync(attachment.uri, file);
    }
    if (file.size > MAX_ATTACHMENT_BYTES) throw new Error('File exceeds the 10 MB attachment limit.');
    return { uri: file.uri, release: () => { if (file.exists) file.delete(); } };
  } catch (error) {
    if (file.exists) file.delete();
    throw error;
  }
}

export async function openAttachmentExternally(attachment: PromptAttachment) {
  validateAttachmentUri(attachment.uri);
  if (Platform.OS === 'web') {
    if (/^https?:/i.test(attachment.uri)) {
      window.open(attachment.uri, '_blank', 'noopener,noreferrer');
      return;
    }
    let uri = attachment.uri;
    if (uri.startsWith('data:')) {
      const bytes = dataUrlBytes(uri);
      uri = URL.createObjectURL(new Blob([bytes.buffer as ArrayBuffer], { type: attachment.mime || 'application/octet-stream' }));
    }
    const link = document.createElement('a');
    link.href = uri;
    link.download = attachment.filename || 'attachment';
    link.click();
    if (uri !== attachment.uri) setTimeout(() => URL.revokeObjectURL(uri), 1000);
    return;
  }
  const sharing = await import('expo-sharing');
  if (!await sharing.isAvailableAsync()) throw new Error('No compatible document viewer is available.');
  const file = await prepareAttachmentFile(attachment);
  try {
    await sharing.shareAsync(file.uri, { mimeType: attachment.mime, dialogTitle: attachment.filename });
  } finally {
    file.release();
  }
}
