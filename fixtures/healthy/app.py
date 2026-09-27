import os

DATABASE_URL     = os.environ["DATABASE_URL"]
SMTP_HOST        = os.environ["SMTP_HOST"]
SMTP_PORT        = int(os.getenv("SMTP_PORT", "587"))
API_SECRET_KEY   = os.environ["API_SECRET_KEY"]

def send_notification(recipient, body):
    """Demo notifications service; no real SMTP calls are made."""
    return {
        "recipient": recipient,
        "configured": bool(DATABASE_URL and SMTP_HOST and API_SECRET_KEY),
    }
