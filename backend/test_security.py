import asyncio
import base64
import json
import os
from time import monotonic, time
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import FastAPI, Request
from google.auth import crypt, jwt
import httpx

from security import AccessDenied, FirebaseVerifier, FIREBASE_PROJECT, MAX_REQUEST_BYTES, SlidingLimits, UploadGuard, UploadSecurity
import pdf_processing


class FirebaseTests(unittest.IsolatedAsyncioTestCase):
    @classmethod
    def setUpClass(cls):
        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        private = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                                    serialization.NoEncryption())
        cls.public = key.public_key().public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo).decode()
        cls.signer = crypt.RSASigner.from_string(private, key_id="test")

    def token(self, **updates):
        now = int(time())
        claims = {"iss": f"https://securetoken.google.com/{FIREBASE_PROJECT}", "aud": FIREBASE_PROJECT,
                  "sub": "test-user", "iat": now - 5, "exp": now + 3600, "auth_time": now - 10,
                  "email": "student@unmsm.edu.pe", "email_verified": True,
                  "firebase": {"sign_in_provider": "google.com"}}
        claims.update(updates)
        return "Bearer " + jwt.encode(self.signer, claims).decode()

    def verifier(self):
        verifier = FirebaseVerifier()
        verifier.certs = {"test": self.public}
        verifier.expires = monotonic() + 3600
        verifier.last_refresh = monotonic()
        return verifier

    async def test_valid_signed_institutional_token(self):
        self.assertEqual(await self.verifier().verify(self.token()), "test-user")

    async def test_wrong_project_issuer_expiry_and_authentication_time(self):
        for update in ({"aud": "another-project"}, {"iss": "https://attacker.example"},
                       {"exp": int(time()) - 300}, {"auth_time": int(time()) + 500}, {"sub": ""}):
            with self.subTest(update=update), self.assertRaises(AccessDenied) as error:
                await self.verifier().verify(self.token(**update))
            self.assertEqual(error.exception.status, 401)

    async def test_unverified_external_or_wrong_provider_accounts(self):
        for update in ({"email_verified": False}, {"email": "student@unmsm.edu.pe.evil.example"},
                       {"email": "student@example.com"}, {"firebase": {"sign_in_provider": "password"}}):
            with self.subTest(update=update), self.assertRaises(AccessDenied) as error:
                await self.verifier().verify(self.token(**update))
            self.assertEqual(error.exception.status, 403)

    async def test_invalid_signature_and_unsigned_tokens_are_rejected(self):
        token = self.token().split(" ", 1)[1]
        header, payload, signature = token.split(".")
        bad_signature = ("A" if signature[0] != "A" else "B") + signature[1:]
        unsigned = base64.urlsafe_b64encode(b'{"alg":"none","kid":"test"}').decode().rstrip("=")
        for value in ("", "Bearer malformed", "Bearer " + header + "." + payload + "." + bad_signature,
                      "Bearer " + unsigned + "." + payload + ".", "Bearer " + "a" * 9000):
            with self.subTest(value=value[:30]), self.assertRaises(AccessDenied) as error:
                await self.verifier().verify(value)
            self.assertEqual(error.exception.status, 401)

    async def test_unknown_keys_cannot_trigger_unbounded_certificate_refreshes(self):
        verifier = self.verifier()
        with patch("security.httpx.AsyncClient") as client, self.assertRaises(AccessDenied):
            await verifier.certificates("attacker-controlled-key")
        client.assert_not_called()


class LimitsTests(unittest.TestCase):
    def test_sliding_window_and_bounded_storage_fail_closed(self):
        now = [0]
        limits = SlidingLimits(clock=lambda: now[0], max_keys=2)
        self.assertTrue(limits.allow("user", 2, 60))
        self.assertTrue(limits.allow("user", 2, 60))
        self.assertFalse(limits.allow("user", 2, 60))
        self.assertTrue(limits.allow("other", 2, 60))
        self.assertFalse(limits.allow("new", 2, 60))
        now[0] = 61
        self.assertTrue(limits.allow("new", 2, 60))

    def test_ai_budget_is_bounded(self):
        state = UploadSecurity()
        for _ in range(20):
            self.assertTrue(state.allow_ai("student"))
        self.assertFalse(state.allow_ai("student"))
        self.assertTrue(state.allow_ai("another-student"))


class GuardTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.state = UploadSecurity()
        self.state.verifier.verify = AsyncMock(side_effect=lambda value: value.removeprefix("Bearer "))
        self.read_calls = 0
        app = FastAPI()

        @app.post("/upload")
        async def upload(request: Request):
            self.read_calls += 1
            await request.body()
            return {"ok": True}

        app.add_middleware(UploadGuard, security=self.state)
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://localhost")
        self.headers = {"Authorization": "Bearer student", "Content-Type": "multipart/form-data; boundary=test"}

    async def asyncTearDown(self):
        await self.client.aclose()

    async def test_anonymous_request_rejected_before_body_read(self):
        response = await self.client.post("/upload", content=b"test")
        self.assertEqual(response.status_code, 401)
        self.assertEqual(self.read_calls, 0)

    async def test_oversized_content_length_rejected_before_body_read(self):
        headers = {**self.headers, "Content-Length": str(MAX_REQUEST_BYTES + 1)}
        response = await self.client.post("/upload", content=b"x", headers=headers)
        self.assertEqual(response.status_code, 413)
        self.assertEqual(self.read_calls, 0)

    async def test_chunked_body_cannot_bypass_size_limit(self):
        async def body():
            yield b"x" * (MAX_REQUEST_BYTES // 2)
            yield b"x" * (MAX_REQUEST_BYTES // 2 + 1)
        response = await self.client.post("/upload", content=body(), headers=self.headers)
        self.assertEqual(response.status_code, 413)

    async def test_user_limit_and_forwarded_ip_spoofing(self):
        for index in range(7):
            response = await self.client.post("/upload", content=b"x", headers={**self.headers,
                "X-Forwarded-For": f"203.0.113.{index}", "X-User-ID": f"forged-{index}"})
        self.assertEqual(response.status_code, 429)
        self.assertEqual(response.headers["Retry-After"], "60")

    async def test_continuous_chunks_cannot_exceed_total_upload_deadline(self):
        async def body():
            yield b"first"
            yield b"second"
        with patch("security.monotonic", side_effect=[0, 1, 31]):
            response = await self.client.post("/upload", content=body(), headers=self.headers)
        self.assertEqual(response.status_code, 408)
        self.assertEqual(self.state.active, 0)

    async def test_foreign_origin_cannot_consume_processing(self):
        response = await self.client.post("/upload", content=b"x", headers={**self.headers, "Origin": "https://evil.example"})
        self.assertEqual(response.status_code, 403)
        self.assertEqual(self.read_calls, 0)
        self.state.verifier.verify.assert_not_awaited()

    async def test_busy_server_rejects_without_queuing(self):
        self.state.active = self.state.max_active
        response = await self.client.post("/upload", content=b"x", headers=self.headers)
        self.assertEqual(response.status_code, 503)
        self.assertEqual(self.read_calls, 0)

    async def test_duplicate_request_cannot_clear_an_existing_user_reservation(self):
        self.state.active = 1
        self.state.active_users.add("student")
        response = await self.client.post("/upload", content=b"x", headers=self.headers)
        self.assertEqual(response.status_code, 429)
        self.assertEqual(self.state.active, 1)
        self.assertIn("student", self.state.active_users)


class WorkerTests(unittest.IsolatedAsyncioTestCase):
    async def test_client_cancellation_kills_child_and_keeps_credentials_out_of_environment(self):
        started = asyncio.Event()
        process = MagicMock()
        process.returncode = None
        process.stdin.drain = AsyncMock()

        async def stall():
            started.set()
            await asyncio.Event().wait()

        async def wait():
            process.returncode = -9
            return -9

        process.stdout.readline = AsyncMock(side_effect=stall)
        process.wait = AsyncMock(side_effect=wait)
        spawn = AsyncMock(return_value=process)
        pdf_processing.worker_slots = asyncio.Semaphore(1)
        with patch.object(pdf_processing.asyncio, "create_subprocess_exec", spawn), \
                patch.dict(os.environ, {"GEMINI_API_KEY": "test-only"}):
            task = asyncio.create_task(pdf_processing.run_pdf_worker(b"%PDF-test"))
            await started.wait()
            task.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await task
        process.kill.assert_called_once()
        self.assertNotIn("GEMINI_API_KEY", spawn.call_args.kwargs["env"])
        self.assertEqual(pdf_processing.worker_slots._value, 1)

    async def test_timeout_kills_child_and_releases_slot(self):
        process = MagicMock()
        process.returncode = None
        process.stdin.drain = AsyncMock()
        async def stall():
            await asyncio.sleep(10)
        process.stdout.readline = AsyncMock(side_effect=stall)

        async def wait():
            process.returncode = -9
            return -9

        process.wait = AsyncMock(side_effect=wait)
        pdf_processing.worker_slots = asyncio.Semaphore(1)
        with patch.object(pdf_processing.asyncio, "create_subprocess_exec", AsyncMock(return_value=process)), \
                patch.object(pdf_processing, "PDF_TIMEOUT_SECONDS", 0.02):
            with self.assertRaises(Exception) as error:
                await pdf_processing.run_pdf_worker(b"%PDF-test")
        self.assertEqual(error.exception.status_code, 422)
        process.kill.assert_called_once()
        self.assertEqual(pdf_processing.worker_slots._value, 1)
