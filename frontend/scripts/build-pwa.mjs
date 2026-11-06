import { readdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
const root = path.resolve("dist");
async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((entry) =>
        entry.isDirectory()
          ? files(path.join(directory, entry.name))
          : [path.join(directory, entry.name)],
      ),
    )
  ).flat();
}
const assets = (await files(root))
  .filter(
    (file) =>
      !file.endsWith("sw.js") &&
      !["_headers", "_redirects"].includes(path.basename(file)),
  )
  .sort();
const digest = createHash("sha256");
for (const file of assets) {
  digest.update(path.relative(root, file));
  digest.update(await readFile(file));
}
const version = digest.digest("hex").slice(0, 20),
  urls = assets.map((file) =>
    path.relative(root, file).split(path.sep).join("/"),
  );
const source = `/* Generated app-shell cache. Uploaded audio and API results are NEVER cached. */
const VERSION=${JSON.stringify(version)};
const ASSETS=${JSON.stringify(urls)};
const PREFIX='openscore-shell-'+new URL(self.registration.scope).pathname;
const CACHE=PREFIX+'-'+VERSION;
self.addEventListener('install',event=>{event.waitUntil((async()=>{const cache=await caches.open(CACHE);try{await cache.addAll(ASSETS.map(asset=>new Request(new URL(asset,self.registration.scope),{cache:'reload'})));}catch(error){await caches.delete(CACHE);throw error;}})());});
self.addEventListener('activate',event=>{event.waitUntil((async()=>{const old=(await caches.keys()).filter(key=>key.startsWith(PREFIX+'-')&&key!==CACHE);for(const key of old.slice(0,-2))await caches.delete(key);await self.clients.claim();})());});
self.addEventListener('message',event=>{if(event.data==='SKIP_WAITING')self.skipWaiting();});
async function asset(request,url){const current=await caches.open(CACHE);const found=await current.match(url.pathname);if(found)return found;for(const key of (await caches.keys()).filter(key=>key.startsWith(PREFIX+'-')&&key!==CACHE).reverse()){const cached=await(await caches.open(key)).match(url.pathname);if(cached)return cached;}return fetch(request);}
self.addEventListener('fetch',event=>{const request=event.request,url=new URL(request.url),scope=new URL(self.registration.scope);if(request.method!=='GET'||url.origin!==scope.origin||url.pathname.startsWith('/api/')||url.pathname.includes('/api/'))return;const allowed=ASSETS.some(file=>new URL(file,self.registration.scope).pathname===url.pathname);if(allowed||url.pathname.startsWith(scope.pathname+'assets/')){event.respondWith(asset(request,url));return;}if(request.mode==='navigate'&&url.pathname.startsWith(scope.pathname))event.respondWith(caches.open(CACHE).then(async cache=>(await cache.match(new URL('index.html',self.registration.scope)))||fetch(request)));});
`;
await writeFile(path.join(root, "sw.js"), source);
console.log(`PWA shell: ${urls.length} local assets, revision ${version}`);
