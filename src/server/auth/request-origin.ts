/** Reject cross-origin cookie-authenticated mutations, including sibling subdomains. */
export function acceptsSameOriginMutation(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin || origin.includes(",") || origin.trim() !== origin || origin === "null") return false;
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") return false;
  try {
    const supplied = new URL(origin);
    return (supplied.protocol === "https:" || supplied.protocol === "http:") &&
      supplied.origin === new URL(request.url).origin &&
      supplied.pathname === "/" && !supplied.search && !supplied.hash &&
      !supplied.username && !supplied.password &&
      supplied.origin === origin;
  } catch {
    return false;
  }
}
