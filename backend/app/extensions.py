from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from flask_migrate import Migrate
from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()
migrate = Migrate()
# Counts are kept in memory per process. Set RATELIMIT_STORAGE_URI (for example to Redis) when
# running more than one worker.
limiter = Limiter(key_func=get_remote_address)
