# Amazon KDP eBook Rules Reference

- **Version:** `2026-10-29.1`
- **Verified:** 2026-10-29
- **Scope:** Kindle eBooks (reflowable fiction first). Paperback notes are in section 14 only.

> **Re-verify before relying on this.** KDP changes its rules, price bands and UI without notice, and several
> values below changed during 2025–2026. Re-fetch every source URL listed in a section before changing code that
> depends on it, then bump the version (`YYYY-MM-DD.N`) and add a changelog entry at the end of this file.

## How to read this document

| Marker         | Meaning                                                                                                                                              |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| (no marker)    | Value read on an official Amazon source (kdp.amazon.com help page or the Kindle Publishing Guidelines PDF) on 2026-10-29.                            |
| **UNVERIFIED** | Not found on any official page fetched on 2026-10-29. The value comes from a secondary source or is unknown. Do not hard-code it as a blocking rule. |
| **CONFLICT**   | Two official Amazon pages disagree. The section says which value to use in code and why.                                                             |

Sources are paraphrased. Quotes are kept short (one per section at most). The KDP UI behind login was **not**
inspected, so exact field labels and field order in the title-setup UI are only what the public help pages state.

Abbreviations: KPG = _Amazon Kindle Publishing Guidelines_ PDF, **version 2026.3** (fetched from
`https://kindlegen.s3.amazonaws.com/AmazonKindlePublishingGuidelines.pdf`). KDP = Kindle Direct Publishing.

### Notable changes 2025–2026 (things older guides get wrong)

| Change                                                                                                                                                                                     | Effective                              | Section |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------- | ------- |
| 70% royalty max list price on Amazon.com raised from $9.99 to **$12.99** (UK £12.99, EUR €12.99 also shown)                                                                                | 2026-07-07                             | 8       |
| eBook pre-orders can be set up **18 months** ahead (was 12); second missed deadline now costs **6 months** of pre-order privileges (was 1 year); up to **2 postponements** within 6 months | pre-orders created on/after 2026-09-02 | 12      |
| Kindle Unlimited renamed **Kindle+**; KDP help pages now say "Kindle+" everywhere                                                                                                          | 2026-10-22 (press)                     | 9       |
| MOBI no longer accepted for fixed-layout eBooks (reflowable MOBI already ended 2021-08-01)                                                                                                 | 2025-03-18                             | 1       |
| KPG 2026.3: Kindle Previewer 4 (KPR4) is the validation tool                                                                                                                               | 2026                                   | 2       |
| New-title limit: up to **2 new titles per format per week** (creation and submission), reset Sunday 00:00 UTC                                                                              | current                                | 5       |
| EPUBCheck **v5.4.0** (EPUB 3.4 support)                                                                                                                                                    | 2026-09-15                             | 2       |

---

## 1. Supported eBook manuscript formats

**Recommended formats**

| Format                      | Status      | Notes                                                                                                 |
| --------------------------- | ----------- | ----------------------------------------------------------------------------------------------------- |
| DOC / DOCX                  | Recommended | Most files convert well. Complex formatting may not, so check with Kindle Previewer.                  |
| KPF (Kindle Package Format) | Recommended | Produced only by Kindle Create (see section 3).                                                       |
| EPUB                        | Recommended | Must meet the Kindle Publishing Guidelines. KDP says to validate with Kindle Previewer before upload. |

The "Paths to Getting Your Content on Kindle" page names **EPUB, DOCX and KPF** as the formats to use for
reflowable content and says MOBI is not recommended.

**Other accepted formats**

| Format                         | Status                                                                                                                                                                                                                                                                                              |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HTML (`.zip`, `.htm`, `.html`) | Accepted                                                                                                                                                                                                                                                                                            |
| RTF                            | Accepted                                                                                                                                                                                                                                                                                            |
| TXT                            | Accepted                                                                                                                                                                                                                                                                                            |
| PDF                            | Accepted for eBooks only in English, French, German, Italian, Portuguese, Spanish, Catalan, Galician and Basque. It often converts poorly. Image-heavy PDFs become Print Replica eBooks, which can't be resized and don't work with screen readers. Not suitable for a reflowable fiction pipeline. |
| MOBI                           | **Not accepted.** Reflowable MOBI support ended **2021-08-01** and fixed-layout MOBI support ended **2025-03-18**.                                                                                                                                                                                  |

**Size and structure limits**

- **Max manuscript file size: 650 MB.** "Save Your Manuscript File" gives 650 MB as the conversion limit, and KPG 11.4.2 gives 650 MB as the maximum EPUB size.
- KPG section 9: each HTML/XHTML file inside the eBook must be **< 30 MB**, and the eBook must contain **fewer than 300 HTML files**.
- After upload, conversion takes about **5–7 minutes** ("Upload and Preview Book Content").
- **UNVERIFIED:** a maximum page count for eBooks. An older KDP snippet mentions 8,000 pages, but no current official page states it.
- The same "Save Your Manuscript File" page says Japanese, Hebrew, Latin and Yiddish manuscripts can only be uploaded as PDF. That page mostly covers print, so it is unclear whether this applies to eBooks.

**For code:** the module should output **EPUB** (primary) and/or **DOCX** (for the Kindle Create route), reject MOBI, and
not offer PDF for reflowable fiction. Enforce a hard limit of 650 MB, but warn far earlier, because delivery costs are
charged per MB (section 8).

Quote ("What file formats are supported…"): "Effective March 2025, we will no longer accept MOBI files for fixed-layout eBooks."

**Sources** (all fetched 2026-10-29)

- https://kdp.amazon.com/en_US/help/topic/G200634390 — What file formats are supported for eBook manuscripts?
- https://kdp.amazon.com/en_US/help/topic/GULSQMHU5MNH4EZM — MOBI Support for eBooks FAQ
- https://kdp.amazon.com/en_US/help/topic/G79CTKR8BX79E96L — Paths to Getting Your Content on Kindle
- https://kdp.amazon.com/en_US/help/topic/G202145060 — Save Your Manuscript File
- https://kdp.amazon.com/en_US/help/topic/G200641240 — Upload and Preview Book Content
- https://kindlegen.s3.amazonaws.com/AmazonKindlePublishingGuidelines.pdf — KPG v2026.3, sections 9 and 11.4.2

---

## 2. EPUB specifics (as documented by KDP / KPG) and EPUBCheck

### 2.1 EPUB version and layout

- **EPUB version: no required version is stated** on any KDP help page fetched. KPG 2026.3 documents both EPUB 3 constructs (`nav epub:type="toc"`, `landmarks`, `properties="cover-image"`) and EPUB 2 constructs (NCX, `<guide>`), so both are accepted in practice. A specific required version is **UNVERIFIED**.
  - **For code:** produce **EPUB 3** with a `nav` TOC **and** an NCX fallback (KPG and the quality guide both still talk about NCX).
- eBooks are **reflowable by default**. A reflowable EPUB doesn't need a `book-type` meta, but the OPF **must** contain `<dc:title>` and `<dc:language>` (KPG 11.1).
- Use a single-column layout and don't use CSS `position` for alignment (KPG 11.2). Using fixed layout just to copy the print layout is not allowed (KPG 6.8).

### 2.2 Navigation / TOC (see also section 11)

