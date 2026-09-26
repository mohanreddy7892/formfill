# ---- build React ----
FROM node:24-alpine AS web
WORKDIR /build
COPY frontend/package*.json frontend/
RUN npm ci --prefix frontend
COPY frontend/ frontend/
COPY scripts/ scripts/
RUN node scripts/prepare-browser-assets.mjs && npm --prefix frontend run build

# ---- API + static ----
FROM python:3.12-slim
# Offline OCR for reading bills (English). Nothing is sent to an external service.
RUN apt-get update && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-eng \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY backend/requirements.txt backend/requirements-typellm.txt backend/
RUN pip install --no-cache-dir -r backend/requirements.txt
COPY backend/ backend/
COPY --from=web /build/frontend/dist frontend/dist
ENV PYTHONDONTWRITEBYTECODE=1
EXPOSE 8000
WORKDIR /app/backend
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --no-access-log --proxy-headers --forwarded-allow-ips=*"]
