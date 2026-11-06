import { it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import vm from "node:vm";
it("builds an atomic scoped shell cache, serves offline navigation, and never caches API/audio", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "openscore-pwa-"));
  try {
    await mkdir(path.join(root, "dist/assets"), { recursive: true });
    await writeFile(
      path.join(root, "dist/index.html"),
      "<html>offline shell</html>",
    );
    await writeFile(
      path.join(root, "dist/_headers"),
      "/sw.js\n Cache-Control: no-cache",
    );
    await writeFile(
      path.join(root, "dist/assets/app-hash.js"),
      'console.log("app")',
    );
    execFileSync(process.execPath, [path.resolve("scripts/build-pwa.mjs")], {
      cwd: root,
    });
    const source = await readFile(path.join(root, "dist/sw.js"), "utf8");
    const handlers: Record<string, (event: any) => void> = {};
    let precached: string[] = [],
      deleted: string[] = [];
    let fetches = 0;
    const cache = {
      addAll: async (requests: Request[]) => {
        precached = requests.map((r) => r.url);
      },
      match: async () => new Response("offline shell"),
    };
    const self = {
      registration: { scope: "https://example.test/music/" },
      clients: { claim: async () => {} },
      addEventListener: (event: string, handler: (event: any) => void) => {
        handlers[event] = handler;
      },
      skipWaiting: () => {},
    };
    vm.runInNewContext(source, {
      self,
      URL,
      Request,
      caches: {
        open: async () => cache,
        keys: async () => [
          "other-app-cache",
          "openscore-shell-/music/-oldest",
          "openscore-shell-/music/-older",
          "openscore-shell-/music/-old",
        ],
        delete: async (key: string) => {
          deleted.push(key);
        },
      },
      fetch: async () => {
        fetches++;
        throw new Error("offline");
      },
    });
    let install: Promise<void> | undefined;
    handlers.install({
      waitUntil: (p: Promise<void>) => {
        install = p;
      },
    });
    await install;
    expect(precached).toEqual([
      "https://example.test/music/assets/app-hash.js",
      "https://example.test/music/index.html",
    ]);
    let activation: Promise<void> | undefined;
    handlers.activate({
      waitUntil: (p: Promise<void>) => {
        activation = p;
      },
    });
    await activation;
    expect(deleted).toEqual(["openscore-shell-/music/-oldest"]);
    let handled = false;
    for (const url of [
      "https://example.test/api/jobs/token/audio",
      "https://api.example.test/audio",
      "https://example.test/music/api/jobs",
    ])
      handlers.fetch({
        request: { url, method: "GET", mode: "cors" },
        respondWith: () => {
          handled = true;
        },
      });
    expect(handled).toBe(false);
    let response: Promise<Response> | undefined;
    handlers.fetch({
      request: {
        url: "https://example.test/music/",
        method: "GET",
        mode: "navigate",
      },
      respondWith: (p: Promise<Response>) => {
        response = p;
      },
    });
    expect(await (await response!).text()).toBe("offline shell");
    expect(fetches).toBe(0); // Never mix a newly deployed HTML shell with the active worker's old assets.
  } finally {
    if (!root.startsWith(path.join(tmpdir(), "openscore-pwa-")))
      throw new Error("Unexpected test directory");
    await rm(root, { recursive: true, force: true });
  }
});
