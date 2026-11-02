// Reading a request body without letting the caller decide how much memory it costs.
//
// Checking the Content-Length header is not enough on its own: a request sent in chunks has none, and
// a client can state one number and send another. So the body is read as a stream and abandoned the
// moment it passes the limit, whatever the headers said. The header is still used, as a cheap early
// refusal before anything is read.

/** Room for the multipart envelope around an upload (boundaries, field names, the file's name). */
export const FORM_OVERHEAD_BYTES = 64 * 1024;

/** The body's bytes, or null when it is larger than `maxBytes`. */
export async function readBodyBytes(
  request: Request,
  maxBytes: number,
): Promise<Uint8Array<ArrayBuffer> | null> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  if (!request.body) return new Uint8Array(0);

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export type BodyResult<T> =
  { status: "ok"; value: T } | { status: "too-large" } | { status: "invalid" };

/** The body as text. */
export async function readTextBody(
  request: Request,
  maxBytes: number,
): Promise<BodyResult<string>> {
  const bytes = await readBodyBytes(request, maxBytes);
  if (!bytes) return { status: "too-large" };
  return { status: "ok", value: new TextDecoder().decode(bytes) };
}

/** The body parsed as JSON. */
export async function readJsonBody(
  request: Request,
  maxBytes: number,
): Promise<BodyResult<unknown>> {
  const text = await readTextBody(request, maxBytes);
  if (text.status !== "ok") return text;
  try {
    return { status: "ok", value: JSON.parse(text.value) as unknown };
  } catch {
    return { status: "invalid" };
  }
}

/** The body parsed as a multipart or URL-encoded form. `maxBytes` includes the form's envelope. */
export async function readFormBody(
  request: Request,
  maxBytes: number,
): Promise<BodyResult<FormData>> {
  const bytes = await readBodyBytes(request, maxBytes);
  if (!bytes) return { status: "too-large" };
  const contentType = request.headers.get("content-type");
  if (!contentType) return { status: "invalid" };
  try {
    // Re-wrapping the bytes in a Response is the standard way to parse them as a form.
    const form = await new Response(bytes, { headers: { "content-type": contentType } }).formData();
    return { status: "ok", value: form };
  } catch {
    return { status: "invalid" };
  }
}
