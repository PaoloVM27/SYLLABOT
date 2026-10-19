from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from dotenv import load_dotenv
from google import genai
from google.genai import types
from ics import Calendar, Event
from datetime import date, datetime
import typing_extensions as typing
import pdfplumber
import json
import io
import os

load_dotenv()

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
if not GEMINI_API_KEY:
    raise RuntimeError("GEMINI_API_KEY no encontrada. Verifica tu archivo .env")

client = genai.Client(api_key=GEMINI_API_KEY)


# --- Esquema de Structured Output ---
class Evaluacion(typing.TypedDict):
    nombre: str
    semana: int  # ej. 8
    peso: int

class EvaluacionesResponse(typing.TypedDict):
    fecha_inicio: str  # YYYY-MM-DD
    dia_clases: str    # "Lunes", "Martes", "Miercoles", "Jueves", "Viernes", "Sabado", "Domingo"
    evaluaciones: list[Evaluacion]


PROMPT_TEMPLATE = """
Eres un asistente experto que extrae con máxima precisión datos y cronogramas de sílabos universitarios (como UNMSM).

Extrae la siguiente información global del curso:
- fecha_inicio: Fecha de inicio de clases en formato YYYY-MM-DD (busca en los datos generales, ej. 24/08/2026 -> 2026-08-24). Si no la hay, usa "0000-00-00".
- dia_clases: El día principal de la semana en el que se dicta la clase (ej. "Martes"). Usa solo una palabra en español, sin tildes. Si no hay, usa "".

REGLAS ESTRICTAS DE EVALUACIONES (OBLIGATORIAS):
1. EXAMEN PARCIAL:
   - Solo puede haber COMO MÁXIMO UN (1) "Examen Parcial" en todo el curso.
   - Ocurre a mitad de semestre, típicamente en la SEMANA 8.
   - NUNCA generes más de un Examen Parcial.

2. EXAMEN FINAL:
   - Solo puede haber COMO MÁXIMO UN (1) "Examen Final" en todo el curso.
   - Ocurre en la última semana del semestre, típicamente en la SEMANA 16.
   - NUNCA pongas un "Examen Final" en la semana 8 ni en la misma fecha que el Examen Parcial.

3. PROYECTOS Y ENTREGABLES:
   - En la semana 15 (o la penúltima semana previa al examen final) es la presentación o entrega final del proyecto. Nómbralo: "Presentación de Proyecto Final".
   - Si en el sílabo aparecen entregas o avances previos de proyecto (por ejemplo cada 3 semanas: semanas 3, 6, 9, 12, etc.), NUNCA los llames "Proyecto Final".
   - Nómbralos en orden cronológico como entregables: "1er Entregable de Proyecto", "2do Entregable de Proyecto", "3er Entregable de Proyecto", etc.
   - Solo puede haber UNA entrega final de proyecto (en la semana 15).

4. PRÁCTICAS CALIFICADAS (PC):
   - Si el curso tiene prácticas calificadas, extrae COMO MÁXIMO 2 (o menos si hay 1 o ninguna).
   - Nómbralas "Práctica Calificada 1" y "Práctica Calificada 2". No extraigas más de 2 prácticas calificadas.

5. ACTIVIDADES A IGNORAR:
   - Ignora por completo actividades rutinarias como "Laboratorio semanal", "Práctica dirigida", "Discusión", "Desarrollo de algoritmos", clases normales o lecturas que no sean evaluaciones formales.

Para cada evaluación extraída proporciona:
- nombre: nombre descriptivo y normalizado según las reglas anteriores (ej. "Práctica Calificada 1", "Examen Parcial", "1er Entregable de Proyecto", "Presentación de Proyecto Final", "Examen Final").
- semana: número entero de la semana en la que ocurre (ej. 8). Asegúrate de leer cuidadosamente la columna o fila de la semana donde está la evaluación.
- peso: porcentaje de la nota final (ej. 20). Si no se indica porcentaje, usa 0.

Devuelve ÚNICAMENTE el JSON solicitado.

Texto del documento:
\"\"\"
{texto}
\"\"\"
"""

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:3000",
        "http://localhost:8080",
        "https://syllabot-red.vercel.app",
    ],
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1)(:\d+)?",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def build_ics(evaluaciones: list[dict]) -> bytes:
    """Convierte la lista de evaluaciones en un archivo .ics en memoria."""
    cal = Calendar()

    for ev in evaluaciones:
        nombre = ev.get("nombre", "Evaluación")
        fecha_str = ev.get("fecha", "0000-00-00")
        peso = ev.get("peso", 0)

        event = Event()
        event.name = f"{nombre} ({peso}%)"
        event.description = f"Peso en la nota final: {peso}%"

        try:
            fecha = date.fromisoformat(fecha_str)
            event.begin = datetime(fecha.year, fecha.month, fecha.day, 12, 0, 0)
            event.make_all_day()
        except ValueError:
            pass  # Evento sin fecha si no es parseable

        cal.events.add(event)

    return cal.serialize().encode("utf-8")


