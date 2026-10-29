import { XMLParser, XMLValidator } from "fast-xml-parser";

// XML 1.0 forbids most control characters outright; one stray character from a
// model or a paste would make the whole file unreadable for every reader.
const invalidXmlChar = /[^\t\n\r\x20-퟿-�\u{10000}-\u{10FFFF}]/gu;

export function xmlText(text: string): string {
  return text
    .replace(invalidXmlChar, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function xmlAttr(text: string): string {
  return xmlText(text).replace(/"/g, "&quot;");
}

export type XmlElement = {
  name: string;
  attributes: Record<string, string>;
  children: XmlNode[];
};

export type XmlNode = XmlElement | string;

export type XmlProblem = { line: number; message: string };

export function checkWellFormed(text: string): XmlProblem | null {
  const result = XMLValidator.validate(text);
  return result === true
    ? null
    : { line: result.err.line, message: result.err.msg };
}

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: "",
  allowBooleanAttributes: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
  ignoreDeclaration: true,
  ignorePiTags: true,
  processEntities: true,
  htmlEntities: false,
});

/** Parses well-formed XML into a small element tree; check it first. */
export function parseXml(text: string): XmlElement[] {
  return convertNodes(parser.parse(text)).filter(isElement);
}

function convertNodes(raw: unknown): XmlNode[] {
  if (!Array.isArray(raw)) return [];
  const nodes: XmlNode[] = [];
  for (const item of raw as unknown[]) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    for (const [key, value] of Object.entries(record)) {
      if (key === ":@") continue;
      if (key === "#text") {
        nodes.push(decodeCharacterReferences(String(value)));
        continue;
      }
      nodes.push({
        name: key,
        attributes: convertAttributes(record[":@"]),
        children: convertNodes(value),
      });
    }
  }
  return nodes;
}

function convertAttributes(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object") return {};
  const attributes: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    attributes[key] =
      typeof value === "string" ? decodeCharacterReferences(value) : "";
  }
  return attributes;
}

// The parser resolves named entities but leaves numeric references as written.
function decodeCharacterReferences(text: string): string {
  return text.replace(/&#(x[0-9a-f]+|\d+);/gi, (match, code: string) => {
    const value =
      code[0] === "x" || code[0] === "X"
        ? Number.parseInt(code.slice(1), 16)
        : Number.parseInt(code, 10);
    try {
      return String.fromCodePoint(value);
    } catch {
      return match;
    }
  });
}

export function isElement(node: XmlNode): node is XmlElement {
  return typeof node !== "string";
}

export function localName(name: string): string {
  const colon = name.indexOf(":");
  return colon >= 0 ? name.slice(colon + 1) : name;
}

/** Every element below the given roots, in document order, roots included. */
export function descendants(roots: XmlElement[]): XmlElement[] {
  const found: XmlElement[] = [];
  const visit = (element: XmlElement) => {
    found.push(element);
    for (const child of element.children) {
      if (isElement(child)) visit(child);
    }
  };
  roots.forEach(visit);
  return found;
}

export function textContent(node: XmlNode): string {
  if (typeof node === "string") return node;
  return node.children.map(textContent).join("");
}

export function hasToken(value: string | undefined, token: string): boolean {
  return (value ?? "").split(/\s+/).includes(token);
}
