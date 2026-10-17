import { useCallback, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  CloudUpload,
  FileText,
  Check,
  X,
  Loader2,
  RotateCcw,
  LogOut,
  Calendar as CalendarIcon,
  Trash2,
  Edit2,
  Plus,
  Download,
  ExternalLink,
  Sparkles,
  CheckCircle2,
} from "lucide-react";
import { useAuth } from "@/auth/AuthContext";
import { LoginScreen } from "@/auth/LoginScreen";
import { Calendar, dateFnsLocalizer } from "react-big-calendar";
import { format, parse, startOfWeek, getDay } from "date-fns";
import { es } from "date-fns/locale";
import { toast } from "sonner";
import confetti from "canvas-confetti";
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
type EventCategory = "examen" | "practica" | "proyecto" | "otro";

interface SyllabotEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  description?: string;
  tooltip?: string;
  peso?: number;
  category: EventCategory;
  selected: boolean;
  hasExactDate: boolean;
  isVagueDate?: boolean;
  vagueDateRef?: number;
}

/* ── Clasificador de Categorías por Color ── */
function categorizeEvent(name: string): EventCategory {
  const n = name.toLowerCase();
  if (
    n.includes("examen") ||
    n.includes("parcial") ||
    (n.includes("final") && !n.includes("proyecto"))
  ) {
    return "examen";
  }
  if (n.includes("práctica") || n.includes("practica") || n.includes("pc")) {
    return "practica";
  }
  if (
    n.includes("proyecto") ||
    n.includes("avance") ||
    n.includes("entregable") ||
    n.includes("sustentaci") ||
    n.includes("laboratorio")
  ) {
    return "proyecto";
  }
  return "otro";
}

/* ── Configuración Visual de Categorías ── */
const CATEGORY_STYLES: Record<
  EventCategory,
  { label: string; bg: string; border: string; text: string; badge: string; dot: string }
> = {
  examen: {
    label: "Exámenes",
    bg: "#e11d48", // Rose 600
    border: "#be123c",
    text: "#ffffff",
    badge:
      "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/30 dark:text-rose-300 dark:border-rose-800",
    dot: "bg-rose-500",
  },
  practica: {
    label: "Prácticas Calificadas",
    bg: "#4f46e5", // Indigo 600
    border: "#4338ca",
    text: "#ffffff",
    badge:
      "bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/30 dark:text-indigo-300 dark:border-indigo-800",
    dot: "bg-indigo-500",
  },
  proyecto: {
    label: "Proyectos / Entregables",
    bg: "#059669", // Emerald 600
    border: "#047857",
    text: "#ffffff",
    badge:
      "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-800",
    dot: "bg-emerald-500",
  },
  otro: {
    label: "Otros Hitos",
    bg: "#d97706", // Amber 600
    border: "#b45309",
    text: "#ffffff",
    badge:
      "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-800",
    dot: "bg-amber-500",
  },
};

/* ── Configuración de Mascota por Estado ── */
const MASCOT_CONFIG: Record<Phase, { src: string; message: string }> = {
  idle: {
    src: "/syllabot_02_saludando.png",
    message: "¡Hola! Sube tu sílabo y te organizo el semestre",
  },
  file: {
    src: "/syllabot_03_pulgar_arriba.png",
    message: '¡Perfecto! Dale a "Visualizar Fechas" cuando estés listo',
  },
  loading: {
    src: "/syllabot_04_pensando.png",
    message: "Analizando tu sílabo... dame unos segundos",
  },
  success: {
    src: "/syllabot_06_celebrando.png",
    message: "¡Listo! Revisa y edita las fechas antes de exportar",
  },
  error: {
    src: "/syllabot_08_sorprendido.png",
    message: "¡Ups! Algo no salió bien, intentémoslo de nuevo",
  },
};

function MascotBubble({ phase }: { phase: Phase }) {
  const config = MASCOT_CONFIG[phase];
  return (
    <div className="flex items-end gap-3.5 mb-6">
      <div className="relative shrink-0">
        <img
          src={config.src}
          alt="Syllabot mascota"
          className="w-20 h-20 object-contain drop-shadow-md"
        />
      </div>
      <div className="relative bg-card border border-border rounded-2xl rounded-bl-sm px-4 py-3 max-w-xs shadow-sm">
        <p className="text-xs sm:text-sm font-medium text-foreground leading-relaxed">
          {config.message}
        </p>
        <div className="absolute -left-2 bottom-3 w-0 h-0 border-t-[6px] border-t-transparent border-b-[6px] border-b-transparent border-r-[8px] border-r-border" />
      </div>
    </div>
  );
}

