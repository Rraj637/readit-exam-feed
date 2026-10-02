# Readit — Exam Bulletin Feed

GitHub Actions har 6 ghante me official government portals se exam
notifications crawl karke `exam-feed/feeds/job_bulletins.json` update karta
hai. Readit app isi JSON ko sync karta hai.

## Setup (one-time)

1. Is folder ko GitHub par push karo:
   ```
   git init        # (already done)
   gh auth login   # ya github.com par repo create karke remote add karo
   git remote add origin https://github.com/YOUR_USERNAME/readit-exam-feed.git
   git push -u origin main
   ```
2. Push hote hi `.github/workflows/auto-crawler.yml` active ho jayega
   (har 6 ghante + manual "Run workflow" button repo ki Actions tab me).
3. Feed URL (app ke 🤖 Crawler Feed Sync box me paste karo):
   `https://raw.githubusercontent.com/YOUR_USERNAME/readit-exam-feed/main/exam-feed/feeds/job_bulletins.json`

## Scope note

- UPSC whats-new parser: REAL (server-rendered page).
- ssc.gov.in: Angular SPA — parser TODO. ibps.in: TODO. Crawl.mjs ke
  comments padho naye portal add karne se pehle.
