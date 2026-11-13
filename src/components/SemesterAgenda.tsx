import React from "react";
import type { ViewProps } from "react-big-calendar";

interface AgendaEntry {
  title: string;
  start: Date;
  end: Date;
}

const dayFormat = new Intl.DateTimeFormat("es-PE", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});
const timeFormat = new Intl.DateTimeFormat("es-PE", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

// This view iterates over the evaluations, not over a date range.
export function SemesterAgenda({ events = [], getters }: ViewProps<AgendaEntry>) {
  const ordered = events
    .filter(
      (event) => Number.isFinite(event.start.getTime()) && Number.isFinite(event.end.getTime()),
    )
    .slice()
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  if (ordered.length === 0) {
    return (
      <div className="rbc-agenda-view">
        <p className="text-sm text-muted-foreground py-3">
          No hay evaluaciones con fecha para mostrar.
        </p>
      </div>
    );
  }
  return (
    <div className="rbc-agenda-view min-h-0" aria-label="Todas las evaluaciones con fecha">
      <div className="rbc-agenda-content">
        <table className="rbc-agenda-table">
          <thead className="sticky top-0 bg-card z-10">
            <tr>
              <th scope="col" className="rbc-header">
                Fecha
              </th>
              <th scope="col" className="rbc-header">
                Hora
              </th>
              <th scope="col" className="rbc-header">
                Evaluación
              </th>
            </tr>
          </thead>
          <tbody>
            {ordered.map((event, index) => (
              <tr key={index} style={getters.eventProp(event, event.start, event.end, false).style}>
                <td className="rbc-agenda-date-cell whitespace-nowrap">
                  {dayFormat.format(event.start)}
                </td>
                <td className="rbc-agenda-time-cell whitespace-nowrap">
                  {timeFormat.format(event.start)} – {timeFormat.format(event.end)}
                </td>
                <td className="rbc-agenda-event-cell">{event.title}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

SemesterAgenda.title = () => "Todas las evaluaciones";
SemesterAgenda.navigate = (date: Date) => date;
SemesterAgenda.range = (date: Date) => ({ start: date, end: date });