/* ── Stepper de Progreso ── */
function FlowStepper({ phase }: { phase: Phase }) {
  const steps = [
    { key: "upload", label: "1. Subir Sílabo" },
    { key: "analyze", label: "2. Procesar IA" },
    { key: "review", label: "3. Revisar Eventos" },
    { key: "export", label: "4. Exportar" },
  ];

  let currentIdx = 0;
  if (phase === "loading") currentIdx = 1;
  else if (phase === "success") currentIdx = 2;

  return (
    <div className="w-full bg-muted/40 border border-border/80 rounded-2xl p-2.5 mb-8">
      <div className="grid grid-cols-4 gap-2 text-center">
        {steps.map((st, i) => {
          const isDone = i < currentIdx;
          const isCurrent = i === currentIdx;
          return (
            <div
              key={st.key}
              className={`flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-xl text-xs font-semibold transition-all ${
                isCurrent
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : isDone
                    ? "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10"
                    : "text-muted-foreground/60"
              }`}
            >
              {isDone && <Check size={12} className="stroke-[3]" />}
              <span className="truncate">{st.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── Helper para formatear bytes ── */
function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function Index() {
  const { user, loading, logout } = useAuth();
  const [phase, setPhase] = useState<Phase>("idle");
  const [fileName, setFileName] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [events, setEvents] = useState<SyllabotEvent[]>([]);
  const [calendarView, setCalendarView] = useState<string>("month");
  const [currentDate, setCurrentDate] = useState<Date>(new Date());
  const [dragging, setDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newEventTitle, setNewEventTitle] = useState("");
  const [newEventDate, setNewEventDate] = useState("");
  const [newEventCategory, setNewEventCategory] = useState<EventCategory>("practica");

  const inputRef = useRef<HTMLInputElement>(null);

  const acceptFile = useCallback((file: File) => {
    const validExtensions = [".pdf", ".doc", ".docx"];
    const isVal = validExtensions.some((ext) => file.name.toLowerCase().endsWith(ext));
    if (!isVal) {
      toast.error("Formato no compatible. Por favor sube un archivo PDF o Word (.docx)");
      return;
    }
    setSelectedFile(file);
    setFileName(file.name);
    setPhase("file");
    toast.info(`Archivo cargado: ${file.name}`);
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 size={40} className="animate-spin text-primary" />
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

    const toastLoadingId = toast.loading("Analizando sílabo con Inteligencia Artificial...");

    try {
      const formData = new FormData();
      formData.append("file", selectedFile);

      const API_URL = (import.meta.env["VITE_API_URL"] as string) || "http://localhost:8000";
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

      const data = await res.json();

      let minDate = new Date();
      interface RawEval {
        nombre?: string;
        fecha?: string;
        peso?: number;
      }
      const rawEvaluaciones: RawEval[] = data.evaluaciones || [];
      const exactDates = rawEvaluaciones.filter(
        (e): e is RawEval & { fecha: string } =>
          Boolean(e.fecha) && e.fecha !== "0000-00-00" && !e.fecha!.includes("0000"),
      );
      if (exactDates.length > 0) {
        const times = exactDates.map((e) =>
          new Date(e.fecha.replace(/\//g, "-") + "T10:00:00").getTime(),
        );
        minDate = new Date(Math.min(...times));
      }

      // Fecha ancla para agrupar eventos sin fecha fija
      const vagueDate = new Date(minDate);
      vagueDate.setDate(vagueDate.getDate() - 1);
      vagueDate.setHours(0, 0, 0, 0);

      const parsedEvents: SyllabotEvent[] = (data.evaluaciones || []).map(
        (
          ev: {
            nombre: string;
            fecha: string;
            peso?: number;
          },
          index: number,
        ) => {
          const hasExactDate =
            Boolean(ev.fecha) && ev.fecha !== "0000-00-00" && !ev.fecha.includes("0000");

          let startDate: Date;
          if (hasExactDate) {
            startDate = new Date(ev.fecha.replace(/\//g, "-") + "T10:00:00");
          } else {
            startDate = new Date(vagueDate);
            startDate.setHours(10, 0, 0, 0);
          }

          const endDate = new Date(startDate.getTime() + 2 * 60 * 60 * 1000);
          const dateWarning = hasExactDate ? "" : " ⚠️";

          return {
            id: `ev-${index}-${Date.now()}`,
            title: ev.nombre + dateWarning,
            tooltip: `${ev.nombre}${ev.peso ? ` (${ev.peso}%)` : ""}${
              hasExactDate ? "" : " (Fecha sin especificar)"
            }`,
            start: isNaN(startDate.getTime()) ? new Date() : startDate,
            end: isNaN(endDate.getTime()) ? new Date() : endDate,
            description: `Peso de la evaluación: ${ev.peso || "No especificado"}%`,
            peso: ev.peso,
            category: categorizeEvent(ev.nombre),
            selected: true,
            hasExactDate: hasExactDate,
            isVagueDate: !hasExactDate,
            vagueDateRef: vagueDate.getTime(),
          };
        },
      );

      setEvents(parsedEvents);
      setCurrentDate(vagueDate);
      setPhase("success");

      toast.dismiss(toastLoadingId);
      toast.success(
        `¡Análisis completado! Se detectaron ${parsedEvents.length} evaluaciones clave.`,
      );
    } catch (err) {
      toast.dismiss(toastLoadingId);
      const msg = err instanceof Error ? err.message : "Error al conectar con el servidor.";
      setErrorMessage(msg);
      setPhase("error");
      toast.error(msg);
    }
  };

  const reset = () => {
    setPhase("idle");
    setFileName("");
    setErrorMessage("");
    setEvents([]);
    setSelectedFile(null);
    setCurrentDate(new Date());
    if (inputRef.current) inputRef.current.value = "";
  };

  /* ── Funciones de Edición de Eventos ── */
  const toggleSelectEvent = (id: string) => {
    setEvents((prev) => prev.map((e) => (e.id === id ? { ...e, selected: !e.selected } : e)));
  };

  const selectAll = (status: boolean) => {
    setEvents((prev) => prev.map((e) => ({ ...e, selected: status })));
  };

  const deleteEvent = (id: string) => {
    setEvents((prev) => prev.filter((e) => e.id !== id));
    toast.info("Evaluación eliminada");
  };

  const handleUpdateTitle = (id: string, newTitle: string) => {
    if (!newTitle.trim()) return;
    setEvents((prev) =>
      prev.map((e) =>
        e.id === id
          ? {
              ...e,
              title: newTitle,
              tooltip: newTitle,
              category: categorizeEvent(newTitle),
            }
          : e,
      ),
    );
    setEditingId(null);
  };

  const handleAddCustomEvent = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEventTitle.trim()) {
      toast.error("Ingresa el título de la evaluación");
      return;
    }

    let start = new Date();
    let hasExact = false;
    if (newEventDate) {
      start = new Date(`${newEventDate}T10:00:00`);
      hasExact = true;
    }
    const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);

    const newEv: SyllabotEvent = {
      id: `ev-manual-${Date.now()}`,
      title: newEventTitle,
      tooltip: newEventTitle,
      start,
      end,
      category: newEventCategory,
      selected: true,
      hasExactDate: hasExact,
      isVagueDate: !hasExact,
    };

    setEvents((prev) => [...prev, newEv]);
    setNewEventTitle("");
    setNewEventDate("");
    setShowAddModal(false);
    toast.success("Evaluación agregada manualmente");
  };

  /* ── Exportar a archivo estándar .ics (Google Calendar / Apple / Outlook) ── */
  const handleExportICS = () => {
    const activeEvents = events.filter((e) => e.selected);
    if (activeEvents.length === 0) {
      toast.error("Selecciona al menos una evaluación para exportar.");
      return;
    }

    const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
    const toICSDate = (date: Date) => {
      return (
        date.getUTCFullYear() +
        pad(date.getUTCMonth() + 1) +
        pad(date.getUTCDate()) +
        "T" +
        pad(date.getUTCHours()) +
        pad(date.getUTCMinutes()) +
        pad(date.getUTCSeconds()) +
        "Z"
      );
    };

    const icsContent = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Syllabot//UNMSM//ES",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
    ];

    activeEvents.forEach((ev) => {
      const startStr = toICSDate(ev.start);
      const endStr = toICSDate(ev.end);
      const uid = `${ev.id}@syllabot.app`;
      const cleanTitle = ev.title.replace(/ ⚠️/g, "");

      icsContent.push(
        "BEGIN:VEVENT",
        `UID:${uid}`,
        `DTSTAMP:${toICSDate(new Date())}`,
        `DTSTART:${startStr}`,
        `DTEND:${endStr}`,
        `SUMMARY:${cleanTitle}`,
        `DESCRIPTION:Evaluación extraída por Syllabot - UNMSM. ${ev.description || ""}`,
        "STATUS:CONFIRMED",
        "BEGIN:VALARM",
        "TRIGGER:-P1D",
        "ACTION:DISPLAY",
        `DESCRIPTION:Recordatorio de ${cleanTitle}`,
        "END:VALARM",
        "END:VEVENT",
      );
    });

    icsContent.push("END:VCALENDAR");

    const blob = new Blob([icsContent.join("\r\n")], {
      type: "text/calendar;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", "syllabot_evaluaciones.ics");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    // Celebración con Confetti 🎉
    confetti({
      particleCount: 100,
      spread: 70,
      origin: { y: 0.6 },
    });

    toast.success("¡Archivo .ics descargado!", {
      description:
        "Ábrelo para agregarlo automáticamente a tu Google Calendar, Apple Calendar u Outlook.",
    });
  };

  /* ── Estilos por evento en el calendario ── */
  const eventStyleGetter = (event: SyllabotEvent) => {
    const config = CATEGORY_STYLES[event.category] || CATEGORY_STYLES.otro;
    return {
      style: {
        backgroundColor: config.bg,
        borderColor: config.border,
        color: config.text,
        borderRadius: "6px",
        borderWidth: "1px",
        fontSize: "0.8rem",
        fontWeight: "600",
        padding: "2px 6px",
        boxShadow: "0 1px 2px rgba(0,0,0,0.08)",
      },
    };
  };

  // Eventos activos que se muestran en el calendario
  const calendarEvents = events.filter((e) => e.selected);
  const activeEventsCount = calendarEvents.length;

  return (
    <div className="flex min-h-screen flex-col bg-background font-sans antialiased overflow-x-hidden">
      {/* ── Header ── */}
      <header className="border-b border-border/60 bg-card/70 backdrop-blur-md sticky top-0 z-50">
        <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between px-6">
          <a href="/" className="flex items-center gap-3">
            <img src="/SYLLABOT.png" alt="Syllabot" className="size-10 object-contain" />
            <span className="text-xl font-bold tracking-tight text-foreground">Syllabot</span>
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
              className="flex items-center gap-2 rounded-xl border border-border bg-card px-3.5 py-1.5 text-xs font-semibold text-destructive transition-colors hover:bg-destructive/10"
              title="Cerrar sesión"
            >
              <LogOut size={14} />
              <span className="hidden sm:inline">Salir</span>
            </button>
          </div>
        </div>
      </header>

      {/* ── Main Two-Column Layout ── */}
      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col lg:flex-row gap-10 px-6 pb-20 pt-8 lg:pt-10">
        {/* Left Column: Upload & Review */}
        <div className="flex-1 flex flex-col items-start text-left w-full max-w-[520px] mx-auto lg:max-w-none">
          <h1 className="text-3xl font-extrabold leading-tight tracking-tight text-foreground sm:text-4xl mb-3 text-center lg:text-left">
            Tu semestre organizado en segundos.
          </h1>
          <p className="text-muted-foreground text-base mb-6 text-center lg:text-left">
            Sube tu sílabo y nuestra IA extraerá todas las fechas de evaluaciones para que puedas
            revisarlas y exportarlas a tu Google Calendar.
          </p>

          {/* Stepper de Progreso */}
          <FlowStepper phase={phase} />

          {/* Mascot + Speech Bubble */}
          <MascotBubble phase={phase} />

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
                  className={`flex cursor-pointer flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed bg-card px-8 py-12 transition-all duration-200 ${
                    dragging
                      ? "border-primary bg-primary/5 scale-[1.01] shadow-lg shadow-primary/10"
                      : "border-border hover:border-primary/50 hover:bg-muted/40"
                  }`}
                >
                  <input
                    ref={inputRef}
                    type="file"
                    accept=".pdf,.doc,.docx"
                    className="hidden"
                    disabled={phase === "loading"}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) acceptFile(file);
                    }}
                  />

                  {phase === "loading" ? (
                    <>
                      <Loader2 className="size-12 animate-spin text-primary" />
                      <div className="text-center">
                        <p className="text-lg font-bold text-foreground">
                          Leyendo fechas con IA...
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Analizando cronograma, ponderaciones y evaluaciones
                        </p>
                      </div>
                    </>
                  ) : phase === "file" && selectedFile ? (
                    <div className="w-full flex flex-col items-center">
                      <div className="w-full bg-muted/50 border border-border rounded-xl p-4 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="flex size-11 items-center justify-center rounded-lg bg-primary/10 text-primary shrink-0">
                            <FileText size={22} />
                          </span>
                          <div className="min-w-0 text-left">
                            <p className="text-sm font-semibold text-foreground truncate">
                              {fileName}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {formatFileSize(selectedFile.size)} &bull;{" "}
                              <span className="text-emerald-600 font-medium dark:text-emerald-400">
                                Listo para analizar
                              </span>
                            </p>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            reset();
                          }}
                          className="flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-background hover:text-destructive transition-colors shrink-0"
                          title="Quitar archivo"
                        >
                          <X size={18} />
                        </button>
                      </div>
                      <p className="mt-3 text-xs text-muted-foreground text-center">
                        Haz clic o arrastra otro archivo para cambiarlo
                      </p>
                    </div>
                  ) : (
                    <>
                      <span className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                        <CloudUpload className="size-7" />
                      </span>
                      <div className="text-center">
                        <p className="text-base font-semibold text-foreground">
                          Arrastra tu sílabo aquí o haz clic
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Formatos compatibles: PDF, Word (.docx) &bull; Máx. 10MB
                        </p>
                      </div>
                    </>
                  )}
                </label>

                {/* Botón Principal con Alto Contraste y Gradiente */}
                <button
                  onClick={generate}
                  disabled={phase !== "file"}
                  className="mt-5 w-full h-13 flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 via-indigo-500 to-purple-600 px-8 text-base font-bold text-white shadow-md shadow-indigo-500/20 transition-all hover:opacity-95 hover:shadow-lg hover:shadow-indigo-500/30 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
                >
                  {phase === "loading" ? (
                    <>
                      <Loader2 className="size-5 animate-spin" />
                      Procesando sílabo...
                    </>
                  ) : (
                    <>
                      <Sparkles className="size-5" />
                      Visualizar Fechas
                    </>
                  )}
                </button>
              </>
            ) : phase === "success" ? (
              /* ── Panel de Revisión Editable de Eventos ── */
              <div className="flex flex-col gap-4 w-full">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-bold text-foreground">Revisión de Evaluaciones</h2>
                    <p className="text-xs text-muted-foreground">
                      {activeEventsCount} de {events.length} seleccionadas para el calendario
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => selectAll(true)}
                      className="text-xs font-semibold text-primary hover:underline"
                    >
                      Todas
                    </button>
                    <span className="text-muted-foreground/40">&bull;</span>
                    <button
                      onClick={() => selectAll(false)}
                      className="text-xs font-semibold text-muted-foreground hover:underline"
                    >
                      Ninguna
                    </button>
                  </div>
                </div>

                {/* Lista de Eventos Editables */}
                <div className="flex flex-col gap-2 max-h-[380px] overflow-y-auto pr-1">
                  {events.map((ev) => {
                    const catStyle = CATEGORY_STYLES[ev.category];
                    const isEditing = editingId === ev.id;

                    return (
                      <div
                        key={ev.id}
                        className={`flex items-center justify-between p-3 rounded-xl border transition-all ${
                          ev.selected
                            ? "bg-card border-border shadow-xs"
                            : "bg-muted/30 border-transparent opacity-60"
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <input
                            type="checkbox"
                            checked={ev.selected}
                            onChange={() => toggleSelectEvent(ev.id)}
                            className="size-4 rounded text-primary focus:ring-primary cursor-pointer shrink-0"
                          />

                          <div className="min-w-0 flex-1">
                            {isEditing ? (
                              <input
                                autoFocus
                                defaultValue={ev.title.replace(/ ⚠️/g, "")}
                                onBlur={(e) => handleUpdateTitle(ev.id, e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter")
                                    handleUpdateTitle(ev.id, (e.target as HTMLInputElement).value);
                                }}
                                className="w-full text-xs font-semibold px-2 py-1 rounded border border-primary bg-background text-foreground"
                              />
                            ) : (
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-xs font-bold text-foreground truncate">
                                  {ev.title.replace(/ ⚠️/g, "")}
                                </span>
                                <span
                                  className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${catStyle.badge}`}
                                >
                                  {catStyle.label}
                                </span>
                              </div>
                            )}

                            <p className="text-[11px] text-muted-foreground mt-0.5">
                              {ev.hasExactDate ? (
                                format(ev.start, "dd/MM/yyyy", { locale: es })
                              ) : (
                                <span className="text-amber-600 dark:text-amber-400 font-medium">
                                  Fecha por confirmar
                                </span>
                              )}
                              {ev.peso ? ` &bull; ${ev.peso}% de la nota` : ""}
                            </p>
                          </div>
                        </div>

                        {/* Botones de acción */}
                        <div className="flex items-center gap-1 shrink-0 ml-2">
                          <button
                            onClick={() => setEditingId(isEditing ? null : ev.id)}
                            className="p-1.5 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                            title="Editar título"
                          >
                            <Edit2 size={13} />
                          </button>
                          <button
                            onClick={() => deleteEvent(ev.id)}
                            className="p-1.5 rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                            title="Eliminar evento"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Botón para agregar evaluación manual */}
                {showAddModal ? (
                  <form
                    onSubmit={handleAddCustomEvent}
                    className="p-3 bg-muted/40 border border-border rounded-xl flex flex-col gap-2.5"
                  >
                    <p className="text-xs font-bold text-foreground">Nueva Evaluación Manual</p>
                    <input
                      type="text"
                      placeholder="Nombre (ej. Práctica Calificada 3)"
                      value={newEventTitle}
                      onChange={(e) => setNewEventTitle(e.target.value)}
                      className="text-xs px-2.5 py-1.5 rounded-lg border border-border bg-background"
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="date"
                        value={newEventDate}
                        onChange={(e) => setNewEventDate(e.target.value)}
                        className="text-xs px-2 py-1.5 rounded-lg border border-border bg-background"
                      />
                      <select
                        value={newEventCategory}
                        onChange={(e) => setNewEventCategory(e.target.value as EventCategory)}
                        className="text-xs px-2 py-1.5 rounded-lg border border-border bg-background"
                      >
                        <option value="practica">Práctica</option>
                        <option value="examen">Examen</option>
                        <option value="proyecto">Proyecto</option>
                        <option value="otro">Otro</option>
                      </select>
                    </div>
                    <div className="flex justify-end gap-2 mt-1">
                      <button
                        type="button"
                        onClick={() => setShowAddModal(false)}
                        className="text-xs px-3 py-1 text-muted-foreground hover:underline"
                      >
                        Cancelar
                      </button>
                      <button
                        type="submit"
                        className="text-xs px-3 py-1 rounded-lg bg-primary text-primary-foreground font-semibold"
                      >
                        Guardar
                      </button>
                    </div>
                  </form>
                ) : (
                  <button
                    onClick={() => setShowAddModal(true)}
                    className="w-full py-2 border border-dashed border-border rounded-xl text-xs font-semibold text-muted-foreground hover:text-foreground hover:border-primary/50 transition-colors flex items-center justify-center gap-1.5"
                  >
                    <Plus size={14} /> Agregar evaluación manual
                  </button>
                )}

                <button
                  onClick={reset}
                  className="mt-2 w-full h-11 inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-card text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <RotateCcw className="size-3.5" />
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
                    <h2 className="text-lg font-bold tracking-tight text-foreground">
                      Algo salió mal
                    </h2>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">{errorMessage}</p>
                <button
                  onClick={reset}
                  className="mt-2 w-full h-11 inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-card text-xs font-semibold text-foreground transition-colors hover:bg-muted"
                >
                  <RotateCcw className="size-3.5" />
                  Intentar de nuevo
                </button>
              </div>
            )}
          </div>
        </div>

        {/* ── Right Column: Calendar Preview ── */}
        <div className="flex-[1.5] flex flex-col bg-card border border-border rounded-2xl shadow-sm overflow-hidden h-[620px] lg:h-[720px] w-full">
          {/* Calendar Header */}
          <div className="px-6 py-3.5 border-b border-border bg-muted/20 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
            <div>
              <h3 className="font-bold text-base flex items-center gap-2 text-foreground">
                <CalendarIcon className="text-primary" size={18} /> Vista Previa del Semestre
              </h3>
              {events.length > 0 && (
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Mostrando {activeEventsCount} evaluaciones seleccionadas
                </p>
              )}
            </div>

            {/* Botón de Exportar a Calendar */}
            <button
              onClick={handleExportICS}
              disabled={activeEventsCount === 0}
              className="flex items-center gap-2 bg-[#4285F4] text-white px-4 py-2 rounded-xl text-xs font-bold transition-all hover:bg-[#3367d6] hover:shadow-md disabled:opacity-40 disabled:cursor-not-allowed shadow-sm shrink-0"
              title="Descargar archivo de calendario .ics para Google Calendar"
            >
              <Download size={15} />
              Exportar a Calendar (.ics)
            </button>
          </div>

          {/* Leyenda de Colores */}
          {events.length > 0 && (
            <div className="px-6 py-2 bg-muted/30 border-b border-border/60 flex items-center gap-4 flex-wrap text-[11px]">
              <span className="font-semibold text-muted-foreground">Leyenda:</span>
              <span className="flex items-center gap-1.5 font-medium">
                <span className="size-2 rounded-full bg-rose-500" /> Exámenes
              </span>
              <span className="flex items-center gap-1.5 font-medium">
                <span className="size-2 rounded-full bg-indigo-500" /> Prácticas Calificadas
              </span>
              <span className="flex items-center gap-1.5 font-medium">
                <span className="size-2 rounded-full bg-emerald-500" /> Proyectos
              </span>
              <span className="flex items-center gap-1.5 font-medium">
                <span className="size-2 rounded-full bg-amber-500" /> Por Confirmar
              </span>
            </div>
          )}

          {/* Calendar Body */}
          <div className="flex-1 p-4 overflow-hidden relative">
            {/* Empty State Limpio y Centrado */}
            {events.length === 0 ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center z-20 p-8 text-center bg-card">
                <div className="relative mb-4">
                  <img
                    src="/syllabot_05_calendario.png"
                    alt="Syllabot calendario"
                    className="w-36 h-36 object-contain drop-shadow-md animate-pulse"
                  />
                </div>
                <h4 className="text-lg font-bold text-foreground">Tu calendario aparecerá aquí</h4>
                <p className="mt-1.5 text-xs text-muted-foreground max-w-sm leading-relaxed">
                  Sube el sílabo de tu curso. Nuestra IA detectará exámenes parciales, finales,
                  prácticas y proyectos calculando las fechas exactas del semestre.
                </p>

                {/* Badges de demostración */}
                <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
                  <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-rose-500/10 text-rose-600 border border-rose-200 dark:border-rose-800">
                    🔴 Examen Parcial
                  </span>
                  <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-indigo-500/10 text-indigo-600 border border-indigo-200 dark:border-indigo-800">
                    🔵 Práctica Calificada
                  </span>
                  <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-600 border border-emerald-200 dark:border-emerald-800">
                    🟢 Proyecto Final
                  </span>
                </div>
              </div>
            ) : (
              <div className="h-full">
                <Calendar
                  localizer={localizer}
                  events={
                    calendarView === "month"
                      ? calendarEvents.filter((e) => e.hasExactDate !== false)
                      : calendarEvents
                  }
                  onView={(view) => setCalendarView(view)}
                  date={currentDate}
                  onNavigate={(newDate) => setCurrentDate(newDate)}
                  startAccessor="start"
                  endAccessor="end"
                  tooltipAccessor="tooltip"
                  eventPropGetter={eventStyleGetter}
                  style={{ height: "100%", minHeight: 400 }}
                  culture="es"
                  length={150}
                  formats={{
                    agendaDateFormat: "dd/MM/yyyy",
                  }}
                  components={{
                    agenda: {
                      date: (props) => {
                        const isVagueDateGroup = events.some(
                          (e) =>
                            e.isVagueDate &&
                            new Date(e.vagueDateRef!).getTime() === props.day.getTime(),
                        );
                        if (isVagueDateGroup) {
                          return (
                            <span className="font-semibold text-amber-600 dark:text-amber-400">
                              Sin especificar
                            </span>
                          );
                        }
                        return <span>{props.label}</span>;
                      },
                      time: (props) => {
                        const ev = props.event as Partial<SyllabotEvent>;
                        if (ev.isVagueDate) {
                          return (
                            <span className="text-muted-foreground italic">Por confirmar</span>
                          );
                        }
                        return <span>{props.label}</span>;
                      },
                    },
                  }}
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
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
