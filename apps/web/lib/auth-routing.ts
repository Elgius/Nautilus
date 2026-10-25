// Only known application destinations are allowed after login.
export function safeReturnTo(value: string | null | undefined) {
  if (
    !value ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\")
  )
    return "/";
  try {
    const url = new URL(value, "https://nautilus.invalid");
    if (url.origin !== "https://nautilus.invalid") return "/";
    if (
      !["/", "/dashboard", "/organizations", "/accept-invitation"].includes(
        url.pathname,
      ) &&
      !/^\/room-id=[\w%-]+$/.test(url.pathname)
    )
      return "/";
    return url.pathname + url.search;
  } catch {
    return "/";
  }
}

export function invitationPath(id: string) {
  return `/accept-invitation?${new URLSearchParams({ invitationId: id })}`;
}

export function loginPath(invitationId?: string | null) {
  return invitationId
    ? `/login?${new URLSearchParams({ invitationId })}`
    : "/login";
}
