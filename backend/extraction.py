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
WEEK_WORDS = {}
for index, stem in enumerate(("primer", "segund", "tercer", "cuart", "quint", "sext",
                              "septim", "octav", "noven", "decim"), 1):
    WEEK_WORDS[stem + "a"] = index
    WEEK_WORDS[stem + "o"] = index
WEEK_WORDS.update({"primer": 1, "tercer": 3, "undecima": 11, "undecimo": 11,
                   "duodecima": 12, "duodecimo": 12})
# These forms are common in syllabus week columns even though they are fractional names.
for index, stem in enumerate(("once", "doce", "trece", "catorce", "quince", "dieciseis",
                              "diecisiete", "dieciocho", "diecinueve", "veinte"), 11):
    WEEK_WORDS[stem + "ava"] = index
    WEEK_WORDS[stem + "avo"] = index
for tens, stem in ((10, "decim"), (20, "vigesim"), (30, "trigesim")):
    for gender in ("a", "o"):
        WEEK_WORDS[stem + gender] = tens
        if tens == 30:
            continue
        for unit, unit_stem in enumerate(("primer", "segund", "tercer", "cuart", "quint",
                                         "sext", "septim", "octav", "noven"), 1):
            for unit_gender in ("a", "o"):
                WEEK_WORDS[stem + gender + " " + unit_stem + unit_gender] = tens + unit
                WEEK_WORDS[stem + gender + unit_stem + unit_gender] = tens + unit
WORD_NUMBERS = "|".join(re.escape(word).replace(r"\ ", r"\s+")
                        for word in sorted(WEEK_WORDS, key=len, reverse=True))
NUMBER = r"(?:" + WORD_NUMBERS + r"|\d{1,2}|[ivx]{1,5})"
ORDINALS = {"primera": 1, "segunda": 2, "tercera": 3, "cuarta": 4, "quinta": 5, "sexta": 6}
PRACTICE_NUMBER = r"(?:\s*(?:n[.°ºo]*\s*)?(?:\d{1,2}|[ivx]+)\b(?!\s*%|[/-]\d|\s+de\b))?"
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
    value = " ".join(fold(value).split())
    return int(value) if value.isdigit() else WEEK_WORDS.get(value, ROMANS.get(value, 0))


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


def practice_index(ev: dict) -> int:
    match = re.search(r"(\d+)$", ev["nombre"])
    return int(match[1]) if match and kind(ev["nombre"]) == "practice" else 0


def practice_limit(text: str, evaluations: list[dict]) -> int:
    """Only document evidence can raise the default of two, never an AI guess."""
    counts = {"dos": 2, "tres": 3, "cuatro": 4, "cinco": 5, "seis": 6,
              "siete": 7, "ocho": 8, "nueve": 9, "diez": 10}
    token = r"(?:\d{1,2}|" + "|".join(counts) + r")"
    quantities = [2, *(practice_index(ev) for ev in evaluations)]
    normalized = fold(text)
    for pattern in (r"\b(" + token + r")\s+(?:\(\d+\)\s*)?practicas\s+calificadas\b",
                    r"\bpracticas\s+calificadas\s*[:=(]\s*(" + token + r")\b"):
        for match in re.finditer(pattern, normalized):
            quantities.append(int(match[1]) if match[1].isdigit() else counts[match[1]])
    return min(52, max(quantities))


def consolidate_exams(evaluations: list[dict]) -> list[dict]:
    """A course has one partial and one final; repeated mentions are not new exams."""
    result = [e for e in evaluations if kind(e["nombre"]) not in ("partial", "final")]
    for category in ("partial", "final"):
        candidates = [e for e in evaluations if kind(e["nombre"]) == category]
        if not candidates:
            continue
        dated = [e for e in candidates if e["fecha"] != UNKNOWN]
        weekly = [e for e in candidates if e["semana"]]
        pool = dated or weekly or candidates
        key = (lambda e: e["fecha"]) if dated else (lambda e: e["semana"])
        best = (min(pool, key=key) if category == "partial" else max(pool, key=key)).copy()
        if not best["peso"]:
            weights = {e["peso"] for e in candidates if e["peso"]}
            if len(weights) == 1:
                best["peso"] = weights.pop()
        result.append(best)
    return sorted(result, key=lambda e: (e["semana"] or 999, e["fecha"], e["nombre"]))


