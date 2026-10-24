import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, ShieldCheck, Lock, Calendar, School } from "lucide-react";

export const Route = createFileRoute("/privacy")({
  component: PrivacyComponent,
});

function PrivacyComponent() {
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
            <ShieldCheck size={28} />
          </div>
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
              Política de Privacidad
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Syllabot &bull; Universidad Nacional Mayor de San Marcos (UNMSM)
            </p>
          </div>
        </div>

        <div className="prose prose-sm dark:prose-invert max-w-none space-y-6 text-muted-foreground text-sm leading-relaxed">
          <section className="space-y-2">
            <h2 className="text-base font-bold text-foreground flex items-center gap-2">
              <School size={16} className="text-primary" /> 1. Propósito de la Aplicación
            </h2>
            <p>
              Syllabot es una herramienta académica desarrollada para estudiantes de la Universidad
              Nacional Mayor de San Marcos (UNMSM). Su objetivo exclusivo es procesar sílabos
              universitarios y automatizar la organización de fechas de exámenes, prácticas
              calificadas y entregas de proyectos.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-bold text-foreground flex items-center gap-2">
              <Calendar size={16} className="text-primary" /> 2. Uso del Alcance de Google Calendar
            </h2>
            <p>
              Syllabot solicita acceso mediante el alcance (scope) oficial de Google Calendar con el
              único fin de:
            </p>
            <ul className="list-disc pl-5 space-y-1">
              <li>
                Crear automáticamente en tu calendario los eventos académicos correspondientes al
                sílabo que subiste.
              </li>
              <li>Asignar recordatorios previos (1 día y 2 horas antes) para cada evaluación.</li>
            </ul>
            <p className="font-semibold text-foreground">
              Syllabot nunca lee tus eventos personales previos, nunca comparte tus citas ni vende
              tu información a terceros.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-bold text-foreground flex items-center gap-2">
              <Lock size={16} className="text-primary" /> 3. Tratamiento de Documentos y Archivos
            </h2>
            <p>
              Los sílabos subidos a la plataforma se procesan en tiempo real exclusivamente para
              extraer el cronograma de fechas. Los archivos no se almacenan de manera persistente en
              ningún servidor ni son accesibles para terceros.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-bold text-foreground">
              4. Revocación de Permisos y Control del Usuario
            </h2>
            <p>
              En cualquier momento puedes revocar el acceso de Syllabot a tu Google Calendar
              accediendo a la configuración de seguridad de tu cuenta institucional en:
            </p>
            <a
              href="https://myaccount.google.com/permissions"
              target="_blank"
              rel="noreferrer"
              className="text-primary underline font-medium"
            >
              myaccount.google.com/permissions
            </a>
          </section>

          <section className="pt-4 border-t border-border/60 text-xs text-muted-foreground">
            Última actualización: Octubre 2026 &bull; Soporte: Decanatura / Comunidad UNMSM
          </section>
        </div>
      </div>
    </div>
  );
}
