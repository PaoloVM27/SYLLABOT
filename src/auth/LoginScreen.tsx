import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { signInWithPopup, GoogleAuthProvider } from "firebase/auth";
import { auth, googleProvider } from "@/lib/firebase";
import { AlertCircle, Loader2, LogIn } from "lucide-react";

const ALLOWED_DOMAIN = "@unmsm.edu.pe";

/* ── Partículas flotantes ── */
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

/* ── Línea de escaneo ── */
const ScanningLine = () => (
  <motion.div className="absolute inset-0 z-10 pointer-events-none overflow-hidden rounded-[2.5rem]">
    <motion.div
      className="absolute top-[-50%] left-[-50%] w-[200%] h-[8px] bg-gradient-to-r from-transparent via-white/10 to-transparent rotate-[35deg]"
      animate={{ top: ["-100%", "200%"], left: ["-100%", "200%"] }}
      transition={{ duration: 6, repeat: Infinity, ease: "linear" }}
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
      // Si el dominio es correcto, AuthContext detecta el cambio automáticamente
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
    <div className="min-h-screen flex flex-col items-center justify-center p-4 relative overflow-hidden bg-[#07091a]">
      {/* Fondos */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,_rgba(67,56,202,0.5)_0%,_transparent_60%)] pointer-events-none" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_right,_rgba(99,102,241,0.15)_0%,_transparent_60%)] pointer-events-none" />
      <div className="absolute top-0 left-0 w-full h-[3px] bg-gradient-to-r from-indigo-600 via-purple-500 to-indigo-800" />

      <FloatingParticles />

      {/* Tarjeta */}
      <div className="relative z-10 w-full max-w-[420px]">
        {/* Logo + título */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-indigo-600/20 border border-indigo-500/30 mb-4">
            <svg viewBox="0 0 24 24" className="w-8 h-8 fill-indigo-400">
              <path d="M8 2h8l4 4v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm0 2v4h8V4H8zm-2 6v2h12v-2H6zm0 4v2h8v-2H6z" />
            </svg>
          </div>
          <h1 className="text-4xl font-bold text-white tracking-tight">Syllabot</h1>
          <p className="text-indigo-300/70 text-sm mt-1 font-medium">
            Acceso exclusivo para estudiantes UNMSM
          </p>
        </div>

        <motion.div
          layout
          className="bg-white/5 backdrop-blur-2xl border border-white/10 rounded-[2.5rem] p-8 shadow-[0_30px_60px_rgba(0,0,0,0.7)] relative overflow-hidden"
        >
          <ScanningLine />

          <AnimatePresence mode="wait">
            {step === "home" && (
              <motion.div
                key="home"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="space-y-5 relative z-10"
              >
                <div className="text-center mb-6">
                  <h2 className="text-white text-2xl font-bold mb-1">Iniciar sesión</h2>
                  <p className="text-white/40 text-sm">
                    Usa tu cuenta institucional para continuar
                  </p>
                </div>

                <button
                  onClick={handleGoogle}
                  className="relative overflow-hidden group w-full flex items-center justify-center gap-3 bg-white/5 border-2 border-white/20 hover:border-indigo-400/60 hover:bg-white/10 text-white font-bold py-4 rounded-2xl transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_0_20px_rgba(99,102,241,0.3)]"
                >
                  <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700" />
                  <svg viewBox="0 0 24 24" className="w-5 h-5 relative z-10">
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
                  <span className="relative z-10">Continuar con Google</span>
                </button>

                <p className="text-center text-white/30 text-xs">
                  Requiere cuenta{" "}
                  <span className="text-indigo-300 font-semibold">@unmsm.edu.pe</span>
                </p>

                {error && (
                  <div className="flex items-center gap-2 text-red-300 text-sm bg-red-900/30 border border-red-500/30 px-4 py-3 rounded-xl">
                    <AlertCircle size={16} className="shrink-0" />
                    {error}
                  </div>
                )}
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
                <Loader2 size={40} className="animate-spin text-indigo-400" />
                <p className="text-white/60 text-sm font-medium">Verificando tu cuenta...</p>
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
                <div className="bg-red-900/20 border border-red-500/30 rounded-2xl p-6 text-center space-y-3">
                  <div className="w-14 h-14 bg-red-500/10 rounded-full flex items-center justify-center mx-auto border border-red-500/20">
                    <AlertCircle size={28} className="text-red-400" />
                  </div>
                  <p className="text-white font-semibold">Correo no institucional</p>
                  <p className="text-white/50 text-sm leading-relaxed">
                    <span className="text-red-300 font-medium">{badEmail}</span> no pertenece a la
                    UNMSM.
                    <br />
                    Debes usar tu cuenta <strong className="text-white/80">@unmsm.edu.pe</strong>.
                  </p>
                </div>
                <button
                  onClick={() => setStep("home")}
                  className="w-full py-4 rounded-xl bg-white/5 hover:bg-white/10 border-2 border-white/20 hover:border-white/40 text-white font-bold text-sm transition-all"
                >
                  Volver a intentar
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

        <p className="text-center text-white/20 text-xs mt-8">
          &copy; 2026 Syllabot &mdash; Solo para estudiantes UNMSM
        </p>
      </div>
    </div>
  );
}
