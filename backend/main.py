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

Luego, extrae TODAS las evaluaciones, prácticas, exámenes o entregables:
- nombre: nombre descriptivo (ej. "Examen Parcial").
- semana: número entero de la semana en la que ocurre (ej. 8). Si el sílabo no menciona semana exacta, usa 0.
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
    for attempt in range(3):
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
            if "503" in str(e) or "UNAVAILABLE" in str(e):
                time.sleep(2 ** attempt)  # 1s, 2s, 4s
                continue
            raise HTTPException(status_code=502, detail=f"Error al llamar a Gemini: {str(e)}")
    if last_error:
        raise HTTPException(status_code=502, detail=f"Error al llamar a Gemini: {str(last_error)}")

    try:
        from datetime import datetime, timedelta
        
        parsed = json.loads(gemini_response.text)
        fecha_inicio_str = parsed.get("fecha_inicio", "0000-00-00")
        dia_clases_str = parsed.get("dia_clases", "")
        raw_evaluaciones = parsed.get("evaluaciones", [])
        
        dias_map = {
            "lunes": 0, "martes": 1, "miercoles": 2, "jueves": 3,
            "viernes": 4, "sabado": 5, "domingo": 6
        }
        
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

    except json.JSONDecodeError:
        raise HTTPException(status_code=502, detail="Gemini devolvió una respuesta no válida.")

    # 3. Retornar los eventos en formato JSON
    return JSONResponse(content={"evaluaciones": evaluaciones})
