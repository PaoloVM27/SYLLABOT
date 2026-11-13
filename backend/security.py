"""Admission control before multipart parsing. No client-supplied identity/IP is trusted."""
import asyncio
import base64
from collections import deque
import json
import os
import re
from time import monotonic, time

from google.auth import jwt
import httpx
from starlette.responses import JSONResponse
from dotenv import load_dotenv

load_dotenv()

FIREBASE_PROJECT = os.getenv("FIREBASE_PROJECT_ID", "syllabot-unmsm")
ALLOWED_EMAIL_DOMAIN = "unmsm.edu.pe"
CERTS_URL = "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com"
MAX_REQUEST_BYTES = 10 * 1024 * 1024 + 64 * 1024
UPLOAD_IDLE_TIMEOUT_SECONDS = 10
UPLOAD_TOTAL_TIMEOUT_SECONDS = 30
ALLOWED_ORIGINS = {"https://syllabot-red.vercel.app", *filter(None, (
    origin.strip().rstrip("/") for origin in os.getenv("CORS_ORIGINS", "").split(",")))}


class AccessDenied(Exception):
    def __init__(self, status, message):
        self.status = status
        self.message = message


class FirebaseVerifier:
    def __init__(self):
        self.certs = {}
        self.expires = 0
        self.last_refresh = -60.0
        self.lock = asyncio.Lock()

    async def certificates(self, key_id):
        now = monotonic()
        if now < self.expires and key_id in self.certs:
            return self.certs
        async with self.lock:
            now = monotonic()
            if now < self.expires and key_id in self.certs:
                return self.certs
            if now - self.last_refresh < 60:
                if self.certs and now < self.expires:
                    raise AccessDenied(401, "La sesión no es válida. Vuelve a iniciar sesión.")
                raise AccessDenied(503, "No se pudo verificar la sesión. Intenta nuevamente en un momento.")
            self.last_refresh = now
            try:
                async with httpx.AsyncClient(timeout=4, follow_redirects=False) as client:
                    response = await client.get(CERTS_URL)
                    response.raise_for_status()
                    certs = response.json()
                    if not isinstance(certs, dict) or not certs or len(certs) > 10:
                        raise ValueError("Invalid certificate response")
                    if not all(isinstance(k, str) and isinstance(v, str) and len(v) < 10_000
                               for k, v in certs.items()):
                        raise ValueError("Invalid certificate entries")
                    self.certs = certs
                    max_age = re.search(r"\bmax-age=(\d+)", response.headers.get("cache-control", ""))
                    self.expires = monotonic() + min(3000, int(max_age[1]) if max_age else 300)
            except Exception:
                raise AccessDenied(503, "No se pudo verificar la sesión. Intenta nuevamente en un momento.") from None
        return self.certs

    async def verify(self, authorization):
        try:
            scheme, token = authorization.split(" ", 1)
            if scheme.lower() != "bearer" or not token or len(token) > 8192:
                raise ValueError("Invalid bearer")
            parts = token.split(".")
            if len(parts) != 3:
                raise ValueError("Invalid token")
            header = json.loads(base64.urlsafe_b64decode(parts[0] + "=" * (-len(parts[0]) % 4)))
            if header.get("alg") != "RS256" or not isinstance(header.get("kid"), str) or len(header["kid"]) > 128:
                raise ValueError("Invalid algorithm/key")
        except (ValueError, TypeError, KeyError, AttributeError):
            raise AccessDenied(401, "Inicia sesión con tu cuenta institucional para analizar un sílabo.") from None
        certs = await self.certificates(header["kid"])
        try:
            claims = jwt.decode(token, certs=certs, audience=FIREBASE_PROJECT, clock_skew_in_seconds=30)
            if claims.get("iss") != f"https://securetoken.google.com/{FIREBASE_PROJECT}":
                raise ValueError("Invalid issuer")
            uid = claims.get("sub")
            if not isinstance(uid, str) or not 1 <= len(uid) <= 128:
                raise ValueError("Invalid subject")
            auth_time = claims.get("auth_time")
            if not isinstance(auth_time, (int, float)) or not 0 < auth_time <= time() + 30:
                raise ValueError("Invalid authentication time")
            email = claims.get("email", "")
            if (claims.get("email_verified") is not True or not isinstance(email, str)
                    or email.count("@") != 1 or email.split("@")[1].lower() != ALLOWED_EMAIL_DOMAIN
                    or claims.get("firebase", {}).get("sign_in_provider") != "google.com"):
                raise AccessDenied(403, "Utiliza una cuenta institucional verificada de UNMSM.")
            return uid
        except AccessDenied:
            raise
        except Exception:
            raise AccessDenied(401, "La sesión no es válida o ha vencido. Vuelve a iniciar sesión.") from None


class SlidingLimits:
    """Bounded, per-process limits. Use shared storage before scaling to replicas."""
    def __init__(self, clock=monotonic, max_keys=5000):
        self.clock = clock
        self.max_keys = max_keys
        self.buckets = {}

    def allow(self, key, limit, window):
        now = self.clock()
        identity = (key, window)
        bucket = self.buckets.get(identity)
        if bucket is None:
            if len(self.buckets) >= self.max_keys:
                self.buckets = {k: v for k, v in self.buckets.items() if v and v[-1] > now - k[1]}
                if len(self.buckets) >= self.max_keys:
                    return False
            bucket = self.buckets.setdefault(identity, deque())
        while bucket and bucket[0] <= now - window:
            bucket.popleft()
        if len(bucket) >= limit:
            return False
        bucket.append(now)
        return True