- **A logical TOC is required in every Kindle book.** It can be a `nav epub:type="toc"` (EPUB 3) or an NCX (EPUB 2) (KPG 5). The _Guide to Kindle Content Quality_ also lists a logical TOC (NCX) as required.
- An **HTML TOC** (an in-book page of links) is strongly recommended for all books that benefit from one. It is optional for most fixed-layout children's and comic books. Rules for it:
  - Place it near the **beginning** of the book, not the end.
  - Every entry must be a **hyperlink**.
  - Don't build it with `<table>`.
  - Don't include **page numbers**.
  - Keep entries in reading order.
- The KPG says the logical TOC matters especially for books longer than 20 pages. This is emphasis, **not** a page threshold: the logical TOC is required regardless of length.
- NCX checks: every link resolves, no chapters missing, no duplicates, entries in reading order.
- `nav` TOC: KPG says it should be a separate XHTML document from the HTML TOC, and is declared with `properties="nav"` in the manifest.
- Guide items or landmarks (`cover`, `toc`) are optional but highly recommended. Amazon sets the start-reading location itself.

### 2.3 Fonts and text styling

- Embedded **OpenType (OTF)** and **TrueType (TTF)** fonts are supported.
- Type 1 (PostScript) fonts are not recommended. Reflowable books that use them are rendered with Kindle fonts instead.
- Readers can switch publisher fonts on or off. The publisher must hold licences for any embedded font. Amazon recommends using the default Kindle fonts unless a font is needed to convey intent.
- **Body text must use defaults:** no forced font face, size, color or background on body text. Creative styles are fine for headings, special paragraphs and similar elements. Set the main font at `<body>` level and apply bold/italic as text styles (KPG 11.3.2, 11.3.8, 11.3.9).
- Body text is justified by default, so set explicit alignment on headings (KPG 11.3.1).
- Avoid thin fonts, for accessibility.

### 2.4 Things KDP strips, ignores or rejects (KPG 2026.3)

- **Scripts are stripped** during conversion. Forms, frames and JavaScript are not supported (KPG 6.1, 6.3).
- Negative `line-height` is not supported. Avoid negative margins and positioning unless you add compensating padding (KPG 6.2).
- Nested `<p>` tags make conversion fail (KPG 6.4).
- File references are case-sensitive and must use `/` as the path separator (KPG 6.5).
- The only supported space characters are the normal space, `&nbsp;` and `&zwnj;`. Don't use Unicode format characters. Use UTF-8 and declare the encoding (KPG 6.6, 6.7).
- **Images:**
  - TIFF, multi-frame GIF and images with transparency are **not supported** in content. Use JPEG (photos) or PNG (line art). SVG images are not supported; SVG rasterization is only partly supported (KPG 11.4.1).
  - Use RGB. The KPG states that sRGB and CMYK are not supported.
  - Alt text should be **< 140 characters**. Use `alt=""` for decorative images.
  - Images need 300 ppi at the intended display size, so a full-page image is at least **1200 × 1800 px**. Photos smaller than 300 × 400 px may look blurry (KPG 11.4.2, 11.4.5).
- Tags ignored under Enhanced Typesetting include `small`, `big`, `ins`, `kbd`, `map`, `area` and `time`. Ignored attributes include `widows`, `orphans`, the `column-*` properties, `animation-*` / `transition-*`, `on*` event handlers, `user-select` and `word-wrap`. The full list is in KPG 18.3; a non-exhaustive list is enough for linting.
- **Links:**
  - Footnotes must use bi-directional links.
  - External links to other eBook stores, to web forms that collect personal data, or to illegal or malicious content are prohibited.
  - Amazon may remove links (KPG 7).

### 2.5 Validation

- **KDP's documented validator is Kindle Previewer** (now **Kindle Previewer 4 / KPR4**). Previewer compiles the EPUB and checks it for common errors. Per KDP, any error or warning it reports will keep the title from becoming available. It runs on Windows and macOS. The "Paths" page lists Apple-silicon Macs on macOS 12 or later.
- **EPUBCheck is not mentioned on any KDP page fetched.** "KDP recommends EPUBCheck" is therefore **UNVERIFIED**. EPUBCheck is still the W3C conformance checker and a sensible automated pre-check before Kindle Previewer.
- Accessibility (KDP page "Accessibility for eBooks"):
  - Alt text of 140 characters at most.
  - Logical heading hierarchy.
  - Contrast of at least **4.5:1** for normal text and **3:1** for large text.
  - Book language, file metadata and the language chosen at setup must match.
  - None of these is described as a publishing gate. The setup flow has an accessibility question that defaults to "I don't know" and can be published as is.
  - The DAISY **Ace** checker was mentioned in a search snippet but not on the page fetched: **UNVERIFIED**.

### 2.6 EPUBCheck (latest release)

- **Latest release: EPUBCheck v5.4.0**, published **2026-09-15**. It validates EPUB 2 and EPUB 3, checking EPUB 3 against **EPUB 3.4**.
- **Java requirement: Java 8 or newer.** The v5.0.0 release notes say the required runtime is now Java 8 or greater, and `pom.xml` at tag v5.4.0 sets `java.version` to `1.8`. v5.2.0 added fixes for Java 21. The README's "JDK 1.7" line only applies to building from source and is outdated.
- Also available on Maven Central as `org.w3c:epubcheck`.
- **For code:** EPUB 3.4 rules make v5.4.0 report the OPF 2 NCX, the `<guide>` element, OPF 2 `<meta>` and font obfuscation as **"outdated" USAGE messages**. These are not errors. KDP still documents NCX and guide, so keep them and **do not fail the build on USAGE-level messages**. Fail only on FATAL/ERROR, and possibly WARNING.

Quote (KPG 5): "Amazon requires that all Kindle books include a logical TOC."

**Sources** (all fetched 2026-10-29)

- https://kindlegen.s3.amazonaws.com/AmazonKindlePublishingGuidelines.pdf — KPG v2026.3, sections 2.2.1, 5, 6, 7, 9, 11, 18.3
- https://kdp.amazon.com/en_US/help/topic/G79CTKR8BX79E96L — Paths to Getting Your Content on Kindle
- https://kdp.amazon.com/en_US/help/topic/G200952510 — Guide to Kindle Content Quality
- https://kdp.amazon.com/en_US/help/topic/GBPE3QVZ2J3HLQ4B — Accessibility for eBooks
- https://github.com/w3c/epubcheck/releases/tag/v5.4.0 — read via `gh api repos/w3c/epubcheck/releases/latest`
- https://github.com/w3c/epubcheck/releases/tag/v5.0.0 — release notes (Java 8 requirement)
- https://github.com/w3c/epubcheck/blob/v5.4.0/pom.xml and https://github.com/w3c/epubcheck/blob/main/README.md

---

## 3. Kindle Create / KPF workflow

- Kindle Create is Amazon's **free** desktop formatting tool.
- **System requirements** (Getting Started page):

  | Item              | Requirement                        |
  | ----------------- | ---------------------------------- |
  | Windows           | Windows 10 or later                |
  | Intel Mac         | macOS 10.15 or later               |
  | Apple-silicon Mac | macOS 11 or later                  |
  | RAM               | 4 GB minimum, 8 GB recommended     |
  | Processor         | 1.2 GHz minimum, 2 GHz recommended |
  - **CONFLICT:** KPG 2.1.1 and the "Paths" page still say Windows 7+ / Mac OS 10.9+. Use the Getting Started values, which are newer.
  - **Linux is not supported.**

