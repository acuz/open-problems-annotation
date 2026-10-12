# Open problems in mathematics papers — expert classification

A static page for mathematicians to classify whether arXiv papers pose or explicitly flag open problems.
Built by `analysis/scripts/4.1_build_annotation_site.py` (project "The Frontier Under Full Automation").

- 120 arXiv mathematics papers, each released under a Creative Commons licence that allows redistribution with
  attribution (CC BY, BY-SA, BY-NC, BY-NC-SA, CC0); authors, licence and arXiv link are shown with every paper.
- Text: title and abstract from arXiv metadata; introduction extracted from the authors' LaTeX source.
- Published versions from Semantic Scholar where available.
- Answers stay in the classifier's browser (localStorage) until they download them as CSV/JSON; nothing is sent
  anywhere by the page.
