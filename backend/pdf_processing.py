import asyncio
from contextlib import suppress
import json
import os
from pathlib import Path
import sys

from fastapi import HTTPException

PDF_TIMEOUT_SECONDS = 18
WORKER_PATH = str(Path(__file__).with_name("pdf_worker.py"))
worker_slots = asyncio.Semaphore(1)


async def run_pdf_worker(contents, on_page=None):
    try:
        await asyncio.wait_for(worker_slots.acquire(), timeout=PDF_TIMEOUT_SECONDS)
    except TimeoutError:
        raise HTTPException(503, "El servicio está ocupado. Intenta nuevamente en unos segundos.") from None
    process = None
    try:
        async with asyncio.timeout(PDF_TIMEOUT_SECONDS):
            environment = {k: v for k, v in os.environ.items()
                           if k.upper() in {"PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP"}}
            environment.update(PYTHONIOENCODING="utf-8", PYTHONDONTWRITEBYTECODE="1")
            process = await asyncio.create_subprocess_exec(
                sys.executable, WORKER_PATH, stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
                env=environment, limit=2 * 1024 * 1024)
            process.stdin.write(contents)
            await process.stdin.drain()
            process.stdin.close()
            result = None
            while line := await process.stdout.readline():
                event = json.loads(line)
                if event["type"] == "page" and on_page:
                    on_page(event["done"], event["total"])
                elif event["type"] == "error":
                    raise HTTPException(event["status"], event["detail"])
                elif event["type"] == "result":
                    result = event["text"], event["fallback"]
            await process.wait()
            if process.returncode != 0 or result is None:
                raise HTTPException(422, "El PDF es demasiado complejo o no se pudo procesar.")
            return result
    except HTTPException:
        raise
    except (TimeoutError, ValueError, BrokenPipeError, ConnectionResetError):
        raise HTTPException(422, "El PDF superó el límite de procesamiento. Intenta con una versión más simple.") from None
    finally:
        if process is not None and process.returncode is None:
            with suppress(ProcessLookupError):
                process.kill()
            await process.wait()
        worker_slots.release()
