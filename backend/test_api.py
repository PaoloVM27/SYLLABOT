import asyncio
import json
from time import monotonic
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, patch

import httpx
from google import genai
from google.genai import types
import main
import pdf_processing
from extraction import extract_without_ai
from security import SlidingLimits


def pdf_bytes(text="Curso: Fisica\nCRONOGRAMA\nSemana 8 Examen Parcial 20%\nSemana 16 Examen Final 40%", pages=1):
    """Tiny real text PDF; no fixture documents or personal data required."""
    stream = b"BT /F1 12 Tf 40 780 Td 16 TL\n"
    for line in text.splitlines():
        escaped = line.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
        stream += b"(" + escaped.encode("latin-1") + b") Tj T*\n"
    stream += b"ET"
    objects = [b"<< /Type /Catalog /Pages 2 0 R >>",
               b"<< /Type /Pages /Kids [" + b" ".join(f"{i + 5} 0 R".encode() for i in range(pages)) + b"] /Count " + str(pages).encode() + b" >>",
               b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
               b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream",
               *[b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 3 0 R >> >> /Contents 4 0 R >>"] * pages]
    output = b"%PDF-1.4\n"
    offsets = [0]
    for i, obj in enumerate(objects, 1):
        offsets.append(len(output))
        output += f"{i} 0 obj\n".encode() + obj + b"\nendobj\n"
    xref = len(output)
    output += f"xref\n0 {len(offsets)}\n0000000000 65535 f \n".encode()
    output += b"".join(f"{offset:010d} 00000 n \n".encode() for offset in offsets[1:])
    return output + f"trailer\n<< /Size {len(offsets)} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF".encode()


class ApiTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.api = httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url="http://localhost")
        self.key_patch = patch.object(main, "client", None)
        self.key_patch.start()
        main.security.limits = SlidingLimits()
        main.security.active = 0
        main.security.active_users.clear()
        self.auth_patch = patch.object(main.security.verifier, "verify", AsyncMock(return_value="test-user"))
        self.auth_patch.start()
        self.api.headers["Authorization"] = "Bearer test-api-token"
        main.ai_unavailable_until = 0
        main.ai_slots = asyncio.Semaphore(2)
        pdf_processing.worker_slots = asyncio.Semaphore(1)

    async def asyncTearDown(self):
        await self.api.aclose()
        self.key_patch.stop()
        self.auth_patch.stop()

    async def upload(self, suffix="", contents=None, filename="silabo.pdf", headers=None):
        return await self.api.post("/upload" + suffix, headers=headers, files={"file": (filename, pdf_bytes() if contents is None else contents, "application/pdf")})

    async def test_stream_reports_confirmed_stages_and_result(self):
        response = await self.upload(headers={"Accept": "application/x-ndjson, application/json"})
        self.assertEqual(response.status_code, 200)
        self.assertIn("application/x-ndjson", response.headers["content-type"])
        events = [json.loads(line) for line in response.text.splitlines()]
        progress = [e for e in events if e["type"] == "progress"]
        percentages = [e["percent"] for e in progress]
        self.assertEqual(percentages, sorted(percentages))
        self.assertEqual(percentages[-1], 95)
        self.assertTrue(any("1 de 1" in e["message"] for e in progress))
        self.assertEqual(events[-1]["type"], "result")
        self.assertEqual(len(events[-1]["data"]["evaluaciones"]), 2)

    async def test_multipart_cannot_exhaust_file_handles_or_field_storage(self):
        with patch.object(main, "run_pdf_worker", AsyncMock()) as worker:
            response = await self.api.post("/upload", files=[
                ("file", ("first.pdf", b"%PDF-test", "application/pdf")),
                ("extra", ("second.pdf", b"%PDF-test", "application/pdf")),
            ])
            self.assertEqual(response.status_code, 400)
            response = await self.api.post("/upload", files={"file": ("silabo.pdf", b"%PDF-test")},
                                           data={f"field{i}": "value" for i in range(5)})
            self.assertEqual(response.status_code, 400)
            worker.assert_not_awaited()

    async def test_stream_survives_gemini_failure_with_automatic_fallback(self):
        generate = AsyncMock(side_effect=RuntimeError("provider unavailable"))
        fake = SimpleNamespace(aio=SimpleNamespace(models=SimpleNamespace(generate_content=generate)))
        with patch.object(main, "client", fake):
            response = await self.upload(headers={"Accept": "application/x-ndjson"})
        events = [json.loads(line) for line in response.text.splitlines()]
        self.assertEqual(events[-1]["data"]["metodo"], "reglas")
        self.assertFalse(any("sin IA" in e.get("message", "") for e in events))
        self.assertFalse(any("sin IA" in warning for warning in events[-1]["data"]["advertencias"]))
        generate.assert_awaited_once()

    async def test_completed_upload_keeps_stream_open_past_upload_timeouts(self):
        async def slow_analysis(text, fallback):
            await asyncio.sleep(0.08)
            return fallback, "timeout"

        # Exercise ASGI's disconnect listener while the real PDF worker and AI
        # processing continue. Upload deadlines must stop once the body is read.
        with patch("security.UPLOAD_IDLE_TIMEOUT_SECONDS", 0.02), \
                patch("security.UPLOAD_TOTAL_TIMEOUT_SECONDS", 0.06), \
                patch.object(main, "enhance_with_ai", slow_analysis):
            response = await self.upload(headers={"Accept": "application/x-ndjson"})
        self.assertEqual(response.status_code, 200)
        events = [json.loads(line) for line in response.text.splitlines()]
        self.assertEqual(events[-1]["type"], "result")
        self.assertEqual(len(events[-1]["data"]["evaluaciones"]), 2)
        self.assertEqual(main.security.active, 0)
        self.assertFalse(main.security.active_users)

    async def test_stream_reports_pdf_error_without_result_or_completion(self):
        response = await self.upload(contents=pdf_bytes(""), headers={"Accept": "application/x-ndjson"})
        events = [json.loads(line) for line in response.text.splitlines()]
        self.assertEqual(events[-1]["type"], "error")
        self.assertIn("OCR", events[-1]["detail"])
        self.assertFalse(any(e["type"] == "result" for e in events))

    async def test_real_pdf_without_key_and_explicit_no_ai(self):
        for suffix in ("", "?use_ai=false"):
            response = await self.upload(suffix)
            self.assertEqual(response.status_code, 200, response.text)
            data = response.json()
            self.assertEqual(data["metodo"], "reglas")
            self.assertEqual(len(data["evaluaciones"]), 2)
            self.assertTrue(data["advertencias"])

    async def test_pdf_with_word_weeks_calculates_dates_from_course_schedule(self):
        text = """Curso: Modelos y Simulacion
Duracion: 16 semanas
Fecha de inicio: 24 de agosto de 2026
Fecha de finalizacion: 12 de diciembre de 2026
Horario: G1: Jueves 14:00-18:00
Unidades de aprendizaje
UNIDAD I
Duracion: 4 semanas
Semana Contenido tematico
Primera Presentacion del silabo
Octava Examen Parcial
Decimosexta Examen Final"""
        response = await self.upload(contents=pdf_bytes(text))
        self.assertEqual(response.status_code, 200)
        result = response.json()
        self.assertEqual([e["fecha"] for e in result["evaluaciones"]], ["2026-10-15", "2026-12-10"])
        self.assertTrue(all(e["fecha_origen"] == "calculada" for e in result["evaluaciones"]))
        self.assertFalse(any("sin fecha" in warning for warning in result["advertencias"]))

    async def test_schedule_corrects_duplicate_exams_and_wrong_pc2_from_ai(self):
        text = """Curso: Modelos y Simulacion
Duracion: 16 semanas
Fecha de inicio: 24 de agosto de 2026
Fecha de finalizacion: 12 de diciembre de 2026
Horario: Jueves
Evaluacion
PC1
PC2
Unidades de aprendizaje
Semana Contenido tematico
Cuarta Practica calificada
Octava Examen parcial
Decima Temas del curso
Onceava Analisis de resultados
Doceava Estudios de casos
Practica calificada
Dieciseisava Examen final
5. Calificacion
Examen parcial 30%
Examen final 40%"""
        bad_result = {"evaluaciones": [
            {"nombre": "PC1", "semana": 4}, {"nombre": "Examen parcial", "semana": 8},
            {"nombre": "Examen parcial", "semana": 10}, {"nombre": "Examen final", "semana": 10},
            {"nombre": "PC2", "semana": 10, "fecha": "2026-10-29"}]}
        fake = SimpleNamespace(aio=SimpleNamespace(models=SimpleNamespace(
            generate_content=AsyncMock(return_value=SimpleNamespace(text=json.dumps(bad_result))))))
        with patch.object(main, "client", fake):
            response = await self.upload(contents=pdf_bytes(text))
        evs = response.json()["evaluaciones"]
        self.assertEqual(len(evs), 4)
        self.assertEqual([e["nombre"] for e in evs], ["Práctica Calificada 1", "Examen Parcial", "Práctica Calificada 2", "Examen Final"])
        self.assertEqual([e["fecha"] for e in evs], ["2026-09-17", "2026-10-15", "2026-11-12", "2026-12-10"])

    async def test_invalid_pdf_word_and_scanned_pdf_errors(self):
        for contents, filename, status in ((b"not pdf", "a.pdf", 422), (b"word", "a.docx", 400),
                                           (pdf_bytes(""), "scanned.pdf", 422)):
            response = await self.upload(contents=contents, filename=filename)
            self.assertEqual(response.status_code, status)

    async def test_anonymous_upload_is_rejected_before_multipart_validation(self):
        self.api.headers.pop("Authorization")
        response = await self.api.post("/upload", content=b"")
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.headers["X-Content-Type-Options"], "nosniff")
        self.assertEqual(response.headers["WWW-Authenticate"], "Bearer")

    async def test_auth_header_is_allowed_in_legitimate_cors_preflight(self):
        response = await self.api.options("/upload", headers={
            "Origin": "https://syllabot-red.vercel.app", "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "authorization,content-type"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["Access-Control-Allow-Origin"], "https://syllabot-red.vercel.app")

    async def test_untrusted_host_and_api_documentation_are_not_exposed(self):
        self.assertEqual((await self.api.get("/health", headers={"Host": "evil.example"})).status_code, 400)
        self.assertEqual((await self.api.get("/openapi.json")).status_code, 404)

    async def test_file_limit_is_enforced(self):
        response = await self.upload(contents=b"%PDF-" + b"x" * main.MAX_BYTES)
        self.assertEqual(response.status_code, 413)

    async def test_page_limit_is_enforced_before_extracting(self):
        response = await self.upload(contents=pdf_bytes(pages=51))
        self.assertEqual(response.status_code, 413)

    async def test_timeout_cancels_ai_and_returns_fallback(self):
        cancelled = asyncio.Event()

        async def hanging(**kwargs):
            try:
                await asyncio.Event().wait()
            finally:
                cancelled.set()

        generate = AsyncMock(side_effect=hanging)
        fake = SimpleNamespace(aio=SimpleNamespace(models=SimpleNamespace(generate_content=generate)))
        with patch.object(main, "client", fake), patch.object(main, "AI_TIMEOUT_SECONDS", 0.03):
            started = monotonic()
            response = await self.upload()
            self.assertLess(monotonic() - started, 5)
        self.assertTrue(cancelled.is_set())
        self.assertEqual(response.json()["metodo"], "reglas")
        self.assertEqual(generate.await_count, 1)

    async def test_sdk_429_is_not_retried_and_cooldown_skips_next_request(self):
        requests = []

        async def overloaded(request):
            requests.append(request)
            return httpx.Response(429, json={"error": {"code": 429, "message": "quota", "status": "RESOURCE_EXHAUSTED"}})

        async_http = httpx.AsyncClient(transport=httpx.MockTransport(overloaded))
        provider = genai.Client(api_key="test-only", http_options=types.HttpOptions(
            httpx_async_client=async_http, retry_options=types.HttpRetryOptions(attempts=1)))
        try:
            with patch.object(main, "client", provider):
                first = await self.upload()
                second = await self.upload()
            self.assertEqual(first.json()["metodo"], "reglas")
            self.assertEqual(second.json()["metodo"], "reglas")
            self.assertEqual(len(requests), 1)
        finally:
            await provider.aio.aclose()
            provider.close()

    async def test_valid_ai_through_real_sdk_serialization(self):
        parsed = {"nombre_curso": "Fisica", "evaluaciones": [
            {"nombre": "Examen Parcial", "semana": 8, "peso": 20},
            {"nombre": "Examen Final", "semana": 16, "peso": 40}]}

        async def generate(request):
            body = json.loads(request.content)
            self.assertEqual(body["generationConfig"]["responseMimeType"], "application/json")
            return httpx.Response(200, json={"candidates": [{"content": {
                "parts": [{"text": json.dumps(parsed)}], "role": "model"}, "finishReason": "STOP"}]})

        provider = genai.Client(api_key="test-only", http_options=types.HttpOptions(
            httpx_async_client=httpx.AsyncClient(transport=httpx.MockTransport(generate)),
            retry_options=types.HttpRetryOptions(attempts=1)))
        try:
            with patch.object(main, "client", provider):
                response = await self.upload()
            self.assertEqual(response.json()["metodo"], "ia", response.text)
        finally:
            await provider.aio.aclose()
            provider.close()

    async def test_malformed_or_empty_ai_response_uses_rules(self):
        for text in ("not json", '{"evaluaciones": []}', '{"evaluaciones": [{"nombre":"EP", "semana":99}]}'):
            fake = SimpleNamespace(aio=SimpleNamespace(models=SimpleNamespace(
                generate_content=AsyncMock(return_value=SimpleNamespace(text=text)))))
            with patch.object(main, "client", fake):
                response = await self.upload()
            self.assertEqual(response.json()["metodo"], "reglas")

    async def test_busy_ai_uses_rules_without_queueing(self):
        fake = SimpleNamespace(aio=SimpleNamespace(models=SimpleNamespace(generate_content=AsyncMock())))
        main.ai_slots = asyncio.Semaphore(0)
        with patch.object(main, "client", fake):
            response = await self.upload()
        self.assertEqual(response.json()["metodo"], "reglas")
        fake.aio.models.generate_content.assert_not_awaited()

    async def test_health_remains_responsive_during_pdf_processing(self):
        started, release = asyncio.Event(), asyncio.Event()

        async def slow_read(contents, on_page=None):
            started.set()
            await release.wait()
            text = "Semana 8 Examen Parcial"
            return text, extract_without_ai(text)

        with patch.object(main, "run_pdf_worker", slow_read):
            task = asyncio.create_task(self.upload())
            await asyncio.wait_for(started.wait(), 1)
            try:
                response = await asyncio.wait_for(self.api.get("/health"), timeout=0.5)
                self.assertEqual(response.status_code, 200)
                self.assertFalse(task.done())
            finally:
                release.set()
                await task



if __name__ == "__main__":
    unittest.main()
