"""Conservative Spanish syllabus extraction. No provider or web dependencies."""
from datetime import date, timedelta
import re
import unicodedata

UNKNOWN = "0000-00-00"
DAYS = {"lunes": 0, "martes": 1, "miercoles": 2, "jueves": 3,
        "viernes": 4, "sabado": 5, "domingo": 6}
MONTHS = {name: i for i, name in enumerate(("enero", "febrero", "marzo", "abril",
          "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"), 1)}
MONTHS["setiembre"] = 9
ROMANS = {"i": 1, "ii": 2, "iii": 3, "iv": 4, "v": 5, "vi": 6, "vii": 7,
          "viii": 8, "ix": 9, "x": 10, "xi": 11, "xii": 12, "xiii": 13,
          "xiv": 14, "xv": 15, "xvi": 16, "xvii": 17, "xviii": 18, "xix": 19, "xx": 20}
NUMBER = r"(?:\d{1,2}|[ivx]{1,5})"
ORDINALS = {"primera": 1, "segunda": 2, "tercera": 3, "cuarta": 4, "quinta": 5, "sexta": 6}
PRACTICE_NUMBER = r"(?:\s*(?:n[.°ºo]*\s*)?(?:\d{1,2}|[ivx]+)\b(?!\s*%))?"
DATE_RE = re.compile(
    r"\b(?:(?P<iso>20\d{2}-\d{1,2}-\d{1,2})|"
    r"(?P<d>\d{1,2})[/-](?P<m>\d{1,2})[/-](?P<y>20\d{2})|"
    r"(?P<day>\d{1,2})\s+de\s+(?P<month>" + "|".join(MONTHS) + r")\s+(?:de\s+)?(?P<year>20\d{2}))\b"
)
EVENT_RE = re.compile(
    r"\b(?:examen\s+(?:de\s+)?(?:medio\s+curso|parcial|final|sustitutorio|rezagados?)|"
    r"evaluacion\s+(?:parcial|final)|ep|ef|"
    r"(?:(?:primera|segunda|tercera|cuarta|quinta|sexta|\d+(?:ra|da|ta|a))\s+)?"
    r"practica\s+calificada" + PRACTICE_NUMBER + r"|pc" + PRACTICE_NUMBER + r"|"
    r"(?:(?:\d+(?:er|do|ro|to|mo|vo)?|primer|segundo|tercer)\s+)?"
    r"(?:entregable|avance)(?:\s+(?:de|del)\s+proyecto)?(?:\s*\d+)?|"
    r"(?:presentacion|sustentacion|entrega)\s+(?:final\s+)?(?:de|del)\s+proyecto(?:\s+final)?|"
    r"proyecto\s+final)\b"
)


