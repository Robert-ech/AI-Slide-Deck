"""
A short python script to list the Google Gemini models which 
the .env Gemini API key can reach.
"""

import os
from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()
client = OpenAI(api_key=os.getenv("LLM_API_KEY"),
                base_url=os.getenv("LLM_BASE_URL")
)

for m in client.models.list():
    if "flash" in m.id:
        print(m.id)
