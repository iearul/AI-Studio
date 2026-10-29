/**
 * One stylesheet for every EPUB. Body text keeps the reader's font, size and
 * alignment (Kindle Publishing Guidelines 11.3), sizes are relative, nothing is
 * positioned, and headings set their alignment explicitly because Kindle
 * justifies body text by default.
 */
export const bookCss = `@charset "UTF-8";

section {
  page-break-before: always;
  break-before: page;
}

h1,
h2 {
  text-align: center;
  font-weight: bold;
  text-indent: 0;
  page-break-after: avoid;
  break-after: avoid;
  page-break-inside: avoid;
  break-inside: avoid;
}

h1 {
  font-size: 1.5em;
  margin: 2em 0 1.5em 0;
}

p {
  margin: 0;
  text-indent: 1.5em;
}

p.first {
  text-indent: 0;
}

p.scene-break {
  text-indent: 0;
  text-align: center;
  margin: 1em 0;
}

em {
  font-style: italic;
}

strong {
  font-weight: bold;
}

.title-page {
  text-align: center;
  padding-top: 4em;
}

.title-page h1 {
  font-size: 2em;
  margin: 0 0 0.5em 0;
}

.title-page p {
  text-indent: 0;
  text-align: center;
  margin: 0 0 1em 0;
}

.title-page .book-subtitle {
  font-size: 1.2em;
  font-style: italic;
}

.title-page .book-author {
  font-size: 1.2em;
  margin-top: 3em;
}

.copyright p,
.content-notice p,
.call-to-action p {
  text-indent: 0;
  margin: 0 0 0.75em 0;
}

.dedication {
  text-align: center;
  padding-top: 3em;
}

.dedication p {
  text-indent: 0;
  text-align: center;
  margin: 0 0 1em 0;
}

ol.toc-list {
  list-style-type: none;
  margin: 0;
  padding: 0;
}

ol.toc-list li {
  margin: 0 0 0.6em 0;
}

.cover {
  text-align: center;
  margin: 0;
  padding: 0;
}

.cover img {
  max-width: 100%;
  max-height: 100%;
}
`;
