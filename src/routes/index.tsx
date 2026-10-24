import { useCallback, useEffect, useRef, useState } from "react";
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
  ChevronDown,
  Settings,
  BookOpen,
} from "lucide-react";
import { useAuth } from "@/auth/AuthContext";
import { LoginScreen } from "@/auth/LoginScreen";
import { GoogleAuthProvider, signInWithPopup } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { Calendar, dateFnsLocalizer } from "react-big-calendar";
import { format, parse, startOfWeek, getDay } from "date-fns";
import { es } from "date-fns/locale";
import { toast } from "sonner";
import confetti from "canvas-confetti";
import "react-big-calendar/lib/css/react-big-calendar.css";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SettingsDialog } from "@/components/SettingsDialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

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

function MascotBubble({ phase, progress }: { phase: Phase; progress?: number }) {
  const config = MASCOT_CONFIG[phase];
  let message = config.message;
  if (phase === "loading" && typeof progress === "number") {
    if (progress < 25) message = "Extrayendo el texto de tu sílabo...";
    else if (progress < 60) message = "Analizando evaluaciones y fechas con IA...";
    else if (progress < 95) message = "Organizando exámenes, prácticas y ponderaciones...";
    else message = "¡Casi listo! Generando tu calendario...";
  }

  return (
    <div className="flex items-end gap-2.5 sm:gap-3.5 mb-6 justify-start">
      <div className="relative shrink-0">
        <img
          src={config.src}
          alt="Syllabot mascota"
          className="w-16 h-16 sm:w-20 sm:h-20 object-contain drop-shadow-md"
        />
      </div>
      <div className="relative bg-card border border-border rounded-2xl rounded-bl-sm px-3.5 py-2.5 sm:px-4 sm:py-3 max-w-[240px] sm:max-w-xs shadow-sm">
        <p className="text-xs sm:text-sm font-medium text-foreground leading-relaxed">{message}</p>
        <div className="absolute -left-2 bottom-3 w-0 h-0 border-t-[6px] border-t-transparent border-b-[6px] border-b-transparent border-r-[8px] border-r-border" />
      </div>
    </div>
  );
}

