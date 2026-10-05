import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));

export function toDataUri(code) {
  return `data:text/javascript,${encodeURIComponent(code)}`;
}

// Transpile a TS module and recursively inline its relative and alias imports
// as data: URLs, so a module split across files stays loadable by the pure
// test suites (a data: URL cannot resolve relative specifiers on its own).
// `imports` maps a bare/alias specifier to a replacement module URL (stubs);
// `replacements` runs extra regex substitutions after transpile.
export async function loadTsModule(relative, { imports = {}, replacements = [], alias = { '@/': projectRoot } } = {}) {
  const cache = new Map();
  const resolving = new Set();
  const stubCache = new WeakMap();
  let stubId = 0;

  // An `imports` value may be a module URL string or a plain object/namespace
  // stub. Object stubs are exposed through globalThis and re-exported by a
  // generated data: module, so a data: URL with no bare-specifier resolution
  // can still import them by name.
  function stubModule(value) {
    if (typeof value === 'string') return value;
    if (value && typeof value === 'object') {
      const cached = stubCache.get(value);
      if (cached) return cached;
    }
    const key = `__loadTsModuleStub${stubId++}`;
    globalThis[key] = value;
    const names = value && typeof value === 'object'
      ? Object.keys(value).filter((name) => name !== 'default' && /^[A-Za-z_$][\w$]*$/.test(name))
      : [];
    const code = [
      `const m = globalThis.${key};`,
      'export default (m && m.default !== undefined) ? m.default : m;',
      ...names.map((name) => `export const ${name} = m[${JSON.stringify(name)}];`),
    ].join('\n');
    const uri = toDataUri(code);
    if (value && typeof value === 'object') stubCache.set(value, uri);
    return uri;
  }

  async function resolveSpecifier(fromFile, spec) {
    if (Object.prototype.hasOwnProperty.call(imports, spec)) return stubModule(imports[spec]);
    let target;
    if (spec.startsWith('.')) {
      target = path.resolve(path.dirname(fromFile), spec);
    } else {
      const prefix = Object.keys(alias).find((key) => spec.startsWith(key));
      if (!prefix) return undefined;
      target = path.resolve(alias[prefix], './' + spec.slice(prefix.length));
    }
    for (const candidate of [target, `${target}.ts`, `${target}.tsx`, `${target}.js`, path.join(target, 'index.ts'), path.join(target, 'index.tsx')]) {
      try {
        await readFile(candidate);
        return await build(candidate);
      } catch {
        // Try the next candidate extension.
      }
    }
    throw new Error(`loadTsModule could not resolve ${spec} from ${fromFile}`);
  }

  async function build(file) {
    if (cache.has(file)) return cache.get(file);
    if (resolving.has(file)) throw new Error(`loadTsModule cannot inline a circular import: ${file}`);
    resolving.add(file);
    let code = ts.transpileModule(await readFile(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    for (const [pattern, replacement] of replacements) code = code.replace(pattern, replacement);
    const specifiers = new Set([...code.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map((match) => match[1]));
    for (const spec of specifiers) {
      const resolved = await resolveSpecifier(file, spec);
      if (resolved === undefined) continue;
      // Always wrap in double quotes: encodeURIComponent leaves single quotes
      // raw, so a nested data: URL would terminate a single-quoted specifier.
      code = code.replace(new RegExp(`(from\\s*|import\\s*\\(?\\s*)(['"])${spec.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\2`, 'g'), `$1"${resolved}"`);
    }
    resolving.delete(file);
    const uri = toDataUri(code);
    cache.set(file, uri);
    return uri;
  }

  return import(await build(path.resolve(projectRoot, relative)));
}

export async function loadTs(relative, imports = {}, globals = {}) {
  const source = await readFile(new URL(`../../${relative}`, import.meta.url), 'utf8');
  const exports = {};
  runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, {
    exports, console, Headers, URL, AbortController, setTimeout, clearTimeout, setInterval, clearInterval,
    require(name) { if (!(name in imports)) throw new Error(`Missing test import ${name} in ${relative}`); return imports[name]; },
    ...globals,
  });
  return exports;
}

// Small deterministic hook driver: exercises provider orchestration with real
// hook source, mocked platform boundaries, and manually advanced timers.
export function hookRuntime() {
  const slots = [];
  let index = 0, dirty = false, mounted = true;
  const effects = { layout: [], passive: [] };
  const timers = new Map();
  let timerId = 0;
  const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const memo = (create, deps) => {
    const i = index++;
    if (!slots[i] || !same(slots[i].deps, deps)) slots[i] = { value: create(), deps };
    return slots[i].value;
  };
  const effect = (kind) => (run, deps) => {
    const i = index++;
    if (!slots[i] || !same(slots[i].deps, deps)) effects[kind].push(() => {
      slots[i]?.cleanup?.();
      slots[i] = { deps, cleanup: run() };
    });
  };
  const react = {
    useState(initial) {
      const i = index++;
      if (!slots[i]) {
        slots[i] = { value: typeof initial === 'function' ? initial() : initial, set(next) {
          if (!mounted) return;
          const value = typeof next === 'function' ? next(slots[i].value) : next;
          if (!Object.is(value, slots[i].value)) { slots[i].value = value; dirty = true; }
        } };
      }
      return [slots[i].value, slots[i].set];
    },
    useRef(initial) { return memo(() => ({ current: initial }), []); },
    useMemo: memo,
    useCallback: (callback, deps) => memo(() => callback, deps),
    useEffect: effect('passive'), useLayoutEffect: effect('layout'),
  };
  let hook, props, value;
  const flush = () => {
    for (let pass = 0; pass < 30; pass++) {
      index = 0; dirty = false; value = hook(props);
      for (const kind of ['layout', 'passive']) while (effects[kind].length) effects[kind].shift()();
      if (!dirty) return value;
    }
    throw new Error('Hook did not settle');
  };
  return {
    react,
    globals: {
      setTimeout(fn, ms) { const id = ++timerId; timers.set(id, { fn, ms, interval: false }); return id; },
      setInterval(fn, ms) { const id = ++timerId; timers.set(id, { fn, ms, interval: true }); return id; },
      clearTimeout: (id) => timers.delete(id), clearInterval: (id) => timers.delete(id),
    },
    mount(fn, initial) { hook = fn; props = initial; return flush(); },
    update(patch) { props = { ...props, ...patch }; return flush(); },
    flush,
    // Async flows can chain several awaits (e.g. a failed production claim
    // followed by a staging re-init and re-claim). 60 microtask turns were not
    // enough for automatic Connect environment routing; keep headroom so the
    // hook reaches its settled state before assertions run.
    async settle() { for (let i = 0; i < 120; i++) { await Promise.resolve(); flush(); } return value; },
    get value() { return value; },
    fire(ms) { for (const [id, timer] of [...timers]) if (timer.ms === ms && timers.has(id)) { if (!timer.interval) timers.delete(id); timer.fn(); } return flush(); },
    countTimers(ms) { return [...timers.values()].filter((timer) => timer.ms === ms).length; },
    unmount() { mounted = false; slots.forEach((slot) => slot.cleanup?.()); },
  };
}

export function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
