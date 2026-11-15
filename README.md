# Momentum Lab

## Start the React dashboard

From the Momentum Lab folder in PowerShell:

```powershell
python -m pip install -r requirements.txt
npm.cmd --prefix frontend ci
npm.cmd --prefix frontend run build
python api.py
```

Open http://127.0.0.1:8765. The server listens on this computer only. For Vite development, leave the Python API running and open a second terminal with `npm.cmd --prefix frontend run dev`.

Select **Quality Stocks** for the built-in quarterly history, or upload an effective-date CSV under **Settings**. Uploaded history overrides the built-in history. Use `YYYY-MM-DD` column headers and put one ticker per cell. Chartink historical snapshots can repaint. The first backtest or holdings calculation can take a few minutes while prices download.

The original Streamlit interface is also available with `python -m streamlit run app.py`. Both interfaces import the strategy engine in `engine.py`.

## Deploy on Render

Push this project folder as its own GitHub repository, then create a Render
Blueprint linked to that repository. The root `render.yaml` selects one free
Docker web service. Render builds the React frontend and starts the Python API
from the Dockerfile. Check `/api/health` and run a backtest on the deployed URL.

The hosted service reads snapshots from the repository. The included GitHub
Actions workflow checks for the scheduled Chartink capture and commits a new
snapshot when one is due. On protected branches, the workflow needs permission
to push or the new snapshot must be merged by a maintainer. If needed, set
the repository Actions secret `RENDER_DEPLOY_HOOK` to the service deploy hook.
