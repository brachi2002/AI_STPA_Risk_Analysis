# stpa_agent.py
import requests
import json # ייבוא מודול JSON

def analyze_system(description: str) -> dict:
    prompt = f"""
    Perform a Systems-Theoretic Process Analysis (STPA) for the following system:
    "{description}"

    List the following in JSON format with keys "system_losses", "associated_hazards", and "unsafe_control_actions". Each key should map to a list of strings.

    Example Output:
    {{
        "system_losses": ["Loss 1 description", "Loss 2 description"],
        "associated_hazards": ["Hazard 1 description", "Hazard 2 description"],
        "unsafe_control_actions": ["UCA 1 description", "UCA 2 description"]
    }}
    """

    try:
        response = requests.post("http://localhost:11434/api/generate", json={
            "model": "mistral",
            "prompt": prompt,
            "stream": False,
            "format": "json" # בקשה מפורשת לפלט JSON
        })
        response.raise_for_status() # יזרוק שגיאה עבור סטטוסי שגיאה (4xx, 5xx)

        output = response.json()["response"]

        # ננסה לנתח את הפלט כ-JSON
        try:
            parsed_output = json.loads(output)
        except json.JSONDecodeError:
            # אם ה-LLM לא החזיר JSON תקין, נחזיר הודעת שגיאה ברורה
            parsed_output = {"error": "Failed to parse JSON from LLM", "raw_llm_output": output}

    except requests.exceptions.RequestException as e:
        # טיפול בשגיאות תקשורת (לדוגמה, Ollama לא רץ)
        parsed_output = {"error": f"Communication with Ollama failed: {e}"}

    return {
        "input_description": description,
        "analysis": parsed_output
    }