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
const { evaluationDates, parseEvaluationDate, scheduledEvaluations, monthNavigationDate } =
  await import(`data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`);
const agendaSource = await readFile(
  new URL("../src/components/SemesterAgenda.tsx", import.meta.url),
  "utf8",
);
const agendaJavascript = ts
  .transpileModule(agendaSource, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.React,
    },
  })
  .outputText.replace('from "react"', `from ${JSON.stringify(import.meta.resolve("react"))}`);
const { SemesterAgenda } = await import(
  `data:text/javascript;base64,${Buffer.from(agendaJavascript).toString("base64")}`
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
const renderCalendar = (view, events, date = new Date(2026, 9, 1)) =>
  renderToStaticMarkup(
    React.createElement(Calendar, {
      localizer,
      view,
      views: { month: true, agenda: SemesterAgenda },
      date,
      onView: () => {},
      onNavigate: () => {},
      culture: "es",
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

test("agenda includes all selected dated evaluations regardless of the displayed month or year", () => {
  const events = [
    event("Final lejano", "2029-12-10"),
    event("Parcial anterior", "2026-10-15"),
    event("PC2 intermedia", "2027-11-12"),
    event("Pendiente", ""),
    event("No seleccionada", "2028-01-01", false),
  ];
  const agenda = renderCalendar("agenda", events, new Date(2035, 6, 1));
  assert.match(agenda, /Todas las evaluaciones/);
  assert.match(agenda, /Parcial anterior/);
  assert.match(agenda, /PC2 intermedia/);
  assert.match(agenda, /Final lejano/);
  assert.doesNotMatch(agenda, /Pendiente|No seleccionada|2035/);
  assert.ok(agenda.indexOf("Parcial anterior") < agenda.indexOf("PC2 intermedia"));
  assert.ok(agenda.indexOf("PC2 intermedia") < agenda.indexOf("Final lejano"));
});

test("Agenda toolbar has no rolling date-range label", () => {
  const agenda = renderCalendar("agenda", [event("Final", "2026-12-10")]);
  assert.match(agenda, /rbc-toolbar-label">Todas las evaluaciones</);
});

test("previous and next navigation move a calendar month instead of an agenda range", () => {
  const current = new Date(2026, 9, 31);
  const next = monthNavigationDate(current, "NEXT", new Date(2027, 4, 1));
  const previous = monthNavigationDate(current, "PREV", new Date(2026, 4, 1));
  assert.deepEqual([next.getFullYear(), next.getMonth(), next.getDate()], [2026, 10, 1]);
  assert.deepEqual([previous.getFullYear(), previous.getMonth(), previous.getDate()], [2026, 8, 1]);
  const newYear = monthNavigationDate(new Date(2026, 11, 31), "NEXT");
  assert.deepEqual([newYear.getFullYear(), newYear.getMonth()], [2027, 0]);
});

test("today and direct month navigation retain their intended dates", () => {
  const current = new Date(2026, 9, 15);
  const today = new Date(2026, 10, 12);
  assert.equal(monthNavigationDate(current, "TODAY", current, today), today);
  const chosen = new Date(2026, 11, 9);
  assert.equal(monthNavigationDate(current, "DATE", chosen), chosen);
});
