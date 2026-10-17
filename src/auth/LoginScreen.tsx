import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { signInWithPopup, GoogleAuthProvider } from "firebase/auth";
import { auth, googleProvider } from "@/lib/firebase";
import { AlertCircle, Loader2, Lock } from "lucide-react";

const ALLOWED_DOMAIN = "@unmsm.edu.pe";

/* ── Partículas flotantes de fondo ── */
const FloatingParticles = () => (
  <div className="fixed inset-0 overflow-hidden pointer-events-none z-0">
    {[...Array(24)].map((_, i) => {
      const size = Math.random() * 4 + 2;
      const drift = (Math.random() - 0.5) * 100;
      return (
        <motion.div
          key={i}
          className="absolute rounded-full"
          style={{
            width: size,
            height: size,
            background: "radial-gradient(circle, rgba(99,102,241,0.7), transparent)",
            left: Math.random() * 100 + "%",
          }}
          initial={{ y: "110vh", opacity: 0, scale: 0 }}
          animate={{ y: "-10vh", x: drift, opacity: [0, 0.8, 0], scale: [0, 1, 1.5] }}
          transition={{
            duration: Math.random() * 10 + 8,
            repeat: Infinity,
            ease: "linear",
            delay: Math.random() * 12,
          }}
        />
      );
    })}
  </div>
);

/* ── Línea de escaneo sutil ── */
const ScanningLine = () => (
  <motion.div className="absolute inset-0 z-10 pointer-events-none overflow-hidden rounded-[2rem]">
    <motion.div
      className="absolute top-[-50%] left-[-50%] w-[200%] h-[6px] bg-gradient-to-r from-transparent via-white/10 to-transparent rotate-[35deg]"
      animate={{ top: ["-100%", "200%"], left: ["-100%", "200%"] }}
      transition={{ duration: 7, repeat: Infinity, ease: "linear" }}
    />
  </motion.div>
);

type LoginStep = "home" | "loading" | "domain-error";

