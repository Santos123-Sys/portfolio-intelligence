FROM python:3.12-slim
WORKDIR /app
COPY services/filings_python/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt
COPY services/filings_python /app/filings_python
ENV PYTHONUNBUFFERED=1
CMD ["sh", "-c", "uvicorn filings_python.app:app --host 0.0.0.0 --port ${PORT:-8000}"]