@app.post("/upload")
async def upload_pdf(file: UploadFile = File(...)):
    is_pdf = (
        file.content_type in ["application/pdf", "application/x-pdf", "application/octet-stream"]
        or (file.filename and file.filename.lower().endswith(".pdf"))
    )
    if not is_pdf:
        raise HTTPException(status_code=400, detail="El archivo debe ser un PDF.")

    # 1. Extraer texto del PDF
    contents = await file.read()
    try:
        with pdfplumber.open(io.BytesIO(contents)) as pdf:
            raw_text = "\n".join(
                page.extract_text() or "" for page in pdf.pages
            )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error al procesar el PDF: {str(e)}")

    if not raw_text.strip():
        raise HTTPException(status_code=422, detail="No se pudo extraer texto del PDF.")

    # 2. Enviar a Gemini con Structured Output
    prompt = PROMPT_TEMPLATE.format(texto=raw_text)
    import time
    last_error = None
    for attempt in range(8): # Aumentado a 8 intentos
        try:
            gemini_response = client.models.generate_content(
                model="gemini-3.6-flash",
                contents=prompt,
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    response_schema=EvaluacionesResponse,
                ),
            )
            last_error = None
            break
        except Exception as e:
            last_error = e
            # Si hay error de saturación o límite de peticiones (429, 503)
            if "503" in str(e) or "UNAVAILABLE" in str(e) or "429" in str(e) or "Quota" in str(e):
                time.sleep(2)  # Espera 2 segundos exactos entre intentos
                continue
            # Si es otro error raro, rompemos de inmediato
            raise HTTPException(status_code=502, detail="Error interno al comunicarse con la Inteligencia Artificial.")
            
    import re
    from datetime import datetime, timedelta

    def sanitize_evaluaciones(raw_evals: list[dict]) -> list[dict]:
        """
        Aplica las reglas estrictas de negocio para sílabos universitarios:
        1. Máximo 1 Examen Parcial (típicamente semana 8).
        2. Máximo 1 Examen Final (típicamente semana 16, nunca en semanas iniciales/semana 8).
        3. Prácticas Calificadas: Máximo 2 o menos (PC1 y PC2).
        4. Proyectos: En semana 15 (o semana final de presentación) es 'Presentación de Proyecto Final'.
           Si hay entregas previas (semanas 3, 6, 9, 12, etc.), se nombran '1er Entregable de Proyecto',
           '2do Entregable de Proyecto', etc. Nunca repetir 'Proyecto Final' antes de semana 15.
           Si semana 15 ya tiene la Presentación, descarta duplicados en semana 16.
        5. Deduplicación de eventos en la misma semana/fecha con títulos conflictivos.
        """
        if not raw_evals:
            return []

        cleaned = []
        for ev in raw_evals:
            nombre = str(ev.get("nombre", "")).strip()
            if not nombre:
                continue
            try:
                semana = int(ev.get("semana", 0))
            except (ValueError, TypeError):
                semana = 0
            try:
                peso = int(ev.get("peso", 0))
            except (ValueError, TypeError):
                peso = 0
            cleaned.append({
                "nombre": nombre,
                "semana": semana,
                "peso": peso
            })

        parcial_candidates = []
        final_candidates = []
        practica_candidates = []
        proyecto_candidates = []
        otros_candidates = []

        for ev in cleaned:
            nombre_lower = ev["nombre"].lower()
            
            is_proyecto = bool(re.search(r"\b(proyecto|avance|entregable|sustentaci[oó]n|informe)\b", nombre_lower))
            is_practica = bool(re.search(r"(pr[aá]ctica\s+calificad[ao]|\bpc\b|\bpc\s*\d|\bpr[aá]ctica\s*\d)", nombre_lower))
            is_parcial = bool(re.search(r"\b(parcial|ep)\b", nombre_lower)) and not is_proyecto
            is_final = bool(re.search(r"\b(final|ef)\b", nombre_lower)) and not is_proyecto and not is_parcial

            if is_parcial:
                parcial_candidates.append(ev)
            elif is_final:
                final_candidates.append(ev)
            elif is_practica:
                practica_candidates.append(ev)
            elif is_proyecto:
                proyecto_candidates.append(ev)
            else:
                otros_candidates.append(ev)

        result = []

        # 1. Regla: Exactamente MÁXIMO 1 Examen Parcial
        if parcial_candidates:
            best_parcial = min(
                parcial_candidates,
                key=lambda x: abs(x["semana"] - 8) if x["semana"] > 0 else 99
            )
            best_parcial["nombre"] = "Examen Parcial"
            result.append(best_parcial)

        # 2. Regla: Exactamente MÁXIMO 1 Examen Final
        if final_candidates:
            valid_final_candidates = [
                f for f in final_candidates 
                if f["semana"] >= 13 or (f["semana"] > 8 and not any(p["semana"] == f["semana"] for p in result))
            ]
            if valid_final_candidates:
                best_final = max(valid_final_candidates, key=lambda x: x["semana"])
                best_final["nombre"] = "Examen Final"
                result.append(best_final)
            elif not any(r["nombre"] == "Examen Parcial" for r in result):
                best_final = max(final_candidates, key=lambda x: x["semana"])
                best_final["nombre"] = "Examen Final"
                result.append(best_final)

        # 3. Regla: Prácticas Calificadas (Máximo 2 o menos)
        if practica_candidates:
            practica_candidates.sort(key=lambda x: x["semana"])
            unique_pcs = []
            seen_weeks = set()
            for pc in practica_candidates:
                w = pc["semana"]
                if w not in seen_weeks or w == 0:
                    unique_pcs.append(pc)
                    if w > 0:
                        seen_weeks.add(w)
            selected_pcs = unique_pcs[:2]
            if len(selected_pcs) == 1:
                selected_pcs[0]["nombre"] = "Práctica Calificada 1"
            elif len(selected_pcs) >= 2:
                selected_pcs[0]["nombre"] = "Práctica Calificada 1"
                selected_pcs[1]["nombre"] = "Práctica Calificada 2"
            result.extend(selected_pcs)

        # 4. Regla: Proyectos y Entregables
        if proyecto_candidates:
            proyecto_candidates.sort(key=lambda x: x["semana"])
            unique_proyectos = []
            seen_weeks_proj = set()
            for pr in proyecto_candidates:
                w = pr["semana"]
                if w not in seen_weeks_proj or w == 0:
                    unique_proyectos.append(pr)
                    if w > 0:
                        seen_weeks_proj.add(w)

            # Si semana 15 ya tiene el proyecto final, descartar duplicado espurio en semana 16
            if any(p["semana"] == 15 for p in unique_proyectos) and any(p["semana"] == 16 for p in unique_proyectos):
                unique_proyectos = [p for p in unique_proyectos if p["semana"] != 16]

            ordinals = {1: "1er", 2: "2do", 3: "3er", 4: "4to", 5: "5to", 6: "6to", 7: "7mo", 8: "8vo"}

            if len(unique_proyectos) == 1:
                p = unique_proyectos[0]
                if p["semana"] >= 14 or p["semana"] == 0:
                    p["nombre"] = "Presentación de Proyecto Final"
                else:
                    p["nombre"] = "1er Entregable de Proyecto"
                result.append(p)
            else:
                final_proj_idx = -1
                for idx, p in enumerate(unique_proyectos):
                    if p["semana"] == 15:
                        final_proj_idx = idx
                        break
                if final_proj_idx == -1 and unique_proyectos[-1]["semana"] >= 14:
                    final_proj_idx = len(unique_proyectos) - 1

                entregable_count = 1
                for idx, p in enumerate(unique_proyectos):
                    if idx == final_proj_idx:
                        p["nombre"] = "Presentación de Proyecto Final"
                    else:
                        ord_str = ordinals.get(entregable_count, f"{entregable_count}°")
                        p["nombre"] = f"{ord_str} Entregable de Proyecto"
                        entregable_count += 1
                    result.append(p)

        # 5. Otros Hitos
        for ot in otros_candidates:
            if not any(r["nombre"] == ot["nombre"] and r["semana"] == ot["semana"] for r in result):
                result.append(ot)

        result.sort(key=lambda x: (x["semana"] if x["semana"] > 0 else 999, x["nombre"]))
        return result
    
    def extract_evaluations_without_ai(text: str):
        fecha_inicio = "0000-00-00"
        match_inicio = re.search(r"Fecha de inicio\s*:\s*(\d{2}/\d{2}/\d{4})", text, re.IGNORECASE)
        if match_inicio:
            parts = match_inicio.group(1).split("/")
            fecha_inicio = f"{parts[2]}-{parts[1]}-{parts[0]}"
            
        dia_clases = ""
        match_dia = re.search(r"Horario\s*:\s*(Lunes|Martes|Mi[eé]rcoles|Jueves|Viernes|S[aá]bado|Domingo)", text, re.IGNORECASE)
        if match_dia:
            dia_clases = match_dia.group(1).replace("é", "e").replace("á", "a")
            
        evals = []
        lines = text.split('\n')
        current_week = 0
        
        for line in lines:
            # Buscar semana suelta o al inicio
            week_match = re.search(r"^(?:semana\s*)?(\d{1,2})\b", line.strip(), re.IGNORECASE)
            if week_match:
                current_week = int(week_match.group(1))
                
            # Buscar hitos importantes
            eval_match = re.search(r"(Pr[aá]ctica\s+Calificad[ao]|Examen\s+Parcial|Examen\s+Final|Proyecto\s+Final|Avance\s+de\s+Proyecto|Entregable)", line, re.IGNORECASE)
            if eval_match:
                nombre = eval_match.group(1).strip().title()
                
                # Para evitar duplicados en la misma línea o lecturas raras
                if not any(e["nombre"] == nombre and e["semana"] == current_week for e in evals):
                    evals.append({
                        "nombre": nombre,
                        "semana": current_week,
                        "peso": 0
                    })
        return {
            "fecha_inicio": fecha_inicio,
            "dia_clases": dia_clases,
            "evaluaciones": evals
        }

    if last_error:
        # Si la IA falla, usamos nuestro propio algoritmo de extracción clásico (Regex)
        print("IA falló, usando extracción Regex manual.")
        parsed = extract_evaluations_without_ai(raw_text)
    else:
        try:
            parsed = json.loads(gemini_response.text)
        except json.JSONDecodeError:
            parsed = extract_evaluations_without_ai(raw_text)
            
    fecha_inicio_str = parsed.get("fecha_inicio", "0000-00-00")
    dia_clases_str = parsed.get("dia_clases", "")
    raw_evaluaciones = parsed.get("evaluaciones", [])
    
    # Sanitizar y ordenar evaluaciones según reglas estrictas
    sanitized_evals = sanitize_evaluaciones(raw_evaluaciones)

    dias_map = {
        "lunes": 0, "martes": 1, "miercoles": 2, "jueves": 3,
        "viernes": 4, "sabado": 5, "domingo": 6
    }
    
    start_date = None
    if fecha_inicio_str and fecha_inicio_str != "0000-00-00":
        try:
            start_date = datetime.strptime(fecha_inicio_str, "%Y-%m-%d")
        except ValueError:
            pass
            
    target_weekday = dias_map.get(dia_clases_str.lower().strip(), -1)
    
    first_class_date = None
    if start_date and target_weekday != -1:
        days_ahead = target_weekday - start_date.weekday()
        if days_ahead < 0:
            days_ahead += 7
        first_class_date = start_date + timedelta(days=days_ahead)
        
    evaluaciones = []
    for ev in sanitized_evals:
        semana = ev.get("semana", 0)
        fecha_final = "0000-00-00"
        if semana > 0 and first_class_date:
            eval_date = first_class_date + timedelta(days=(semana - 1) * 7)
            fecha_final = eval_date.strftime("%Y-%m-%d")
            
        evaluaciones.append({
            "nombre": ev.get("nombre", "Evaluación"),
            "fecha": fecha_final,
            "peso": ev.get("peso", 0),
            "semana": semana
        })

    # 3. Retornar los eventos en formato JSON
    return JSONResponse(content={"evaluaciones": evaluaciones})
