# Auditoría de seguridad de Syllabot

Fecha de revisión: 12 de noviembre de 2026, America/Lima.

Alcance: repositorio, historial Git, dependencias, frontend Vercel, API Render,
Firebase Authentication, procesamiento PDF y exportaciones de calendario.
Las pruebas de abuso se ejecutan localmente. En producción se revisan respuestas,
cabeceras y rechazos de peticiones de diagnóstico, sin generar tráfico masivo.

## Hallazgos y parches

| Prioridad        | Hallazgo confirmado                                                                                                                                                               | Corrección                                                                                                                                                                                                                                        |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Alta             | `/upload` no verificaba identidad. Una petición anónima vacía llegaba al parser y respondía 422. CORS y el login visual no impedían consumir PDF/Gemini desde un cliente directo. | Verificación de firma RS256 con certificados públicos de Google, proyecto, emisor, audiencia, expiración, autenticación, cuenta Google y correo institucional verificado. Sin token se rechaza antes de leer el cuerpo.                           |
| Alta             | El límite de archivo se comprobaba después del parser multipart; no había admisión global ni cuotas por cuenta.                                                                   | Límite de cuerpo antes/durante recepción, también sin Content-Length; cuotas y concurrencia antes del trabajo costoso; límite temporal de subida.                                                                                                 |
| Alta             | Un PDF lento podía ocupar un hilo indefinidamente. Los límites de páginas/texto no eran un límite duro del costo de una página maliciosa.                                         | Subproceso terminable con límite de 18 s de pared, 12 s de CPU y 256 MB de memoria virtual en Linux. Ambiente del proceso sin claves del proveedor. Terminación por cancelación y por timeout.                                                    |
| Alta/preventiva  | Alertas conocidas en dependencias JavaScript y Python. Su alcance varía entre construcción, desarrollo y ejecución: no todas prueban una explotación remota del sitio.            | Actualizaciones y overrides fijados en el lockfile; versiones corregidas de Vite, Seroval, shell-quote, source-map-js, grpc-js, re2js, minimatch, Zod, certifi, Pillow y pyasn1. pip local actualizado y script de construcción seguro preparado. |
| Media            | Títulos y descripciones podían introducir saltos de línea y propiedades adicionales en `.ics`.                                                                                    | Escape de texto ICS y plegado conforme a 75 octetos UTF-8, con pruebas de inyección de eventos.                                                                                                                                                   |
| Media/preventiva | OAuth de Google Calendar persistía en sessionStorage, ampliando su exposición si aparecía un XSS.                                                                                 | Tokens de Calendar solo en memoria, con expiración y limpieza al salir. Eliminación de tokens de versiones anteriores y del almacenamiento innecesario durante el login.                                                                          |
| Media/preventiva | La web no enviaba CSP, X-Frame-Options, nosniff, política de referencia ni permisos del navegador en la comprobación inicial.                                                     | Cabeceras en Vercel y SSR; bloqueo de iframes externos que intenten incrustar la aplicación, plugins y conexiones ajenas a la lista permitida. La API también envía cabeceras defensivas.                                                         |
| Baja/preventiva  | Documentación API pública y aceptación de hosts arbitrarios.                                                                                                                      | OpenAPI/Swagger/Redoc deshabilitados, hosts de API permitidos, CORS acotado a los orígenes autorizados.                                                                                                                                           |