def fold(text: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", text.lower()) if not unicodedata.combining(c))


def number(value: str) -> int:
    return int(value) if value.isdigit() else ROMANS.get(value, 0)


def dates(text: str) -> list[str]:
    result = []
    for match in DATE_RE.finditer(fold(text)):
        try:
            if match["iso"]:
                parsed = date.fromisoformat("-".join(f"{int(p):02d}" for p in match["iso"].split("-")))
            elif match["d"]:
                parsed = date(int(match["y"]), int(match["m"]), int(match["d"]))
            else:
                parsed = date(int(match["year"]), MONTHS[match["month"]], int(match["day"]))
            result.append(parsed.isoformat())
        except ValueError:
            continue
    return result


def single_date(text: str) -> str:
    found = dates(text)
    # Ranges are not individual exam dates (including 'del 10 al 16/09/2026').
    if len(found) != 1 or re.search(r"\b\d{1,2}\s*(?:al|a|–|—)\s*\d{1,2}[/-]", fold(text)):
        return UNKNOWN
    return found[0]


def kind(name: str) -> str:
    n = fold(name)
    if re.search(r"proyecto|entregable|avance|sustentacion", n):
        return "project"
    if re.search(r"practica|\bpc\s*\d*\b", n):
        return "practice"
    if re.search(r"parcial|medio curso|\bep\b", n):
        return "partial"
    if re.search(r"final|\bef\b", n):
        return "final"
    return n


def canonical(label: str) -> str:
    n = fold(label).strip()
    category = kind(n)
    if category == "partial":
        return "Examen Parcial"
    if category == "final":
        return "Examen Final"
    if category == "practice":
        match = re.search(r"(?:calificada|pc)\s*(?:n[.°ºo]*\s*)?(\d{1,2}|[ivx]+)\b", n)
        index = number(match[1]) if match else 0
        if not index:
            prefix = n.split()[0]
            index = ORDINALS.get(prefix, 0)
            digit = re.match(r"(\d+)(?:ra|da|ta|a)\b", prefix)
            if digit:
                index = int(digit[1])
        return "Práctica Calificada" + (f" {index}" if index else "")
    # Preserve project distinctions and numbering instead of assigning a final by week.
    return label.strip().capitalize()


def normalize_evaluations(evaluations: list[dict]) -> list[dict]:
    cleaned = []
    for ev in evaluations:
        name = str(ev.get("nombre", "")).strip()
        if not name:
            continue
        try:
            week = int(ev.get("semana", 0))
            weight = float(ev.get("peso", 0))
        except (TypeError, ValueError):
            continue
        cleaned.append({"nombre": canonical(name), "semana": week if 1 <= week <= 52 else 0,
                        "peso": weight if 0 <= weight <= 100 else 0,
                        "fecha": single_date(str(ev.get("fecha", "")))})
    # General mentions of the grading scheme should not duplicate scheduled exams.
    scheduled = [e for e in cleaned if e["semana"] or e["fecha"] != UNKNOWN]
    result = []
    for ev in cleaned:
        if ev not in scheduled:
            matches = [s for s in scheduled if s["nombre"] == ev["nombre"] or (
                kind(s["nombre"]) == kind(ev["nombre"]) and kind(ev["nombre"]) in ("partial", "final"))]
            if matches:
                if len(matches) == 1 and not matches[0]["peso"]:
                    matches[0]["peso"] = ev["peso"]
                continue
            if ev["nombre"] == "Práctica Calificada" and any(kind(s["nombre"]) == "practice" for s in scheduled):
                continue  # A combined practice percentage isn't each practice's weight.
        existing = next((r for r in result if r["nombre"] == ev["nombre"] and
                         r["semana"] == ev["semana"] and (r["fecha"] == ev["fecha"] or
                         UNKNOWN in (r["fecha"], ev["fecha"]))), None)
        if existing:
            if existing["fecha"] == UNKNOWN:
                existing["fecha"] = ev["fecha"]
            if not existing["peso"]:
                existing["peso"] = ev["peso"]
        else:
            result.append(ev)
    return sorted(result, key=lambda e: (e["semana"] or 999, e["fecha"], e["nombre"]))


def extract_without_ai(text: str) -> dict:
    text = unicodedata.normalize("NFC", text)
    lines = text.splitlines()
    course = ""
    start = UNKNOWN
    day = ""
    for i, line in enumerate(lines):
        n = fold(line)
        label = re.search(r"\b(?:nombre\s+(?:(?:de|del)\s+)?(?:la\s+)?(?:asignatura|curso)|asignatura|curso)\s*[:：]\s*(.*)", n)
        if not course and label:
            course = line[label.start(1):].strip()
            if not course and i + 1 < len(lines):
                course = lines[i + 1].strip()
        if re.search(r"\b(?:fecha\s+de\s+inicio|inicio\s+de\s+(?:clases|semestre)|inicia\s+el)\b", n):
            start = single_date(line) if dates(line) else single_date(" ".join(lines[i:i + 2]))
        if re.search(r"\b(?:horario|dia\s+de\s+clases|dias\s+de\s+clase)\b", n):
            match = re.search(r"\b(" + "|".join(DAYS) + r")\b", fold(" ".join(lines[i:i + 2])))
            if match:
                day = match[1]

    evaluations = []
    week = 0
    in_schedule = False
    for line in lines:
        n = fold(line).strip()
        if re.search(r"cronograma|contenido\s+tematico|programacion\s+(?:de\s+contenidos|semanal|de\s+actividades)|\bsemana\b.*\b(?:fecha|contenido|sesion|actividad)", n):
            in_schedule = True
            week = 0
        elif re.match(r"^(?:(?:[ivx]+[.\s-]+|\d+\.\s*))?(?:sistema\s+de\s+evaluacion|evaluacion|bibliografia|referencias|metodologia)\b", n):
            in_schedule = False
            week = 0
        explicit = re.search(r"\bsemanas?\s*:?\s*(?:n[.°ºo]*\s*)?(" + NUMBER + r")\b", n)
        row = re.match(r"^\|?\s*(" + NUMBER + r")(?:\s*[|:]\s*|\s+)(?![.%])", n) if in_schedule else None
        range_row = re.match(r"^\|?\s*" + NUMBER + r"\s*[-–—]\s*" + NUMBER + r"\b", n) if in_schedule else None
        if range_row:
            week = 0
        match = explicit or row
        if match:
            candidate = number(match[1])
            week = candidate if 1 <= candidate <= 30 else 0
            if explicit:
                in_schedule = True
            # A multi-week range cannot identify a single assessment week.
            if re.match(r"\s*(?:al|a|y|[-–—])\s*" + NUMBER + r"\b", n[match.end():]):
                week = 0
        if re.search(r"preparacion\s+(?:para|del)|repaso\s+(?:para|del)|revision\s+(?:del|de)|simulacro", n):
            continue
        events = list(EVENT_RE.finditer(n))
        for j, match in enumerate(events):
            label = line.strip()[match.start():match.end()]
            # Bare projects in lecture topics are not necessarily submissions.
            if match[0] == "proyecto final" and not re.search(r"entrega|presentacion|sustentacion|evaluacion|%", n):
                continue
            segment = n[match.end():events[j + 1].start() if j + 1 < len(events) else len(n)]
            percent = re.search(r"\b(\d{1,3}(?:[.,]\d+)?)\s*%", segment)
            if not percent and len(events) == 1:
                percent = re.search(r"\b(\d{1,3}(?:[.,]\d+)?)\s*%", n[:match.start()])
            # Only attach an exact date when it unambiguously belongs to this event.
            event_date = single_date(n) if len(events) == 1 else single_date(segment)
            evaluations.append({"nombre": canonical(label), "semana": week,
                                "peso": float(percent[1].replace(",", ".")) if percent else 0,
                                "fecha": event_date})
    return {"nombre_curso": course, "fecha_inicio": start, "dia_clases": day,
            "evaluaciones": normalize_evaluations(evaluations)}


def merge_results(ai: dict, fallback: dict) -> dict:
    """Keep deterministic dated entries if the AI missed them; no blind date merging."""
    merged = dict(ai)
    for field in ("nombre_curso", "fecha_inicio", "dia_clases"):
        if not merged.get(field) or merged[field] == UNKNOWN:
            merged[field] = fallback[field]
    evaluations = normalize_evaluations(ai["evaluaciones"])
    for ev in fallback["evaluaciones"]:
        matches = [e for e in evaluations if (e["nombre"] == ev["nombre"] or
                   kind(e["nombre"]) == kind(ev["nombre"]) and kind(ev["nombre"]) in ("partial", "final"))
                   and (e["semana"] == ev["semana"] or not e["semana"])]
        if len(matches) == 1:
            if ev["fecha"] != UNKNOWN:
                matches[0]["fecha"] = ev["fecha"]
            if ev["semana"]:
                matches[0]["semana"] = ev["semana"]
            if not matches[0]["peso"]:
                matches[0]["peso"] = ev["peso"]
        elif not matches and (ev["semana"] or ev["fecha"] != UNKNOWN):
            evaluations.append(ev.copy())
    merged["evaluaciones"] = normalize_evaluations(evaluations)
    return merged


def finalize(parsed: dict) -> list[dict]:
    start = single_date(str(parsed.get("fecha_inicio", "")))
    weekday = DAYS.get(fold(str(parsed.get("dia_clases", ""))).strip())
    first_class = None
    if start != UNKNOWN and weekday is not None:
        start_date = date.fromisoformat(start)
        first_class = start_date + timedelta(days=(weekday - start_date.weekday()) % 7)
    result = normalize_evaluations(parsed.get("evaluaciones", []))
    for ev in result:
        ev["fecha_origen"] = "explicita" if ev["fecha"] != UNKNOWN else "pendiente"
        if ev["fecha"] == UNKNOWN and first_class and ev["semana"]:
            ev["fecha"] = (first_class + timedelta(weeks=ev["semana"] - 1)).isoformat()
            ev["fecha_origen"] = "calculada"
    return result
