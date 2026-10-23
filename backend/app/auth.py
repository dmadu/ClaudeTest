from functools import wraps

from flask import g, jsonify, session

from .extensions import db
from .models import User


def current_user():
    user_id = session.get("user_id")
    if user_id is None:
        return None
    return db.session.get(User, user_id)


def login_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        user = current_user()
        if user is None:
            return jsonify(message="Authentication required."), 401
        g.current_user = user
        return view(*args, **kwargs)

    return wrapped