- **Input:** DOC or DOCX for reflowable eBooks and for print. PDF for print-replica and comic eBooks; comics can also use JPEG files.
- **Output:**
  - **KPF**: Amazon's preferred format for Kindle eBooks, uploaded to KDP as the manuscript.
  - **EPUB**: reflowable only, according to the Getting Started page.
  - **KCB**: the project/work file. Amazon keeps no copy, so back it up. You need the KCB to update the book later.
- **eBook languages:** Dutch, English, French, German, Gujarati, Hindi, Italian, Malayalam, Marathi, Portuguese, Spanish and Tamil. Japanese is not supported for reflowable or print-replica eBooks; manga is supported.
- **Known DOCX import problems:**
  - File name longer than 250 characters.
  - Special characters (quotes, brackets, `%`) in the file name.
  - Password-protected, empty or corrupt files.
  - Word styles other than "Normal" can fail to import.
  - Tables, lists and footnotes cannot be edited inside Kindle Create.
- **Typical flow for this module:**
  1. Generate a clean DOCX: Heading 1 for chapter titles, the Normal style for body text, real page breaks, no cover image.
  2. The user opens Kindle Create, imports the DOCX, confirms the detected chapter titles ("Accept Selected"), and adds front and back matter.
  3. The user exports a KPF and uploads it to KDP.

  No official KPF specification is published. KDP pages only describe KPF as created by Kindle Create, so third-party KPF generation is not a supported path (**UNVERIFIED** whether any other route exists).

- Kindle Create can also take the DOCX route for paperbacks: KDP accepts print books from it as reflowable books in any trim size.

Quote (Paths page): "Use EPUB, DOCX, or KPF files for publishing reflowable content."

**Sources** (all fetched 2026-10-29)

- https://kdp.amazon.com/en_US/help/topic/GUGQ4WDZ92F733GC — Getting Started with Kindle Create
- https://kdp.amazon.com/en_US/help/topic/G79CTKR8BX79E96L — Paths to Getting Your Content on Kindle
- https://kdp.amazon.com/en_US/help/topic/G201605700 — Create a Table of Contents
- https://kindlegen.s3.amazonaws.com/AmazonKindlePublishingGuidelines.pdf — KPG v2026.3 section 2.1.1

---

## 4. eBook cover requirements

**Primary source for KDP eBooks:** the KDP help page "What criteria does my eBook's cover image need to meet?"

| Property                  | Value                                                                                                                                                                              |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Format                    | **JPEG** (`.jpg`/`.jpeg`) or **TIFF** (`.tif`/`.tiff`). JPEG is preferred per KPG.                                                                                                 |
| Ideal size                | **2560 px high × 1600 px wide**. Both pages also say the height should be 2500 px for best quality on HD devices; the wording is odd, but it is what both say. Target 1600 × 2560. |
| Aspect ratio              | height : width of at least **1.6 : 1**                                                                                                                                             |
| Minimum size              | **1000 px high × 625 px wide**                                                                                                                                                     |
| Maximum size              | **10,000 px** on each side                                                                                                                                                         |
| Max file size             | **< 50 MB**                                                                                                                                                                        |
| Color                     | **RGB**, saved without color separation                                                                                                                                            |
| Resolution                | The page lists "72 dpi" and also recommends at least 300 PPI. DPI metadata doesn't matter for a pixel image: **validate pixel dimensions, not DPI.**                               |
| Compression               | Avoid heavy compression, which reduces quality on devices                                                                                                                          |
| Border                    | Covers with a white or very light background should get a narrow **3–4 px medium-gray border**                                                                                     |
| Uploads below 2560 × 1600 | A warning is shown. Don't upscale: create a larger image instead.                                                                                                                  |

**Conflicts with the KPG (written for publishers in general, not only KDP):**

| Rule          | KDP help page (G200645690) | KPG / its KDP-hosted HTML copy (G6GTK3T3NUHKLEFX)                                 | Use in code                       |
| ------------- | -------------------------- | --------------------------------------------------------------------------------- | --------------------------------- |
| Minimum size  | 1000 × 625 px              | Covers with less than 500 px on one side are not shown on the website             | Use 1000 × 625                    |
| Max file size | < 50 MB                    | KPG PDF 4.1: 5 MB or less. HTML copy: 50 MB                                       | Hard limit 50 MB; warn above 5 MB |
| Formats       | JPEG and TIFF only         | HTML copy also allows PNG and non-animated GIF; SVG not supported                 | Accept JPEG and TIFF only         |
| Color         | RGB                        | KPG PDF: Kindle does not support CMYK. HTML copy: CMYK is converted automatically | Require RGB                       |

**Content rules:**

- The cover must show the **title and author**, and that text must match the metadata.
- No price or promotional text (e.g., "free").
- No spine, barcode or back cover.
- No typos, watermarks or placeholder text.
- The cover language must match the book's language.
- It must not closely imitate another book's cover.
- You must hold the rights to all cover content.

**Cover inside the manuscript:** **do not include the cover in the manuscript.**

- The eBook Manuscript Formatting Guide says not to put the cover image in the manuscript file. KDP adds the cover uploaded during setup.
- KPG 4.2 ("internal content cover image is mandatory") is marked in KPG v2026.3 as **not applying to KDP eBooks**.
- The KDP-hosted HTML copy of the cover guideline (G6GTK3T3NUHKLEFX) still shows the internal-cover rule without that note: **CONFLICT**. Follow the KDP manuscript guide plus the KPG note.
- **For code:** never insert a cover page or cover image into the DOCX/EPUB body, and never add an extra HTML cover page. Upload the cover file separately.

Quote (eBook Manuscript Formatting Guide): "Don't include your cover image in your manuscript file."

**Sources** (all fetched 2026-10-29)

- https://kdp.amazon.com/en_US/help/topic/G200645690 — What criteria does my eBook's cover image need to meet?
- https://kdp.amazon.com/en_US/help/topic/G6GTK3T3NUHKLEFX — Cover Image Guidelines for Kindle eBooks (KPG HTML)
- https://kdp.amazon.com/en_US/help/topic/G200645680 — eBook Manuscript Formatting Guide
- https://kdp.amazon.com/en_US/help/topic/G201097560 — Metadata Guidelines for Books (cover must match metadata, no look-alike covers)
- https://kindlegen.s3.amazonaws.com/AmazonKindlePublishingGuidelines.pdf — KPG v2026.3 sections 4.1, 4.2

---

## 5. Book metadata fields at title setup

The setup flow has three parts: **Details**, **Content** and **Pricing** (the "Create a Book" page calls them book details, upload and preview, and rights and pricing).

| Part    | Fields                                                                                                                                                                               |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Details | Language, title, subtitle, series, edition number, author, contributors, description, publishing rights, primary audience, primary marketplace, categories, keywords, release option |
| Content | Manuscript, DRM, cover, AI disclosure, accessibility question, preview, optional ISBN and publisher                                                                                  |
| Pricing | KDP Select, territories, royalty plan, list prices                                                                                                                                   |

The exact UI labels and field order are **UNVERIFIED**: they sit behind login and were not checked.

