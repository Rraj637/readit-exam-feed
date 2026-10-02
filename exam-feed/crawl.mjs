/**
 * Exam bulletin crawler — GitHub Actions runs this every 6 hours and commits
 * the merged feed JSON, which the Readit app can sync from.
 *
 * REALITY CHECK (read before adding portals):
 *  - ssc.gov.in is an Angular SPA: the homepage HTML contains NO content
 *    links — its notification API would need reverse-engineering and breaks
 *    on every redeploy. NOT implemented; do not pretend it works.
 *  - www.upsc.gov.in/whats-new IS server-rendered — real parser below.
 *  - ibps.in timed out from the build environment — NOT implemented yet.
 *
 * Usage: node crawl.mjs   →  writes feeds/job_bulletins.json
 */
import fs from 'node:fs';
import path from 'node:path';

const FEED_DIR = path.resolve('feeds');
const FEED_FILE = path.join(FEED_DIR, 'job_bulletins.json');
const GOV_HOST = /\.(gov\.in|nic\.in)$/;

/** UPSC whats-new parser: server-rendered list of notices with PDF links. */
async function crawlUpsc() {
  const res = await fetch('https://www.upsc.gov.in/whats-new', {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36' },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`upsc.gov.in responded ${res.status}`);
  const html = await res.text();
  const out = [];
  // anchors whose href points at a PDF on the official host
  const re = /<a\s[^>]*href="([^"]+\.pdf[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const href = m[1];
    const title = m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (!title) continue;
    const pdfUrl = new URL(href, 'https://www.upsc.gov.in').toString();
    if (!GOV_HOST.test(new URL(pdfUrl).hostname)) continue;
    out.push({
      id: `upsc_${hash(pdfUrl)}`,
      title: title.slice(0, 180),
      organization: 'UPSC',
      pdfUrl,
      // UPSC's list does not expose application deadlines — the app marks
      // these entries "dates unverified" instead of inventing one.
      lastDate: null,
      crawledAt: new Date().toISOString(),
    });
  }
  return out;
}

function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}

async function main() {
  const entries = [];
  const failures = [];
  try {
    entries.push(...(await crawlUpsc()));
    console.log(`upsc: ${entries.length} entries`);
  } catch (e) {
    failures.push(`upsc: ${e.message}`);
    console.error('upsc failed:', e.message);
  }
  // TODO: ssc.gov.in (SPA — needs internal API reverse-engineering)
  // TODO: ibps.in (timed out from build env; needs a custom parser)

  fs.mkdirSync(FEED_DIR, { recursive: true });
  // merge with a previously committed feed so entries survive transient
  // portal failures (capped at 200 newest)
  const prev = fs.existsSync(FEED_FILE) ? JSON.parse(fs.readFileSync(FEED_FILE, 'utf8')) : [];
  const byId = new Map(prev.map((e) => [e.id, e]));
  for (const e of entries) byId.set(e.id, e);
  const merged = [...byId.values()].slice(0, 200);
  fs.writeFileSync(FEED_FILE, JSON.stringify(merged, null, 2));
  console.log(`feed written: ${merged.length} entries (${failures.length} source failures)`);
  if (failures.length && merged.length === 0) process.exitCode = 1;
}

main();