def consolidate_practices(evaluations: list[dict], limit: int) -> list[dict]:
    """Numbered mentions are identities, not extra events beside the schedule."""
    others = [ev for ev in evaluations if kind(ev["nombre"]) != "practice"]
    practices = [ev.copy() for ev in evaluations if kind(ev["nombre"]) == "practice"]
    numbered = {}
    generic = []

    def quality(ev):
        return (ev["fecha"] != UNKNOWN, ev.get("fecha_origen") == "explicita",
                bool(ev["semana"]), bool(ev["peso"]))

    def chronology(ev):
        return (ev["fecha"] if ev["fecha"] != UNKNOWN else "9999-99-99", ev["semana"] or 999)

    def fill(target, source):
        if target["fecha"] == UNKNOWN and source["fecha"] != UNKNOWN:
            target["fecha"] = source["fecha"]
            target["fecha_origen"] = source.get("fecha_origen", "pendiente")
        if not target["semana"] and (source["fecha"] == UNKNOWN or target["fecha"] == source["fecha"]):
            target["semana"] = source["semana"]
        if not target["peso"]:
            target["peso"] = source["peso"]

    for ev in practices:
        index = practice_index(ev)
        if index:
            if index > limit:
                continue
            existing = numbered.get(index)
            if existing is None:
                numbered[index] = ev
            elif quality(ev) > quality(existing):
                fill(ev, existing)
                numbered[index] = ev
            else:
                fill(existing, ev)
        else:
            existing = next((p for p in generic if
                             (ev["fecha"] != UNKNOWN and ev["fecha"] == p["fecha"]) or
                             (ev["semana"] and ev["semana"] == p["semana"])), None)
            if existing is None:
                generic.append(ev)
            elif quality(ev) > quality(existing):
                fill(ev, existing)
                generic[generic.index(existing)] = ev
            else:
                fill(existing, ev)

    unmatched = []
    for ev in sorted(generic, key=chronology):
        matches = [p for p in numbered.values() if
                   (ev["fecha"] != UNKNOWN and ev["fecha"] == p["fecha"]) or
                   (ev["semana"] and ev["semana"] == p["semana"])]
        if len(matches) == 1:
            fill(matches[0], ev)
        elif ev["fecha"] != UNKNOWN or ev["semana"] or not numbered:
            unmatched.append(ev)

    missing = [numbered[i] for i in sorted(numbered) if not numbered[i]["semana"] and numbered[i]["fecha"] == UNKNOWN]
    if missing:
        # Two scheduled practices + PC1/PC2 in the grading scheme are the same pair.
        if len(missing) == len(unmatched):
            for target, source in zip(missing, unmatched):
                fill(target, source)
        # An isolated generic date cannot safely be assigned to one of two unknown PCs.
        unmatched = []
    for ev in unmatched:
        index = next((i for i in range(1, limit + 1) if i not in numbered), None)
        if index is None:
            break
        ev["nombre"] = f"Práctica Calificada {index}"
        numbered[index] = ev
    return sorted(others + list(numbered.values()),
                  key=lambda e: (e["semana"] or 999, e["fecha"], e["nombre"]))


