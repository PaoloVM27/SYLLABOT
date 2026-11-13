export interface CalendarDates {
  hasExactDate: boolean;
  start: Date;
  end: Date;
}

export function parseEvaluationDate(value: string): Date | null {
  const normalized = value.replace(/\//g, "-");
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized);
  if (!match || Number(match[1]) === 0) return null;
  const date = new Date(`${normalized}T10:00:00`);
  if (
    !Number.isFinite(date.getTime()) ||
    date.getFullYear() !== Number(match[1]) ||
    date.getMonth() + 1 !== Number(match[2]) ||
    date.getDate() !== Number(match[3])
  )
    return null;
  return date;
}

export function evaluationDates(value: string): CalendarDates {
  const start = parseEvaluationDate(value);
  if (!start) {
    // An undated evaluation has no usable calendar position, even internally.
    return { hasExactDate: false, start: new Date(NaN), end: new Date(NaN) };
  }
  return { hasExactDate: true, start, end: new Date(start.getTime() + 2 * 60 * 60 * 1000) };
}

// The month, agenda, Google Calendar and .ics exports share this eligibility rule.
export function scheduledEvaluations<T extends CalendarDates & { selected: boolean }>(
  events: T[],
): T[] {
  return events
    .filter(
      (event) =>
        event.selected &&
        event.hasExactDate &&
        Number.isFinite(event.start.getTime()) &&
        Number.isFinite(event.end.getTime()) &&
        event.end.getTime() > event.start.getTime(),
    )
    .sort((a, b) => a.start.getTime() - b.start.getTime());
}
