"""HTTP wrapper over the Splink model, implementing IdentityResolver's wire shape.

    uvicorn main:app --port 8100

POST /resolve  {"records": [{"id", "full_name", "email", "phone", "city", "state"}]}
            →  {"pairs": [{"left_id", "right_id", "confidence"}]}
"""

from fastapi import FastAPI
from pydantic import BaseModel

from model import resolve

app = FastAPI(title="athena-identity-splink")


class Record(BaseModel):
    id: str
    full_name: str | None = None
    email: str | None = None
    phone: str | None = None
    city: str | None = None
    state: str | None = None


class ResolveRequest(BaseModel):
    records: list[Record]


@app.get("/health")
def health() -> dict:
    return {"ok": True}


@app.post("/resolve")
def resolve_records(req: ResolveRequest) -> dict:
    if len(req.records) < 2:
        return {"pairs": []}
    return {"pairs": resolve([r.model_dump() for r in req.records])}
