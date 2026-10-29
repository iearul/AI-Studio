import {
  checkWellFormed,
  descendants,
  hasToken,
  localName,
  parseXml,
  textContent,
} from "./xml.js";
import type { XmlElement } from "./xml.js";
import { readZip } from "./zip.js";

export type Issue = { code: string; message: string; path?: string };

export type EpubStructureReport = {
  ok: boolean;
  errors: Issue[];
  warnings: Issue[];
  stats: {
    files: number;
    xhtmlFiles: number;
    tocEntries: number;
    /** Size of the EPUB file itself. */
    totalBytes: number;
  };
};

// Kindle Publishing Guidelines, section 9 and 11.4.2. Decimal megabytes keep
// the checks on the safe side of either reading of "MB".
const maxXhtmlBytes = 30_000_000;
const maxXhtmlFiles = 300;
const maxEpubBytes = 650_000_000;

const mimetype = "application/epub+zip";
const xmlExtensions = /\.(?:xhtml|html|htm|xml|opf|ncx|svg)$/i;
const xhtmlExtensions = /\.(?:xhtml|html|htm)$/i;
const fontExtensions = /\.(?:ttf|otf|woff2?)$/i;
const fontMediaTypes =
  /^(?:font\/|application\/(?:font-|x-font-|vnd\.ms-opentype))/i;
const pageNumberText =
  /(?:\.{3,}|…|\t|\s{3,})\s*\d+\s*$|\b(?:p\.|pp\.|pg\.?|page|seite|s\.)\s*\d+\s*$/i;
const absoluteUrl = /^[a-z][a-z0-9+.-]*:/i;

type Link = { from: string; href: string };

class Collector {
  readonly errors: Issue[] = [];
  readonly warnings: Issue[] = [];

  error(code: string, message: string, path?: string): void {
    this.errors.push(path ? { code, message, path } : { code, message });
  }

  warn(code: string, message: string, path?: string): void {
    this.warnings.push(path ? { code, message, path } : { code, message });
  }
}

const decoder = new TextDecoder();

/**
 * Structural checks that catch broken packages before EPUBCheck runs, plus
 * Kindle-specific limits EPUBCheck does not know about. It is not a
 * replacement for EPUBCheck or Kindle Previewer.
 */
export function validateEpubStructure(bytes: Uint8Array): EpubStructureReport {
  const issues = new Collector();
  const stats = {
    files: 0,
    xhtmlFiles: 0,
    tocEntries: 0,
    totalBytes: bytes.length,
  };
  const report = (): EpubStructureReport => ({
    ok: issues.errors.length === 0,
    errors: issues.errors,
    warnings: issues.warnings,
    stats,
  });

  if (bytes.length > maxEpubBytes) {
    issues.error(
      "EPUB_TOO_LARGE",
      `The EPUB is ${bytes.length} bytes; Kindle accepts at most 650 MB.`,
    );
  }

  let files: Map<string, Uint8Array>;
  try {
    files = readZip(bytes);
  } catch (error) {
    issues.error(
      "ZIP_INVALID",
      `The file is not a readable ZIP archive (${error instanceof Error ? error.message : String(error)}).`,
    );
    return report();
  }
  const paths = [...files.keys()].filter((path) => !path.endsWith("/"));
  stats.files = paths.length;

  checkMimetype(bytes, files, issues);

  const texts = new Map<string, string>();
  const text = (path: string): string => {
    let value = texts.get(path);
    if (value === undefined) {
      value = decoder.decode(files.get(path) ?? new Uint8Array());
      texts.set(path, value);
    }
    return value;
  };

  // Well-formedness first: later checks only parse files that passed.
  const parsed = new Map<string, XmlElement[]>();
  for (const path of paths) {
    if (!xmlExtensions.test(path)) continue;
    const problem = checkWellFormed(text(path));
    if (problem) {
      issues.error(
        "XML_MALFORMED",
        `Line ${problem.line}: ${problem.message}`,
        path,
      );
      continue;
    }
    try {
      parsed.set(path, parseXml(text(path)));
    } catch (error) {
      issues.error(
        "XML_MALFORMED",
        error instanceof Error ? error.message : String(error),
        path,
      );
    }
  }

  const opfPath = findPackageDocument(files, parsed, issues);
  const links: Link[] = [];
  let navPath: string | null = null;
  if (opfPath) {
    navPath = checkPackageDocument(opfPath, files, parsed, issues);
  }

  const ids = new Map<string, Set<string>>();
  const xhtmlPaths = paths.filter((path) => xhtmlExtensions.test(path));
  stats.xhtmlFiles = xhtmlPaths.length;
  if (xhtmlPaths.length >= maxXhtmlFiles) {
    issues.error(
      "TOO_MANY_XHTML",
      `The EPUB contains ${xhtmlPaths.length} XHTML files; Kindle requires fewer than ${maxXhtmlFiles}.`,
    );
  }
  for (const path of xhtmlPaths) {
    const size = files.get(path)?.length ?? 0;
    if (size > maxXhtmlBytes) {
      issues.error(
        "XHTML_TOO_LARGE",
        `The file is ${size} bytes; Kindle requires each XHTML file to be under 30 MB.`,
        path,
      );
    }
    const roots = parsed.get(path);
    if (roots) checkContentDocument(path, roots, ids, links, issues);
  }
  for (const [path, roots] of parsed) {
    if (path.toLowerCase().endsWith(".ncx"))
      checkNcx(path, roots, links, issues);
  }

  if (navPath) {
    const roots = parsed.get(navPath);
    if (roots) stats.tocEntries = checkNavDocument(navPath, roots, issues);
  }

  for (const path of paths) {
    if (path.toLowerCase().endsWith(".css")) checkCss(text(path), path, issues);
  }

  checkLinks(links, files, ids, parsed, issues);
  return report();
}

