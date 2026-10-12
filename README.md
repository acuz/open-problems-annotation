# Open problems in mathematics papers — expert classification

A static page for mathematicians to classify whether arXiv papers pose or explicitly flag open problems, and whether
they resolve (or make partial progress on) a conjecture or problem posed before.
Built by `analysis/scripts/4.1_build_annotation_site.py` (project "The Frontier Under Full Automation").

- 120 arXiv mathematics papers, each released under a Creative Commons licence that allows redistribution with
  attribution (CC BY, BY-SA, BY-NC, BY-NC-SA, CC0); authors, licence and arXiv link are shown with every paper.
- Text: title and abstract from arXiv metadata; introduction from the authors' LaTeX source, converted to HTML with
  pandoc (the authors' own macros expanded; figures, tables and code omitted; citations shown as [ref]); maths rendered
  with KaTeX.
- Published versions from Semantic Scholar where available.
- Answers are kept in the classifier's browser (localStorage) and sent as they change to a Google Apps Script web
  app (`apps_script.gs`) that appends them to a Google Sheet held by the research team. Failed sends are queued and
  retried. "Download a copy" exports CSV/JSON as a backup; "Import" restores it on another computer.

## Transparency: what makes the answers tamper-evident

The sheet belongs to the research team, so its owner could in principle edit it. The design makes any later change
detectable by others:

1. **Hash chain.** Every answer is a row of an append-only log ("log" sheet). Each row stores
   `row_hash = SHA-256(canonical)`, where `canonical` is the JSON list of the row's public fields including the previous
   row's hash. Editing, deleting or inserting a row breaks every later hash.
2. **Receipts held by the experts.** Every send returns the rows' numbers and hashes; the page keeps them ("My
   receipt": view, download) and, if the expert gave an e-mail address (institutional preferred), sends a receipt
   e-mail at the end or on request. Experts can check their rows against the published log.
3. **Independent time-stamps.** The expert's own browser time-stamps every receipt hash with three OpenTimestamps
   calendars (free, anchored in Bitcoin) as soon as the log returns it, without going through the research team's
   server; the proofs are kept in the receipt. A row removed or altered later — even with the whole chain recomputed —
   is then provably missing (it existed at the stamped time). In addition the server time-stamps the log head once a
   day, and anyone can read the current head: a plain GET of the web app URL returns `{"head": {"seq", "hash"}}`.
4. **Privacy.** Names and e-mails are kept in a separate private sheet ("identities") and enter the log only as a
   salted commitment; research area, career stage and the answers are in the log, which is meant to be published.
5. **Invitation codes (optional).** `python analysis/scripts/4.3_verify_expert_log.py --make-invites N` creates codes
   (private list with personal links) and their hashes (`invite_hashes.txt`, to publish before inviting); the log
   stores only the hash of the code an expert used.

Verification: `analysis/scripts/4.3_verify_expert_log.py` recomputes the chain, rebuilds the time-stamp proofs and
checks them against Bitcoin block headers, and checks receipts and invitation codes. When collection closes, deposit
the log (`data/cleaned/expert_log_public.csv`) with the proofs (`head_<seq>.txt`, `head_<seq>.txt.ots`) on Zenodo.

## Setting up the central sheet (once)

1. Create a Google Sheet (sheets.new) in the research team's account.
2. Extensions → Apps Script; replace the code with `apps_script.gs`; save.
3. Project Settings → Script properties → add `READ_TOKEN` = a long random string (used only to read the data back).
4. In the editor choose the function `setup` and press Run once; authorise (sending e-mail, external requests,
   triggers). This creates the sheets and the daily time-stamp trigger.
5. Deploy → New deployment (or Manage deployments → edit → Version: New version) → Web app; Execute as: Me;
   Who has access: Anyone → Deploy.
6. Copy the web app URL (ends in `/exec`) into `const ENDPOINT = "..."` in `index.html` and publish.
7. To pull the answers: set `EXPERT_ENDPOINT` and `EXPERT_READ_TOKEN`, run `analysis/scripts/4.2_fetch_expert_answers.py`,
   then `analysis/scripts/4.3_verify_expert_log.py`.
