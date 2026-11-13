# Syllabot

Convierte un sílabo PDF con texto seleccionable en evaluaciones que puedes revisar,
editar y exportar a Google Calendar o a un archivo `.ics`.

## Procesamiento y tiempos de espera

1. Al iniciar sesión, la página consulta `GET /health` para intentar despertar el
   backend mientras eliges tu archivo. Es una consulta opcional: si falla o la
   ruta no existe en una versión anterior, no bloquea `POST /upload`.
2. `POST /upload` acepta PDF de hasta 10 MB, 50 páginas y 200 000 caracteres.
   La lectura del PDF y la extracción por reglas se ejecutan fuera del bucle que
   atiende las solicitudes. Se permiten dos trabajos de extracción simultáneos.
3. El resultado sin IA se calcula primero. Gemini intenta mejorarlo una sola vez,
   durante un máximo de 12 segundos por defecto. Ante cuota agotada, error,
   respuesta inválida, ausencia de clave o saturación local, se devuelve la
   extracción por reglas automáticamente, sin opciones manuales en la página.
   Tras un fallo de servicio, se omite Gemini durante 60 segundos en ese proceso.
4. La petición del navegador admite hasta 180 segundos incluyendo la subida y el
   arranque de Render. Puede cancelarse. La espera de Gemini sigue acotada aparte.
5. El frontend solicita progreso con `Accept: application/x-ndjson`. El servidor
   informa recepción (5 %), lectura de páginas (10–65 %), extracción base (75 %)
   y preparación del resultado (90–95 %). Son porcentajes por etapas, no una
   predicción del tiempo restante; no avanzan artificialmente mientras espera IA.
   La página muestra 100 % cuando termina de preparar el calendario. Los clientes
   anteriores siguen recibiendo JSON. Si el backend todavía es anterior y solo
   devuelve JSON, la página espera el resultado sin inventar progreso intermedio.

Estos límites no prometen un tiempo total en producción: la subida, el arranque
de Render y el costo de lectura del PDF son adicionales al presupuesto de Gemini.
Cancelar en el navegador deja de esperar el resultado; una lectura de PDF que ya
se esté ejecutando en el servidor puede continuar hasta terminar.

## Extracción sin IA

Reconoce nombres de curso, inicio de clases, días con tildes, semanas explícitas,
filas de cronogramas con semanas numéricas, romanas o en palabras (Primera,
Octava, Décima sexta y variantes como Onceava/Doceava), EP, EF, PC1/PC2/etc.,
prácticas calificadas, avances, entregables y presentaciones de proyecto.
Conserva porcentajes decimales y fechas completas numéricas o con meses en español.

Considera hasta dos prácticas calificadas por defecto. Solo permite más cuando
el documento lo indica explícitamente por cantidad o numeración (PC3, PC4, etc.).
Unifica menciones genéricas y numeradas de la misma práctica; no genera una
práctica adicional por su aparición en el cronograma y en la fórmula de notas.
Excluye siempre los exámenes sustitutorios, incluso con fecha explícita.
Conserva como máximo un Examen Parcial y un Examen Final: unifica menciones
repetidas y prioriza las semanas identificadas en el cronograma sobre fechas
contradictorias propuestas por la IA. Valida el orden parcial → PC2 → final.
Si una contradicción no puede resolverse con el documento, deja la fecha por
confirmar en lugar de inventar una semana para hacerla encajar.
No convierte automáticamente los proyectos de las semanas 15/16 en entregas
finales. Evita duplicar menciones generales del sistema
de evaluación cuando encuentra la misma evaluación en el cronograma. Los pesos
agrupados de prácticas no se asignan a cada práctica individual.

