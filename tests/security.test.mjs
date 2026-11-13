import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function load(path) {
  const source = (await readFile(new URL(path, import.meta.url), "utf8")).replaceAll(
    "import.meta.env.DEV",
    "false",
  );
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
}
const { escapeIcsText, foldIcsLine } = await load("../src/lib/ics-security.ts");
const { securityHeaders, secureResponse } = await load("../src/lib/security-headers.ts");
const { calendarAccessToken, rememberCalendarAccess, clearCalendarAccess } = await load(
  "../src/lib/calendar-auth.ts",
);

test("calendar text cannot inject events or calendar properties through CRLF", () => {
  const payload = "Examen\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nATTENDEE:attacker@example.com";
  const line = "SUMMARY:" + escapeIcsText(payload);
  assert.equal(line.split(/\r?\n/).length, 1);
  assert.match(line, /\\nEND:VEVENT\\nBEGIN:VEVENT/);
  assert.equal(escapeIcsText("A;B,C\\D"), "A\\;B\\,C\\\\D");
});

test("ICS folding respects 75 UTF-8 octets without changing text", () => {
  const original = "SUMMARY:" + "Evaluación áéíóú 🎓 ".repeat(40);
  const folded = foldIcsLine(original);
  assert.ok(folded.split("\r\n").every((line) => Buffer.byteLength(line, "utf8") <= 75));
  assert.equal(folded.replace(/\r\n /g, ""), original);
});

test("static and SSR security policies agree and prohibit embedding/plugins", async () => {
  const config = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));
  const staticHeaders = Object.fromEntries(
    config.headers[0].headers.map(({ key, value }) => [key, value]),
  );
  assert.deepEqual(staticHeaders, securityHeaders);
  assert.match(securityHeaders["Content-Security-Policy"], /frame-ancestors 'none'/);
  assert.match(securityHeaders["Content-Security-Policy"], /object-src 'none'/);
  assert.doesNotMatch(securityHeaders["Content-Security-Policy"], /unsafe-eval/);
  const response = secureResponse(
    new Response("body", { status: 429, headers: { "Retry-After": "60" } }),
  );
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("Retry-After"), "60");
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(await response.text(), "body");
});

test("Calendar OAuth grants expire and are cleared on logout", (t) => {
  let now = 1000;
  t.mock.method(Date, "now", () => now);
  rememberCalendarAccess("test-user", "test-access-token");
  assert.equal(calendarAccessToken("test-user"), "test-access-token");
  assert.equal(calendarAccessToken("other-user"), undefined);
  now += 51 * 60 * 1000;
  assert.equal(calendarAccessToken("test-user"), undefined);
  rememberCalendarAccess("test-user", "test-access-token");
  clearCalendarAccess();
  assert.equal(calendarAccessToken("test-user"), undefined);
});
