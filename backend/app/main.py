from pathlib import Path
from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().parents[1] / ".env")

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .core.db import init_db
from .routers import disease, health, integrated, iot, irrigation, yield_api

app = FastAPI()

app.add_middleware(
	CORSMiddleware,
	allow_origins=["*"],
	allow_credentials=True,
	allow_methods=["*"],
	allow_headers=["*"],
)

app.include_router(health.router, prefix='/health')
app.include_router(disease.router, prefix='/predict')
app.include_router(yield_api.router, prefix='/yield')
app.include_router(integrated.router, prefix='/predict-all')
app.include_router(irrigation.router, prefix='/irrigation')
app.include_router(iot.router, prefix='/iot')


@app.on_event("startup")
def on_startup():
	init_db()
