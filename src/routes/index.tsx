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
        title: "Syllabot — Tu sílabo convertido en calendario con IA",
      },
      {
        name: "description",
        content:
          "Sube tu sílabo universitario en PDF o Word y Syllabot extrae exámenes y entregas con IA para generar un archivo .ics listo para Google Calendar.",
      },
      { property: "og:title", content: "Syllabot — Tu semestre organizado en segundos" },
      {
        property: "og:description",
        content:
          "Sube tu sílabo y nuestra IA extraerá todas las fechas de exámenes y entregas directamente a tu Google Calendar.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

type Phase = "idle" | "file" | "loading" | "success";

function Index() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [fileName, setFileName] = useState<string>("");
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const acceptFile = useCallback((name: string) => {
    setFileName(name);
    setPhase("file");
  }, []);

  // Native change listener: React's synthetic onChange misses file-picker
  // change events in some environments.
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

  const generate = () => {
    if (phase !== "file") return;
    setPhase("loading");
    timerRef.current = setTimeout(() => setPhase("success"), 2800);
  };

  const reset = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setPhase("idle");
    setFileName("");
    if (inputRef.current) inputRef.current.value = "";
  };

  const downloadIcs = () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Syllabot//ES",
      "BEGIN:VEVENT",
      "SUMMARY:Examen Parcial 1 (generado con Syllabot)",
      "DTSTART;VALUE=DATE:20261005",
      "DTEND;VALUE=DATE:20261006",
      "DESCRIPTION:Evento de ejemplo extraído de tu sílabo.",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const blob = new Blob([ics], { type: "text/calendar" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "mi_semestre.ics";
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
            <span className="text-lg font-semibold tracking-tight text-foreground">
              Syllabot
            </span>
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
          Sube tu sílabo y nuestra IA extraerá todas las fechas de exámenes y
          entregas directamente a tu Google Calendar.
        </p>

        {/* Dropzone */}
        <div className="mt-12 w-full max-w-2xl">
          {phase !== "success" ? (
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
                      <p className="text-lg font-semibold text-foreground">
                        {fileName}
                      </p>
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
                        Arrastra tu sílabo aquí o haz clic para buscar
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
          ) : (
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
                    12 fechas de exámenes y entregas
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
                  Analizar otro sílabo
                </button>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-border/60 py-8">
        <p className="text-center text-sm text-muted-foreground">
          © 2026 Syllabot — De sílabos caóticos a semestres organizados.
        </p>
      </footer>
    </div>
  );
}
