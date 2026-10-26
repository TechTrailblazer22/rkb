// Live check of file storage. Run it once after setting CLOUDINARY_URL to prove that uploads,
// short-lived private links and public images all work, and that private files really are private.
//
//   npm run storage:check
//
// With no CLOUDINARY_URL it checks the local development driver instead.
import "dotenv/config";
import { v2 as cloudinary } from "cloudinary";
import { getStorage } from "../src/lib/storage";

/** A valid one-page PDF. Cloudinary checks PDFs properly, so a stub file would be refused. */
function onePagePdf(): Buffer {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>",
  ];
  const NL = String.fromCharCode(10);
  let out = "%PDF-1.4" + NL;
  const offsets = objects.map((body, i) => {
    const at = out.length;
    out += `${i + 1} 0 obj${NL}${body}${NL}endobj${NL}`;
    return at;
  });
  const xref = out.length;
  out += `xref${NL}0 ${objects.length + 1}${NL}0000000000 65535 f ${NL}`;
  for (const at of offsets) out += `${String(at).padStart(10, "0")} 00000 n ${NL}`;
  out += `trailer${NL}<< /Size ${objects.length + 1} /Root 1 0 R >>${NL}startxref${NL}${xref}${NL}%%EOF${NL}`;
  return Buffer.from(out);
}
const PDF = onePagePdf();
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

let failed = 0;
function report(ok: boolean, message: string, hint = "") {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${message}${ok || !hint ? "" : `\n      ${hint}`}`);
}

const storage = getStorage();
console.log(`Storage driver: ${storage.name}\n`);
const stamp = Date.now().toString(36);
const privateKey = `builders/check${stamp}/docs/pan-check${stamp}.pdf`;
const publicKey = `builders/check${stamp}/public/logo-check${stamp}.png`;

try {
  await storage.put({
    key: privateKey,
    data: PDF,
    contentType: "application/pdf",
    visibility: "private",
  });
  report(true, "uploaded a private PDF");

  const read = await storage.read(privateKey, "private", 120);
  if (read.kind === "redirect") {
    const response = await fetch(read.url);
    const body = Buffer.from(await response.arrayBuffer());
    report(
      response.ok && body.subarray(0, 5).toString() === "%PDF-",
      "the signed private link downloads the PDF",
      `Got HTTP ${response.status}. In Cloudinary: Settings > Security > enable "PDF and ZIP files delivery".`,
    );

    // The same file must NOT be reachable through an ordinary public URL.
    const cloud = cloudinary.config().cloud_name;
    const publicTry = await fetch(
      `https://res.cloudinary.com/${cloud}/image/upload/${privateKey.replace(/\.pdf$/, "")}.pdf`,
    );
    report(
      !publicTry.ok,
      "the private file is NOT reachable by a plain public URL",
      `Got HTTP ${publicTry.status}.`,
    );
  } else {
    report(read.data.subarray(0, 5).toString() === "%PDF-", "read the PDF back from local disk");
  }

  await storage.put({ key: publicKey, data: PNG, contentType: "image/png", visibility: "public" });
  const imageUrl = storage.publicUrl(publicKey);
  report(true, `uploaded a public image (${imageUrl})`);
  if (storage.name === "cloudinary") {
    const response = await fetch(imageUrl);
    report(
      response.ok && (response.headers.get("content-type") ?? "").startsWith("image/"),
      "the public image loads",
    );
  }
} catch (error) {
  report(
    false,
    "storage operation threw",
    error instanceof Error ? error.message : JSON.stringify(error),
  );
} finally {
  await storage.remove(privateKey, "private").catch(() => {});
  await storage.remove(publicKey, "public").catch(() => {});
  console.log("\nCleaned up the test files.");
}

console.log(failed === 0 ? "\nStorage is working." : `\n${failed} check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
