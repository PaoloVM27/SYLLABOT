const API_URL = ((import.meta.env["VITE_API_URL"] as string) || "http://localhost:8000").replace(
  /\/$/,
  "",
);
let readyPromise: Promise<void> | undefined;
let readyAt = 0;

// Best-effort warm-up only. A missing /health on an older backend must never block /upload.
export function prepareSyllabusService(): Promise<void> {
  if (readyAt && Date.now() - readyAt > 60_000) {
    readyPromise = undefined;
    readyAt = 0;
  }
  if (!readyPromise) {
    readyPromise = fetch(`${API_URL}/health`, { signal: AbortSignal.timeout(90_000) })
      .then(() => {
        readyAt = Date.now();
      })
      .catch(() => {
        readyPromise = undefined;
        readyAt = 0;
      });
  }
  return readyPromise;
}

export interface ProcessingProgress {
  percent: number;
  message: string;
}

export interface EvaluationResponse {
  nombre: string;
  semana: number;
  peso: number;
  fecha: string;
  fecha_origen?: string;
}

export interface SyllabusResponse {
  curso: string;
  evaluaciones: EvaluationResponse[];
  metodo?: "ia" | "reglas";
  advertencias?: string[];
  tiempo_segundos?: number;
}

export async function uploadSyllabus(
  file: File,
  signal: AbortSignal,
  onProgress: (progress: ProcessingProgress) => void,
): Promise<SyllabusResponse> {
  const body = new FormData();
  body.append("file", file);
  // Include Render's cold start in this budget. Gemini has its own short server deadline.
  const response = await fetch(`${API_URL}/upload`, {
    method: "POST",
    body,
    headers: { Accept: "application/x-ndjson, application/json" },
    signal: AbortSignal.any([signal, AbortSignal.timeout(180_000)]),
  });
  if (!response.ok) {
    const text = await response.text();
    let detail = `El servidor no pudo procesar el PDF (error ${response.status}). Intenta nuevamente.`;
    try {
      const error = JSON.parse(text);
      if (typeof error?.detail === "string") detail = error.detail;
    } catch {
      /* A proxy may respond with HTML. Don't display it as an error message. */
    }
    throw new Error(detail);
  }

  if (!response.headers.get("content-type")?.includes("application/x-ndjson")) {
    // Older deployments return JSON and cannot report internal progress.
    const data = await response.json().catch(() => {
      throw new Error(
        "El servidor no devolvió un resultado válido. Intenta nuevamente en unos momentos.",
      );
    });
    if (!data || !Array.isArray(data.evaluaciones))
      throw new Error("El resultado del análisis está incompleto.");
    return data as SyllabusResponse;
  }
  if (!response.body) throw new Error("No se pudo recibir el resultado del análisis.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: SyllabusResponse | undefined;
  let previousPercent = 0;
  const consume = (line: string) => {
    if (!line.trim()) return;
    const event = JSON.parse(line);
    if (event.type === "error")
      throw new Error(
        typeof event.detail === "string" ? event.detail : "No se pudo procesar el PDF.",
      );
    if (
      event.type === "progress" &&
      Number.isFinite(event.percent) &&
      typeof event.message === "string"
    ) {
      previousPercent = Math.max(previousPercent, Math.min(95, Math.max(0, event.percent)));
      onProgress({ percent: previousPercent, message: event.message });
    }
    if (event.type === "result" && Array.isArray(event.data?.evaluaciones)) result = event.data;
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) consume(line);
      if (done) break;
    }
    consume(buffer);
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  if (!result)
    throw new Error(
      "La conexión se interrumpió antes de completar el análisis. Intenta nuevamente.",
    );
  return result;
}
