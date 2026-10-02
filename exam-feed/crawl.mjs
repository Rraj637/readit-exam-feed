/**
 * Exam bulletin crawler — GitHub Actions runs this every 6 hours and commits
 * the merged feed JSON, which the Readit app can sync from.
 *
 * REALITY CHECK (read before adding portals):
 *  - www.upsc.gov.in/whats-new IS server-rendered — real parser below.
 *  - nta.ac.in homepage IS server-rendered (notice PDFs under
 *    /Download/Notice/, titles in <content> tags) — real parser below.
 *  - www.ibps.in/index.php/careers/ IS server-rendered (advertisement PDFs
 *    from wp-content/uploads) — real parser below.
 *  - ssc.gov.in is an Angular SPA whose public API is session-gated (the
 *    internal endpoint is ssc.gov.in/general-website/portal/notice-boards —
 *    returns index.html without a portal session). NOT implemented.
 *  - rrbapply.gov.in is a JS shell — NOT implemented.
 *
 * ALLOWED HOSTS: gov.in/nic.in suffixes plus the exact autonomous-body hosts
 * nta.ac.in and ibps.in — mirrored in the Cloudflare worker and the app's
 * isOfficialGovHost().
 *
 * Usage: node crawl.mjs   →  writes feeds/job_bulletins.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const FEED_DIR = path.resolve('feeds');
const FEED_FILE = path.join(FEED_DIR, 'job_bulletins.json');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36';
const EXACT_HOSTS = ['nta.ac.in', 'ibps.in', 'www.ibps.in'];

const stripTags = (s) => s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

/** Classify a notification by its title keywords — the app uses this to split
 *  the mixed feed into Jobs & Notices / Results & Keys / Admit Cards tabs. */
function classifyNotice(title) {
  const t = title.toLowerCase();
  if (/admit card|call letter|hall ticket|city intimation/.test(t)) return 'admit';
  if (/result|merit list|answer key|score|rank|recommend(ed|ation)|selected candidat|cut ?off|marks/.test(t)) return 'result';
  return 'notice';
}

function isAllowedHost(hostname) {
  const h = hostname.toLowerCase();
  return /\.(gov\.in|nic\.in)$/.test(h) || EXACT_HOSTS.includes(h);
}

/** UPSC whats-new parser: server-rendered list of notices with PDF links. */
async function crawlUpsc() {
  const res = await fetch('https://www.upsc.gov.in/whats-new', {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`upsc.gov.in responded ${res.status}`);
  const html = await res.text();
  const out = [];
  const re = /<a\s[^>]*href="([^"]+\.pdf[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const title = stripTags(m[2]);
    if (!title) continue;
    const pdfUrl = new URL(m[1], 'https://www.upsc.gov.in').toString();
    if (!isAllowedHost(new URL(pdfUrl).hostname)) continue;
    out.push({
      id: `upsc_${hash(pdfUrl)}`,
      title: title.slice(0, 180),
      organization: 'UPSC',
      noticeType: classifyNotice(title),
      pdfUrl,
      // UPSC's list does not expose application deadlines — the app marks
      // these entries "dates unverified" instead of inventing one.
      lastDate: null,
      crawledAt: new Date().toISOString(),
    });
  }
  return out;
}

/** NTA homepage: notice PDFs under /Download/Notice/ — the real title sits
 *  in a <content> tag that precedes the "Read More" anchor. */
async function crawlNta() {
  const res = await fetch('https://nta.ac.in', {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`nta.ac.in responded ${res.status}`);
  const html = await res.text();
  const out = [];
  // pair each notice title (<content>) with the notice PDF link that follows
  const re = /<content[^>]*>([\s\S]*?)<\/content>[\s\S]{0,800}?<a\s[^>]*href="(\/Download\/Notice\/[^"]+\.pdf)"/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const pdfUrl = new URL(m[2], 'https://nta.ac.in').toString();
    if (!isAllowedHost(new URL(pdfUrl).hostname)) continue;
    const title = stripTags(m[1]);
    if (!title || title.length < 8) continue;
    out.push({
      id: `nta_${hash(pdfUrl)}`,
      title: title.slice(0, 180),
      organization: 'NTA',
      noticeType: classifyNotice(title),
      pdfUrl,
      lastDate: null,
      crawledAt: new Date().toISOString(),
    });
  }
  return out;
}

/** IBPS careers page: official advertisement PDFs from wp-content/uploads.
 *  ibps.in's WAF rejects Node's TLS handshake (undici AND node:https both
 *  fail with SSL errors) but accepts curl — so this parser shells out to
 *  curl (available on Windows 10+ and ubuntu runners alike). */
function fetchWithCurl(url) {
  return execFileSync('curl', ['-s', '--max-time', '30', '-A', UA, url], {
    maxBuffer: 20 * 1024 * 1024,
  }).toString();
}