Una fecha explícita tiene prioridad. La fecha de inicio ancla la semana 1; si
existe horario, se usa la primera clase en ese día a partir del inicio. Sin
horario, se toma el propio inicio como la primera clase. La fecha de una
evaluación se calcula sumando `(semana - 1) * 7` días a esa primera clase.
Se verifica que el cálculo no supere la fecha de finalización ni la duración
global del curso; la duración de una unidad no reemplaza la del semestre.
Las evaluaciones sin semana ni fecha permanecen por confirmar.
La respuesta identifica `fecha_origen` como
`explicita`, `calculada` o `pendiente`, y la página advierte cuando hay fechas
calculadas o faltantes. Los rangos de fechas y fechas sin año no se presentan
como fechas exactas. Las fechas calculadas no contemplan feriados o reprogramaciones.

Las evaluaciones por confirmar permanecen en la lista de revisión, sin una fecha
provisional en el calendario. Mes, Agenda, Google Calendar y `.ics` muestran o
exportan únicamente evaluaciones seleccionadas con fecha válida. Asignar una
fecha manual las incorpora al calendario; quitarla vuelve a dejarlas pendientes.
Agenda reúne todas las evaluaciones seleccionadas con fecha en orden cronológico,
sin filtrar por mes, año o un rango fijo. Mes vuelve a la cuadrícula conservando
el mes consultado; Hoy, Ant y Sig cambian a Mes y navegan por meses.
Ambas vistas comparten el mismo filtro y una vista controlada. Tras sincronizar
con Google, las evaluaciones pendientes permanecen disponibles para completarlas.

Limitaciones: no incluye OCR para PDF escaneados; los documentos sin texto
reciben un mensaje específico. Tablas con celdas combinadas, varias columnas o
cronogramas inusuales pueden requerir corrección manual. Conviene validar el
extractor con sílabos reales de distintos cursos antes de medir su precisión.

## Desarrollo

Frontend (Node y pnpm):

```sh
pnpm install
pnpm dev
```

Configura `VITE_API_URL` en el `.env` del frontend; en local puede ser
`http://localhost:8000`. Es una variable de compilación de Vite.

Backend (Python 3.11 o superior, desde `backend/`):

```sh
python -m venv venv
# Activa el entorno virtual según tu sistema operativo.
pip install -r requirements.txt
# Copia .env.example a .env si quieres usar Gemini.
uvicorn main:app --host 0.0.0.0 --port 8000
```

`GEMINI_API_KEY` es opcional. `GEMINI_MODEL` permite cambiar el modelo sin editar
código. `AI_TIMEOUT_SECONDS` tiene valor predeterminado 12 y se acota entre 1 y
30 segundos. `CORS_ORIGINS` agrega dominios del frontend separados por comas.

## Verificación

Desde la raíz, usando el Python del entorno virtual del backend:

```sh
python -m unittest discover -s backend -p "test_*.py" -v
node --test tests/syllabus-api.test.mjs tests/calendar-events.test.mjs
pnpm exec tsc --noEmit
pnpm exec eslint src/routes/index.tsx src/lib/syllabus-api.ts
pnpm build
```

Las pruebas usan PDF sintéticos y respuestas simuladas de Gemini a través del
SDK real. No envían documentos ni consumen cuota del proveedor. Para ejecutar
las pruebas de API necesitas `httpx`, instalado también como dependencia del SDK.

## Despliegue y diagnóstico

Despliega el backend con directorio raíz `backend`, instala `requirements.txt`
y usa `uvicorn main:app --host 0.0.0.0 --port $PORT`. Publica también el frontend
con su `VITE_API_URL` correcto para incorporar la nueva pantalla y `/health`.
Los cambios locales no se sincronizan hasta publicarlos.

El log `upload` registra identificador de solicitud, método, razón de fallback,
segundos de extracción, segundos totales y cantidad de evaluaciones. No registra
el PDF, su texto ni credenciales. La respuesta devuelve `request_id`, `metodo`,
`advertencias` y `tiempo_segundos` para ayudar a diagnosticar las esperas.

Mejoras pendientes recomendadas: OCR opcional para escaneos, validación con
sílabos reales, autenticación y límites de peticiones en la API pública (CORS no
sustituye autenticación), y revisión del tamaño del JavaScript y las imágenes.
Un plan de Render sin suspensión reduce el arranque en frío; no sustituye los
límites de espera y el manejo de fallos implementados aquí.
