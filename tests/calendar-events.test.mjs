import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Calendar, dateFnsLocalizer } from "react-big-calendar";
import { format, parse, startOfWeek, getDay } from "date-fns";
import { es } from "date-fns/locale";

const source = await readFile(new URL("../src/lib/calendar-events.ts", import.meta.url), "utf8");
const javascript = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { evaluationDates, parseEvaluationDate, scheduledEvaluations } = await import(
  `data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`
);
const event = (id, value, selected = true) => ({
  id,
  title: id,
  selected,
  ...evaluationDates(value),
});

test("pending evaluations never receive a usable provisional date", () => {
  const pending = event("Práctica pendiente", "0000-00-00");
  assert.equal(pending.hasExactDate, false);
  assert.equal(Number.isNaN(pending.start.getTime()), true);
  assert.deepEqual(scheduledEvaluations([pending]), []);
});

test("placeholder dates remain excluded when an old record is marked pending", () => {
  const pending = { ...event("Práctica pendiente", "2026-10-13"), hasExactDate: false };
  assert.deepEqual(scheduledEvaluations([pending]), []);
});

test("manual date assignment makes an evaluation eligible and clearing it hides it", () => {
  let pending = event("PC1", "");
  assert.equal(scheduledEvaluations([pending]).length, 0);
  pending = { ...pending, ...evaluationDates("2026-11-12") };
  assert.equal(scheduledEvaluations([pending]).length, 1);
  pending = { ...pending, ...evaluationDates("") };
  assert.equal(scheduledEvaluations([pending]).length, 0);
});

test("invalid calendar days cannot become events", () => {
  for (const value of ["2026-02-30", "2026-13-01", "0000-00-00", "", "not-a-date"]) {
    assert.equal(parseEvaluationDate(value), null);
  }
  assert.notEqual(parseEvaluationDate("2028-02-29"), null);
});

test("only selected valid events are eligible, in chronological order", () => {
  const final = event("Final", "2026-12-09");
  const partial = event("Parcial", "2026-10-14");
  const pending = event("Pendiente", "");
  const unselected = event("No seleccionada", "2026-09-01", false);
  const invalid = { ...partial, id: "Fecha inválida", end: new Date(NaN) };
  assert.deepEqual(
    scheduledEvaluations([final, pending, unselected, invalid, partial]).map((e) => e.id),
    ["Parcial", "Final"],
  );
});

const localizer = dateFnsLocalizer({ format, parse, startOfWeek, getDay, locales: { es } });
const renderCalendar = (view, events) =>
  renderToStaticMarkup(
    React.createElement(Calendar, {
      localizer,
      view,
      views: ["month", "agenda"],
      date: new Date(2026, 9, 1),
      onView: () => {},
      onNavigate: () => {},
      culture: "es",
      length: 150,
      events: scheduledEvaluations(events),
    }),
  );

test("controlled month and agenda views render without pending practices", () => {
  const events = [event("Parcial visible", "2026-10-14"), event("Práctica pendiente", "")];
  const month = renderCalendar("month", events);
  const agenda = renderCalendar("agenda", events);
  assert.match(month, /rbc-month-view/);
  assert.match(agenda, /rbc-agenda-view/);
  // Month lays out its event rows after measuring the browser; SSR only renders its grid.
  assert.match(agenda, /Parcial visible/);
  assert.doesNotMatch(month, /Práctica pendiente/);
  assert.doesNotMatch(agenda, /Práctica pendiente/);
});
