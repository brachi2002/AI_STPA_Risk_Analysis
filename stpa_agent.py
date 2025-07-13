import requests


def analyze_system(description: str) -> dict:
    """
    שולח את תיאור המערכת ל־Mistral דרך Ollama ומחזיר ניתוח STPA
    """
    prompt = f"""
Perform a Systems-Theoretic Process Analysis (STPA) for the following system:
"{description}"

List the following:
1. System-level losses
2. Associated hazards
3. Unsafe control actions
Answer in structured text.
"""

    response = requests.post("http://localhost:11434/api/generate", json={
        "model": "mistral",
        "prompt": prompt,
        "stream": False
    })

    output = response.json()["response"]

    return {
        "input_description": description,
        "analysis": output
    }
