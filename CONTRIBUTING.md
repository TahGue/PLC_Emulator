# Contributing

## Prerequisites

- Python 3.11+
- Node.js (optional, for frontend linting)
- Docker + Docker Compose (for backend services)

## Local Setup

```bash
# Clone
git clone https://github.com/TahGue/PLC_Emulator.git
cd PLC_Emulator

# Install Python deps (use a virtualenv)
python -m venv .venv
source .venv/bin/activate   # or .venv\Scripts\activate on Windows
pip install -r backend/requirements.txt

# Start Postgres + Analyzer
docker compose up --build -d

# Serve frontend
python -m http.server 8000
```

## Running Tests

```bash
cd PLC_Emulator
PYTHONPATH=backend python -m pytest backend/tests/ -v
```

On Windows PowerShell:

```powershell
$env:PYTHONPATH='backend'; python -m pytest backend/tests/ -v
```

## Code Style

- Python: follow existing patterns, no additional linting enforced yet
- JavaScript: vanilla ES6, no build step
- Keep imports at the top of files
- Don't add comments unless they clarify non-obvious logic

## Adding a New Script

1. Create the script in `backend/scripts/`
2. Add CLI args with `argparse`
3. Add unit tests in `backend/tests/test_<name>.py`
4. Document usage in `backend/scripts/README.md`
5. Add to the file tree in `README.md`

## Adding a New API Endpoint

1. Add the route in `backend/app/main.py`
2. Add integration tests in `backend/tests/test_api_integration.py`
3. Document in the Analyzer API section of `README.md`
4. If it exposes metrics, wire counters in the `/metrics` endpoint

## Commit Messages

Use clear imperative messages:
- `Add <feature>`
- `Fix <bug description>`
- `Update <file> for <reason>`