| Field                            | Rule / limit                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Language**                     | Must match the book's language and the file metadata (Accessibility page). The list of options is UNVERIFIED.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **Title**                        | Only the real title, exactly as on the cover. It must be **identical across eBook, paperback and hardcover** so the formats link. Not allowed: generic keyword stuffing (e.g., "notebook", "books"); unauthorized references to other titles, authors or trademarks; implied contributions from people not involved; sales-rank claims ("bestselling"); promotional words ("free"); punctuation-only or placeholder values ("unknown", "n/a", "none"); HTML; extra description. Multi-story books should say so ("Collection", "Compilation").                                                                                                                |
| **Subtitle**                     | Optional. Same rules as the title. Amazon inserts a colon between title and subtitle on the detail page.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **Title + subtitle length**      | **CONFLICT:** "Metadata Guidelines" says the combined length must be _fewer than_ 200 characters; "Books Titles & Editions" says _200 or fewer_. **Use ≤ 199 characters in code.** No separate limit for the title alone is published.                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Series name / number**         | Optional. The series name follows the title rules. The series number goes in its own field, **digits only** ("3", not "Book 3"); this is stated in the Japan-specific part of the Metadata Guidelines. **Public-domain and low-content books can't be in a series.** A series page appears within 72 h. Series 1-click ordering applies to Kindle eBooks only.                                                                                                                                                                                                                                                                                                |
| **Edition number**               | Optional. Enter it as a numeral. A significant change needs a new edition, for example: a new title, primary author or cover; a page count change of more than 10%; for print, a new ISBN, trim, ink or paper. Typo fixes don't. **Title and edition can't be changed after publication**; republish as a new title with "Previously published as …" at the top of the description.                                                                                                                                                                                                                                                                           |
| **Author**                       | The primary contributor. Pen names are allowed if they don't mislead buyers. No HTML.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **Contributors**                 | Only people who actually worked on this book (author, editor, illustrator, translator, …). Translations must credit the translator _and_ the original author; use "Anonymous" if the translator is unknown. No keywords or HTML.                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Description**                  | **Max 4,000 characters, HTML tags included.** Allowed HTML: `<br>`, `<p>`, `<b>`, `<em>`, `<i>`, `<u>`, `<h4>`–`<h6>`, `<ol>`, `<ul>`, `<li>`. `<h1>`–`<h3>` are not supported. No stray or empty angle brackets. Not allowed: explicit or offensive content; phone numbers, addresses, emails or URLs; reviews, quotes or testimonials, and requests for reviews; ads or watermarks; time-sensitive information; price, availability or ordering information; spoilers; **emojis**; keyword or tag stuffing. Multiple spaces are collapsed. About 150 words is suggested for the main paragraph.                                                             |
| **Publishing rights**            | Choose between owning the rights and "This is a public domain work". The exact label of the first option is UNVERIFIED. Public domain rules are in section 6.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **Primary audience**             | **Sexually explicit images or title language: Yes/No (required).** "Yes" makes the book ineligible for children's categories and keeps it out of general product searches. **Reading age** (min/max) is optional, but children's categories need **0–12** and Teen & Young Adult needs **13–17**.                                                                                                                                                                                                                                                                                                                                                             |
| **Primary marketplace**          | Required before choosing categories. It also sets the base list price. Changing it on a live or pre-order book may change prices.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **Categories**                   | **Up to 3**, chosen from a marketplace- and audience-specific list (section 13).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Keywords**                     | **Up to 7** keywords or short phrases. The **per-box character limit is UNVERIFIED**: KDP only tells you to watch the limit shown in the text field, and third-party guides (not official) report 50 characters per box. Not allowed: other authors or books; words already in the title, contributors or categories; subjective claims ("best"); time-sensitive terms ("new", "on sale"); generic words like "book"; misspellings; spacing, punctuation, case or plural variants; brands you don't own; **quotation marks**; Amazon program names ("Kindle+", "KDP Select"); HTML. KDP prefers specific single words in the order customers would type them. |
| **Publisher (eBook, optional)**  | The author's or publisher's own name only. No references to other or prior publishers, Amazon, Kindle, KDP, or websites or domains.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **Imprint (with your own ISBN)** | Must match the ISBN agency record. Case-sensitive. Placeholders like "unknown" are not allowed. **Max 100 characters.**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Release option**               | Release now, or pre-order (eBook only; see section 12).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **AI disclosure**                | Required for AI-generated content (section 7). Where it appears in the flow is UNVERIFIED.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **Accessibility question**       | Present in setup. The default "I don't know…" can be published.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **ISBN (eBook)**                 | Optional (section 10).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

**Cross-field rules**

- The title, subtitle, author, series information and ISBN **inside the manuscript must match** what is entered at setup. KDP flags an error on mismatch.
- **No HTML** in the title, subtitle, author, contributors or keywords.
- **Account throughput limit:** up to **2 new titles per format per week**, counted both at creation and at first submission; drafts count. Updates don't count. The limit resets **Sunday 00:00 UTC**.
- KDP may change or remove irrelevant or misleading categories.

Quote (Write a Book Description): "Note that we have a limit of 4000 characters for the description."

**Sources** (all fetched 2026-10-29)

- https://kdp.amazon.com/en_US/help/topic/G201097560 — Metadata Guidelines for Books
- https://kdp.amazon.com/en_US/help/topic/GW7J4WEKBVU25YEC — Books Titles & Editions
- https://kdp.amazon.com/en_US/help/topic/G201189630 — Write a Book Description
- https://kdp.amazon.com/en_US/help/topic/G201298500 — Make Your Book More Discoverable with Keywords
- https://kdp.amazon.com/en_US/help/topic/G201743260 — How do I add/change my keywords?
- https://kdp.amazon.com/en_US/help/topic/G200652170 — Categories (reading-age ranges)
- https://kdp.amazon.com/en_US/help/topic/G202172740 — Create a Book (weekly limits, matching rule, no HTML)
- https://kdp.amazon.com/en_US/help/topic/G201757800 — Start a Book Series
- https://kdp.amazon.com/en_US/help/topic/G201834170 — What is an ISBN and Imprint? (imprint ≤ 100 chars)
- https://kdp.amazon.com/en_US/help/topic/GBPE3QVZ2J3HLQ4B — Accessibility for eBooks
- https://kdp.amazon.com/en_US/help/topic/G200743940 — Publishing Public Domain Content ("This is a public domain work")

---

## 6. Content guidelines relevant to fiction

- **Illegal or infringing content:** the publisher is responsible for copyright, trademark, privacy and publicity rights. Companion works (summaries, study guides) can't be published outside the US without the rights holder's written permission.
- **Offensive content** is not sold. This includes hate speech, content promoting the abuse or sexual exploitation of children, **pornography**, content glorifying rape or pedophilia, content advocating terrorism, and other content Amazon finds inappropriate. Sexually explicit (but permitted) fiction must answer "Yes" to the sexually explicit question (section 5), which removes it from children's categories and general search.
- **Public domain:**
  - Allowed only if the book is **differentiated** whenever a free version already exists in the store. Qualifying differentiation: an original **translation**, original **annotations** (study guide, critique, biography, historical context), or **10 or more original illustrations**.
  - The title field must include **"(Translated)"**, **"(Annotated)"** or **"(Illustrated)"**.
  - The description must start with a bulleted summary of what is original, **≤ 80 characters**.
  - These do **not** count as differentiation: a linked TOC, formatting, collections, price, freely available web content.
  - Amazon may ask for proof of public-domain status. Public-domain books are **not eligible for KDP Select** and earn **35% only** (section 8).