function checkMimetype(
  bytes: Uint8Array,
  files: Map<string, Uint8Array>,
  issues: Collector,
): void {
  // The OCF rule is about the raw archive layout, which unzipping hides, so
  // the first local file header is read directly.
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 30 || view.getUint32(0, true) !== 0x04034b50) {
    issues.error(
      "MIMETYPE_MISSING",
      "The archive does not start with a file entry.",
    );
    return;
  }
  const method = view.getUint16(8, true);
  const nameLength = view.getUint16(26, true);
  const extraLength = view.getUint16(28, true);
  const name = decoder.decode(bytes.subarray(30, 30 + nameLength));
  if (name !== "mimetype") {
    if (files.has("mimetype")) {
      issues.error(
        "MIMETYPE_NOT_FIRST",
        `The first entry is "${name}"; "mimetype" must come first.`,
      );
    } else {
      issues.error("MIMETYPE_MISSING", "The archive has no mimetype entry.");
    }
    return;
  }
  if (method !== 0) {
    issues.error(
      "MIMETYPE_COMPRESSED",
      "The mimetype entry must be stored without compression.",
      "mimetype",
    );
  }
  if (extraLength > 0) {
    issues.warn(
      "MIMETYPE_EXTRA_FIELD",
      "The mimetype entry has an extra field; some readers expect none.",
      "mimetype",
    );
  }
  const content = decoder.decode(files.get("mimetype") ?? new Uint8Array());
  if (content !== mimetype) {
    issues.error(
      "MIMETYPE_CONTENT",
      `The mimetype entry must contain exactly "${mimetype}".`,
      "mimetype",
    );
  }
}

function findPackageDocument(
  files: Map<string, Uint8Array>,
  parsed: Map<string, XmlElement[]>,
  issues: Collector,
): string | null {
  const containerPath = "META-INF/container.xml";
  if (!files.has(containerPath)) {
    issues.error("CONTAINER_MISSING", "META-INF/container.xml is missing.");
    return null;
  }
  const roots = parsed.get(containerPath);
  if (!roots) return null;
  const rootfile = descendants(roots).find(
    (element) =>
      localName(element.name) === "rootfile" &&
      element.attributes["media-type"] === "application/oebps-package+xml",
  );
  const fullPath = rootfile?.attributes["full-path"];
  if (!fullPath) {
    issues.error(
      "CONTAINER_NO_ROOTFILE",
      "container.xml does not name a package document.",
      containerPath,
    );
    return null;
  }
  if (!files.has(fullPath)) {
    issues.error(
      "OPF_MISSING",
      `container.xml points to "${fullPath}", which does not exist.`,
      containerPath,
    );
    return null;
  }
  return parsed.has(fullPath) ? fullPath : null;
}