/* ── Stepper de Progreso Adaptable a Móvil y Desktop ── */
function FlowStepper({ phase }: { phase: Phase }) {
  const steps = [
    { key: "upload", label: "1. Subir Sílabo", short: "1. Subir" },
    { key: "analyze", label: "2. Procesar IA", short: "2. IA" },
    { key: "review", label: "3. Revisar Eventos", short: "3. Revisar" },
    { key: "export", label: "4. Exportar", short: "4. Exportar" },
  ];

  let currentIdx = 0;
  if (phase === "loading") currentIdx = 1;
  else if (phase === "success") currentIdx = 2;

  return (
    <div className="w-full bg-muted/40 border border-border/80 rounded-2xl p-1.5 sm:p-2.5 mb-6 sm:mb-8">
      <div className="grid grid-cols-4 gap-1 sm:gap-2 text-center">
        {steps.map((st, i) => {
          const isDone = i < currentIdx;
          const isCurrent = i === currentIdx;
          return (
            <div
              key={st.key}
              className={`flex items-center justify-center gap-1 sm:gap-1.5 py-1.5 px-1 sm:px-2 rounded-xl text-[10px] sm:text-xs font-semibold transition-all ${
                isCurrent
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : isDone
                    ? "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10"
                    : "text-muted-foreground/60"
              }`}
            >
              {isDone && <Check size={11} className="stroke-[3] shrink-0" />}
              <span className="hidden sm:inline truncate">{st.label}</span>
              <span className="sm:hidden truncate">{st.short}</span>
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

/* ── Helpers para usuario ── */
function getGoogleDefaultLetter(name?: string | null, email?: string | null): string {
  if (name && name.trim()) return name.trim().charAt(0).toUpperCase();
  if (email && email.trim()) return email.trim().charAt(0).toUpperCase();
  return "U";
}

function getGoogleAvatarColor(letter: string): string {
  const colors: Record<string, string> = {
    A: "bg-[#795548]",
    B: "bg-[#e91e63]",
    C: "bg-[#9c27b0]",
    D: "bg-[#673ab7]",
    E: "bg-[#3f51b5]",
    F: "bg-[#2196f3]",
    G: "bg-[#03a9f4]",
    H: "bg-[#00bcd4]",
    I: "bg-[#009688]",
    J: "bg-[#4caf50]",
    K: "bg-[#8bc34a]",
    L: "bg-[#cddc39]",
    M: "bg-[#ffeb3b] text-black",
    N: "bg-[#ffc107] text-black",
    O: "bg-[#ff9800]",
    P: "bg-[#2e7d32]",
    Q: "bg-[#f44336]",
    R: "bg-[#00897b]",
    S: "bg-[#d81b60]",
    T: "bg-[#8e24aa]",
    U: "bg-[#5e35b1]",
    V: "bg-[#3949ab]",
    W: "bg-[#1e88e5]",
    X: "bg-[#039be5]",
    Y: "bg-[#00acc1]",
    Z: "bg-[#00897b]",
  };
  return colors[letter.toUpperCase()] || "bg-[#2e7d32]";
}

function formatUserName(name?: string | null): string {
  if (!name) return "Estudiante";
  if (name === name.toUpperCase()) {
    return name
      .toLowerCase()
      .split(" ")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
  }
  return name;
}

/* ── Reglas Estrictas de Evaluaciones (UNMSM / Universidad) ── */
interface RawEval {
  nombre?: string;
  fecha?: string;
  peso?: number;
  semana?: number;
}

interface NormalizedEval {
  nombre: string;
  fecha: string;
  peso: number;
  semana: number;
}

function sanitizeEvaluacionesFrontend(rawList: RawEval[]): RawEval[] {
  if (!rawList || rawList.length === 0) return [];

  const cleaned: NormalizedEval[] = [];
  for (const e of rawList) {
    const nombre = (e.nombre || "").trim();
    if (nombre.length > 0) {
      cleaned.push({
        nombre,
        fecha: e.fecha || "0000-00-00",
        peso: typeof e.peso === "number" ? e.peso : 0,
        semana: typeof e.semana === "number" ? e.semana : 0,
      });
    }
  }

  const parcialCandidates: NormalizedEval[] = [];
  const finalCandidates: NormalizedEval[] = [];
  const practicaCandidates: NormalizedEval[] = [];
  const proyectoCandidates: NormalizedEval[] = [];
  const otrosCandidates: NormalizedEval[] = [];

  for (const ev of cleaned) {
    const n = ev.nombre.toLowerCase();
    const isProyecto = /\b(proyecto|avance|entregable|sustentaci[oó]n|informe)\b/i.test(n);
    const isPractica = /(pr[aá]ctica\s+calificad[ao]|\bpc\b|\bpc\s*\d|\bpr[aá]ctica\s*\d)/i.test(n);
    const isParcial = /\b(parcial|ep)\b/i.test(n) && !isProyecto;
    const isFinal = /\b(final|ef)\b/i.test(n) && !isProyecto && !isParcial;

    if (isParcial) {
      parcialCandidates.push(ev);
    } else if (isFinal) {
      finalCandidates.push(ev);
    } else if (isPractica) {
      practicaCandidates.push(ev);
    } else if (isProyecto) {
      proyectoCandidates.push(ev);
    } else {
      otrosCandidates.push(ev);
    }
  }

  const result: NormalizedEval[] = [];

  // 1. Regla: Máximo 1 Examen Parcial (cercano a semana 8)
  if (parcialCandidates.length > 0) {
    const firstParcial = parcialCandidates[0];
    if (firstParcial) {
      let bestParcial = firstParcial;
      for (const curr of parcialCandidates) {
        const prevDiff = bestParcial.semana > 0 ? Math.abs(bestParcial.semana - 8) : 99;
        const currDiff = curr.semana > 0 ? Math.abs(curr.semana - 8) : 99;
        if (currDiff < prevDiff) {
          bestParcial = curr;
        }
      }
      result.push({ ...bestParcial, nombre: "Examen Parcial" });
    }
  }

  // 2. Regla: Máximo 1 Examen Final (nunca en semana 8 ni misma fecha que parcial)
  if (finalCandidates.length > 0) {
    const validFinals = finalCandidates.filter((f) => {
      if (
        result.some(
          (r) => r.nombre === "Examen Parcial" && r.fecha === f.fecha && f.fecha !== "0000-00-00",
        )
      ) {
        return false;
      }
      if (f.semana > 0 && f.semana <= 8) return false;
      return true;
    });

    const pool =
      validFinals.length > 0
        ? validFinals
        : !result.some((r) => r.nombre === "Examen Parcial")
          ? finalCandidates
          : [];

    if (pool.length > 0) {
      const firstFinal = pool[0];
      if (firstFinal) {
        let bestFinal = firstFinal;
        for (const curr of pool) {
          if (curr.semana > bestFinal.semana || curr.fecha > bestFinal.fecha) {
            bestFinal = curr;
          }
        }
        result.push({ ...bestFinal, nombre: "Examen Final" });
      }
    }
  }

  // 3. Regla: Prácticas Calificadas (Máximo 2 o menos)
  if (practicaCandidates.length > 0) {
    practicaCandidates.sort((a, b) => {
      if (a.semana !== b.semana) return a.semana - b.semana;
      return a.fecha.localeCompare(b.fecha);
    });
    const uniquePcs: NormalizedEval[] = [];
    const seenPcs = new Set<string>();
    for (const pc of practicaCandidates) {
      const key = `${pc.semana}-${pc.fecha}`;
      if (!seenPcs.has(key) || key === "0-0000-00-00") {
        uniquePcs.push(pc);
        if (key !== "0-0000-00-00") seenPcs.add(key);
      }
    }
    const selectedPcs = uniquePcs.slice(0, 2);
    for (let i = 0; i < selectedPcs.length; i++) {
      const pc = selectedPcs[i];
      if (pc) {
        result.push({
          ...pc,
          nombre: `Práctica Calificada ${i + 1}`,
        });
      }
    }
  }

  // 4. Regla: Proyectos y Entregables (semana 15 es Presentación de Proyecto Final)
  if (proyectoCandidates.length > 0) {
    proyectoCandidates.sort((a, b) => {
      if (a.semana !== b.semana) return a.semana - b.semana;
      return a.fecha.localeCompare(b.fecha);
    });

    let uniqueProjs: NormalizedEval[] = [];
    const seenProj = new Set<string>();
    for (const pr of proyectoCandidates) {
      const key = `${pr.semana}-${pr.fecha}`;
      if (!seenProj.has(key) || key === "0-0000-00-00") {
        uniqueProjs.push(pr);
        if (key !== "0-0000-00-00") seenProj.add(key);
      }
    }

    if (uniqueProjs.some((p) => p.semana === 15) && uniqueProjs.some((p) => p.semana === 16)) {
      uniqueProjs = uniqueProjs.filter((p) => p.semana !== 16);
    }

    const ordinals: Record<number, string> = {
      1: "1er",
      2: "2do",
      3: "3er",
      4: "4to",
      5: "5to",
      6: "6to",
      7: "7mo",
      8: "8vo",
    };

    if (uniqueProjs.length === 1) {
      const p = uniqueProjs[0];
      if (p) {
        const isFinal = p.semana >= 14 || p.semana === 0;
        result.push({
          ...p,
          nombre: isFinal ? "Presentación de Proyecto Final" : "1er Entregable de Proyecto",
        });
      }
    } else if (uniqueProjs.length > 1) {
      let finalIdx = uniqueProjs.findIndex((p) => p.semana === 15);
      const lastProj = uniqueProjs[uniqueProjs.length - 1];
      if (finalIdx === -1 && lastProj && lastProj.semana >= 14) {
        finalIdx = uniqueProjs.length - 1;
      }

      let entregableCount = 1;
      for (let idx = 0; idx < uniqueProjs.length; idx++) {
        const p = uniqueProjs[idx];
        if (!p) continue;
        if (idx === finalIdx) {
          result.push({ ...p, nombre: "Presentación de Proyecto Final" });
        } else {
          const ordStr = ordinals[entregableCount] ?? `${entregableCount}°`;
          result.push({ ...p, nombre: `${ordStr} Entregable de Proyecto` });
          entregableCount++;
        }
      }
    }
  }

  // 5. Otros Hitos
  for (const ot of otrosCandidates) {
    if (!result.some((r) => r.nombre === ot.nombre && r.fecha === ot.fecha)) {
      result.push(ot);
    }
  }

  result.sort((a, b) => {
    if (a.semana > 0 && b.semana > 0 && a.semana !== b.semana) {
      return a.semana - b.semana;
    }
    if (a.fecha !== "0000-00-00" && b.fecha !== "0000-00-00") {
      return a.fecha.localeCompare(b.fecha);
    }
    return 0;
  });

  return result;
}

function MarqueeFileName({ name }: { name: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLParagraphElement>(null);
  const [scrollDistance, setScrollDistance] = useState(0);
  const [isHovered, setIsHovered] = useState(false);

  useEffect(() => {
    const updateDistance = () => {
      if (containerRef.current && textRef.current) {
        const diff = textRef.current.scrollWidth - containerRef.current.clientWidth;
        setScrollDistance(diff > 0 ? diff : 0);
      }
    };
    updateDistance();
    window.addEventListener("resize", updateDistance);
    return () => window.removeEventListener("resize", updateDistance);
  }, [name]);

  const hasOverflow = scrollDistance > 0;
  const duration = Math.max(3.5, (scrollDistance / 35) * 2);

  return (
    <div
      ref={containerRef}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className="relative w-full overflow-hidden cursor-default"
      title={name}
    >
      <p
        ref={textRef}
        style={
          isHovered && hasOverflow
            ? ({
                animation: `marquee-bounce ${duration}s ease-in-out infinite alternate`,
                "--marquee-dist": `-${scrollDistance + 6}px`,
              } as React.CSSProperties)
            : { transform: "translateX(0)" }
        }
        className={`text-sm font-semibold text-foreground whitespace-nowrap inline-block transition-transform ${
          !isHovered && hasOverflow ? "truncate max-w-full block" : ""
        }`}
      >
        {name}
      </p>
    </div>
  );
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
  const [editTitle, setEditTitle] = useState("");
  const [editDate, setEditDate] = useState("");
  const [showAddModal, setShowAddModal] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [newEventTitle, setNewEventTitle] = useState("");
  const [newEventDate, setNewEventDate] = useState("");
  const [newEventCategory, setNewEventCategory] = useState<EventCategory>("practica");
  const [isSyncingCalendar, setIsSyncingCalendar] = useState(false);
  const [courseName, setCourseName] = useState("");
  const [analysisProgress, setAnalysisProgress] = useState(0);
  const [isCalendarAuthorized, setIsCalendarAuthorized] = useState(false);
  const [successModalData, setSuccessModalData] = useState<{
    open: boolean;
    count: number;
    courseName: string;
  }>({
    open: false,
    count: 0,
    courseName: "",
  });

  useEffect(() => {
    if (!user) return;
    const authKey = `gcal_authorized_${user.uid}`;
    const tokenKey = `gcal_token_${user.uid}`;
    const expKey = `gcal_token_exp_${user.uid}`;
    const hasAuthorized = localStorage.getItem(authKey) === "true";
    const cachedToken = sessionStorage.getItem(tokenKey);
    const cachedExp = sessionStorage.getItem(expKey);

    if (hasAuthorized || (cachedToken && cachedExp && Date.now() < Number(cachedExp))) {
      setIsCalendarAuthorized(true);
    }
  }, [user]);

  const deriveCourseName = (fileName: string, detectedCourse?: string): string => {
    if (detectedCourse && detectedCourse.trim()) return detectedCourse.trim();
    let name = fileName.replace(/\.[^/.]+$/, "");
    name = name.replace(/^(silabo|s[ií]labo|syllabus|unmsm|fisi|curso)[\s_\-–—]*/i, "");
    name = name.replace(/[\s_\-–—]*(202\d([-\s]?[iIvV\d]+)?|semestre[\w-]*)$/i, "");
    name = name.replace(/[_-]+/g, " ").trim();
    if (name.length > 0) {
      return name
        .toLowerCase()
        .split(" ")
        .map((w) => (w.length > 2 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
        .join(" ");
    }
    return "Curso";
  };

  const inputRef = useRef<HTMLInputElement>(null);

  const handleLogout = async () => {
    try {
      setEvents([]);
      setSelectedFile(null);
      setFileName("");
      setPhase("idle");
      setErrorMessage("");
      setEditingId(null);
      setEditTitle("");
      setEditDate("");
      setCourseName("");
      setAnalysisProgress(0);
      setIsCalendarAuthorized(false);
      setSuccessModalData({ open: false, count: 0, courseName: "" });
      sessionStorage.clear();
      await logout();
      toast.success("Has cerrado sesión exitosamente");
    } catch (err) {
      console.error("Error al cerrar sesión:", err);
      toast.error("Ocurrió un error al cerrar sesión");
    }
  };

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
    setAnalysisProgress(5);

    // Animación de carga continua y suave sin estancarse
    const progressInterval = setInterval(() => {
      setAnalysisProgress((prev) => {
        if (prev < 25) return prev + 1; // 5 -> 25 (inicio y lectura: ~3s a 150ms)
        if (prev < 60) return prev + 1; // 25 -> 60 (análisis con IA: ~5s)
        if (prev < 80) return Math.random() > 0.35 ? prev + 1 : prev; // 60 -> 80 (procesando cronograma: ~4.5s)
        if (prev < 92) return Math.random() > 0.55 ? prev + 1 : prev; // 80 -> 92 (extrayendo fechas: ~4s)
        if (prev < 98) return Math.random() > 0.75 ? prev + 1 : prev; // 92 -> 98 (micro-avance continuo: nunca se congela)
        return prev;
      });
    }, 150);

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
      const detectedCourse = deriveCourseName(selectedFile.name, data.curso);
      setCourseName(detectedCourse);

      // Cuando la IA termina, avanzamos al 100%
      clearInterval(progressInterval);
      setAnalysisProgress(100);
      await new Promise((resolve) => setTimeout(resolve, 450));

      let minDate = new Date();
      const rawEvaluaciones: RawEval[] = sanitizeEvaluacionesFrontend(data.evaluaciones || []);
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

      const parsedEvents: SyllabotEvent[] = rawEvaluaciones.map((ev: RawEval, index: number) => {
        const hasExactDate =
          Boolean(ev.fecha) && ev.fecha !== "0000-00-00" && !ev.fecha!.includes("0000");

        let startDate: Date;
        if (hasExactDate) {
          startDate = new Date(ev.fecha!.replace(/\//g, "-") + "T10:00:00");
        } else {
          startDate = new Date(vagueDate);
          startDate.setHours(10, 0, 0, 0);
        }

        const endDate = new Date(startDate.getTime() + 2 * 60 * 60 * 1000);
        const dateWarning = hasExactDate ? "" : " ⚠️";
        const title = (ev.nombre || "Evaluación").trim();

        const eventItem: SyllabotEvent = {
          id: `ev-${index}-${Date.now()}`,
          title: title + dateWarning,
          tooltip: `${title}${typeof ev.peso === "number" && ev.peso > 0 ? ` (${ev.peso}%)` : ""}${
            hasExactDate ? "" : " (Fecha sin especificar)"
          }`,
          start: isNaN(startDate.getTime()) ? new Date() : startDate,
          end: isNaN(endDate.getTime()) ? new Date() : endDate,
          description: `Peso de la evaluación: ${typeof ev.peso === "number" ? ev.peso : "No especificado"}%`,
          category: categorizeEvent(title),
          selected: true,
          hasExactDate: hasExactDate,
          isVagueDate: !hasExactDate,
          vagueDateRef: vagueDate.getTime(),
          ...(typeof ev.peso === "number" ? { peso: ev.peso } : {}),
        };
        return eventItem;
      });

      setEvents(parsedEvents);
      setCurrentDate(vagueDate);
      setPhase("success");

      toast.success(
        `¡Análisis completado! Se detectaron ${parsedEvents.length} evaluaciones clave.`,
      );
    } catch (err) {
      clearInterval(progressInterval);
      setAnalysisProgress(0);
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
    setEditingId(null);
    setEditTitle("");
    setEditDate("");
    setCourseName("");
    setAnalysisProgress(0);
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

  const startEditing = (ev: SyllabotEvent) => {
    setEditingId(ev.id);
    setEditTitle(ev.title.replace(/ ⚠️/g, ""));
    if (ev.hasExactDate && !isNaN(ev.start.getTime())) {
      try {
        setEditDate(format(ev.start, "yyyy-MM-dd"));
      } catch {
        setEditDate("");
      }
    } else {
      setEditDate("");
    }
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditTitle("");
    setEditDate("");
    setCourseName("");
  };

  const handleSaveEvent = (id: string) => {
    const cleanTitle = editTitle.trim();
    if (!cleanTitle) {
      toast.error("El nombre de la evaluación no puede estar vacío");
      return;
    }

    let dateWasUpdated = false;
    let targetDate: Date | null = null;

    setEvents((prev) =>
      prev.map((e) => {
        if (e.id !== id) return e;

        let newStart = e.start;
        let newEnd = e.end;
        let hasExact = e.hasExactDate;

        if (editDate) {
          const parsed = new Date(`${editDate}T10:00:00`);
          if (!isNaN(parsed.getTime())) {
            newStart = parsed;
            newEnd = new Date(parsed.getTime() + 2 * 60 * 60 * 1000);
            hasExact = true;
            dateWasUpdated = true;
            targetDate = parsed;
          }
        }

        const dateWarning = hasExact ? "" : " ⚠️";

        return {
          ...e,
          title: cleanTitle + dateWarning,
          tooltip: `${cleanTitle}${typeof e.peso === "number" && e.peso > 0 ? ` (${e.peso}%)` : ""}${
            hasExact ? "" : " (Fecha sin especificar)"
          }`,
          start: newStart,
          end: newEnd,
          hasExactDate: hasExact,
          isVagueDate: !hasExact,
          category: categorizeEvent(cleanTitle),
        };
      }),
    );

    if (dateWasUpdated && targetDate) {
      setCurrentDate(targetDate);
      toast.success("Fecha actualizada y posicionada en el calendario");
    } else {
      toast.success("Evaluación actualizada");
    }

    setEditingId(null);
    setEditTitle("");
    setEditDate("");
    setCourseName("");
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

  /* ── Sincronizar directamente con Google Calendar ── */
  const handleSyncGoogleCalendar = async () => {
    const activeEvents = events.filter((e) => e.selected);
    if (activeEvents.length === 0) {
      toast.error("Selecciona al menos una evaluación para sincronizar.");
      return;
    }

    setIsSyncingCalendar(true);
    const syncToastId = toast.loading("Conectando con Google Calendar...");

    const cachedTokenKey = user?.uid ? `gcal_token_${user.uid}` : "gcal_token";
    const cachedExpiryKey = user?.uid ? `gcal_token_exp_${user.uid}` : "gcal_token_exp";

    try {
      let accessToken: string | undefined;

      // 1. Verificar si ya otorgó permiso previamente y tenemos token activo en memoria
      const cachedToken = sessionStorage.getItem(cachedTokenKey);
      const cachedExpiry = sessionStorage.getItem(cachedExpiryKey);

      if (cachedToken && cachedExpiry && Date.now() < Number(cachedExpiry)) {
        accessToken = cachedToken;
      } else {
        // Primera vez o sesión vencida (>1 hora): Solicitar permiso una sola vez
        const provider = new GoogleAuthProvider();
        provider.addScope("https://www.googleapis.com/auth/calendar.events");
        if (user?.email) {
          provider.setCustomParameters({
            login_hint: user.email,
          });
        }

        const result = await signInWithPopup(auth, provider);
        const credential = GoogleAuthProvider.credentialFromResult(result);
        accessToken = credential?.accessToken;

        if (!accessToken) {
          throw new Error("No se pudo obtener el token de acceso de Google Calendar.");
        }

        // Guardar token en sessionStorage (válido por 50 minutos)
        sessionStorage.setItem(cachedTokenKey, accessToken);
        sessionStorage.setItem(cachedExpiryKey, (Date.now() + 50 * 60 * 1000).toString());
      }

      toast.loading(`Sincronizando ${activeEvents.length} evaluaciones con tu Google Calendar...`, {
        id: syncToastId,
      });

      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Lima";

      let successCount = 0;
      for (const ev of activeEvents) {
        const cleanTitle = ev.title.replace(/ ⚠️/g, "");
        const eventSummary = courseName.trim()
          ? `${cleanTitle} - ${courseName.trim()}`
          : cleanTitle;

        const descriptionLines = [
          "📌 Evaluación sincronizada automáticamente por Syllabot UNMSM.",
          courseName.trim() ? `Curso: ${courseName.trim()}` : "",
          ev.description ? `Detalle: ${ev.description}` : "",
          ev.hasExactDate === false
            ? "⚠️ Advertencia: Fecha estimada en el sílabo. Confirma la fecha exacta con tu docente."
            : "",
        ].filter(Boolean);

        let colorId = "9"; // Azul marino (Prácticas)
        if (ev.category === "examen")
          colorId = "11"; // Rojo (Exámenes)
        else if (ev.category === "proyecto") colorId = "5"; // Amarillo (Proyectos)

        const eventPayload = {
          summary: eventSummary,
          description: descriptionLines.join("\n\n"),
          start: {
            dateTime: ev.start.toISOString(),
            timeZone,
          },
          end: {
            dateTime: ev.end.toISOString(),
            timeZone,
          },
          colorId,
          reminders: {
            useDefault: false,
            overrides: [
              { method: "popup", minutes: 24 * 60 },
              { method: "popup", minutes: 120 },
            ],
          },
        };

        const response = await fetch(
          "https://www.googleapis.com/calendar/v3/calendars/primary/events",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(eventPayload),
          },
        );

        if (!response.ok) {
          if (response.status === 401) {
            sessionStorage.removeItem(cachedTokenKey);
            sessionStorage.removeItem(cachedExpiryKey);
            throw new Error(
              "La sesión de Google Calendar expiró. Vuelve a hacer clic para autorizar.",
            );
          }
          const errBody = await response.json().catch(() => null);
          console.error("Error al crear evento en Google Calendar:", errBody);
          throw new Error(
            errBody?.error?.message || `Error al guardar "${eventSummary}" en Google Calendar.`,
          );
        }
        successCount++;
      }

      if (user?.uid) {
        localStorage.setItem(`gcal_authorized_${user.uid}`, "true");
      }
      setIsCalendarAuthorized(true);

      toast.dismiss(syncToastId);
      confetti({ particleCount: 90, spread: 75, origin: { y: 0.55 } });

      const finalCourseName = courseName.trim() || "Tu Asignatura";

      // Limpiar el fondo (calendario, archivo y revisión) dejándolo listo para subir otro archivo
      reset();

      // Abrir modal centrado con fondo difuminado
      setSuccessModalData({
        open: true,
        count: successCount,
        courseName: finalCourseName,
      });
    } catch (err: unknown) {
      toast.dismiss(syncToastId);
      console.error("Error sincronizando con Google Calendar:", err);
      const message =
        err instanceof Error ? err.message : "Ocurrió un error al sincronizar con Google Calendar.";

      if (typeof message === "string" && message.includes("auth/popup-closed-by-user")) {
        toast.info("Sincronización cancelada.");
      } else {
        toast.error(message);
      }
    } finally {
      setIsSyncingCalendar(false);
    }
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
      const eventSummary = courseName.trim() ? `${cleanTitle} - ${courseName.trim()}` : cleanTitle;

      icsContent.push(
        "BEGIN:VEVENT",
        `UID:${uid}`,
        `DTSTAMP:${toICSDate(new Date())}`,
        `DTSTART:${startStr}`,
        `DTEND:${endStr}`,
        `SUMMARY:${eventSummary}`,
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
      {/* ── Header con tono índigo más claro y luminoso ── */}
      <header className="sticky top-0 z-50 bg-gradient-to-r from-[#202758] via-[#2d3775] to-[#202758] border-b border-indigo-400/25 shadow-lg shadow-indigo-950/15 relative overflow-hidden">
        {/* Gradientes de luz sutiles que aportan claridad y profundidad */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,_rgba(129,140,248,0.35)_0%,_transparent_65%)] pointer-events-none" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_right,_rgba(99,102,241,0.25)_0%,_transparent_65%)] pointer-events-none" />
        <div className="absolute top-0 left-0 w-full h-[2px] bg-gradient-to-r from-indigo-400 via-sky-400 to-indigo-500 pointer-events-none" />

        <div className="relative z-10 mx-auto flex h-16 w-full max-w-7xl items-center justify-between px-4 sm:px-6">
          <a
            href="/"
            className="flex items-center gap-2.5 sm:gap-3 group transition-transform active:scale-95 shrink-0"
          >
            <img
              src="/SYLLABOT.png"
              alt="Syllabot Logo"
              className="size-8 sm:size-9 object-contain drop-shadow-md transition-transform group-hover:scale-105"
            />
            <span className="text-lg sm:text-xl font-bold font-space tracking-tight text-white drop-shadow-sm">
              Syllabot
            </span>
          </a>

          {/* Menú desplegable del Usuario adaptable */}
          <div className="flex items-center gap-2 sm:gap-3">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="group flex items-center gap-2 sm:gap-3 py-1 px-2 sm:py-1.5 sm:px-3 rounded-full sm:rounded-2xl bg-white/10 hover:bg-white/15 border border-white/15 hover:border-indigo-300/40 transition-all duration-200 outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 cursor-pointer text-left shadow-sm"
                >
                  {user?.photoURL ? (
                    <img
                      src={user.photoURL}
                      alt={user?.displayName || "Usuario"}
                      referrerPolicy="no-referrer"
                      className="size-8 sm:size-9 rounded-full object-cover border border-indigo-300/40 shadow-sm shrink-0"
                    />
                  ) : (
                    <div
                      className={`size-8 sm:size-9 rounded-full ${getGoogleAvatarColor(
                        getGoogleDefaultLetter(user?.displayName, user?.email),
                      )} text-white flex items-center justify-center text-xs sm:text-sm font-semibold border border-indigo-300/40 shadow-sm shrink-0`}
                    >
                      {getGoogleDefaultLetter(user?.displayName, user?.email)}
                    </div>
                  )}

                  <div className="hidden sm:flex flex-col min-w-0 pr-1 text-left">
                    <span className="text-xs sm:text-sm font-semibold text-white truncate max-w-[130px] md:max-w-[200px] lg:max-w-[240px] leading-tight">
                      {formatUserName(user?.displayName) || "Estudiante"}
                    </span>
                    <span className="text-[11px] text-indigo-100/80 truncate max-w-[130px] md:max-w-[200px] lg:max-w-[240px] leading-tight">
                      {user?.email}
                    </span>
                  </div>

                  <ChevronDown className="size-3.5 text-indigo-100/70 group-hover:text-white transition-transform duration-200 shrink-0" />
                </button>
              </DropdownMenuTrigger>

              <DropdownMenuContent
                align="end"
                sideOffset={8}
                className="w-[calc(100vw-2rem)] sm:w-80 max-w-sm p-2.5 bg-[#1b224c]/95 border border-indigo-400/30 text-white shadow-2xl rounded-2xl backdrop-blur-2xl z-50"
              >
                {/* Cabecera del usuario en el desplegable (sin círculo) */}
                <div className="p-3 rounded-xl bg-white/[0.08] border border-white/10 mb-1.5">
                  <div className="flex flex-col min-w-0">
                    <p className="text-sm font-semibold text-white truncate leading-snug">
                      {formatUserName(user?.displayName) || "Estudiante"}
                    </p>
                    <p className="text-xs text-indigo-100/80 truncate leading-snug mt-0.5">
                      {user?.email}
                    </p>
                    <span className="inline-flex items-center gap-1.5 text-[10px] text-emerald-300 font-medium mt-1.5">
                      <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      Cuenta UNMSM activa
                    </span>
                  </div>
                </div>

                <DropdownMenuSeparator className="bg-white/10 my-1" />

                <DropdownMenuItem
                  onClick={() => setIsSettingsOpen(true)}
                  className="flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-slate-100 hover:text-white focus:bg-white/[0.12] focus:text-white rounded-lg cursor-pointer transition-colors"
                >
                  <Settings className="size-4 text-indigo-300" />
                  <span>Configuración</span>
                </DropdownMenuItem>

                <DropdownMenuSeparator className="bg-white/10 my-1" />

                <DropdownMenuItem
                  onClick={handleLogout}
                  className="flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-rose-300 hover:text-rose-200 focus:bg-rose-500/20 focus:text-rose-200 rounded-lg cursor-pointer transition-colors"
                >
                  <LogOut className="size-4" />
                  <span>Cerrar sesión</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      {/* Modal de Configuración */}
      <SettingsDialog open={isSettingsOpen} onOpenChange={setIsSettingsOpen} user={user} />

      {/* ── Modal Emergente de Éxito de Exportación al Centro de la Pantalla ── */}
      <Dialog
        open={successModalData.open}
        onOpenChange={(open) => setSuccessModalData((prev) => ({ ...prev, open }))}
      >
        <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-md bg-card border border-border/80 shadow-2xl rounded-2xl p-6 text-center animate-in fade-in zoom-in-95 duration-200">
          <div className="flex flex-col items-center justify-center gap-4 py-2">
            {/* Icono de Check con Halo Esmeralda */}
            <div className="relative">
              <div className="absolute inset-0 rounded-full bg-emerald-500/20 blur-xl animate-pulse" />
              <div className="relative size-16 rounded-full bg-emerald-500/10 border-2 border-emerald-500/30 flex items-center justify-center text-emerald-500 shadow-sm">
                <CheckCircle2 size={36} className="stroke-[2.5]" />
              </div>
            </div>

            <DialogHeader className="text-center sm:text-center space-y-1.5">
              <DialogTitle className="text-xl sm:text-2xl font-black text-foreground tracking-tight text-center">
                ¡Exportación Completada!
              </DialogTitle>
              <DialogDescription className="text-xs sm:text-sm text-muted-foreground leading-relaxed text-center">
                Se agregaron exitosamente{" "}
                <span className="font-bold text-foreground">
                  {successModalData.count} evaluaciones
                </span>{" "}
                a tu Google Calendar de San Marcos.
              </DialogDescription>
            </DialogHeader>

            {/* Tarjeta resumen del curso exportado */}
            <div className="w-full bg-muted/40 border border-border/80 rounded-xl p-3.5 text-left text-xs space-y-2">
              <div className="flex items-center gap-2">
                <BookOpen size={15} className="text-primary shrink-0" />
                <span className="font-semibold text-foreground truncate">
                  {successModalData.courseName}
                </span>
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <CalendarIcon size={14} className="text-emerald-500 shrink-0" />
                <span>Recordatorios configurados: 1 día y 2 horas antes</span>
              </div>
            </div>

            {/* Botones de acción */}
            <div className="flex flex-col sm:flex-row items-center gap-2.5 w-full mt-2">
              <button
                type="button"
                onClick={() => {
                  window.open("https://calendar.google.com", "_blank");
                  setSuccessModalData((prev) => ({ ...prev, open: false }));
                }}
                className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-bold py-2.5 px-4 rounded-xl text-xs sm:text-sm shadow-md transition-all active:scale-[0.99] cursor-pointer"
              >
                <span>Ver en Google Calendar</span>
                <ExternalLink size={15} />
              </button>

              <button
                type="button"
                onClick={() => setSuccessModalData((prev) => ({ ...prev, open: false }))}
                className="w-full sm:w-auto px-5 py-2.5 rounded-xl border border-border/80 bg-background hover:bg-muted text-foreground text-xs sm:text-sm font-semibold transition-all cursor-pointer"
              >
                Cerrar
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Main Two-Column Layout Adaptable a Móvil, Tablet y Desktop ── */}
      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col lg:flex-row gap-8 lg:gap-10 px-4 sm:px-6 pb-16 sm:pb-20 pt-6 sm:pt-8 lg:pt-10">
        {/* Left Column: Upload & Review */}
        <div className="w-full lg:w-[420px] xl:w-[450px] lg:shrink-0 flex flex-col items-start text-left max-w-2xl lg:max-w-none mx-auto lg:mx-0 min-w-0">
          <h1 className="text-2xl sm:text-3xl lg:text-4xl font-extrabold leading-tight tracking-tight text-foreground mb-3 text-center lg:text-left w-full lg:w-auto">
            Tu semestre organizado en segundos.
          </h1>
          <p className="text-muted-foreground text-sm sm:text-base mb-6 text-center lg:text-left w-full lg:w-auto">
            Sube tu sílabo y nuestra IA extraerá todas las fechas de evaluaciones para que puedas
            revisarlas y exportarlas a tu Google Calendar.
          </p>

          {/* Stepper de Progreso */}
          <FlowStepper phase={phase} />

          {/* Mascot + Speech Bubble */}
          <MascotBubble phase={phase} progress={analysisProgress} />

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
                    <div className="w-full flex flex-col items-center justify-center py-2 animate-in fade-in duration-300">
                      {/* Anillo de Carga Circular con Porcentaje en el Centro */}
                      <div className="relative size-24 sm:size-28 flex items-center justify-center">
                        <svg className="size-full -rotate-90" viewBox="0 0 100 100">
                          {/* Círculo de fondo */}
                          <circle
                            cx="50"
                            cy="50"
                            r="40"
                            className="stroke-muted/30"
                            strokeWidth="8"
                            fill="transparent"
                          />
                          {/* Círculo de progreso animado */}
                          <circle
                            cx="50"
                            cy="50"
                            r="40"
                            stroke="url(#analysis-gradient)"
                            strokeWidth="8"
                            strokeLinecap="round"
                            fill="transparent"
                            strokeDasharray={251.32}
                            strokeDashoffset={251.32 - (251.32 * analysisProgress) / 100}
                            className="transition-all duration-300 ease-out"
                          />
                          <defs>
                            <linearGradient
                              id="analysis-gradient"
                              x1="0%"
                              y1="0%"
                              x2="100%"
                              y2="100%"
                            >
                              <stop offset="0%" stopColor="#4f46e5" />
                              <stop offset="50%" stopColor="#6366f1" />
                              <stop offset="100%" stopColor="#06b6d4" />
                            </linearGradient>
                          </defs>
                        </svg>

                        {/* Porcentaje en el Centro */}
                        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                          <span className="font-space text-2xl sm:text-3xl font-black text-foreground tracking-tight">
                            {analysisProgress}%
                          </span>
                        </div>
                      </div>

                      {/* Mensaje dinámico según el porcentaje de avance */}
                      <div className="text-center mt-4 max-w-xs space-y-1">
                        <p className="text-base sm:text-lg font-bold text-foreground">
                          {analysisProgress < 25 && "Extrayendo texto del sílabo..."}
                          {analysisProgress >= 25 &&
                            analysisProgress < 60 &&
                            "Analizando cronograma con IA..."}
                          {analysisProgress >= 60 &&
                            analysisProgress < 100 &&
                            "Sanitizando exámenes y prácticas..."}
                          {analysisProgress === 100 && "¡Análisis completado al 100%!"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {analysisProgress < 100
                            ? "Identificando parciales, finales y entregables"
                            : "Generando tu calendario semestral..."}
                        </p>
                      </div>

                      {/* Mini barra de progreso lineal de soporte */}
                      <div className="w-48 sm:w-56 h-1.5 bg-muted/60 rounded-full mt-3 overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-indigo-500 via-sky-500 to-emerald-500 rounded-full transition-all duration-300 ease-out"
                          style={{ width: `${analysisProgress}%` }}
                        />
                      </div>
                    </div>
                  ) : phase === "file" && selectedFile ? (
                    <div className="w-full flex flex-col items-center">
                      <div className="w-full bg-muted/50 border border-border rounded-xl p-4 flex items-center justify-between gap-3 min-w-0 overflow-hidden">
                        <div className="flex items-center gap-3 min-w-0 flex-1 overflow-hidden">
                          <span className="flex size-11 items-center justify-center rounded-lg bg-primary/10 text-primary shrink-0">
                            <FileText size={22} />
                          </span>
                          <div className="min-w-0 text-left flex-1 overflow-hidden">
                            <MarqueeFileName name={fileName} />
                            <p className="text-xs text-muted-foreground mt-0.5">
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
                    <div className="flex items-center gap-2">
                      <Loader2 className="size-5 animate-spin" />
                      <span>Analizando sílabo...</span>
                    </div>
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
                {/* Asignatura / Curso editable */}
                <div className="flex flex-col gap-1.5 p-3 rounded-xl bg-primary/5 border border-primary/20">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-primary flex items-center gap-1.5">
                      <BookOpen size={14} /> Asignatura / Curso:
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      Se exportará como: Examen Final - {courseName || "Nombre del Curso"}
                    </span>
                  </div>
                  <input
                    type="text"
                    value={courseName}
                    onChange={(e) => setCourseName(e.target.value)}
                    placeholder="Ej. Procesos Estocásticos"
                    className="w-full text-xs sm:text-sm font-semibold px-3 py-1.5 rounded-lg border border-border/80 bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-2xs"
                  />
                </div>

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
                        className={`p-3 rounded-xl border transition-all ${
                          isEditing
                            ? "bg-card border-primary/50 shadow-sm ring-1 ring-primary/20"
                            : ev.selected
                              ? "bg-card border-border shadow-xs"
                              : "bg-muted/30 border-transparent opacity-60"
                        }`}
                      >
                        {isEditing ? (
                          <div className="flex flex-col gap-2.5 w-full">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[11px] font-bold text-primary flex items-center gap-1.5">
                                <Edit2 size={12} /> Editando evaluación
                              </span>
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => handleSaveEvent(ev.id)}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shadow-xs cursor-pointer"
                                  title="Guardar cambios"
                                >
                                  <Check size={12} className="stroke-[3]" /> Guardar
                                </button>
                                <button
                                  type="button"
                                  onClick={cancelEditing}
                                  className="p-1 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
                                  title="Cancelar"
                                >
                                  <X size={14} />
                                </button>
                              </div>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              <div>
                                <label className="text-[10px] font-semibold text-muted-foreground block mb-1">
                                  Nombre de la evaluación
                                </label>
                                <input
                                  type="text"
                                  autoFocus
                                  value={editTitle}
                                  onChange={(e) => setEditTitle(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                      e.preventDefault();
                                      handleSaveEvent(ev.id);
                                    } else if (e.key === "Escape") {
                                      cancelEditing();
                                    }
                                  }}
                                  placeholder="Ej. Examen Parcial"
                                  className="w-full text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-primary/50 focus:border-primary bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                                />
                              </div>

                              <div>
                                <label className="text-[10px] font-semibold text-muted-foreground block mb-1">
                                  Fecha de la evaluación
                                </label>
                                <input
                                  type="date"
                                  value={editDate}
                                  onChange={(e) => setEditDate(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                      e.preventDefault();
                                      handleSaveEvent(ev.id);
                                    } else if (e.key === "Escape") {
                                      cancelEditing();
                                    }
                                  }}
                                  className="w-full text-xs font-medium px-2.5 py-1.5 rounded-lg border border-border focus:border-primary bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer"
                                />
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3 min-w-0 flex-1">
                              <input
                                type="checkbox"
                                checked={ev.selected}
                                onChange={() => toggleSelectEvent(ev.id)}
                                className="size-4 rounded text-primary focus:ring-primary cursor-pointer shrink-0"
                              />

                              <div className="min-w-0 flex-1">
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

                                <p className="text-[11px] text-muted-foreground mt-0.5">
                                  {ev.hasExactDate ? (
                                    format(ev.start, "dd/MM/yyyy", { locale: es })
                                  ) : (
                                    <span className="text-amber-600 dark:text-amber-400 font-medium">
                                      Fecha por confirmar
                                    </span>
                                  )}
                                  {ev.peso ? ` • ${ev.peso}% de la nota` : ""}
                                </p>
                              </div>
                            </div>

                            {/* Botones de acción */}
                            <div className="flex items-center gap-1 shrink-0 ml-2">
                              <button
                                type="button"
                                onClick={() => startEditing(ev)}
                                className="p-1.5 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
                                title="Editar evaluación y fecha"
                              >
                                <Edit2 size={13} />
                              </button>
                              <button
                                type="button"
                                onClick={() => deleteEvent(ev.id)}
                                className="p-1.5 rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors cursor-pointer"
                                title="Eliminar evento"
                              >
                                <Trash2 size={13} />
                              </button>
                            </div>
                          </div>
                        )}
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

        {/* ── Right Column: Calendar Preview Adaptable ── */}
        <div className="flex-1 min-w-0 flex flex-col bg-card border border-border rounded-2xl shadow-sm overflow-hidden min-h-[500px] h-[580px] sm:h-[640px] lg:h-[720px] w-full">
          {/* Calendar Header */}
          <div className="p-4 sm:px-6 sm:py-3.5 border-b border-border bg-muted/20 flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-3">
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

            {/* Botones de Sincronización y Exportación */}
            <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap w-full sm:w-auto">
              <button
                onClick={handleSyncGoogleCalendar}
                disabled={activeEventsCount === 0 || isSyncingCalendar}
                className="flex items-center justify-center gap-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white px-4 py-2.5 sm:py-2 rounded-xl text-xs font-bold transition-all hover:shadow-md disabled:opacity-40 disabled:cursor-not-allowed shadow-sm shrink-0 flex-1 sm:flex-none"
                title={
                  isCalendarAuthorized
                    ? "Exportar directamente a tu Google Calendar institucional"
                    : "Sincronizar y vincular tu Google Calendar institucional"
                }
              >
                {isSyncingCalendar ? (
                  <>
                    <Loader2 size={15} className="animate-spin" />
                    <span>{isCalendarAuthorized ? "Exportando..." : "Sincronizando..."}</span>
                  </>
                ) : (
                  <>
                    <CalendarIcon size={15} />
                    <span>
                      {isCalendarAuthorized
                        ? "Exportar a Google Calendar"
                        : "Sincronizar con Google Calendar"}
                    </span>
                  </>
                )}
              </button>

              <button
                onClick={handleExportICS}
                disabled={activeEventsCount === 0 || isSyncingCalendar}
                className="flex items-center justify-center gap-1.5 bg-muted/80 hover:bg-muted text-foreground border border-border/80 px-3 py-2.5 sm:py-2 rounded-xl text-xs font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-xs shrink-0"
                title="Descargar archivo .ics estándar para Apple Calendar u Outlook"
              >
                <Download size={14} />
                <span>.ics</span>
              </button>
            </div>
          </div>

          {/* Leyenda de Colores */}
          {events.length > 0 && (
            <div className="px-4 sm:px-6 py-2.5 bg-muted/30 border-b border-border/60 flex items-center gap-2.5 sm:gap-4 flex-wrap text-[11px]">
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
