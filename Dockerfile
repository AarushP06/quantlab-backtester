FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    MPLBACKEND=Agg

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY quantlab ./quantlab
COPY app ./app
COPY data/processed/universe.parquet ./data/processed/universe.parquet

EXPOSE 10000
CMD ["sh", "-c", "exec gunicorn app.wsgi:app --bind 0.0.0.0:${PORT:-10000} --workers 1 --threads 2 --timeout 120"]