/** Returns the path of the navigation document when exactly one exists. */
function checkPackageDocument(
  opfPath: string,
  files: Map<string, Uint8Array>,
  parsed: Map<string, XmlElement[]>,
  issues: Collector,
): string | null {
  const all = descendants(parsed.get(opfPath) ?? []);
  const packageElement = all.find(
    (element) => localName(element.name) === "package",
  );
  if (!packageElement) {
    issues.error(
      "OPF_INVALID",
      "The package document has no <package> element.",
      opfPath,
    );
    return null;
  }
  // Dublin Core elements carry a prefix; OPF's own elements do not.
  const named = (name: string) =>
    all.filter(
      (element) =>
        element.name.includes(":") &&
        localName(element.name) === name &&
        textContent(element).trim(),
    );
  if (named("title").length === 0) {
    issues.error("OPF_MISSING_TITLE", "The package has no dc:title.", opfPath);
  }
  if (named("language").length === 0) {
    issues.error(
      "OPF_MISSING_LANGUAGE",
      "The package has no dc:language.",
      opfPath,
    );
  }
  const identifiers = named("identifier");
  if (identifiers.length === 0) {
    issues.error(
      "OPF_MISSING_IDENTIFIER",
      "The package has no dc:identifier.",
      opfPath,
    );
  } else {
    const uniqueId = packageElement.attributes["unique-identifier"];
    if (
      !uniqueId ||
      !identifiers.some((element) => element.attributes.id === uniqueId)
    ) {
      issues.error(
        "OPF_UNIQUE_IDENTIFIER",
        `unique-identifier "${uniqueId ?? ""}" does not match the id of a dc:identifier.`,
        opfPath,
      );
    }
  }
  const metas = all.filter((element) => element.name === "meta");
  const modified = metas.find(
    (element) => element.attributes.property === "dcterms:modified",
  );
  if (!modified) {
    issues.error(
      "OPF_MISSING_MODIFIED",
      "The package has no dcterms:modified.",
      opfPath,
    );
  } else if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(textContent(modified).trim())
  ) {
    issues.error(
      "OPF_MODIFIED_FORMAT",
      "dcterms:modified must have the form YYYY-MM-DDThh:mm:ssZ.",
      opfPath,
    );
  }
  const fixedLayout =
    metas.some(
      (element) =>
        element.attributes.property === "rendition:layout" &&
        textContent(element).trim() === "pre-paginated",
    ) ||
    all.some(
      (element) =>
        localName(element.name) === "itemref" &&
        hasToken(
          element.attributes.properties,
          "rendition:layout-pre-paginated",
        ),
    );
  if (fixedLayout) {
    issues.error(
      "FIXED_LAYOUT",
      "The book is fixed layout (rendition:layout pre-paginated); this workflow produces reflowable eBooks.",
      opfPath,
    );
  }

  const manifestIds = new Set<string>();
  const manifestPaths = new Set<string>();
  const navItems: string[] = [];
  for (const item of all.filter(
    (element) => localName(element.name) === "item",
  )) {
    const { id, href } = item.attributes;
    const mediaType = item.attributes["media-type"] ?? "";
    if (id) {
      if (manifestIds.has(id)) {
        issues.error(
          "MANIFEST_DUPLICATE_ID",
          `Manifest id "${id}" is used twice.`,
          opfPath,
        );
      }
      manifestIds.add(id);
    }
    if (!href) continue;
    const target = resolveHref(opfPath, href);
    if (!target) continue;
    manifestPaths.add(target.path);
    if (!files.has(target.path)) {
      issues.error(
        "MANIFEST_FILE_MISSING",
        `Manifest item "${href}" does not exist in the container.`,
        opfPath,
      );
    }
    if (hasToken(item.attributes.properties, "nav")) navItems.push(target.path);
    if (fontMediaTypes.test(mediaType) || fontExtensions.test(href)) {
      issues.warn(
        "FONT_EMBEDDED",
        `"${href}" is an embedded font; Kindle recommends its default fonts unless a font carries meaning.`,
        opfPath,
      );
    }
  }

  const spine = all.find((element) => localName(element.name) === "spine");
  const itemrefs = all.filter(
    (element) => localName(element.name) === "itemref",
  );
  if (!spine || itemrefs.length === 0) {
    issues.error(
      "SPINE_EMPTY",
      "The spine lists no content documents.",
      opfPath,
    );
  }
  const toc = spine?.attributes.toc;
  if (toc && !manifestIds.has(toc)) {
    issues.error(
      "SPINE_IDREF_UNKNOWN",
      `The spine toc "${toc}" is not a manifest id.`,
      opfPath,
    );
  }
  for (const itemref of itemrefs) {
    const idref = itemref.attributes.idref ?? "";
    if (!manifestIds.has(idref)) {
      issues.error(
        "SPINE_IDREF_UNKNOWN",
        `Spine itemref "${idref}" is not a manifest id.`,
        opfPath,
      );
    }
  }

  for (const path of files.keys()) {
    if (
      path.endsWith("/") ||
      path === "mimetype" ||
      path.startsWith("META-INF/") ||
      path === opfPath ||
      manifestPaths.has(path)
    ) {
      continue;
    }
    issues.warn(
      "FILE_NOT_IN_MANIFEST",
      "The file is not listed in the manifest.",
      path,
    );
  }

  if (navItems.length === 0) {
    issues.error(
      "NAV_MISSING",
      'No manifest item has properties="nav".',
      opfPath,
    );
    return null;
  }
  if (navItems.length > 1) {
    issues.error(
      "NAV_MULTIPLE",
      'More than one manifest item has properties="nav".',
      opfPath,
    );
    return null;
  }
  return navItems[0] ?? null;
}

