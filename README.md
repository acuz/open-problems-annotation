# Open problems in mathematics papers — expert classification

A static page for mathematicians to classify whether arXiv papers pose or explicitly flag open problems.
Built by `analysis/scripts/4.1_build_annotation_site.py` (project "The Frontier Under Full Automation").

- 120 arXiv mathematics papers, each released under a Creative Commons licence that allows redistribution with
  attribution (CC BY, BY-SA, BY-NC, BY-NC-SA, CC0); authors, licence and arXiv link are shown with every paper.
- Text: title and abstract from arXiv metadata; introduction extracted from the authors' LaTeX source.
- Published versions from Semantic Scholar where available.
- Answers are kept in the classifier's browser (localStorage) and, when `ENDPOINT` in `index.html` is set, sent as
  they change to a Google Apps Script web app (`apps_script.gs`) that appends them to a Google Sheet held by the
  research team (append-only log; the latest row per annotator and paper is the current answer). Failed sends are
  queued and retried. "Download a copy" exports CSV/JSON as a backup; "Import" restores it on another computer.

## Setting up the central sheet (once)

1. Create a Google Sheet (sheets.new) in the research team's account.
2. Extensions → Apps Script; replace the code with `apps_script.gs`; save.
3. Project Settings → Script properties → add `READ_TOKEN` = a long random string (used only to read the data back).
4. Deploy → New deployment → Web app; Execute as: Me; Who has access: Anyone → Deploy; authorise.
5. Copy the web app URL (ends in `/exec`) into `const ENDPOINT = "..."` in `index.html` and publish.
6. To pull the answers into the project: set `EXPERT_ENDPOINT` and `EXPERT_READ_TOKEN` in the environment and run
   `python analysis/scripts/4.2_fetch_expert_answers.py`.
