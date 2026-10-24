CSRF = "test-csrf-token"


def sign_in(client, user, csrf=CSRF):
    """Log a test client in directly, and make it send the CSRF token like the real frontend."""
    with client.session_transaction() as s:
        s["user_id"] = user.id
        s["csrf"] = csrf
    client.environ_base["HTTP_X_CSRF_TOKEN"] = csrf