function checkContentDocument(
  path: string,
  roots: XmlElement[],
  ids: Map<string, Set<string>>,
  links: Link[],
  issues: Collector,
): void {
  const documentIds = new Set<string>();
  ids.set(path, documentIds);
  for (const element of descendants(roots)) {
    const name = localName(element.name).toLowerCase();
    const { attributes } = element;
    if (attributes.id) documentIds.add(attributes.id);
    for (const key of ["href", "src", "xlink:href"]) {
      const href = attributes[key];
      if (href !== undefined) links.push({ from: path, href });
    }
    if (name === "script") {
      issues.error(
        "SCRIPT_FOUND",
        "Scripts are not allowed; Kindle strips them.",
        path,
      );
    }
    if (["form", "input", "button", "select", "textarea"].includes(name)) {
      issues.error(
        "FORM_FOUND",
        `Forms are not supported on Kindle (<${name}>).`,
        path,
      );
    }
    if (name === "img" && attributes.alt === undefined) {
      issues.warn(
        "IMAGE_ALT_MISSING",
        `Image "${attributes.src ?? ""}" has no alt text.`,
        path,
      );
    }
    if (attributes.style) checkCss(`x{${attributes.style}}`, path, issues);
    if (name === "style") checkCss(textContent(element), path, issues);
    if (hasToken(attributes["epub:type"], "toc") && name !== "nav") {
      checkTocText(element, path, issues);
    }
  }
}

function checkNcx(
  path: string,
  roots: XmlElement[],
  links: Link[],
  issues: Collector,
): void {
  for (const element of descendants(roots)) {
    const name = localName(element.name);
    if (name === "content" && element.attributes.src) {
      links.push({ from: path, href: element.attributes.src });
    }
    if (
      name === "navLabel" &&
      pageNumberText.test(textContent(element).trim())
    ) {
      issues.warn(
        "TOC_PAGE_NUMBERS",
        `TOC entry "${textContent(element).trim()}" looks like it contains a page number.`,
        path,
      );
    }
  }
}

