import { useCallback, useEffect, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  Bot,
  CloudUpload,
  FileText,
  Check,
  X,
  Loader2,
  RotateCcw,
  LogOut,
  Calendar as CalendarIcon,
} from "lucide-react";
import { useAuth } from "@/auth/AuthContext";
import { LoginScreen } from "@/auth/LoginScreen";
import { Calendar, dateFnsLocalizer } from "react-big-calendar";
import { format, parse, startOfWeek, getDay } from "date-fns";
import { es } from "date-fns/locale";
import "react-big-calendar/lib/css/react-big-calendar.css";

const locales = {
  es: es,
};
const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: () => startOfWeek(new Date(), { weekStartsOn: 1 }),
  getDay,
  locales,
});

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      {
        title: "Syllabot Tu sílabo convertido en calendario con IA",
      },
      {
        name: "description",
        content:
          "Sube tu sílabo y nuestra IA extraerá todas las fechas de exámenes y entregas directamente a tu Google Calendar.",
      },
      { property: "og:title", content: "Syllabot - Extrae fechas con IA" },
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

type Phase = "idle" | "file" | "loading" | "success" | "error";

interface SyllabotEvent {
  title: string;
  start: Date;
  end: Date;
  description?: string;
}

function Index() {
  const { user, loading, logout } = useAuth();
  const [phase, setPhase] = useState<Phase>("idle");
  const [fileName, setFileName] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [events, setEvents] = useState<SyllabotEvent[]>([]);
  const [dragging, setDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const acceptFile = useCallback((file: File) => {
    setSelectedFile(file);
    setFileName(file.name);
    setPhase("file");
  }, []);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    const handler = (e: Event) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) acceptFile(file);
    };
    input.addEventListener("change", handler);
    return () => input.removeEventListener("change", handler);
  }, [acceptFile]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#07091a]">
        <Loader2 size={40} className="animate-spin text-indigo-400" />
      </div>
    );
  }
  if (!user) return <LoginScreen />;

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) acceptFile(file);
  };

  const generate = async () => {
    if (phase !== "file" || !selectedFile) return;

    setPhase("loading");
    setErrorMessage("");
    setEvents([]);

    try {
      const formData = new FormData();
      formData.append("file", selectedFile);

      const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";
      const res = await fetch(`${API_URL}/upload`, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        let detail = `Error ${res.status}`;
        try {
          const errJson = await res.json();
          detail = errJson.detail ?? detail;
        } catch {
          const text = await res.text().catch(() => "");
          detail = text.slice(0, 200) || detail;
        }
        throw new Error(detail);
      }

      // El backend ahora devuelve JSON
      const data = await res.json();

      const parsedEvents = (data.evaluaciones || []).map(
        (ev: {
          nombre: string;
          fecha: string;
          peso?: number;
        }) => {
          let startDate = new Date();
          let hasExactDate = false;

          if (ev.fecha && ev.fecha !== "0000-00-00" && !ev.fecha.includes("0000")) {
            const cleanDate = ev.fecha.replace(/\//g, "-");
            const parsedDate = new Date(cleanDate + "T10:00:00");
            if (!isNaN(parsedDate.getTime())) {
              startDate = parsedDate;
              hasExactDate = true;
            }
          }

          const endDate = new Date(startDate.getTime() + 2 * 60 * 60 * 1000);
          const dateWarning = hasExactDate ? "" : " ⚠️ (Día sin especificar)";

          return {
            title: ev.nombre, // Solo el nombre corto para el cuadradito
            tooltip: `${ev.nombre}${ev.peso ? ` (${ev.peso}%)` : ""}${dateWarning}`, // Detalle completo para el hover
            start: startDate,
            end: endDate,
            description: `Peso de la evaluación: ${ev.peso || "No especificado"}%`,
          };
        }
      );

      setEvents(parsedEvents);
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
    setEvents([]);
    setSelectedFile(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div className="flex min-h-screen flex-col bg-background font-sans antialiased overflow-x-hidden">
      <header className="border-b border-border/60">
        <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between px-6">
          <a href="/" className="flex items-center gap-2.5">
            <span className="flex size-8 items-center justify-center rounded-lg bg-primary">
              <Bot className="size-5 text-primary-foreground" />
            </span>
            <span className="text-lg font-semibold tracking-tight text-foreground">Syllabot</span>
          </a>

          <div className="flex items-center gap-4">
            <div className="hidden sm:flex flex-col items-end">
              <span className="text-sm font-semibold text-foreground">
                {user?.displayName || "Estudiante"}
              </span>
              <span className="text-xs text-muted-foreground">{user?.email}</span>
            </div>
            <button
              onClick={logout}
              className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10"
              title="Cerrar sesión"
            >
              <LogOut size={16} />
              <span className="hidden sm:inline">Salir</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Two-Column Layout */}
      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col lg:flex-row gap-12 px-6 pb-24 pt-12 lg:pt-16">
        {/* Left Column: Upload */}
        <div className="flex-1 flex flex-col items-start text-left lg:pt-8 w-full max-w-[500px] mx-auto lg:max-w-none">
          <h1 className="text-4xl font-bold leading-[1.1] tracking-tight text-foreground sm:text-5xl mb-6 text-center lg:text-left">
            Tu semestre organizado en segundos.
          </h1>
          <p className="text-muted-foreground text-lg mb-10 text-center lg:text-left">
            Sube tu sílabo y nuestra IA extraerá todas las fechas de evaluaciones para que puedas
            revisarlas y exportarlas a tu Google Calendar.
          </p>

          <div className="w-full">
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
                      <div className="text-center">
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
                      <div className="text-center">
                        <p className="text-lg font-semibold text-foreground break-all">
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
                      >
                        <X className="size-3.5" /> Quitar archivo
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="flex size-14 items-center justify-center rounded-xl bg-accent">
                        <CloudUpload className="size-7 text-accent-foreground" />
                      </span>
                      <div className="text-center">
                        <p className="text-lg font-semibold text-foreground">
                          Arrastra tu sílabo aquí o haz clic
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
                  className="mt-6 w-full h-12 flex items-center justify-center gap-2 rounded-xl bg-primary px-8 text-base font-semibold text-primary-foreground shadow-sm transition-all hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {phase === "loading" ? (
                    <>
                      <Loader2 className="size-5 animate-spin" />
                      Procesando...
                    </>
                  ) : (
                    "Visualizar Fechas"
                  )}
                </button>
              </>
            ) : phase === "success" ? (
              <div className="flex flex-col items-start gap-4 rounded-2xl border border-border bg-card px-6 py-8 shadow-sm w-full">
                <div className="flex items-center gap-4">
                  <span className="flex size-12 items-center justify-center rounded-full bg-success/10 shrink-0">
                    <Check className="size-6 text-success" />
                  </span>
                  <div>
                    <h2 className="text-xl font-bold tracking-tight text-foreground">
                      ¡Análisis completado!
                    </h2>
                    <p className="text-sm text-muted-foreground">
                      Encontramos {events.length}{" "}
                      {events.length === 1 ? "evaluación" : "evaluaciones"}. Revisa el calendario.
                    </p>
                  </div>
                </div>
                <button
                  onClick={reset}
                  className="mt-4 w-full h-12 inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-card text-base font-medium text-foreground transition-colors hover:bg-muted"
                >
                  <RotateCcw className="size-4" />
                  Analizar otro sílabo
                </button>
              </div>
            ) : (
              <div className="flex flex-col items-start gap-4 rounded-2xl border border-destructive/40 bg-destructive/5 px-6 py-8 w-full">
                <div className="flex items-center gap-4">
                  <span className="flex size-12 items-center justify-center rounded-full bg-destructive/10 shrink-0">
                    <X className="size-6 text-destructive" />
                  </span>
                  <div>
                    <h2 className="text-xl font-bold tracking-tight text-foreground">
                      Algo salió mal
                    </h2>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground">{errorMessage}</p>
                <button
                  onClick={reset}
                  className="mt-4 w-full h-12 inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-card text-base font-medium text-foreground transition-colors hover:bg-muted"
                >
                  <RotateCcw className="size-4" />
                  Intentar de nuevo
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Calendar Preview */}
        <div className="flex-[1.5] flex flex-col bg-card border border-border rounded-2xl shadow-sm overflow-hidden h-[600px] lg:h-[700px] w-full">
          {/* Header */}
          <div className="px-6 py-4 border-b border-border bg-muted/20 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <h3 className="font-semibold text-lg flex items-center gap-2">
              <CalendarIcon className="text-primary" size={20} /> Vista Previa
            </h3>
            <button
              disabled={events.length === 0}
              className="flex items-center gap-2 bg-[#4285F4] text-white px-5 py-2.5 rounded-xl font-medium transition-all hover:bg-[#3367d6] disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
            >
              <svg viewBox="0 0 24 24" className="w-4 h-4 fill-white shrink-0">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
              </svg>
              Exportar a Calendar
            </button>
          </div>

          {/* Calendar Body */}
          <div className="flex-1 p-4 overflow-hidden relative">
            {events.length === 0 && phase !== "success" ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground/50 z-10 p-6 text-center">
                <CalendarIcon size={64} className="mb-4 opacity-50" />
                <p className="text-lg">Sube un sílabo para ver las fechas aquí</p>
              </div>
            ) : null}

            <div
              className={`h-full ${events.length === 0 ? "opacity-30 pointer-events-none" : ""}`}
            >
              <Calendar
                localizer={localizer}
                events={events}
                startAccessor="start"
                endAccessor="end"
                tooltipAccessor="tooltip"
                style={{ height: "100%", minHeight: 400 }}
                culture="es"
                messages={{
                  next: "Sig",
                  previous: "Ant",
                  today: "Hoy",
                  month: "Mes",
                  week: "Semana",
                  day: "Día",
                  agenda: "Agenda",
                  date: "Fecha",
                  time: "Hora",
                  event: "Evaluación",
                  noEventsInRange: "No hay evaluaciones en esta fecha.",
                }}
                defaultView="month"
                views={["month", "agenda"]}
              />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
