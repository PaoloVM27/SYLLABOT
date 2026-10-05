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
Eres un asistente que extrae datos de sílabos universitarios.

Extrae la siguiente información global del curso:
- fecha_inicio: Fecha de inicio de clases en formato YYYY-MM-DD (busca en los datos generales, ej. 24/08/2026 -> 2026-08-24). Si no la hay, usa "0000-00-00".
- dia_clases: El día principal de la semana en el que se dicta la clase (ej. "Martes"). Usa solo una palabra en español, sin tildes. Si no hay, usa "".

Luego, extrae ÚNICAMENTE las evaluaciones principales e hitos importantes del curso:
- SÍ DEBES EXTRAER: "Práctica calificada" (PC), "Examen Parcial", "Examen Final", "Avance de proyecto", "Entregable de proyecto", "Desarrollo de proyecto", "Proyecto final" o similares que sean hitos calificados.
- NO DEBES EXTRAER: Ignora por completo actividades rutinarias como "Laboratorio", "Práctica dirigida", "Discusión", "Desarrollo de algoritmos", u otros que se dan siempre y no son hitos principales.

Para cada evaluación principal extraída proporciona:
- nombre: nombre descriptivo (ej. "Práctica Calificada 1", "Avance de Proyecto Final").
- semana: número entero de la semana en la que ocurre (ej. 8). Si el sílabo no menciona semana exacta, usa 0. Asegúrate de leer bien la columna de la semana donde aparece el hito.
- peso: porcentaje de la nota final (ej. 30). Si no hay, usa 0.

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
        "https://syllabot-red.vercel.app",
    ],
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
    if file.content_type != "application/pdf":
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
            eval_match = re.search(r"(Pr[aá]ctica\s+Calificad[ao]|Examen\s+Parcial|Examen\s+Final|Proyecto\s+Final|Avance\s+de\s+Proyecto)", line, re.IGNORECASE)
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
            
    from datetime import datetime, timedelta
    
    fecha_inicio_str = parsed.get("fecha_inicio", "0000-00-00")
    dia_clases_str = parsed.get("dia_clases", "")
    raw_evaluaciones = parsed.get("evaluaciones", [])
    
    dias_map = {
            "lunes": 0, "martes": 1, "miercoles": 2, "jueves": 3,
            "viernes": 4, "sabado": 5, "domingo": 6
        }
        
        evaluaciones = []
    evaluaciones = []
    
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
        
    for ev in raw_evaluaciones:
        semana = ev.get("semana", 0)
        fecha_final = "0000-00-00"
        if semana > 0 and first_class_date:
            eval_date = first_class_date + timedelta(days=(semana - 1) * 7)
            fecha_final = eval_date.strftime("%Y-%m-%d")
            
        evaluaciones.append({
            "nombre": ev.get("nombre", "Evaluación"),
            "fecha": fecha_final,
            "peso": ev.get("peso", 0)
        })

    # 3. Retornar los eventos en formato JSON
    return JSONResponse(content={"evaluaciones": evaluaciones})
