FROM python:3.12-slim

WORKDIR /app

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend source
COPY . .

# Create data directory for SQLite
RUN mkdir -p data

# Copy compiled frontend if it exists (for single-service deployment)
# Run: npm run build inside frontend/ first, then docker build from repo root
COPY --from=build_stage /build/frontend/dist /app/../frontend/dist 2>/dev/null || true

EXPOSE 8000

ENV PORT=8000
ENV HOST=0.0.0.0

CMD ["python", "main.py"]