def normalize_evaluations(evaluations: list[dict]) -> list[dict]:
    cleaned = []
    for ev in evaluations:
        name = str(ev.get("nombre", "")).strip()
        if not name or re.search(r"\bsustitutor(?:io|ia|ios|ias)\b|\bsusti\b", fold(name)):
            continue
        try:
            week = int(ev.get("semana", 0))
            weight = float(ev.get("peso", 0))
        except (TypeError, ValueError):
            continue
        item = {"nombre": canonical(name), "semana": week if 1 <= week <= 52 else 0,
                "peso": weight if 0 <= weight <= 100 else 0,
                "fecha": single_date(str(ev.get("fecha", "")))}
        if ev.get("fecha_origen") in ("explicita", "calculada", "pendiente"):
            item["fecha_origen"] = ev["fecha_origen"]
        cleaned.append(item)
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
    end = UNKNOWN
    duration = 0
    day = ""
    reading_general = True
    for i, line in enumerate(lines):
        n = fold(line)
        if re.search(r"unidades\s+de\s+aprendizaje|cronograma|contenido\s+tematico|^\s*unidad\s+[ivx\d]+\b", n):
            reading_general = False
        label = re.search(r"\b(?:nombre\s+(?:(?:de|del)\s+)?(?:la\s+)?(?:asignatura|curso)|asignatura|curso)\s*[:：]\s*(.*)", n)
        if not course and label:
            course = line[label.start(1):].strip()
            if not course and i + 1 < len(lines):
                course = lines[i + 1].strip()
        if re.search(r"\b(?:fecha\s+de\s+inicio|inicio\s+de\s+(?:clases|semestre)|inicia\s+el)\b", n):
            start = single_date(line) if dates(line) else single_date(" ".join(lines[i:i + 2]))
        if re.search(r"\b(?:fecha\s+de\s+(?:finalizacion|fin|termino)|fin\s+de\s+(?:clases|semestre))\b", n):
            end = single_date(line) if dates(line) else single_date(" ".join(lines[i:i + 2]))
        duration_match = re.search(r"\bduracion\s*:?\s*(\d{1,2})\s+semanas?\b", n)
        if duration_match and reading_general and not duration:
            duration = int(duration_match[1])
        if re.search(r"\b(?:horario|dia\s+de\s+clases|dias\s+de\s+clase)\b", n):
            match = re.search(r"\b(" + "|".join(DAYS) + r")\b", fold(" ".join(lines[i:i + 2])))
            if match:
                day = match[1]

    evaluations = []
    week = 0
    in_schedule = False
    for line in lines:
        n = fold(line).strip()
        if re.search(r"cronograma|unidades\s+de\s+aprendizaje|contenido\s+tematico|programacion\s+(?:de\s+contenidos|semanal|de\s+actividades)|\bsemana\b.*\b(?:fecha|contenido|sesion|actividad)", n):
            in_schedule = True
        elif (re.match(r"^(?:(?:[ivx]+[.\s-]+|\d+\.\s*))?(?:sistema\s+de\s+evaluacion|evaluacion|bibliografia|referencias|metodologia)\b", n)
              or re.match(r"^(?:\d{1,2}\.|[ivx]+\.)\s+[a-z]", n)):
            in_schedule = False
            week = 0
        explicit = re.search(r"\bsemanas?\s*:?\s*(?:n[.°ºo]*\s*)?(" + NUMBER + r")\b", n)
        if not explicit:
            explicit = re.search(r"\b(" + WORD_NUMBERS + r")\s+semana\b", n)
        row = re.match(r"^\|?\s*(" + NUMBER + r")(?:\s*[|:]\s*|\s+|$)(?![.%])", n) if in_schedule else None
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
        event_start = match.end() if row and match is row else 0
        events = list(EVENT_RE.finditer(n, event_start))
        for j, match in enumerate(events):
            label = line.strip()[match.start():match.end()]
            if re.search(r"\bsustitutor(?:io|ia)\b", match[0]) or re.match(
                    r"\s*(?:\(\s*)?sustitutor(?:io|ia)\b", n[match.end():]):
                continue
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
    limit = practice_limit(text, evaluations)
    parsed = {"nombre_curso": course, "fecha_inicio": start, "fecha_fin": end,
              "duracion_semanas": duration, "dia_clases": day,
              "limite_practicas": limit, "evaluaciones": normalize_evaluations(evaluations)}
    # Establish identities/dates from the source schedule before any model output.
    parsed["evaluaciones"] = finalize(parsed)
    return parsed


