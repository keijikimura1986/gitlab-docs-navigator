FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HOST=0.0.0.0 \
    PORT=8080

WORKDIR /app

COPY app.py ./
COPY static ./static

# OpenShift runs containers with an arbitrary UID that belongs to group 0.
RUN chgrp -R 0 /app && chmod -R g=u /app

EXPOSE 8080

CMD ["python", "app.py"]
