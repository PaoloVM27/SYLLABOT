import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, FileText, CheckCircle2 } from "lucide-react";

export const Route = createFileRoute("/terms")({
  component: TermsComponent,
});

function TermsComponent() {
  return (
    <div className="min-h-screen bg-background text-foreground py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto bg-card border border-border/80 rounded-2xl shadow-sm p-6 sm:p-10">
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline mb-8"
        >
          <ArrowLeft size={16} /> Volver a Syllabot
        </Link>

        <div className="flex items-center gap-3 mb-6">
          <div className="p-3 bg-primary/10 text-primary rounded-xl">
            <FileText size={28} />
          </div>
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
              Términos del Servicio
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Syllabot &bull; Plataforma Académica UNMSM
            </p>
          </div>
        </div>

        <div className="prose prose-sm dark:prose-invert max-w-none space-y-6 text-muted-foreground text-sm leading-relaxed">
          <section className="space-y-2">
            <h2 className="text-base font-bold text-foreground">1. Aceptación de los Términos</h2>
            <p>
              Al utilizar Syllabot, aceptas utilizar la plataforma con fines estrictamente
              académicos para la gestión de tus cursos universitarios en la UNMSM.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-bold text-foreground">2. Uso de la Información</h2>
            <p>
              Syllabot asiste en la extracción de fechas basada en modelos de lenguaje e
              inteligencia artificial. Aunque el sistema aplica reglas de negocio universitarias
              para validar parciales y finales, el estudiante siempre tiene la potestad de revisar,
              editar y confirmar la fecha de sus evaluaciones antes de exportarlas.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-bold text-foreground">3. Cuentas y Seguridad</h2>
            <p>
              El inicio de sesión se realiza mediante la infraestructura segura de Google OAuth para
              cuentas institucionales (@unmsm.edu.pe). Syllabot no almacena tus contraseñas en
              ningún momento.
            </p>
          </section>

          <section className="pt-4 border-t border-border/60 text-xs text-muted-foreground">
            Última actualización: Octubre 2026 &bull; Syllabot
          </section>
        </div>
      </div>
    </div>
  );
}
