"""Run the React dashboard on Streamlit Community Cloud."""
from pathlib import Path

import streamlit as st
import streamlit.components.v1 as components

from api import dashboard_config, export_report, run

DIST = Path(__file__).resolve().parent / "frontend" / "dist"
HANDLERS = {"run": run, "export": export_report}


def render():
    st.set_page_config(page_title="Momentum Lab", layout="wide")
    if not (DIST / "index.html").is_file():
        st.error("The dashboard build is missing. Run npm ci and npm run build in frontend.")
        st.stop()

    st.markdown(
        """
        <style>
        header[data-testid="stHeader"] { display: none; }
        .stMainBlockContainer { max-width: none; padding: 0; }
        .stMainBlockContainer iframe { display: block; }
        </style>
        """,
        unsafe_allow_html=True,
    )
    dashboard = components.declare_component("momentum_dashboard", path=str(DIST))
    response = st.session_state.get("dashboard_response")
    request = dashboard(config=dashboard_config(), response=response, key="momentum_dashboard")
    if not isinstance(request, dict) or not request.get("id"):
        return
    if response and request["id"] == response["id"]:
        return

    try:
        handler = HANDLERS.get(request.get("path"))
        if handler is None:
            raise ValueError("Unsupported dashboard request.")
        result = handler(request.get("body") or {})
        response = {"id": request["id"], "result": result}
    except Exception as error:
        response = {"id": request["id"], "error": str(error)}
    st.session_state["dashboard_response"] = response
    st.rerun()


if __name__ == "__main__":
    render()