/** Returns the number of entries in the `toc` nav. */
function checkNavDocument(
  path: string,
  roots: XmlElement[],
  issues: Collector,
): number {
  const tocNav = descendants(roots).find(
    (element) =>
      localName(element.name) === "nav" &&
      hasToken(element.attributes["epub:type"], "toc"),
  );
  if (!tocNav) {
    issues.error(
      "NAV_TOC_MISSING",
      "The navigation document has no toc nav.",
      path,
    );
    return 0;
  }
  const entries = checkTocText(tocNav, path, issues);
  if (entries === 0) {
    issues.error("NAV_TOC_EMPTY", "The toc nav has no links.", path);
  }
  return entries;
}

function checkTocText(
  toc: XmlElement,
  path: string,
  issues: Collector,
): number {
  const anchors = descendants([toc]).filter(
    (element) => localName(element.name) === "a" && element.attributes.href,
  );
  for (const anchor of anchors) {
    const label = textContent(anchor).trim();
    if (pageNumberText.test(label)) {
      issues.warn(
        "TOC_PAGE_NUMBERS",
        `TOC entry "${label}" looks like it contains a page number; Kindle TOCs must not.`,
        path,
      );
    }
  }
  return anchors.length;
}

function checkCss(css: string, path: string, issues: Collector): void {
  const code = css.replace(/\/\*[\s\S]*?\*\//g, "");
  if (/position\s*:\s*(?:fixed|absolute)/i.test(code)) {
    issues.warn(
      "CSS_POSITIONING",
      "position: fixed/absolute does not work in reflowable Kindle books.",
      path,
    );
  }
  if (/margin(?:-[a-z-]+)?\s*:[^;{}]*?(?<![\w.-])-(?:\d|\.\d)/i.test(code)) {
    issues.warn(
      "CSS_NEGATIVE_MARGIN",
      "Negative margins can push text off screen on Kindle.",
      path,
    );
  }
  if (/@font-face/i.test(code)) {
    issues.warn(
      "FONT_EMBEDDED",
      "The stylesheet embeds fonts with @font-face.",
      path,
    );
  }
}

function checkLinks(
  links: Link[],
  files: Map<string, Uint8Array>,
  ids: Map<string, Set<string>>,
  parsed: Map<string, XmlElement[]>,
  issues: Collector,
): void {
  for (const link of links) {
    const target = resolveHref(link.from, link.href);
    if (!target) continue;
    if (!files.has(target.path)) {
      issues.error(
        "LINK_BROKEN",
        `"${link.href}" points to a file that does not exist.`,
        link.from,
      );
      continue;
    }
    if (!target.fragment) continue;
    const targetIds = ids.get(target.path);
    // Fragments are only checked in documents that parsed; a malformed target
    // is already an error of its own.
    if (!targetIds || !parsed.has(target.path)) continue;
    if (!targetIds.has(target.fragment)) {
      issues.error(
        "LINK_FRAGMENT_MISSING",
        `"${link.href}" points to an id that does not exist in ${target.path}.`,
        link.from,
      );
    }
  }
}

/** Resolves a relative reference to a container path; `null` for URLs. */
function resolveHref(
  fromPath: string,
  href: string,
): { path: string; fragment: string | null } | null {
  const trimmed = href.trim();
  if (absoluteUrl.test(trimmed)) return null;
  const hash = trimmed.indexOf("#");
  const pathPart =
    (hash >= 0 ? trimmed.slice(0, hash) : trimmed).split("?")[0] ?? "";
  const fragment = hash >= 0 ? safeDecode(trimmed.slice(hash + 1)) : null;
  if (!pathPart) return { path: fromPath, fragment };
  const slash = fromPath.lastIndexOf("/");
  const segments = pathPart.startsWith("/")
    ? []
    : fromPath.slice(0, Math.max(slash, 0)).split("/").filter(Boolean);
  for (const segment of safeDecode(pathPart).split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") segments.pop();
    else segments.push(segment);
  }
  return { path: segments.join("/"), fragment: fragment || null };
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
