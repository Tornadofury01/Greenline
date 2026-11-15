// Turns the Vite build (dist/) into Vercel's prebuilt format (.vercel/output/).
// Why: `vercel build` needs symlink rights on Windows, and Vercel can't build the app remotely
// because it imports ../content, ../shared and ../scoring. So we build locally and upload only static files.
import { cpSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';

const out = '.vercel/output';
if (!existsSync('dist/index.html')) throw new Error('dist/ is missing. Run npm run build first.');

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync('dist', `${out}/static`, { recursive: true });

writeFileSync(`${out}/config.json`, JSON.stringify({
  version: 3,
  routes: [
    // The service worker and its manifest must never be cached, so updates reach phones.
    { src: '/(sw\\.js|registerSW\\.js|manifest\\.webmanifest)', headers: { 'cache-control': 'public, max-age=0, must-revalidate' }, continue: true },
    // Hashed build files never change.
    { src: '/assets/(.*)', headers: { 'cache-control': 'public, max-age=31536000, immutable' }, continue: true },
    // v2 field files keep their name across re-runs: short cache, the service worker refreshes them.
    { src: '/v2f/(.*)', headers: { 'cache-control': 'public, max-age=300, must-revalidate' }, continue: true },
    { handle: 'filesystem' },
    // A field with no file is a real 404 (the app shows "No data here yet"), not index.html.
    { src: '/v2f/(.*)', status: 404 },
    // A build file that doesn't exist (an old tab asking for a file a newer deploy replaced) is a real 404, not
    // index.html: then the app knows the load failed and can reload instead of trying to run HTML as code.
    { src: '/assets/(.*)', status: 404 },
    // Single-page app: anything else gets index.html.
    { src: '/(.*)', dest: '/index.html' },
  ],
}, null, 2));

console.log(`Wrote ${out}/ from dist/`);
