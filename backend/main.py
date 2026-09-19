from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
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
    fecha: str   # formato YYYY-MM-DD
    peso: int


class EvaluacionesResponse(typing.TypedDict):
    evaluaciones: list[Evaluacion]


PROMPT_TEMPLATE = """
Eres un asistente que extrae evaluaciones académicas de documentos universitarios (sílabos, programas de curso, etc.).

A partir del siguiente texto, identifica TODAS las evaluaciones, exámenes, tareas, proyectos o actividades calificadas.
Devuelve únicamente el JSON solicitado, sin texto adicional.

Para cada evaluación proporciona:
- nombre: nombre descriptivo de la evaluación.
- fecha: fecha en formato YYYY-MM-DD. Si no hay fecha exacta usa "0000-00-00".
- peso: porcentaje de la nota final como número entero (ej: 30). Si no hay peso usa 0.

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
    try:
        gemini_response = client.models.generate_content(
            model="gemini-1.5-flash",
            contents=prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=EvaluacionesResponse,
            ),
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Error al llamar a Gemini: {str(e)}")

    try:
        parsed = json.loads(gemini_response.text)
        evaluaciones = parsed.get("evaluaciones", [])
    except json.JSONDecodeError:
        raise HTTPException(status_code=502, detail="Gemini devolvió una respuesta no válida.")

    # 3. Generar el archivo .ics
    try:
        ics_bytes = build_ics(evaluaciones)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error al generar el calendario: {str(e)}")

    # 4. Retornar el archivo con headers de descarga
    filename = (file.filename or "evaluaciones").replace(".pdf", "")
    return Response(
        content=ics_bytes,
        media_type="text/calendar; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}.ics"',
        },
    )
