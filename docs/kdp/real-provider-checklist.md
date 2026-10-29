# Real-provider check for KDP Story Studio

Automated tests use scripted providers only, because live API keys are never used
in tests. Run this once yourself to confirm the configured Claude and OpenAI keys
work end to end. A flash-fiction book costs a few cents to well under a dollar
with the default routing; set the book budget to $2 to be safe.

1. `pnpm app:update` (rebuilds and restarts the background app), then open
   <http://localhost:3100/kdp/settings>.
2. Under **Providers**, choose **Check again**. Claude and OpenAI should show
   "ready". The background worker must show as running.
3. **Create new story**: theme of your choice, genre _Psychological thriller_,
   length _Flash fiction_ (1,000 words), 1 chapter, budget **$2**. Choose
   **Create and develop 3 concepts**.
4. Story Blueprint: choose a concept → **Build story bible** → **Generate plot
   and outline** → **Draft all chapters**. Watch the job panel; you can close the
   tab and come back.
5. Open the chapter in the **Chapter Editor**: check the prose, select a sentence
   and try **Rewrite**; accept or reject.
6. **Editorial Review** → run the passes; **Cover Studio** → generate concepts,
   paste or upload artwork, compose and save a final cover; **KDP Metadata** →
   generate the listing.
7. **Export & Publish** → **Build export**. Download the ZIP and open the EPUB in
   Kindle Previewer before any real upload.
8. Check **AI spend** in the book header against the provider dashboards. If the
   OpenAI prices in Settings are marked unverified, enter the current prices
   from <https://openai.com/api/pricing>.

Report anything that fails with the job's error message (shown in the job panel)
and the time it happened; the server log is `~/Library/Logs/AI-Studio/app.log`.
