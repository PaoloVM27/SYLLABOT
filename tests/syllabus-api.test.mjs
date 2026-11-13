import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
// Supply Vite's environment boundary; exercise the real browser API module.
const source = (
  await readFile(new URL("../src/lib/syllabus-api.ts", import.meta.url), "utf8")
).replaceAll("import.meta.env", "({})");
const javascript = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
let sequence = 0;
async function api() {
  return import(
    `data:text/javascript;base64,${Buffer.from(javascript + `\n// ${sequence++}`).toString("base64")}`
  );
}
const file = () => new File(["%PDF-1.4"], "silabo.pdf", { type: "application/pdf" });
const result = {
  curso: "Física",
  evaluaciones: [{ nombre: "Examen Parcial", semana: 8, fecha: "2026-10-14", peso: 20 }],
};
function streamResponse(events, chunkSize = 7) {
  const bytes = new TextEncoder().encode(
    events.map((event) => JSON.stringify(event)).join("\n") + "\n",
  );
  return new Response(
    new ReadableStream({
      start(controller) {
        for (let i = 0; i < bytes.length; i += chunkSize)
          controller.enqueue(bytes.slice(i, i + chunkSize));
        controller.close();
      },
    }),
    { headers: { "Content-Type": "application/x-ndjson" } },
  );
}
test("missing health route does not prevent uploading to an older JSON backend", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push([url, options]);
    return url.endsWith("/health")
      ? new Response("not found", { status: 404 })
      : Response.json(result);
  });
  const module = await api();
  await module.prepareSyllabusService();
  const updates = [];
  assert.deepEqual(
    await module.uploadSyllabus(
      file(),
      new AbortController().signal,
      (p) => updates.push(p),
      "test-id-token",
    ),
    result,
  );
  assert.equal(calls[1][0], "http://localhost:8000/upload");
  assert.equal(calls[1][1].method, "POST");
  assert.equal(calls[1][1].headers.Authorization, "Bearer test-id-token");
  assert.deepEqual(updates, []); // No invented stages from an older server.
});
test("a stalled warm-up does not gate the upload request", async (t) => {
  t.mock.method(globalThis, "fetch", async (url) =>
    url.endsWith("/health") ? new Promise(() => {}) : Response.json(result),
  );
  const module = await api();
  void module.prepareSyllabusService();
  assert.deepEqual(
    await module.uploadSyllabus(file(), new AbortController().signal, () => {}, "test-id-token"),
    result,
  );
});
test("reads confirmed progress and UTF-8 results across arbitrary chunk boundaries", async (t) => {
  const events = [
    { type: "progress", percent: 5, message: "PDF recibido" },
    { type: "progress", percent: 65, message: "Página leída" },
    { type: "progress", percent: 75, message: "Consultando a Gemini" },
    { type: "progress", percent: 95, message: "Evaluaciones listas" },
    { type: "result", data: result },
  ];
  t.mock.method(globalThis, "fetch", async () => streamResponse(events, 1));
  const module = await api();
  const updates = [];
  assert.deepEqual(
    await module.uploadSyllabus(
      file(),
      new AbortController().signal,
      (p) => updates.push(p),
      "test-id-token",
    ),
    result,
  );
  assert.deepEqual(
    updates.map((p) => p.percent),
    [5, 65, 75, 95],
  );
  assert.equal(updates[1].message, "Página leída");
});
test("does not report success when the stream ends before its result", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    streamResponse([{ type: "progress", percent: 75, message: "Consultando" }]),
  );
  const module = await api();
  await assert.rejects(
    module.uploadSyllabus(file(), new AbortController().signal, () => {}, "test-id-token"),
    /interrumpió/,
  );
});
test("displays PDF processing errors sent through the stream", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    streamResponse([{ type: "error", detail: "El PDF necesita OCR." }]),
  );
  const module = await api();
  await assert.rejects(
    module.uploadSyllabus(file(), new AbortController().signal, () => {}, "test-id-token"),
    /necesita OCR/,
  );
});
test("handles proxy errors without exposing an HTML error page", async (t) => {
  t.mock.method(
    globalThis,
    "fetch",
    async () => new Response("<html>Bad gateway</html>", { status: 502 }),
  );
  const module = await api();
  await assert.rejects(
    module.uploadSyllabus(file(), new AbortController().signal, () => {}, "test-id-token"),
    /error 502/,
  );
});