La validación de ID tokens sigue los campos y certificados publicados por
[Firebase](https://firebase.google.com/docs/auth/admin/verify-id-tokens). La API
no recibe el token OAuth de Calendar: recibe el ID token de Firebase, que son
credenciales distintas. No se agregaron claves privadas al frontend.

## Límites antiabuso actuales

| Control                                                | Límite por proceso                                                                              |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| Solicitudes a `/upload`, incluidas las no autenticadas | 120/minuto                                                                                      |
| Análisis por cuenta verificada                         | 6/minuto, 40/hora, 150/24 horas                                                                 |
| Trabajos simultáneos                                   | 2 en total, 1 por usuario                                                                       |
| Lectores de PDF simultáneos                            | 1; la admisión anterior acota la espera                                                         |
| Recepción del cuerpo                                   | 10 MB de PDF + 64 KiB para multipart; hasta 30 s y 10 s sin recibir datos                       |
| Lector PDF                                             | 50 páginas; 200 000 caracteres; 18 s de pared; Linux: 12 s CPU, 256 MB virtual, 64 descriptores |
| Intentos de IA                                         | 20 por cuenta/24 h y 300 globales/24 h; al agotarse continúa la extracción por reglas           |
| Consulta individual a Gemini                           | 12 s por defecto, un intento, respuesta acotada                                                 |
| Resultados                                             | Máximo 200 evaluaciones; límite de lectura de respuesta en el cliente                           |

Las cuentas se identifican mediante el token verificado. `X-User-ID` y
`X-Forwarded-For` enviados por un cliente no conceden identidad ni permiten
reiniciar una cuota. No se usa la IP del proxy de Render como identidad de usuario.

Estos contadores están en memoria y se reinician con el proceso. Antes de escalar
a múltiples réplicas deben trasladarse a un almacén compartido. No sustituyen
un tope de facturación en el proveedor ni una protección de tráfico en el borde.
Los límites se pueden ajustar con métricas de uso legítimo; no equivalen a un SLA.

## Verificación reproducible

- Pruebas de tokens reales de prueba firmados: token válido, firma falsa, `alg=none`,
  proyecto/emisor incorrectos, expiración, autenticación futura, correo externo o
  no verificado y proveedor incorrecto.
- Rechazo previo al cuerpo de peticiones anónimas, origen/host no autorizado,
  tamaños declarados grandes y cuerpos por fragmentos que exceden el límite.
- Cuotas por cuenta, cabeceras de IP/usuario falsas, saturación y conservación de
  las reservas cuando llega una petición duplicada.
- Procesamiento de PDF sintéticos, progreso en streaming, cancelación y terminación
  del subproceso. Comprobación de que no herede `GEMINI_API_KEY`.
- Pruebas de escape ICS, plegado UTF-8, expiración de permisos, coherencia de CSP,
  TypeScript, lint, compilación y regresiones de fechas/calendario.
- `pnpm audit`: 20 avisos antes, 0 después en la consulta realizada.
- `pip-audit`: alertas en certifi, Pillow y pyasn1 antes; 0 después en los paquetes
  fijados. El entorno completo detectó además pip antiguo, que se actualizó;
  la segunda comprobación del entorno tampoco reportó alertas conocidas.
- La primera ejecución en Linux detectó además setuptools 79.0.1 preinstalado
  con alertas conocidas. Se fijó setuptools 84.1.0 y pip 26.3 también en los
  requisitos, para actualizar las herramientas del entorno de despliegue.
- Búsqueda por patrones en 252 blobs históricos: sin coincidencias de claves
  privadas, tokens GitHub o credenciales de servidor literales. No es una prueba
  de ausencia absoluta de secretos; los valores de credenciales nunca se imprimen.

Los informes JSON de `security/` conservan el resumen inicial y los resultados
de las comprobaciones. Las alertas pueden cambiar con nuevas publicaciones.
La configuración pública de Firebase no se considera una clave de servidor.

Se agregó CI en Linux/Python 3.11 y Node 22, con acciones oficiales fijadas a SHA,
permisos de lectura y sin persistir credenciales de Git. Comprueba dependencias,
historial, pruebas y compilación antes de futuras actualizaciones.

## Infraestructura y riesgos residuales

1. **DDoS volumétrico:** no se puede garantizar su prevención desde FastAPI.
   [Render proporciona protección DDoS de borde](https://render.com/docs/ddos-protection)
   y [Vercel dispone de mitigación DDoS](https://vercel.com/docs/vercel-firewall/ddos-mitigation).
   Las cuotas de aplicación protegen el trabajo costoso, pero no impiden que una
   inundación de red llegue al proveedor. No se realizaron ataques reales.
2. **WAF/bots:** revisar en Vercel Firewall las reglas y protección contra bots,
   y activar desafíos cuando haya abuso. No se configuraron opciones de esas
   consolas: esta sesión no tiene credenciales administrativas de Vercel/Render.
   [Configuración de rate limiting en Vercel](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting).
3. **Comandos de Render:** el repositorio incluye `backend/build.sh` y `Procfile`
   endurecidos. Si la consola tiene comandos propios, establecer Build Command
   `sh build.sh` y copiar el comando de `Procfile`; un push no modifica una opción
   administrativa guardada en el proveedor.
4. **Cuotas y acceso de Google:** configurar cuotas y alertas de consumo; revisar
   restricciones de claves por API y dominios autorizados de Firebase. Se conoce
   el proyecto público, pero no se modificaron permisos ni reglas de la consola.
   No hay operaciones Firestore/Storage en el flujo auditado; no se inspeccionaron
   reglas remotas de servicios que pudieran existir fuera de este repositorio.
5. **Revocación inmediata/App Check:** se verifican firmas y claims, pero no la
   revocación administrativa de cada token. Un token ya emitido puede seguir
   válido hasta vencer. Evaluar Firebase Admin con credenciales de servidor para
   revocación y App Check para una señal adicional de legitimidad del cliente.
6. **CSP:** se elimina `unsafe-eval`, se restringen destinos y se prohíben objetos
   y enmarcado. El SSR y estilos actuales requieren `unsafe-inline`; migrar los
   scripts a nonces por respuesta es un endurecimiento pendiente. La CSP actual
   es defensa adicional, no garantía contra todo XSS. React sigue escapando texto.
7. **Aislamiento:** el lector es un proceso con límites, no un sandbox de kernel.
   Un servicio de trabajadores separado ofrece aislamiento adicional si aumenta
   la exposición o se incorpora OCR. Mantener parches del sistema y bibliotecas.
8. **Suplantación/SEO spam:** no hay envío de correos, comentarios públicos ni
   publicación de contenido de los PDF en rutas indexables. Proteger las cuentas
   GitHub, Vercel, Render y Google con MFA. Para un dominio de correo propio se
   requieren SPF, DKIM y DMARC; esos ajustes no corresponden al código ni permiten
   modificar el dominio institucional de la universidad.

## Respuesta a incidentes

Ante un aumento anómalo: revisar métricas del proveedor y respuestas 401/429/503,
activar la mitigación de borde disponible, restringir temporalmente el acceso y
ajustar cuotas con evidencia. Si se expone una clave, revocarla/rotarla en su
consola y actualizar las variables del servicio; no reescribir el historial de
Lovable/GitHub. Para revertir un parche usar un commit de reversión normal.
Los registros no deben incluir tokens, texto del PDF, claves ni cuerpos del proveedor.
