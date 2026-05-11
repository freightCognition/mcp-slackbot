// CJS-mock helper for vitest.
//
// vitest's `vi.mock` is implemented via Vite's ESM transform — it does NOT
// intercept `require(...)` calls inside CommonJS modules that vitest loads
// through Node's native CJS loader. app.js, logger.js, and sentry-init.js
// are all CJS, and they pull in axios / @sentry/node / @slack/bolt / ./db
// via require(). To mock those, we pre-populate Node's require.cache with
// stub module records BEFORE the SUT is required. Once cached, Node's
// resolver returns the stub from cache instead of loading the real module.
//
// Use createRequire(import.meta.url) so the path resolution matches what
// app.js sees at require-time (node_modules layout, dedupe, etc.).
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve as resolvePath } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const projectRequire = createRequire(resolvePath(here, "../../package.json"));

function installCachedModule(specifier, exports) {
  const filename = projectRequire.resolve(specifier);
  projectRequire.cache[filename] = {
    id: filename,
    filename,
    loaded: true,
    exports,
    children: [],
    parent: null,
    paths: [],
  };
  return filename;
}

export function installMockAxios(impl) {
  const notConfigured = (name) => () =>
    Promise.reject(new Error(`installMockAxios: impl.${name} not configured`));
  const mockAxios = (config) => (impl.request ?? notConfigured("request"))(config);
  mockAxios.post = (url, data, config) => (impl.post ?? notConfigured("post"))(url, data, config);
  mockAxios.get = (url, config) => impl.get?.(url, config);
  mockAxios.isAxiosError = () => false;
  mockAxios.create = () => mockAxios;
  return installCachedModule("axios", mockAxios);
}

export function installMockSlackBolt() {
  class MockApp {
    constructor() {}
    command() {}
    action() {}
    view() {}
    error() {}
    async start() {
      return {};
    }
  }
  return installCachedModule("@slack/bolt", { App: MockApp });
}

export function installMockSentryNode(impl) {
  return installCachedModule("@sentry/node", {
    init: impl.init ?? (() => {}),
    addBreadcrumb: impl.addBreadcrumb ?? (() => {}),
    captureException: impl.captureException ?? (() => {}),
    close: impl.close ?? (() => Promise.resolve(true)),
  });
}

export function installMockLogger(impl) {
  return installCachedModule("./logger", {
    warn: impl.warn ?? (() => {}),
    error: impl.error ?? (() => {}),
    info: impl.info ?? (() => {}),
    debug: impl.debug ?? (() => {}),
  });
}

export function installMockDb(impl) {
  return installCachedModule("./db", {
    db: impl.db ?? {},
    initDb: impl.initDb ?? (async () => {}),
    getTokens: impl.getTokens ?? (async () => null),
    saveTokens: impl.saveTokens ?? (async () => {}),
    logAuditEntry: impl.logAuditEntry ?? (async () => {}),
  });
}

export function projectResolve(specifier) {
  return projectRequire.resolve(specifier);
}

export function clearCached(filename) {
  delete projectRequire.cache[filename];
}
