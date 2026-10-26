const BACKSLASH = String.fromCharCode(92);

// "<" could close the script tag; the two line separators break older JavaScript parsers.
const UNSAFE = new RegExp(`[${String.fromCharCode(0x3c, 0x2028, 0x2029)}]`, "g");

/** A character as a JSON escape sequence, for example "<" becomes backslash, u, 0, 0, 3, c. */
const asEscape = (char: string) =>
  `${BACKSLASH}u${char.charCodeAt(0).toString(16).padStart(4, "0")}`;

/**
 * JSON for a <script type="application/ld+json"> tag. Text from a builder (a project name or
 * description) can then never close the script tag and inject markup. The result is still valid
 * JSON that parses back to exactly the same data.
 */
export function jsonLd(data: unknown): string {
  return JSON.stringify(data).replace(UNSAFE, asEscape);
}
