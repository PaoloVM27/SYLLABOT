"""Untrusted PDF processing runs here, with no provider credentials in its environment."""
import io
import json
import sys

MAX_BYTES = 10 * 1024 * 1024
MAX_PAGES = 50
MAX_TEXT = 200_000


class PDFError(Exception):
    def __init__(self, status, message):
        self.status = status
        self.message = message


def read_pdf(contents, on_page=None):
    import pdfplumber
    try:
        with pdfplumber.open(io.BytesIO(contents)) as pdf:
            if len(pdf.pages) > MAX_PAGES:
                raise PDFError(413, f"El PDF supera el límite de {MAX_PAGES} páginas.")
            pages = []
            size = 0
            for page in pdf.pages:
                text = page.extract_text(x_tolerance=2) or ""
                size += len(text)
                if size > MAX_TEXT:
                    raise PDFError(413, "El PDF contiene demasiado texto. Sube solo el sílabo del curso.")
                pages.append(text)
                page.close()
                if on_page:
                    on_page(len(pages), len(pdf.pages))
            return "\n\f\n".join(pages)
    except PDFError:
        raise
    except Exception:
        raise PDFError(422, "No se pudo leer el PDF. Verifica que no esté dañado o protegido.") from None


def emit(value):
    print(json.dumps(value, ensure_ascii=False), flush=True)


def main():
    try:
        # Render runs Linux. Windows development still has the parent's wall-clock kill.
        try:
            import resource
            resource.setrlimit(resource.RLIMIT_CPU, (12, 12))
            resource.setrlimit(resource.RLIMIT_AS, (256 * 1024 * 1024, 256 * 1024 * 1024))
            resource.setrlimit(resource.RLIMIT_NOFILE, (64, 64))
        except ImportError:
            pass
        contents = sys.stdin.buffer.read(MAX_BYTES + 1)
        if len(contents) > MAX_BYTES:
            raise PDFError(413, "El PDF supera el límite de 10 MB.")
        text = read_pdf(contents, lambda done, total: emit({"type": "page", "done": done, "total": total}))
        if not text.strip():
            raise PDFError(422, "El PDF no tiene texto seleccionable. Necesita reconocimiento de texto (OCR); prueba con el PDF original o uno con texto.")
        from extraction import extract_without_ai
        fallback = extract_without_ai(text)
        if len(fallback["evaluaciones"]) > 200:
            raise PDFError(422, "El documento contiene demasiadas evaluaciones. Sube solo el sílabo de un curso.")
        emit({"type": "result", "text": text, "fallback": fallback})
    except PDFError as exc:
        emit({"type": "error", "status": exc.status, "detail": exc.message})
    except Exception:
        emit({"type": "error", "status": 422, "detail": "El PDF es demasiado complejo o no se pudo procesar."})


if __name__ == "__main__":
    main()
