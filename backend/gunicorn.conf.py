"""Gunicorn settings for production. Everything is logged to stdout and stderr for `docker logs`."""

import os

bind = "0.0.0.0:5000"
workers = int(os.environ.get("WEB_CONCURRENCY", "1"))
threads = int(os.environ.get("GUNICORN_THREADS", "4"))
timeout = 60
graceful_timeout = 30
keepalive = 5
worker_tmp_dir = "/dev/shm"  # noqa: S108 (in-memory heartbeat files, keeps the root filesystem read-only)
accesslog = "-"
errorlog = "-"
loglevel = os.environ.get("LOG_LEVEL", "info")
capture_output = True

# Rate-limit counts live in memory, so more than one worker would each keep their own count.
if workers > 1 and os.environ.get("RATELIMIT_STORAGE_URI", "memory://").startswith("memory://"):
    raise SystemExit(
        "WEB_CONCURRENCY > 1 needs a shared rate-limit store: set RATELIMIT_STORAGE_URI (for example Redis)."
    )