- **Freely available content:** copyrighted material that is freely available on the web is not accepted unless the copyright owner submits it.
- **Misleading metadata / poor customer experience:** descriptions, titles and covers must represent the book accurately. KDP may change categories.
- **Disappointing content** (Guide to Kindle Content Quality). KDP doesn't allow content that:
  - is marketed as a subscription, or sends readers elsewhere for the full text;
  - is freely available on the web (unless you own it or it is public domain);
  - mainly exists to solicit or advertise;
  - is not meaningfully different from another book already on sale;
  - is too short;
  - is poorly translated;
  - doesn't give an enjoyable reading experience;
  - puts **bonus content before the main content**;
  - is excessively reused or repeated within or across books;
  - is re-released with metadata changes that confuse readers.
- **Critical quality issues** remove a book from sale until fixed:
  - body text forced bold, italic, underlined or hyperlinked;
  - forced font or background colors that make text unreadable;
  - margins wider than 1/4 of the screen;
  - in-line page numbers;
  - books made entirely of scans;
  - bonus content placed at the beginning.
- Romance may have a second, "discreet" cover edition, but the title or subtitle must say so (e.g., "Discreet Version").
- Translations must credit the translator and the original author.

Quote (Guide to Kindle Content Quality): "any Critical Issue will result in the book being removed from sale"

**Sources** (all fetched 2026-10-29)

- https://kdp.amazon.com/en_US/help/topic/G200672390 — Content Guidelines
- https://kdp.amazon.com/en_US/help/topic/G200952510 — Guide to Kindle Content Quality
- https://kdp.amazon.com/en_US/help/topic/G200743940 — Publishing Public Domain Content
- https://kdp.amazon.com/en_US/help/topic/G201097560 — Metadata Guidelines for Books

---

## 7. AI-generated content disclosure

- **AI-generated:** text, images or translations **created by an AI-based tool**. It **still counts as AI-generated even if you substantially edited it afterwards.** AI-generated images include **cover and interior images and artwork**.
- **AI-assisted:** you created the content yourself and used AI tools to edit, refine, error-check or otherwise improve it. Using AI to **brainstorm** ideas also counts as AI-assisted, as long as you wrote or created the content yourself.
- **Disclosure:** **required for AI-generated** text, images and translations, both when publishing a new book and when republishing an edited existing book. **Not required for AI-assisted** content.
- **Responsibility:** the publisher must make sure all AI-generated and AI-assisted content follows the content guidelines, including intellectual-property rights.
- **Where it is asked: UNVERIFIED.** The official page only says to tell KDP at publishing time and names no tab or question. Third-party guides describe separate questions for text, images and translations in the **Content** step, below the manuscript upload. The answer options (e.g., how much of the work and how much editing) and whether the tool must be named are also UNVERIFIED.
- **For this project:** images generated by OpenAI or Gemini and stories generated by Claude count as **AI-generated**, even after heavy editing. The module should record, per book, which of text, images (cover and interior) and translation were AI-generated, so the user can answer the disclosure accurately.

Quote (Content Guidelines): content created by an AI tool is "AI-generated," even if you applied substantial edits afterwards.

**Sources** (all fetched 2026-10-29)

- https://kdp.amazon.com/en_US/help/topic/G200672390 — Content Guidelines, section "Artificial intelligence (AI) content"
- Secondary (not official, used only for the UNVERIFIED location note): search results for authorsguild.org and scribecount.com, 2026-10-29

---

## 8. eBook royalty and pricing

**Royalty formulas**

- **35% option:** 35% × (list price − VAT). No delivery cost is deducted.
- **70% option:** 70% × (list price − VAT − delivery cost). It applies only to sales to customers in the 70% territories; all other sales earn 35%.
- **Conditions for 70%:**
  - The list price must be within the 70% band in the table below.
  - The list price must be **at least 20% below the Amazon list price of any physical edition**.
  - The book must not be primarily public domain.
  - In **Brazil, Japan, Mexico and India**, the eBook must **also be enrolled in KDP Select**.
- If a price match takes the Amazon price below the 70% minimum, that sale earns 35%.
- Under the 35% option, matching a free price elsewhere means zero royalty for that period.
- **You cannot set a list price of free.** Free is only possible through KDP Select promotions.
- Worked example from KDP (Amazon.es): €1.99 list price, 4% VAT, 1 MB file, €0.10/MB delivery gives a royalty of €1.27. Note the current Amazon.es delivery rate is €0.12/MB (see the delivery table below); the example uses an older rate.

**List price bands, min – max** (VAT-inclusive where local VAT applies; the exact list of eBook marketplaces that include VAT is UNVERIFIED)

| Marketplace                               | 35%, < 3 MB     | 35%, 3 to < 10 MB                   | 35%, ≥ 10 MB    | **70%**                            |
| ----------------------------------------- | --------------- | ----------------------------------- | --------------- | ---------------------------------- |
| Amazon.com (USD)                          | $0.99 – $200    | $1.99 – $200                        | $2.99 – $200    | **$2.99 – $12.99**                 |
| Amazon.co.uk (GBP)                        | £0.77 – £150    | £1.25 – £150                        | £1.49 – £150    | **£1.77 – £12.99**                 |
| EUR (DE, FR, ES, IT, NL: one shared band) | €0.89 – €215    | €1.79 – €215                        | €2.69 – €215    | **€2.69 – €12.99**                 |
| Amazon.ca (CAD)                           | C$0.99 – C$200  | C$1.99 – C$200                      | C$2.99 – C$200  | C$2.99 – C$12.99                   |
| Amazon.com.au (AUD)                       | A$0.99 – A$220  | A$1.99 – A$220                      | A$3.99 – A$220  | A$3.99 – A$15.99                   |
| Amazon.in (INR)                           | ₹49 – ₹10,999   | ₹69 – ₹10,999                       | ₹99 – ₹10,999   | ₹99 – ₹599 (Select required)       |
| Amazon.com.br (BRL)                       | R$1.99 – R$400  | R$3.99 – R$400                      | R$5.99 – R$400  | R$5.99 – R$31.99 (Select required) |
| Amazon.com.mx (MXN)                       | $11.99 – $2,500 | $23.99 – $2,500                     | $34.99 – $2,500 | $34.99 – $199.99 (Select required) |
| Amazon.co.jp (JPY)                        | ¥99 – ¥20,000   | ¥99 – ¥20,000 (one tier for ≥ 3 MB) | —               | ¥250 – ¥1,650 (Select required)    |

- The US 70% band became **$2.99–$12.99 on 2026-07-07**; the maximum was $9.99 before. The help page shows £12.99 and €12.99 as the UK and EUR maximums, but gives no separate effective date for them.

**Delivery cost (70% option only)** — Digital Book Pricing Page, last updated 2026-04-21

| Marketplace                       | Per MB   | Minimum per sale                                        |
| --------------------------------- | -------- | ------------------------------------------------------- |
| Amazon.com                        | US$0.15  | US$0.01                                                 |
| Amazon.ca                         | CAD$0.15 | CAD$0.01                                                |
| Amazon.com.br                     | R$0.30   | R$0.01                                                  |
| Amazon.co.uk                      | £0.10    | £0.01                                                   |
| Amazon.de / .fr / .es / .it / .nl | €0.12    | €0.01                                                   |
| Amazon.in                         | ₹7       | ₹1                                                      |
| Amazon.co.jp                      | ¥1       | ¥1 (no delivery cost for books **≥ 10 MB** sold in JPY) |
| Amazon.com.mx                     | MXN$1    | MXN$1                                                   |
| Amazon.com.au                     | AUD$0.15 | AUD$0.01                                                |

