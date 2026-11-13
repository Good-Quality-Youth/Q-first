FROM python:3.12-slim
WORKDIR /app
COPY requirements.lock.txt .
RUN pip install --no-cache-dir --require-hashes -r requirements.lock.txt
RUN useradd --system --uid 10001 qfirst && mkdir /app/var && chown qfirst /app/var
COPY qfirst_agent qfirst_agent
USER 10001
CMD ["python","-m","uvicorn","qfirst_agent.app:app","--host","0.0.0.0","--port","18094"]
