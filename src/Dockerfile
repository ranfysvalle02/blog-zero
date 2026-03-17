FROM python:3.11-slim

WORKDIR /app

RUN pip install --no-cache-dir "mdb-engine>=0.1" uvicorn

COPY manifest.json .
COPY public/ public/

ENV _MDB_SERVE_MANIFEST=/app/manifest.json
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/docs')" || exit 1

CMD ["uvicorn", "mdb_engine.cli._serve_app:app", "--host", "0.0.0.0", "--port", "8000"]