- File size is the converted file size as Amazon determines it, **rounded up to the nearest KB**. Royalties and costs are rounded to 2 decimals, or to whole yen.
- The eBook Royalties page gives an average of about $0.06 per unit.

**70% territories:** Andorra, Australia, Austria, Bahrain, Belgium, Brazil\*, Canada, Egypt, France, Germany, Gibraltar, Guernsey, Hong Kong, India\*, Ireland, Isle of Man, Italy, Japan\*, Jersey, Jordan, Kuwait, Lebanon, Liechtenstein, Luxembourg, Macao, Mexico\*, Monaco, Netherlands, New Zealand, Oman, Qatar, San Marino, Saudi Arabia, Spain, Switzerland, Taiwan, Thailand, United Arab Emirates, United Kingdom, United States, Vatican City. (\* = KDP Select required.)

**Price entry:** either set a price in the primary marketplace and let KDP convert it, or set each marketplace manually. Changing the primary price does not update prices that were set manually.

Quote (eBook List Price Requirements): "Effective July 7, 2026, the 70% royalty option price band is $2.99-$12.99 on Amazon.com"

**Sources** (all fetched 2026-10-29)

- https://kdp.amazon.com/en_US/help/topic/G200634560 — eBook List Price Requirements
- https://kdp.amazon.com/en_US/help/topic/G200634500 — Digital Book Pricing Page (last updated 2026-04-21)
- https://kdp.amazon.com/en_US/help/topic/G200644210 — eBook Royalties
- https://kdp.amazon.com/en_US/help/topic/G200641280 — Price Your Book

---

## 9. KDP Select

**Enrollment**

- A **free, 90-day** program for Kindle eBooks (and audiobooks).
- **Exclusivity:** during enrollment the **eBook** may be distributed only through KDP (and public libraries). **Print, audio, video and other formats may be sold elsewhere.**
- Eligibility: you need exclusive rights to the primary content. **Public-domain content is not eligible.**
- **Auto-renewal:** enrollment renews every 90 days from the first enrollment unless you turn it off. To turn it off: Bookshelf → "…" → _Manage KDP Select_ → _Turn off automatic renewal_ → _Save changes_. Turning it off doesn't end the current term.
- **Cancel** within **3 days** of the term start; after that, contact KDP. A pre-order eBook can't be cancelled until it is released.

**Kindle+ (formerly Kindle Unlimited)**

- Enrolled titles are automatically included in **Kindle+**, the paid reading subscription. All current KDP help pages say "Kindle+" and never mention Kindle Unlimited.
- Press reports the rename on **2026-10-22**, with no change to rules or price. That date comes from a secondary source (Android Authority); the rename itself is visible on the official pages.

**Page-read royalties**

- Paid from the monthly **KDP Select Global Fund** by share of **KENP** (Kindle Edition Normalized Pages) read.
- Only the **first time** a subscriber reads a page counts.
- Monthly KENP figures are finalized around the 15th of the following month. Payment comes about 60 days after month end.
- There is also a "KDP Select bonus" for top titles and authors; no amounts are published.

**Promotions:** **either** a Free Book Promotion **or** a Kindle Countdown Deal per 90-day term, never both.

| Promotion                 | Rules                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Free Book Promotion**   | Up to **5 days per 90-day term**. Unused days don't roll over. Schedule at least 1 day ahead. The earliest start is day 2 of the term. Can't be scheduled for future terms. Runs midnight to midnight Pacific.                                                                                                                                                                                                                                                                                                  |
| **Kindle Countdown Deal** | **Amazon.com and Amazon.co.uk only.** The title must have been enrolled for **≥ 30 days**. List price unchanged **30 days before and 14 days after** the deal. Price range **$2.99–$24.99** / **£1.99–£15.99**. Minimum discount $1 / £1. Up to 5 price steps. Length **1 hour to 7 days**. Schedule **≥ 24 h** ahead. **One per term.** Must end **≥ 14 days** before the term ends. Your normal royalty rate is kept at the discounted price; for 70% books this holds even below $2.99, minus delivery cost. |

**70% royalty** on sales in **Brazil, Japan, Mexico and India** requires enrollment (section 8).

Quote (KDP Select Enrollment): "the Kindle eBook can only be distributed through KDP and public libraries."

**Sources** (all fetched 2026-10-29)

- https://kdp.amazon.com/en_US/help/topic/G200798990 — KDP Select
- https://kdp.amazon.com/en_US/help/topic/GD9PMU58BV24QFZ7 — KDP Select Enrollment
- https://kdp.amazon.com/en_US/help/topic/GEZBMTMYGN9EBTLG — KDP Select Benefits
- https://kdp.amazon.com/en_US/help/topic/G201541130 — Royalties in Kindle+
- https://kdp.amazon.com/en_US/help/topic/G201298240 — Free Book Promotions
- https://kdp.amazon.com/en_US/help/topic/G201293780 — Kindle Countdown Deals
- https://kdp.amazon.com/en_US/help/topic/G202173620 — Timelines (renewal, Global Fund payment)
- https://kdp.amazon.com/en_US/help/topic/G200634500 — Digital Book Pricing Page (Select requirement for BR/JP/MX/IN)
- Secondary: https://www.androidauthority.com/amazon-rebrands-kindle-unlimited-3726750/ (2026-10-22, rename date)

---

## 10. ISBN for eBooks vs paperback

- **eBook:** an ISBN is **not required**. Amazon assigns an **ASIN** to each book, and the eBook ISBN and publisher fields are optional. If you do enter an ISBN, it must be unique to the eBook format, and an ISBN printed in the manuscript must match the one entered at setup.
- **Paperback and hardcover:** an ISBN is **required**, except for low-content books. There are two options:
  - **Free KDP ISBN:** only usable for publishing through KDP. The imprint shows as "Independently published".
  - **Your own ISBN:** the title, author and imprint must match the ISBN agency's record (e.g., Bowker), or publishing is blocked. The imprint is limited to 100 characters.
- **Each format needs its own ISBN**: paperback and hardcover can't share one, and a new edition with significant changes needs a new ISBN. Hardcover is not available on Amazon.co.jp.
- Boxed sets and bundles should have their own ISBN, not one reused from a book inside the set (KPG 10.4).
- **UNVERIFIED:** whether adding an eBook ISBN locks later updates (seen only in a search snippet).

Quote (What is an ISBN and Imprint Name?): "eBooks don't require an ISBN number to be published on KDP."

**Sources** (all fetched 2026-10-29)

- https://kdp.amazon.com/en_US/help/topic/G7DMSKCM9DVS65TC — What is an ISBN and Imprint Name?
- https://kdp.amazon.com/en_US/help/topic/G201834170 — What is an ISBN and Imprint?
- https://kdp.amazon.com/en_US/help/topic/G201097560 — Metadata Guidelines (ISBN must match manuscript)
- https://kindlegen.s3.amazonaws.com/AmazonKindlePublishingGuidelines.pdf — KPG v2026.3 section 10.4

---

## 11. Front and back matter for eBooks

**Table of contents**

