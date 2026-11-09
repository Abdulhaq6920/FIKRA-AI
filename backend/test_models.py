"""List available Groq models."""

import os
from groq import Groq

client = Groq(api_key=os.environ.get("GROQ_API_KEY", ""))

# Load from .env if not in env
from dotenv import load_dotenv

load_dotenv("c:/Users/Lenovo/Desktop/RAG/backend/.env")
client = Groq(api_key=os.environ.get("GROQ_API_KEY", ""))

try:
    models = client.models.list()
    print("Available models:")
    for m in models.data:
        print(f"  {m.id}  (context: {getattr(m, 'context_window', '?')})")
except Exception as e:
    print(f"Error: {e}")
