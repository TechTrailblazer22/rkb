import { describe, expect, it } from "vitest";
import { jsonLd } from "@/lib/seo/json-ld";

const LINE_SEPARATOR = String.fromCharCode(0x2028);
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029);

describe("jsonLd", () => {
  it("never lets text close the script tag", () => {
    const out = jsonLd({ name: "Evil </script><script>alert(1)</script>" });
    expect(out).not.toContain("<");
    expect(out).not.toContain("</script>");
  });

  it("round-trips to exactly the original data", () => {
    const data = {
      name: "A </script> & <b>",
      n: 5,
      nested: [{ line: `x${LINE_SEPARATOR}y${PARAGRAPH_SEPARATOR}z` }],
    };
    expect(JSON.parse(jsonLd(data))).toEqual(data);
  });

  it("escapes the line separators that older parsers choke on", () => {
    const out = jsonLd({ s: `a${LINE_SEPARATOR}b${PARAGRAPH_SEPARATOR}c` });
    expect(out).not.toContain(LINE_SEPARATOR);
    expect(out).not.toContain(PARAGRAPH_SEPARATOR);
  });

  it("leaves ordinary text alone", () => {
    expect(jsonLd({ a: "Green Valley" })).toBe('{"a":"Green Valley"}');
  });
});
