import { useCallback, useEffect, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  Bot,
  CloudUpload,
  FileText,
  Check,
  X,
  Loader2,
  CalendarCheck,
  Download,
  RotateCcw,
} from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      {
        title: "Syllabot \u2014 Tu s\u00edlabo convertido en calendario con IA",
      },
      {
        name: "description",
        content:
          "Sube tu s\u00edlabo universitario en PDF o Word y Syllabot extrae ex\u00e1menes y entregas con IA para generar un archivo .ics listo para Google Calendar.",
      },
      {
        property: "og:title",
        content: "Syllabot \u2014 Tu semestre organizado en segundos",
      },
      {
        property: "og:description",
        content:
          "Sube tu s\u00edlabo y nuestra IA extraer\u00e1 todas las fechas de ex\u00e1menes y entregas directamente a tu Google Calendar.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

type Phase = "idle" | "file" | "loading" | "success" | "error";

function Index() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [fileName, setFileName] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [icsBlob, setIcsBlob] = useState<Blob | null>(null);
  const [eventCount, setEventCount] = useState<number>(0);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const acceptFile = useCallback((name: string) => {
    setFileName(name);
    setPhase("file");
  }, []);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    const handler = (e: Event) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) acceptFile(file.name);
    };
    input.addEventListener("change", handler);
    return () => input.removeEventListener("change", handler);
  }, [acceptFile]);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) acceptFile(file.name);
  };

  const generate = async () => {
    const fileObj = inputRef.current?.files?.[0];
    if (phase !== "file" || !fileObj) return;

    setPhase("loading");
    setErrorMessage("");
    setIcsBlob(null);

    try {
      const formData = new FormData();
      formData.append("file", fileObj);

      const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";
      const res = await fetch(`${API_URL}/upload`, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Error desconocido del servidor." }));
        throw new Error(err.detail ?? `Error ${res.status}`);
      }

      const blob = await res.blob();

      // Contar eventos en el .ics para mostrar en la UI
      const text = await blob.text();
      const count = (text.match(/BEGIN:VEVENT/g) ?? []).length;

      setIcsBlob(blob);
      setEventCount(count);
      setPhase("success");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Error al conectar con el servidor.");
      setPhase("error");
    }
  };

  const reset = () => {
    setPhase("idle");
    setFileName("");
    setErrorMessage("");
    setIcsBlob(null);
    setEventCount(0);
    if (inputRef.current) inputRef.current.value = "";
  };

  const downloadIcs = () => {
    if (!icsBlob) return;
    const url = URL.createObjectURL(icsBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${fileName.replace(".pdf", "") || "mi_semestre"}.ics`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex min-h-screen flex-col bg-background font-sans antialiased">
      {/* Header */}
      <header className="border-b border-border/60">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-6">
          <a href="/" className="flex items-center gap-2.5">
            <span className="flex size-8 items-center justify-center rounded-lg bg-primary">
              <Bot className="size-5 text-primary-foreground" />
            </span>
            <span className="text-lg font-semibold tracking-tight text-foreground">Syllabot</span>
          </a>
          <button className="rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted">
            Iniciar Sesión
          </button>
        </div>
      </header>

      {/* Hero + Dropzone */}
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col items-center px-6 pb-24 pt-20 text-center sm:pt-28">
        <h1 className="max-w-3xl text-balance text-4xl font-bold leading-[1.1] tracking-tight text-foreground sm:text-6xl">
          Tu semestre organizado en segundos, no en horas.
        </h1>
        <p className="mt-5 max-w-xl text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg">
          Sube tu s&iacute;labo y nuestra IA extraer&aacute; todas las fechas de ex&aacute;menes y entregas directamente
          a tu Google Calendar.
        </p>

        {/* Dropzone */}
        <div className="mt-12 w-full max-w-2xl">
          {phase === "idle" || phase === "file" || phase === "loading" ? (
            <>
              <label
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
                className={`flex cursor-pointer flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed bg-card px-8 py-16 transition-colors ${
                  dragging
                    ? "border-primary bg-accent"
                    : "border-border hover:border-primary/50 hover:bg-muted/50"
                }`}
              >
                <input
                  ref={inputRef}
                  type="file"
                  accept=".pdf,.doc,.docx"
                  className="hidden"
                  disabled={phase === "loading"}
                />
                {phase === "loading" ? (
                  <>
                    <Loader2 className="size-12 animate-spin text-primary" />
                    <div>
                      <p className="text-lg font-semibold text-foreground">
                        Leyendo fechas con IA...
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Esto tomará solo unos segundos.
                      </p>
                    </div>
                  </>
                ) : phase === "file" ? (
                  <>
                    <span className="flex size-14 items-center justify-center rounded-xl bg-success/10">
                      <Check className="size-7 text-success" />
                    </span>
                    <div>
                      <p className="text-lg font-semibold text-foreground">{fileName}</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Archivo cargado. Haz clic para cambiarlo.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        reset();
                      }}
                      className="mt-1 flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                      aria-label="Quitar archivo"
                    >
                      <X className="size-3.5" /> Quitar archivo
                    </button>
                  </>
                ) : (
                  <>
                    <span className="flex size-14 items-center justify-center rounded-xl bg-accent">
                      <CloudUpload className="size-7 text-accent-foreground" />
                    </span>
                    <div>
                      <p className="text-lg font-semibold text-foreground">
                        Arrastra tu s&iacute;labo aqu&iacute; o haz clic para buscar
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Formatos compatibles: PDF, Word (.docx)
                      </p>
                    </div>
                    <FileText className="size-5 text-muted-foreground/50" />
                  </>
                )}
              </label>

              <button
                onClick={generate}
                disabled={phase !== "file"}
                className="mt-8 inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-primary px-8 text-base font-semibold text-primary-foreground shadow-sm transition-all hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {phase === "loading" ? (
                  <>
                    <Loader2 className="size-5 animate-spin" />
                    Leyendo fechas con IA...
                  </>
                ) : (
                  "Generar Calendario"
                )}
              </button>
            </>
          ) : phase === "success" ? (
            <div className="flex flex-col items-center gap-6 rounded-2xl border border-border bg-card px-8 py-14 shadow-sm">
              <span className="flex size-16 items-center justify-center rounded-full bg-success/10">
                <CalendarCheck className="size-8 text-success" />
              </span>
              <div>
                <h2 className="text-2xl font-bold tracking-tight text-foreground">
                  ¡Tu calendario está listo!
                </h2>
                <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
                  Encontramos{" "}
                  <span className="font-semibold text-foreground">
                    {eventCount} {eventCount === 1 ? "evaluación" : "evaluaciones"}
                  </span>{" "}
                  en <span className="font-medium">{fileName}</span>.
                </p>
              </div>
              <div className="flex flex-col items-center gap-3 sm:flex-row">
                <button
                  onClick={downloadIcs}
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-success px-8 text-base font-semibold text-success-foreground shadow-sm transition-all hover:bg-success/90"
                >
                  <Download className="size-5" />
                  Descargar archivo .ics
                </button>
                <button
                  onClick={reset}
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-border bg-card px-6 text-base font-medium text-foreground transition-colors hover:bg-muted"
                >
                  <RotateCcw className="size-4" />
                  Analizar otro s&iacute;labo
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-6 rounded-2xl border border-destructive/40 bg-destructive/5 px-8 py-14">
              <span className="flex size-16 items-center justify-center rounded-full bg-destructive/10">
                <X className="size-8 text-destructive" />
              </span>
              <div>
                <h2 className="text-2xl font-bold tracking-tight text-foreground">
                  Algo salió mal
                </h2>
                <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
                  {errorMessage}
                </p>
              </div>
              <button
                onClick={reset}
                className="inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-border bg-card px-6 text-base font-medium text-foreground transition-colors hover:bg-muted"
              >
                <RotateCcw className="size-4" />
                Intentar de nuevo
              </button>
            </div>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-border/60 py-8">
        <p className="text-center text-sm text-muted-foreground">
          &copy; 2026 Syllabot &mdash; De s&iacute;labos ca&oacute;ticos a semestres organizados.
        </p>
      </footer>
    </div>
  );
}