- A **logical TOC (nav/NCX) is required** in every book (KPG 5; the quality guide says NCX is required).
- An **HTML TOC page with links to each chapter** is strongly recommended and belongs **at the beginning** of the book. A TOC placed at the end hurts "Last Page Read" and drops out of the sample.
- No page numbers in the TOC, and no `<table>` layout.
- "> ~20 pages" is not a threshold: KDP only says the logical TOC matters _especially_ for books longer than 20 pages, and it requires one for every book.
- In Word: apply **Heading 1** to chapter titles, insert a Word TOC with **Show Page Numbers unchecked** and **Show levels = 1**, put a page break after it, and add a bookmark named `toc` on the TOC heading.
- Boxed sets: a linked overall TOC listing every book must come first.

**Front matter** (eBook Manuscript Formatting Guide): title page (title and author), dedication, optional copyright page.

**Back matter:** "About the Author", bibliography. Kindle Create can also add pages such as "Books by this author".

**Sample ("Look Inside" / Read Sample)**

- The sample is the **first 10%** of a reflowable eBook, and the percentage can't be changed.
- Keep front matter short, so the sample reaches the story. This is an inference from the 10% rule, not an explicit KDP rule.
- **Bonus content (other stories, previews of other books) must not come before the main content.** Doing so is a Critical Issue.

**Formatting rules for the manuscript**

- No headers, footers or page numbers.
- Use real page breaks, not repeated returns, and no tabs.
- Body paragraphs: about 0.2" (5 mm) first-line indent, 0 pt spacing before and after, single line spacing.
- Turn off Track Changes.
- Footnotes must be linked; they are converted to endnotes.

**Cover:** **never inside the manuscript** (section 4).

Quote (KPG 5.1): "Place the HTML TOC towards the beginning of the book"

**Sources** (all fetched 2026-10-29)

- https://kdp.amazon.com/en_US/help/topic/G200645680 — eBook Manuscript Formatting Guide
- https://kdp.amazon.com/en_US/help/topic/G201605700 — Create a Table of Contents
- https://kdp.amazon.com/en_US/help/topic/G200644250 — Read Sample (Look Inside the Book)
- https://kdp.amazon.com/en_US/help/topic/G200952510 — Guide to Kindle Content Quality
- https://kindlegen.s3.amazonaws.com/AmazonKindlePublishingGuidelines.pdf — KPG v2026.3 sections 5, 10.6

---

## 12. Pre-orders and publication timing

**Pre-orders (eBook only)**

- Pre-orders are available for **new eBook titles only**. Paperback and hardcover have no pre-order; they can only schedule a release (section 14).
- **Maximum lead time:** **18 months** for pre-orders created on or after **2026-09-02**; 12 months for older pre-orders. No minimum lead time is stated.
- A manuscript is **not needed** to create the pre-order. Uploading a draft early can enable a reading sample.
- **The final manuscript must be uploaded and submitted at least 72 hours before release.** Manuscript and details are locked from then on.
- **Postponing** (pre-orders created on or after 2026-09-02): up to **2 times**, and the new date can't be more than **6 months** after the original release date. Older pre-orders get one postponement of at most 30 days. Going over the limit cancels the pre-order automatically.
- **Penalties:** the first missed deadline or cancellation is a one-time courtesy. A **second** one removes pre-order privileges **for 6 months across the whole catalog**; a removal before 2026-09-02 keeps the old 1-year penalty. A cancelled pre-order's ASIN can't be reused.
- **CONFLICT:** the "Release Date Options" page still says 1 year of lead time, a 1-year penalty and "delay more than once". Those are the pre-2026-09-02 rules, and the dedicated pre-order pages are newer. **Use 18 months / 2 postponements within 6 months / 6-month penalty.**

**Publication timing (Timelines page)**

| Event                                                                           | Time                                               |
| ------------------------------------------------------------------------------- | -------------------------------------------------- |
| New eBook goes live after submission                                            | usually up to **72 hours** (about 3 business days) |
| Pre-order review                                                                | 24–72 hours                                        |
| Detail page, cover thumbnail, search visibility                                 | up to 72 h                                         |
| Updates to title fields, description, keywords, categories, manuscript or cover | up to 72 h                                         |
| List-price change                                                               | up to 24 h                                         |
| Read Sample                                                                     | 7–8 business days                                  |
| eBook ↔ print linking                                                           | 48 h – 1 week                                      |
| Republished title                                                               | 12 h (English), 48 h (other languages)             |
| Changes locked during review after submission                                   | up to 72 h                                         |

Quote (Kindle eBook Pre-Order): "Pre-orders are available for eBooks only (not paperbacks or hardcovers)."

**Sources** (all fetched 2026-10-29)

- https://kdp.amazon.com/en_US/help/topic/G201499380 — Kindle eBook Pre-Order
- https://kdp.amazon.com/en_US/help/topic/G201499440 — Postpone or cancel a pre-order release
- https://kdp.amazon.com/en_US/help/topic/GZUV7SNV728WT4QE — Release Date Options (outdated values, see CONFLICT)
- https://kdp.amazon.com/en_US/help/topic/G202173620 — Timelines

---

## 13. Amazon categories

- **Up to 3 categories** per book, selected in KDP from a list that depends on the **primary marketplace**, the **format** and the **audience**. A primary marketplace must be set first.
- Categories differ between marketplaces (Amazon.com, Amazon.co.uk, …) and between formats (eBook vs print).
- Categories must match the book's actual content. KDP may remove or change irrelevant or misleading choices, and changes are reviewed.
- Eligibility depends on audience:
  - Children's categories need a reading age within **0–12**.
  - Teen & Young Adult needs **13–17**.
  - Books marked sexually explicit are excluded from children's categories.
- If no category fits, choose the closest one and rely on keywords. There is no documented way to request a new category, and KDP Support won't recommend categories.
- To change categories: Bookshelf → "…" → _Edit details_ → _Categories_ → _Edit categories_. Changes take up to 72 h.
- **To look categories up:** open the Kindle Store (eBooks) or Books store (print) on the relevant Amazon marketplace, click **Categories** in the top navigation, and browse the subgenres. The authoritative list is the picker inside KDP, which requires login.
- **For code:** do **not** hard-code category IDs or trees. Store the user's chosen category paths as free text per marketplace (at most 3), and show a link or instructions for browsing.

Quote (Categories page): "you can select 3 categories when creating a book in KDP."

**Sources** (all fetched 2026-10-29)

- https://kdp.amazon.com/en_US/help/topic/G200652170 — Categories
- https://kdp.amazon.com/en_US/help/topic/G201097560 — Metadata Guidelines for Books

---

## 14. eBook vs paperback: what a later paperback workflow needs (brief)