class UploadSecurity:
    def __init__(self):
        self.verifier = FirebaseVerifier()
        self.limits = SlidingLimits()
        self.active = 0
        self.active_users = set()
        self.max_active = 2

    def allow_ai(self, uid):
        return self.limits.allow("ai:" + uid, 20, 86400) and self.limits.allow("ai:global", 300, 86400)


def allowed_origin(origin):
    if origin in ALLOWED_ORIGINS:
        return True
    return bool(re.fullmatch(r"http://(?:localhost|127\.0\.0\.1)(?::\d+)?", origin))


class UploadGuard:
    def __init__(self, app, security):
        self.app = app
        self.security = security

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope["path"].rstrip("/") != "/upload" or scope["method"] != "POST":
            await self.app(scope, receive, send)
            return
        headers = {k.lower(): v for k, v in scope.get("headers", [])}
        state = self.security
        uid = None
        reserved = False
        user_reserved = False
        try:
            if not state.limits.allow("upload:global", 120, 60):
                raise AccessDenied(429, "Hay demasiadas solicitudes. Espera un minuto e intenta nuevamente.")
            if b"origin" in headers and not allowed_origin(headers[b"origin"].decode("latin-1")):
                raise AccessDenied(403, "Origen de solicitud no autorizado.")
            authorization = headers.get(b"authorization", b"").decode("latin-1")
            if not authorization or len(authorization) > 8200:
                raise AccessDenied(401, "Inicia sesión con tu cuenta institucional para analizar un sílabo.")
            if state.active >= state.max_active:
                raise AccessDenied(503, "El servicio está procesando otros sílabos. Intenta en unos segundos.")
            state.active += 1
            reserved = True
            uid = await state.verifier.verify(authorization)
            if uid in state.active_users:
                raise AccessDenied(429, "Tu análisis anterior sigue en proceso. Espera a que termine.")
            if not all(state.limits.allow("upload:" + uid, count, seconds)
                       for count, seconds in ((6, 60), (40, 3600), (150, 86400))):
                raise AccessDenied(429, "Alcanzaste el límite de análisis. Espera antes de intentarlo nuevamente.")
            content_lengths = [v for k, v in scope.get("headers", []) if k.lower() == b"content-length"]
            if len(content_lengths) > 1 or (content_lengths and b"transfer-encoding" in headers):
                raise AccessDenied(400, "Cabeceras de solicitud inválidas.")
            if content_lengths:
                try:
                    size = int(content_lengths[0])
                    if size < 0:
                        raise ValueError()
                except ValueError:
                    raise AccessDenied(400, "Tamaño de solicitud inválido.") from None
                if size > MAX_REQUEST_BYTES:
                    raise AccessDenied(413, "El PDF supera el límite de 10 MB.")
            if not headers.get(b"content-type", b"").lower().startswith(b"multipart/form-data;"):
                raise AccessDenied(415, "La carga debe contener un archivo PDF.")
            state.active_users.add(uid)
            user_reserved = True
            scope.setdefault("state", {})["user_id"] = uid
            received = 0
            body_complete = False
            deadline = monotonic() + UPLOAD_TOTAL_TIMEOUT_SECONDS

            async def limited_receive():
                nonlocal received, body_complete
                # StreamingResponse may keep receiving to detect disconnects.
                # Once upload EOF arrives, silence means processing, not a slow
                # upload. Preserve disconnect delivery without upload deadlines.
                if body_complete:
                    return await receive()
                try:
                    remaining = deadline - monotonic()
                    if remaining <= 0:
                        raise TimeoutError()
                    message = await asyncio.wait_for(receive(), min(UPLOAD_IDLE_TIMEOUT_SECONDS, remaining))
                except TimeoutError:
                    from starlette.exceptions import HTTPException
                    raise HTTPException(408, "La carga tardó demasiado. Intenta nuevamente.") from None
                if message["type"] == "http.request":
                    received += len(message.get("body", b""))
                    if received > MAX_REQUEST_BYTES:
                        from starlette.exceptions import HTTPException
                        raise HTTPException(413, "El PDF supera el límite de 10 MB.")
                    body_complete = not message.get("more_body", False)
                return message

            await self.app(scope, limited_receive, send)
        except AccessDenied as exc:
            headers = {"Cache-Control": "no-store"}
            if exc.status in (429, 503):
                headers["Retry-After"] = "60" if exc.status == 429 else "5"
            if exc.status == 401:
                headers["WWW-Authenticate"] = "Bearer"
            await JSONResponse({"detail": exc.message}, status_code=exc.status, headers=headers)(scope, receive, send)
        finally:
            if reserved:
                state.active -= 1
            if user_reserved:
                state.active_users.discard(uid)


class SecurityHeaders:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        async def secured_send(message):
            if message["type"] == "http.response.start":
                headers = [(k, v) for k, v in message.get("headers", []) if k.lower() != b"cache-control"]
                headers.extend([(b"x-content-type-options", b"nosniff"),
                                (b"x-frame-options", b"DENY"),
                                (b"referrer-policy", b"no-referrer"),
                                (b"cache-control", b"no-store, no-transform"),
                                (b"strict-transport-security", b"max-age=31536000"),
                                (b"content-security-policy", b"default-src 'none'; frame-ancestors 'none'")])
                message["headers"] = headers
            await send(message)
        await self.app(scope, receive, secured_send)
