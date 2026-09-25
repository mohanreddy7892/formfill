FROM python:3.12-slim
WORKDIR /app
COPY pyproject.toml README.md ./
COPY src ./src
RUN pip install --no-cache-dir .
ENV PYTHONDONTWRITEBYTECODE=1
ENV FORMFILL_URL=http://formfill:8000
EXPOSE 8765
# FORMFILL_MCP_TOKEN comes from the environment
CMD ["formfill-mcp", "serve", "--transport", "http", "--host", "0.0.0.0"]