| Topic                         | eBook                                                                                   | Paperback                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Interior file                 | EPUB / DOCX / KPF, reflowable                                                           | Print-ready **PDF** (required if there is bleed), or DOC/DOCX/RTF/HTML/TXT, or Kindle Create. Max 650 MB.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Trim size                     | n/a                                                                                     | Common US sizes: **5×8, 5.5×8.5, 6×9** in (24–828 pages for B&W on white paper) and **8.5×11** in (24–590 pages). Ranges depend on ink and paper: cream 24–776, groundwood 24–812, standard color 72–600. Hardcover: 75–550 pages. Set the trim size **before** the margins.                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Bleed                         | n/a                                                                                     | **0.125 in (3.2 mm)** on the top, bottom and outside edges. Page size with bleed = trim + 0.125 in width and + 0.25 in height (6×9 becomes 6.125×9.25 in).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Margins                       | n/a                                                                                     | **Inside (gutter) margin by page count:** 24–150 → 0.375 in; 151–300 → 0.5 in; 301–500 → 0.625 in; 501–700 → 0.75 in; 701–828 → 0.875 in. **Outside, top and bottom:** at least 0.25 in without bleed, at least 0.375 in with bleed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Cover                         | Front only: JPEG/TIFF, RGB, 1600×2560                                                   | **One PDF wrap** (back + spine + front). **Width** = bleed + back + spine + front + bleed; **height** = bleed + trim height + bleed. **Spine width = page count × per-page thickness**: white 0.002252 in, cream 0.0025 in, premium color 0.002347 in, standard color 0.002252 in. Spine text needs more than 79 pages (**CONFLICT** on the help page: ">79" vs "≥79"; Cover Creator requires 80). Keep 0.0625 in clearance from the spine edges and keep text 0.125 in inside the trim. Images **CMYK**, at least 300 DPI, flattened. Text at least 7 pt. File about 40 MB recommended (650 MB hard limit). KDP can place the barcode. Use KDP's cover calculator and template: https://kdp.amazon.com/cover-calculator |
| ISBN                          | Optional (ASIN assigned)                                                                | **Required** (free KDP ISBN or your own)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Release                       | Release now, or pre-order up to 18 months ahead                                         | Release now, or a **scheduled release 5–90 days ahead**; final files due **5 days** before. No pre-order.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Title fields after publishing | Locked (a new edition is needed)                                                        | Can be edited only within 72 h of first publication; after that a new edition is needed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Linking                       | Title must be **identical** across formats for the detail pages to link (48 h – 1 week) | same                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

**Sources** (all fetched 2026-10-29)

- https://kdp.amazon.com/en_US/help/topic/GVBQ3CMEQW3W2VL6 — Set Trim Size, Bleed, and Margins
- https://kdp.amazon.com/help?topicId=G201953020 — Create a Paperback Cover
- https://kdp.amazon.com/en_US/help/topic/G202145060 — Save Your Manuscript File
- https://kdp.amazon.com/en_US/help/topic/G201834170 — What is an ISBN and Imprint?
- https://kdp.amazon.com/en_US/help/topic/GZUV7SNV728WT4QE — Release Date Options (print scheduled release)
- https://kdp.amazon.com/en_US/help/topic/G202173620 — Timelines
- https://kdp.amazon.com/en_US/help/topic/GW7J4WEKBVU25YEC — Books Titles & Editions

---

## Appendix A: Constants for code (same data as above, verified 2026-10-29)

```yaml
kdpRulesVersion: "2026-10-29.1"
ebook:
  manuscript:
    acceptedFormats: [epub, docx, doc, kpf, html, zip, htm, rtf, txt, pdf] # pdf: limited languages, not for reflowable fiction
    rejectedFormats: [mobi]
    maxFileSizeMB: 650
    maxHtmlFileSizeMB: 30 # per XHTML file inside EPUB (KPG 9)
    maxHtmlFileCount: 299 # "fewer than 300" (KPG 9)
    epubRequiredOpfMeta: [dc:title, dc:language]
    logicalTocRequired: true # nav or NCX
    htmlTocRecommended: true # at the front, linked, no page numbers
    coverInsideManuscript: false
    imageAltTextMaxChars: 140
    fullPageImageMinPx: { width: 1200, height: 1800 }
  epubcheck:
    latestVersion: "5.4.0" # released 2026-09-15
    minJava: 8
    failOn: [FATAL, ERROR] # USAGE "outdated" messages for NCX/guide are expected
  cover:
    formats: [jpeg, tiff]
    idealPx: { width: 1600, height: 2560 }
    aspectRatioHeightToWidth: 1.6
    minPx: { width: 625, height: 1000 }
    maxPxPerSide: 10000
    maxFileSizeMB: 50 # warn above 5 (KPG PDF says 5 MB)
    colorSpace: RGB
    lightCoverBorderPx: [3, 4] # medium gray
  metadata:
    titlePlusSubtitleMaxChars: 199 # CONFLICT "<200" vs "<=200"; use the stricter one
    descriptionMaxChars: 4000 # HTML tags included
    descriptionAllowedTags: [br, p, b, em, i, u, h4, h5, h6, ol, ul, li]
    descriptionForbidden:
      [emoji, url, email, phone, review_quotes, price, time_sensitive]
    keywordsMax: 7
    keywordMaxChars: null # UNVERIFIED (third parties say 50)
    categoriesMax: 3
    imprintMaxChars: 100
    seriesNumberDigitsOnly: true
    htmlForbiddenIn: [title, subtitle, author, contributors, keywords]
    newTitlesPerFormatPerWeek: 2 # resets Sunday 00:00 UTC
    readingAge: { children: [0, 12], teen: [13, 17] }
  aiDisclosure:
    requiredFor:
      [ai_generated_text, ai_generated_images, ai_generated_translation]
    notRequiredFor: [ai_assisted]
    substantialEditsStillAiGenerated: true
  pricing:
    royalty70Band:
      USD: [2.99, 12.99]
      GBP: [1.77, 12.99]
      EUR: [2.69, 12.99]
      CAD: [2.99, 12.99]
      AUD: [3.99, 15.99]
      INR: [99, 599]
      BRL: [5.99, 31.99]
      MXN: [34.99, 199.99]
      JPY: [250, 1650]
    royalty35Min: # by file size: <3MB, 3-<10MB, >=10MB
      USD: [0.99, 1.99, 2.99]
      GBP: [0.77, 1.25, 1.49]
      EUR: [0.89, 1.79, 2.69]
    royalty35Max:
      {
        USD: 200,
        GBP: 150,
        EUR: 215,
        CAD: 200,
        AUD: 220,
        INR: 10999,
        BRL: 400,
        MXN: 2500,
        JPY: 20000,
      }
    deliveryCostPerMB:
      {
        USD: 0.15,
        CAD: 0.15,
        BRL: 0.30,
        GBP: 0.10,
        EUR: 0.12,
        INR: 7,
        JPY: 1,
        MXN: 1,
        AUD: 0.15,
      }
    royalty70RequiresSelectIn: [BR, JP, MX, IN]
    royalty70MaxShareOfPrintPrice: 0.80 # eBook list price at least 20% below any physical edition
    publicDomainRoyalty: 0.35
  kdpSelect:
    termDays: 90
    autoRenew: true
    cancelWithinDays: 3
    freePromoDaysPerTerm: 5
    countdownDeal:
      {
        marketplaces: [US, UK],
        minEnrolledDays: 30,
        maxDays: 7,
        perTerm: 1,
        priceUSD: [2.99, 24.99],
        priceGBP: [1.99, 15.99],
      }
    onePromotionTypePerTerm: true
  preorder:
    maxLeadMonths: 18 # created on/after 2026-09-02
    finalManuscriptHoursBefore: 72
    maxPostponements: 2
    maxPostponementMonthsFromOriginal: 6
    penaltyMonths: 6
  timing:
    publishReviewHours: 72
```

---

## Changelog

| Version      | Date       | Change                                                                                    |
| ------------ | ---------- | ----------------------------------------------------------------------------------------- |
| 2026-10-29.1 | 2026-10-29 | First version, researched from official KDP help pages, KPG v2026.3 and EPUBCheck v5.4.0. |
