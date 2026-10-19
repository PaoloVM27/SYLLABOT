import { useState } from "react";
import type { User } from "firebase/auth";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Bell, CheckCircle2, Calendar, Globe, Mail, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: User | null;
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

export function SettingsDialog({ open, onOpenChange, user }: SettingsDialogProps) {
  const [reminderDayBefore, setReminderDayBefore] = useState(true);
  const [reminderHourBefore, setReminderHourBefore] = useState(true);
  const [calendarPrefix, setCalendarPrefix] = useState("Syllabot - 2026");

  const handleSave = () => {
    toast.success("Preferencias guardadas correctamente");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-md max-h-[90vh] overflow-y-auto bg-card border-border shadow-2xl rounded-2xl p-0">
        {/* Header con gradiente temático más claro */}
        <div className="bg-gradient-to-r from-[#202758] via-[#2d3775] to-[#202758] text-white p-4 sm:p-6 relative overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,_rgba(129,140,248,0.35)_0%,_transparent_60%)] pointer-events-none" />
          <div className="absolute top-0 left-0 w-full h-[2px] bg-gradient-to-r from-indigo-400 via-sky-400 to-indigo-500" />

          <DialogHeader className="relative z-10 text-left">
            <DialogTitle className="text-xl font-bold font-space text-white flex items-center gap-2">
              Configuración
            </DialogTitle>
            <DialogDescription className="text-indigo-200/70 text-xs">
              Ajustes de tu perfil institucional y preferencias de exportación.
            </DialogDescription>
          </DialogHeader>

          {/* Tarjeta de perfil en header */}
          <div className="relative z-10 mt-4 flex items-center gap-3 p-3 rounded-xl bg-white/[0.08] border border-white/10 backdrop-blur-md">
            {user?.photoURL ? (
              <img
                src={user.photoURL}
                alt={user?.displayName || "Usuario"}
                referrerPolicy="no-referrer"
                className="size-11 sm:size-12 rounded-full object-cover border-2 border-indigo-400/40 shadow-md shrink-0"
              />
            ) : (
              <div className="size-11 sm:size-12 rounded-full bg-[#2e7d32] text-white flex items-center justify-center text-sm font-semibold border-2 border-indigo-400/40 shadow-md shrink-0">
                {user?.displayName?.charAt(0).toUpperCase() ||
                  user?.email?.charAt(0).toUpperCase() ||
                  "U"}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-white truncate">
                {formatUserName(user?.displayName) || "Estudiante"}
              </p>
              <div className="flex items-center gap-1.5 text-xs text-indigo-200/80 truncate mt-0.5">
                <Mail className="size-3 shrink-0" />
                <span className="truncate">{user?.email}</span>
              </div>
              <div className="flex items-center gap-1 mt-1 text-[11px] font-medium text-emerald-400">
                <CheckCircle2 className="size-3" />
                <span>Cuenta @unmsm.edu.pe verificada</span>
              </div>
            </div>
          </div>
        </div>

        {/* Cuerpo de configuración */}
        <div className="p-4 sm:p-6 space-y-4 sm:space-y-5">
          {/* Sincronización Google Calendar */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
              <Calendar className="size-3.5 text-primary" />
              <span>Sincronización con Google Calendar</span>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium text-foreground block">
                Nombre de calendario predeterminado
              </label>
              <input
                type="text"
                value={calendarPrefix}
                onChange={(e) => setCalendarPrefix(e.target.value)}
                placeholder="Ej. Syllabot - 2026-I"
                className="w-full px-3 py-2 text-xs rounded-xl border border-border bg-muted/40 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-all"
              />
            </div>

            <div className="space-y-2 pt-1">
              <span className="text-xs font-medium text-foreground block">
                Recordatorios automáticos en el evento
              </span>
              <div className="space-y-2">
                <label className="flex items-center gap-2.5 text-xs text-foreground cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={reminderDayBefore}
                    onChange={(e) => setReminderDayBefore(e.target.checked)}
                    className="rounded border-border text-primary focus:ring-primary size-4"
                  />
                  <Bell className="size-3.5 text-muted-foreground" />
                  <span>Notificación 24 horas antes del examen/entrega</span>
                </label>
                <label className="flex items-center gap-2.5 text-xs text-foreground cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={reminderHourBefore}
                    onChange={(e) => setReminderHourBefore(e.target.checked)}
                    className="rounded border-border text-primary focus:ring-primary size-4"
                  />
                  <Bell className="size-3.5 text-muted-foreground" />
                  <span>Notificación 2 horas antes</span>
                </label>
              </div>
            </div>
          </div>

          {/* Información del Sistema */}
          <div className="rounded-xl border border-border/70 bg-muted/30 p-3 space-y-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <Globe className="size-3.5" />
                Zona horaria
              </span>
              <span className="font-semibold text-foreground">America/Lima (GMT-5)</span>
            </div>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <ShieldCheck className="size-3.5" />
                Seguridad
              </span>
              <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                Google OAuth 2.0
              </span>
            </div>
          </div>
        </div>

        <DialogFooter className="px-4 sm:px-6 py-3 bg-muted/20 border-t border-border flex flex-row items-center justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            className="rounded-xl text-xs"
          >
            Cancelar
          </Button>
          <Button size="sm" onClick={handleSave} className="rounded-xl text-xs font-medium">
            Guardar cambios
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