export function LoginScreen() {
  const [step, setStep] = useState<LoginStep>("home");
  const [badEmail, setBadEmail] = useState("");
  const [error, setError] = useState("");

  const handleGoogle = async () => {
    setError("");
    setStep("loading");
    try {
      const result = await signInWithPopup(auth, googleProvider);

      const credential = GoogleAuthProvider.credentialFromResult(result);
      if (credential?.accessToken) {
        sessionStorage.setItem("googleCalendarToken", credential.accessToken);
      }

      const email = result.user.email ?? "";

      if (!email.toLowerCase().endsWith(ALLOWED_DOMAIN)) {
        await auth.signOut();
        setBadEmail(email);
        setStep("domain-error");
        return;
      }
    } catch (err: unknown) {
      console.error("Firebase Auth Error:", err);
      const e = err as { code?: string; message?: string };
      if (e.code !== "auth/popup-closed-by-user" && e.code !== "auth/cancelled-popup-request") {
        setError("Error al conectar con Google. Inténtalo de nuevo.");
      }
      setStep("home");
    }
  };

  return (
    <div className="min-h-screen flex flex-col justify-between p-6 sm:p-10 relative overflow-hidden bg-[#07091a]">
      {/* Fondos con gradientes sutiles */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,_rgba(67,56,202,0.45)_0%,_transparent_60%)] pointer-events-none" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_right,_rgba(99,102,241,0.15)_0%,_transparent_60%)] pointer-events-none" />
      <div className="absolute top-0 left-0 w-full h-[2px] bg-gradient-to-r from-indigo-600 via-purple-500 to-indigo-800" />

      <FloatingParticles />

      {/* ── Top Bar: Logo oficial en la esquina superior izquierda ── */}
      <header className="relative z-20 flex items-center gap-3">
        <img
          src="/SYLLABOT.png"
          alt="Syllabot Logo"
          className="size-8 object-contain drop-shadow-md"
        />
        <span className="text-xl font-bold tracking-tight text-white">Syllabot</span>
      </header>

      {/* ── Contenedor Central: Dos Columnas (Referencia de Diseño) ── */}
      <main className="relative z-10 w-full max-w-6xl mx-auto my-auto flex flex-col lg:flex-row items-center justify-between gap-12 lg:gap-16 py-8">
        {/* Columna Izquierda: Mascota y Presentación de Valor */}
        <div className="flex-1 flex flex-col items-center text-center lg:items-start lg:text-left max-w-xl">
          {/* Mascota centrada con aura y tamaño aumentado */}
          <div className="w-full flex justify-center mb-6">
            <div className="relative">
              <div className="absolute -inset-6 bg-indigo-500/20 rounded-full blur-3xl pointer-events-none" />
              <motion.img
                src="/syllabot_01_neutral.png"
                alt="Mascota Syllabot"
                className="relative w-60 h-60 sm:w-72 sm:h-72 lg:w-80 lg:h-80 object-contain drop-shadow-[0_20px_40px_rgba(99,102,241,0.35)]"
                animate={{ y: [0, -10, 0] }}
                transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
              />
            </div>
          </div>

          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-black text-white tracking-tight leading-tight">
            Tu semestre bajo control
          </h1>
          <p className="text-indigo-200/70 text-sm sm:text-base mt-3 leading-relaxed max-w-lg">
            Convierte el sílabo de tus cursos en un calendario organizado con inteligencia
            artificial. Nunca más te pierdas una práctica o un examen.
          </p>

          {/* 3 Micro-pasos de Valor */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 w-full mt-6">
            <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-white/[0.04] border border-white/10 backdrop-blur-sm">
              <span className="flex size-5 items-center justify-center rounded-md bg-indigo-600 text-white font-bold text-xs shrink-0">
                1
              </span>
              <span className="text-xs font-medium text-white/90">Sube tu sílabo</span>
            </div>

            <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-white/[0.04] border border-white/10 backdrop-blur-sm">
              <span className="flex size-5 items-center justify-center rounded-md bg-indigo-600 text-white font-bold text-xs shrink-0">
                2
              </span>
              <span className="text-xs font-medium text-white/90">La IA detecta fechas</span>
            </div>

            <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-white/[0.04] border border-white/10 backdrop-blur-sm">
              <span className="flex size-5 items-center justify-center rounded-md bg-indigo-600 text-white font-bold text-xs shrink-0">
                3
              </span>
              <span className="text-xs font-medium text-white/90">Calendario listo</span>
            </div>
          </div>

          {/* Badge Informativo (sin redundancia de UNMSM) */}
          <div className="mt-5 inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-emerald-950/40 border border-emerald-500/30 text-xs font-semibold text-emerald-400">
            <span className="size-2 rounded-full bg-emerald-400" />
            Sincronización instantánea con Google Calendar
          </div>
        </div>

        {/* Columna Derecha: Tarjeta de Acceso Limpia con Botón Blanco */}
        <div className="w-full max-w-[420px]">
          <motion.div
            layout
            className="bg-[#0b0e24]/80 backdrop-blur-2xl border border-white/10 rounded-[2rem] p-7 sm:p-9 shadow-[0_25px_50px_rgba(0,0,0,0.6)] relative overflow-hidden"
          >
            <ScanningLine />

            <AnimatePresence mode="wait">
              {step === "home" && (
                <motion.div
                  key="home"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  className="space-y-6 relative z-10"
                >
                  <div>
                    <h2 className="text-white text-2xl font-bold tracking-tight">Iniciar sesión</h2>
                    <p className="text-white/50 text-xs sm:text-sm mt-1">
                      Usa tu cuenta institucional para continuar
                    </p>
                  </div>

                  {/* Botón Blanco Oficial de Google */}
                  <button
                    onClick={handleGoogle}
                    className="w-full flex items-center justify-center gap-3 bg-white text-gray-900 font-semibold py-3.5 px-4 rounded-xl shadow-sm hover:bg-gray-100 active:scale-[0.99] transition-all text-sm sm:text-base cursor-pointer"
                  >
                    <svg viewBox="0 0 24 24" className="w-5 h-5 shrink-0">
                      <path
                        fill="#4285F4"
                        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                      />
                      <path
                        fill="#34A853"
                        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                      />
                      <path
                        fill="#FBBC05"
                        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                      />
                      <path
                        fill="#EA4335"
                        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                      />
                    </svg>
                    <span>Continuar con Google</span>
                  </button>

                  {/* Restricción de Dominio con Candado */}
                  <div className="flex items-center justify-center gap-1.5 text-xs text-white/50">
                    <Lock size={12} className="shrink-0 text-white/40" />
                    <span>
                      Solo cuentas <strong className="text-white/90">@unmsm.edu.pe</strong>
                    </span>
                  </div>

                  {error && (
                    <div className="flex items-center gap-2 text-red-300 text-xs bg-red-900/30 border border-red-500/30 px-3.5 py-2.5 rounded-xl">
                      <AlertCircle size={15} className="shrink-0 text-red-400" />
                      <span>{error}</span>
                    </div>
                  )}

                  {/* Mensaje de Confianza / Privacidad */}
                  <div className="border-t border-white/10 pt-4">
                    <p className="text-center text-[11px] sm:text-xs text-white/40 leading-relaxed">
                      Solo usamos tu nombre y tu correo. No publicamos nada en tu cuenta.
                    </p>
                  </div>
                </motion.div>
              )}

              {step === "loading" && (
                <motion.div
                  key="loading"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex flex-col items-center gap-4 py-10 relative z-10"
                >
                  <Loader2 size={36} className="animate-spin text-indigo-400" />
                  <p className="text-white/70 text-sm font-medium">Verificando credenciales...</p>
                </motion.div>
              )}

              {step === "domain-error" && (
                <motion.div
                  key="error"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0 }}
                  className="space-y-5 relative z-10"
                >
                  <div className="bg-red-900/20 border border-red-500/30 rounded-2xl p-5 text-center space-y-3">
                    <div className="w-12 h-12 bg-red-500/10 rounded-full flex items-center justify-center mx-auto border border-red-500/20">
                      <AlertCircle size={24} className="text-red-400" />
                    </div>
                    <p className="text-white font-bold text-sm">Correo no institucional</p>
                    <p className="text-white/50 text-xs leading-relaxed">
                      <span className="text-red-300 font-semibold">{badEmail}</span> no pertenece a
                      la UNMSM.
                      <br />
                      Debes usar tu cuenta <strong className="text-white/90">@unmsm.edu.pe</strong>.
                    </p>
                  </div>
                  <button
                    onClick={() => setStep("home")}
                    className="w-full py-3 rounded-xl bg-white/10 hover:bg-white/15 border border-white/20 text-white font-semibold text-xs transition-all"
                  >
                    Volver a intentar
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </div>
      </main>

      {/* ── Footer: Izquierda Copyright, Derecha Enlaces Sutiles ── */}
      <footer className="relative z-20 flex flex-col sm:flex-row items-center justify-between gap-4 pt-6 text-xs text-white/40">
        <p>&copy; 2026 Syllabot. Todos los derechos reservados.</p>

        <div className="flex items-center gap-5">
          <span className="hover:text-white/70 transition-colors cursor-pointer">Privacidad</span>
          <span className="hover:text-white/70 transition-colors cursor-pointer">Términos</span>
          <span className="hover:text-white/70 transition-colors cursor-pointer">
            ¿Necesitas ayuda?
          </span>
        </div>
      </footer>
    </div>
  );
}
