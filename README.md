# D&D Handout — public site

The published copy of the D&D handout page, served by GitHub Pages at
https://danielharriesinfo.github.io/dnd-handout-site/ and embedded in the Wix
site with an HTML iFrame element.

Don't edit here: the source is `web/` in the private `dnd-handout` repo, and
`tools/publish_site.sh` there copies it in, commits and pushes.

- `index.html` — the page: loading screen, the Rive stage, the letter text box
- `dnd-quill.riv` — the signed Rive file (stored as a normal file: Pages can't serve Git LFS)
