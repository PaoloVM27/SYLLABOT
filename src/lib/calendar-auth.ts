// OAuth access tokens are short-lived and stay in memory, never in browser storage.
const grants = new Map<string, { token: string; expiresAt: number }>();

export function calendarAccessToken(uid: string): string | undefined {
  const grant = grants.get(uid);
  if (!grant || grant.expiresAt <= Date.now()) {
    grants.delete(uid);
    return undefined;
  }
  return grant.token;
}

export function rememberCalendarAccess(uid: string, token: string) {
  grants.set(uid, { token, expiresAt: Date.now() + 50 * 60 * 1000 });
}

export function clearCalendarAccess() {
  grants.clear();
  // Remove tokens left behind by previous versions.
  if (typeof window !== "undefined") {
    try {
      for (const key of Object.keys(sessionStorage)) {
        if (key === "googleCalendarToken" || key.startsWith("gcal_token_"))
          sessionStorage.removeItem(key);
      }
    } catch {
      /* Storage can be blocked by the browser's privacy settings. */
    }
  }
}
