from flask import Flask, request, jsonify
from stpa_agent import analyze_system

app = Flask(__name__)


@app.route("/analyze", methods=["POST"])
def analyze():
    data = request.get_json()
    description = data.get("description", "")
    result = analyze_system(description)
    return jsonify(result)


if __name__ == "__main__":
    app.run(port=5005)
