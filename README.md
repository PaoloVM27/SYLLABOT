# Syllabot: Automated Syllabus Parser & Calendar Synchronization

Syllabot es una aplicación web de arquitectura cliente-servidor diseñada para la extracción automatizada de datos temporales desde documentos académicos no estructurados (sílabos en formato PDF). El sistema utiliza modelos de lenguaje grande (LLMs) para estructurar la información y generar archivos de calendario estandarizados listos para su importación.

---

## Arquitectura del Sistema y Funcionalidad Core

El ciclo de vida del procesamiento de datos en Syllabot consta de cuatro fases principales:

1.  **Ingesta de Datos:** Interfaz de usuario que maneja la carga asíncrona de archivos PDF en memoria mediante el protocolo HTTP (multipart/form-data).
2.  **Extracción Híbrida (OCR/Text Mining):** Procesamiento del documento en el backend utilizando algoritmos de lectura de bajo nivel para extraer la capa de texto crudo, omitiendo el renderizado visual para optimizar la latencia.
3.  **Procesamiento de Lenguaje Natural (NLP):** Envío del texto crudo al modelo de inteligencia artificial (Gemini 1.5 Flash) configurado con un esquema de salida estructurada (JSON Schema) estricto. La IA actúa como un motor de Reconocimiento de Entidades Nombradas (NER) para clasificar eventos, fechas y ponderaciones.
4.  **Serialización de Datos:** Transformación del payload JSON resultante en un objeto de calendario compatible con el estándar RFC 5545 (.ics), permitiendo la interoperabilidad con Google Calendar, Apple Calendar y Outlook.

## Valor de Negocio y Escalabilidad

*   **Optimización de Tiempos:** Automatiza un proceso manual iterativo, reduciendo el tiempo de estructuración de datos de horas a milisegundos por documento.
*   **Mitigación de Errores:** Elimina la transcripción manual, garantizando la fidelidad de los datos temporales extraídos frente al documento original.
*   **Baja Latencia:** Arquitectura optimizada (*stateless* en su fase inicial) para devolver el archivo procesado en un promedio de 2 a 5 segundos.

---

## Stack Tecnológico

**Frontend (Client-Side)**
*   **Core:** React, TypeScript[cite: 1]
*   **Build Tool:** Vite (ESM-based)[cite: 1]
*   **Estilos:** Tailwind CSS[cite: 1]
*   **Gestor de Paquetes:** pnpm

**Backend (Server-Side / API)**
*   **Core:** Python 3 (Framework: FastAPI)
*   **Servidor ASGI:** Uvicorn
*   **Procesamiento de Archivos:** pdfplumber, python-multipart
*   **Integración IA:** google-generativeai (Gemini API)
*   **Generación de Formatos:** ics

---

## Despliegue en Entorno Local

Las siguientes instrucciones detallan la configuración del entorno de desarrollo para el entorno cliente y servidor.

### 1. Clonación del Repositorio
```bash
git clone <url-del-repositorio>
cd syllabot