async function crawlIbps() {
  let html = null;
  let lastErr = null;
  for (let attempt = 0; attempt < 3 && !html; attempt++) {
    try {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 3000));
      html = fetchWithCurl('https://www.ibps.in/index.php/careers/');
      if (html.length < 5000) { html = null; throw new Error('too little data'); }
    } catch (e) {
      lastErr = e;
    }
  }
  if (!html) throw lastErr ?? new Error('ibps.in unreachable after retries');
  const out = [];
  const re = /<a\s[^>]*href="(https:\/\/www\.ibps\.in\/wp-content\/uploads\/[^"]+\.pdf)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const pdfUrl = m[1];
    const anchorText = stripTags(m[2]);
    const fileName = decodeURIComponent(pdfUrl.split('/').pop())
      .replace(/\.pdf$/i, '')
      .replace(/^\d+\s*\.?\s*-?\s*/i, '')
      .replace(/[-_]+/g, ' ')
      .trim();
    const title = (anchorText && anchorText.length > 12 ? anchorText : fileName || 'IBPS advertisement').slice(0, 180);
    out.push({
      id: `ibps_${hash(pdfUrl)}`,
      title,
      organization: 'IBPS',
      noticeType: classifyNotice(title),
      pdfUrl,
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

/**
 * Generic state-portal parser: state PSC/Board homepages that list official
 * PDF notices as anchors. Title priority: the anchor's title="…" attribute
 * (MPPSC/DSSSB carry full notice titles there) → anchor text → filename.
 * Verified crawlable (2026-10-02): BPSC, MPPSC, RPSC, DSSSB.
 * TODO (not crawlable honestly): UPPSC/MPSC (JS shells), WBPSC (unreachable).
 */
async function crawlStatePortal(org, stateName, url, opts = {}) {
  // gov portals drop connections intermittently — one retry on failure.
  // Some portals (BPSC) reject Node's TLS handshake entirely → viaCurl mode.
  let html = null;
  let lastErr = null;
  for (let attempt = 0; attempt < 2 && !html; attempt++) {
    try {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 3000));
      html = opts?.viaCurl
        ? fetchWithCurl(url)
        : await (async () => {
            const res = await fetch(url, {
              headers: { 'User-Agent': UA },
              signal: AbortSignal.timeout(30000),
            });
            if (!res.ok) throw new Error(`${url} responded ${res.status}`);
            return res.text();
          })();
      if (!html) throw new Error('empty response');
      break;
    } catch (e) {
      lastErr = e;
    }
  }
  if (!html) throw lastErr ?? new Error(`${url} unreachable after retries`);
  const out = [];
  const re = /<a\s[^>]*href="([^"]+\.pdf[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const pdfUrl = new URL(m[1], url).toString();
    if (!isAllowedHost(new URL(pdfUrl).hostname)) continue;
    // title="…" attribute carries the full notice title on several portals
    const titleAttrMatch = m[0].match(/title="([^"]{10,200})"/);
    const anchorText = stripTags(m[2]);
    const fileName = decodeURIComponent(pdfUrl.split('/').pop())
      .replace(/\.pdf$/i, '')
      .replace(/[-_]+/g, ' ')
      .trim();
    const title = (titleAttrMatch?.[1] || (anchorText && anchorText.length > 12 ? anchorText : fileName) || 'Notification')
      .slice(0, 180);
    out.push({
      id: `${org}_${hash(pdfUrl)}`,
      title: title.slice(0, 180), // no state prefix — the app card adds "🗺️ State:" itself
      organization: org,
      category: 'state',
      stateName,
      noticeType: classifyNotice(title),
      pdfUrl,
      lastDate: null,
      crawledAt: new Date().toISOString(),
    });
  }
  return out;
}

async function main() {
  const entries = [];
  const failures = [];
  const sources = [
    ['upsc', crawlUpsc],
    ['nta', crawlNta],
    ['ibps', crawlIbps],
    // state portals — verified crawlable (see crawlStatePortal notes)
    ['bpsc', () => crawlStatePortal('BPSC', 'Bihar', 'https://bpsc.bihar.gov.in', { viaCurl: true })],
    ['mppsc', () => crawlStatePortal('MPPSC', 'Madhya Pradesh', 'https://mppsc.mp.gov.in')],
    ['rpsc', () => crawlStatePortal('RPSC', 'Rajasthan', 'https://rpsc.rajasthan.gov.in')],
    ['dsssb', () => crawlStatePortal('DSSSB', 'Delhi', 'https://dsssb.delhi.gov.in')],
  ];
  for (const [name, fn] of sources) {
    try {
      const found = await fn();
      entries.push(...found);
      console.log(`${name}: ${found.length} entries`);
    } catch (e) {
      failures.push(`${name}: ${e.message}`);
      console.error(`${name} failed:`, e.message);
    }
  }
  // TODO: ssc.gov.in (SPA + session-gated API), rrbapply.gov.in (JS shell)

  fs.mkdirSync(FEED_DIR, { recursive: true });
  // merge (cap 300): ALL known entries (fresh ∪ previous) grouped by
  // organization, taken ROUND-ROBIN (fresh first within each org) so every
  // source stays represented and no source can flood the others out
  const prev = fs.existsSync(FEED_FILE) ? JSON.parse(fs.readFileSync(FEED_FILE, 'utf8')) : [];
  const all = new Map();
  for (const e of prev) all.set(e.id, { ...e, fresh: false });
  for (const e of entries) all.set(e.id, { ...e, fresh: true });
  const buckets = new Map();
  for (const e of all.values()) {
    const org = e.organization || 'OTHER';
    if (!buckets.has(org)) buckets.set(org, []);
    buckets.get(org).push(e);
  }
  for (const list of buckets.values()) list.sort((a, b) => Number(b.fresh) - Number(a.fresh));
  const merged = [];
  let progressed = true;
  while (merged.length < 300 && progressed) {
    progressed = false;
    for (const list of buckets.values()) {
      if (list.length) {
        merged.push(list.shift());
        progressed = true;
        if (merged.length >= 300) break;
      }
    }
  }
  const out = merged.map(({ fresh, ...e }) => e);
  fs.writeFileSync(FEED_FILE, JSON.stringify(out, null, 2));
  console.log(`feed written: ${out.length} entries (${failures.length} source failures)`);
  if (failures.length && out.length === 0) process.exitCode = 1;
}

main();