def merge_results(ai: dict, fallback: dict) -> dict:
    """Keep deterministic dated entries if the AI missed them; no blind date merging."""
    merged = dict(ai)
    merged["limite_practicas"] = fallback.get("limite_practicas", 2)
    for field in ("nombre_curso", "fecha_inicio", "fecha_fin", "duracion_semanas", "dia_clases"):
        if not merged.get(field) or merged[field] == UNKNOWN:
            merged[field] = fallback.get(field, 0 if field == "duracion_semanas" else "")
    # Explicit general-information fields outrank a model's interpretation of unit dates/durations.
    for field in ("fecha_inicio", "fecha_fin", "duracion_semanas", "dia_clases"):
        if fallback.get(field) and fallback[field] != UNKNOWN:
            merged[field] = fallback[field]
    evaluations = normalize_evaluations(ai["evaluaciones"])
    for ev in fallback["evaluaciones"]:
        identity = kind(ev["nombre"]) in ("partial", "final") or practice_index(ev) > 0
        matches = [e for e in evaluations if (e["nombre"] == ev["nombre"] or
                   kind(e["nombre"]) == kind(ev["nombre"]) and kind(ev["nombre"]) in ("partial", "final"))
                   and (identity or e["semana"] == ev["semana"] or not e["semana"])]
        if len(matches) == 1 or identity and matches:
            for match in matches:
                if ev["fecha"] != UNKNOWN or ev["semana"]:
                    # A documented week overrides an unsupported model date or week.
                    match["fecha"] = ev["fecha"]
                    match["fecha_origen"] = ev.get("fecha_origen", "explicita" if ev["fecha"] != UNKNOWN else "pendiente")
                if ev["semana"]:
                    match["semana"] = ev["semana"]
                if ev["peso"] or not match["peso"]:
                    match["peso"] = ev["peso"]
        elif not matches and (ev["semana"] or ev["fecha"] != UNKNOWN):
            evaluations.append(ev.copy())
    merged["evaluaciones"] = normalize_evaluations(evaluations)
    return merged


def finalize(parsed: dict) -> list[dict]:
    start = single_date(str(parsed.get("fecha_inicio", "")))
    end = single_date(str(parsed.get("fecha_fin", "")))
    end_date = date.fromisoformat(end) if end != UNKNOWN else None
    try:
        duration = int(parsed.get("duracion_semanas", 0))
    except (ValueError, TypeError):
        duration = 0
    weekday = DAYS.get(fold(str(parsed.get("dia_clases", ""))).strip())
    first_class = None
    if start != UNKNOWN:
        start_date = date.fromisoformat(start)
        first_class = start_date + timedelta(days=(weekday - start_date.weekday()) % 7) if weekday is not None else start_date
    result = normalize_evaluations(parsed.get("evaluaciones", []))
    for ev in result:
        ev["fecha_origen"] = ev.get("fecha_origen", "explicita") if ev["fecha"] != UNKNOWN else "pendiente"
        if ev["fecha"] == UNKNOWN and first_class and ev["semana"]:
            candidate = first_class + timedelta(weeks=ev["semana"] - 1)
            if (end_date and candidate > end_date) or (duration > 0 and ev["semana"] > duration):
                continue
            ev["fecha"] = candidate.isoformat()
            ev["fecha_origen"] = "calculada"
    result = consolidate_exams(result)
    result = consolidate_practices(result, int(parsed.get("limite_practicas", 2)))
    return validate_sequence(result)


def validate_sequence(evaluations: list[dict]) -> list[dict]:
    """Reject contradictory dates rather than move an exam to an invented week."""
    partial = next((e for e in evaluations if kind(e["nombre"]) == "partial"), None)
    final = next((e for e in evaluations if kind(e["nombre"]) == "final"), None)
    pc2 = next((e for e in evaluations if practice_index(e) == 2), None)

    def compare(left, right):
        if left is None or right is None:
            return None
        if left["fecha"] != UNKNOWN and right["fecha"] != UNKNOWN:
            return left["fecha"] >= right["fecha"]
        if left["semana"] and right["semana"]:
            return left["semana"] >= right["semana"]
        return None

    def pending(ev):
        ev.update(fecha=UNKNOWN, fecha_origen="pendiente", semana=0)

    if compare(partial, final):
        pending(final)
    if compare(partial, pc2):
        pending(pc2)
    if compare(pc2, final):
        pending(final)
    return sorted(evaluations, key=lambda e: (
        e["fecha"] if e["fecha"] != UNKNOWN else "9999-99-99",
        e["semana"] or 999, e["nombre"]))
