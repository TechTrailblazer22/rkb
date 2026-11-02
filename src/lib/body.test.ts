import { describe, expect, it } from "vitest";
import { readBodyBytes, readFormBody, readJsonBody, readTextBody } from "@/lib/body";

const post = (body: BodyInit | null, headers: Record<string, string> = {}) =>
  new Request("http://localhost/x", { method: "POST", body, headers });

/** A body sent in chunks, so the request carries no Content-Length header at all. */
function chunked(chunks: string[], headers: Record<string, string> = {}) {
  const encoder = new TextEncoder();
  let sent = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent < chunks.length) controller.enqueue(encoder.encode(chunks[sent++]));
      else controller.close();
    },
  });
  return new Request("http://localhost/x", {
    method: "POST",
    body: stream,
    headers,
    // Node's fetch requires this for a streamed body.
    duplex: "half",
  } as RequestInit);
}

describe("readBodyBytes", () => {
  it("returns the body when it is within the limit", async () => {
    const bytes = await readBodyBytes(post("hello"), 10);
    expect(new TextDecoder().decode(bytes!)).toBe("hello");
  });
  it("accepts a body of exactly the limit", async () => {
    expect(await readBodyBytes(post("12345"), 5)).not.toBeNull();
  });
  it("refuses a body one byte over the limit", async () => {
    expect(await readBodyBytes(post("123456"), 5)).toBeNull();
  });
  it("refuses an oversized body that carries no Content-Length (sent in chunks)", async () => {
    const request = chunked(["aaaa", "bbbb", "cccc"]);
    expect(request.headers.get("content-length")).toBeNull();
    expect(await readBodyBytes(request, 10)).toBeNull();
  });
  it("accepts a small chunked body", async () => {
    const bytes = await readBodyBytes(chunked(["ab", "cd"]), 10);
    expect(new TextDecoder().decode(bytes!)).toBe("abcd");
  });
  it("refuses at once when the declared length is already too big", async () => {
    const request = post("tiny", { "content-length": "999999" });
    expect(await readBodyBytes(request, 100)).toBeNull();
  });
  it("is not fooled by a declared length smaller than what is sent", async () => {
    // The header understates the size; the stream itself is what is counted.
    const request = chunked(["x".repeat(50), "y".repeat(50)], { "content-length": "5" });
    expect(await readBodyBytes(request, 20)).toBeNull();
  });
  it("treats a missing body as empty", async () => {
    const bytes = await readBodyBytes(new Request("http://localhost/x", { method: "POST" }), 10);
    expect(bytes).toHaveLength(0);
  });
  it("ignores a Content-Length that is not a number", async () => {
    expect(await readBodyBytes(post("ok", { "content-length": "abc" }), 10)).not.toBeNull();
  });
});

describe("readTextBody and readJsonBody", () => {
  it("reads text", async () => {
    expect(await readTextBody(post("raw text"), 100)).toEqual({ status: "ok", value: "raw text" });
  });
  it("reports too-large for text", async () => {
    expect(await readTextBody(post("x".repeat(20)), 10)).toEqual({ status: "too-large" });
  });
  it("parses JSON", async () => {
    expect(await readJsonBody(post('{"a":1}'), 100)).toEqual({ status: "ok", value: { a: 1 } });
  });
  it("tells invalid JSON from too-large JSON", async () => {
    expect(await readJsonBody(post("{not json"), 100)).toEqual({ status: "invalid" });
    expect(await readJsonBody(post(JSON.stringify({ a: "x".repeat(50) })), 10)).toEqual({
      status: "too-large",
    });
  });
});

describe("readFormBody", () => {
  it("parses a multipart form, file included", async () => {
    const form = new FormData();
    form.set("kind", "LOGO");
    form.set("file", new File(["abc"], "logo.png", { type: "image/png" }));
    // Let the runtime build the multipart body and its boundary header.
    const source = new Request("http://localhost/x", { method: "POST", body: form });
    const request = post(await source.arrayBuffer(), {
      "content-type": source.headers.get("content-type")!,
    });

    const result = await readFormBody(request, 64 * 1024);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.value.get("kind")).toBe("LOGO");
    const file = result.value.get("file") as File;
    expect(file.name).toBe("logo.png");
    expect(file.size).toBe(3);
  });
  it("refuses a form over the limit", async () => {
    const form = new FormData();
    form.set("file", new File(["x".repeat(5000)], "big.bin"));
    const source = new Request("http://localhost/x", { method: "POST", body: form });
    const request = post(await source.arrayBuffer(), {
      "content-type": source.headers.get("content-type")!,
    });
    expect(await readFormBody(request, 1000)).toEqual({ status: "too-large" });
  });
  it("calls a body with no content type invalid", async () => {
    expect(await readFormBody(post("a=b"), 100)).toMatchObject({ status: "invalid" });
  });
  it("calls a malformed multipart body invalid", async () => {
    const request = post("not multipart at all", {
      "content-type": "multipart/form-data; boundary=zzz",
    });
    expect(await readFormBody(request, 1000)).toEqual({ status: "invalid" });
  });
});
