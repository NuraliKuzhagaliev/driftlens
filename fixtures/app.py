import os

DATABASE_URL = os.environ["DATABASE_URL"]
PAYMENT_API_KEY = os.getenv("PAYMENT_API_KEY")
PORT = int(os.getenv("PORT", "8080"))

def checkout(amount):
    # Demo service; deliberately avoids making payment requests.
    return {"amount": amount, "configured": bool(DATABASE_URL and PAYMENT_API_KEY)}
