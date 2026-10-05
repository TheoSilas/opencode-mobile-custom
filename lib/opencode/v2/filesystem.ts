import { decodeFile, type V2Adapter } from './shared';

export function buildFilesystemApi({ api, ok }: V2Adapter): Record<string, unknown> {
  return {
    find: {
      files: async (parameters: { query: string; dirs?: string }) => {
        const includeDirectories = parameters.dirs === 'true';
        const response = await api.file.find({ query: parameters.query, limit: 100, ...(includeDirectories ? {} : { type: 'file' }) });
        return ok((response.data ?? []).map((entry) => entry.path));
      },
      text: async () => ok([]),
      symbols: async () => ok([]),
    },
    file: {
      list: async (parameters: { path?: string }) => {
        const response = await api.file.list(parameters?.path ? { path: parameters.path } : {});
        return ok(response.data);
      },
      read: async (parameters: { path: string }) => ok(decodeFile(await api.file.read({ path: parameters.path }))),
      status: async () => ok([]),
    },
  };
}
