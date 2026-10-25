const ID = /^[A-Za-z0-9_-]{11}$/;

/** The 11 character video id from a YouTube link, or null. Accepts watch, youtu.be, shorts, embed. */
export function parseYouTubeId(input: string): string | null {
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\.|^m\./, "").toLowerCase();

  let id: string | null = null;
  if (host === "youtu.be") {
    id = url.pathname.split("/")[1] ?? null;
  } else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    if (url.pathname === "/watch") id = url.searchParams.get("v");
    else {
      const [, kind, value] = url.pathname.split("/");
      if (kind === "shorts" || kind === "embed" || kind === "live") id = value ?? null;
    }
  }
  return id && ID.test(id) ? id : null;
}

export function youTubeWatchUrl(id: string): string {
  return `https://www.youtube.com/watch?v=${id}`;
}

/** Privacy-friendly embed address (no tracking cookies until the video is played). */
export function youTubeEmbedUrl(id: string): string {
  return `https://www.youtube-nocookie.com/embed/${id}`;
}
