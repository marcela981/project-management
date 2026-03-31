import os
import httpx
from datetime import datetime
from typing import Optional, Annotated
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Header, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field


# =============================================================================
# CONFIGURATION
# =============================================================================

NC_URL = os.getenv("NC_URL", "https://portaltest.gcf.group")
OAUTH_CLIENT_ID = os.getenv("NC_OAUTH_CLIENT_ID", "")
OAUTH_CLIENT_SECRET = os.getenv("NC_OAUTH_CLIENT_SECRET", "")


# =============================================================================
# PYDANTIC MODELS
# =============================================================================

class Subtask(BaseModel):
    id: str
    text: str
    completed: bool = False
    timeSpent: int = 0


class Observation(BaseModel):
    date: str
    text: str


class TimeLogEntry(BaseModel):
    date: str
    seconds: int = 0


class Task(BaseModel):
    id: str
    title: str
    owner: str = ""
    description: Optional[str] = ""
    column: str = "actively-working"
    type: str = "project"
    priority: str = "medium"
    startDate: Optional[str] = None
    deadline: Optional[str] = None
    progress: int = 0
    timeSpent: int = 0
    activityType: Optional[str] = None
    subtasks: list[Subtask] = Field(default_factory=list)
    observations: list[Observation] = Field(default_factory=list)
    timeLog: list[TimeLogEntry] = Field(default_factory=list)


class TaskCreate(BaseModel):
    title: str
    description: Optional[str] = ""
    column: str = "actively-working"
    type: str = "project"
    priority: str = "medium"
    startDate: Optional[str] = None
    deadline: Optional[str] = None
    activityType: Optional[str] = None
    subtasks: list[dict] = Field(default_factory=list)


class TimeRecord(BaseModel):
    tarea_id: str = Field(..., alias="tareaId")
    tiempo_invertido: int = Field(..., alias="tiempoInvertido")
    subtask_id: Optional[str] = Field(None, alias="subtaskId")
    feedback: Optional[dict] = None

    class Config:
        populate_by_name = True


class ColumnUpdate(BaseModel):
    column: str


class OAuthCallback(BaseModel):
    code: str
    redirect_uri: str


class TaskPatch(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    column: Optional[str] = None
    type: Optional[str] = None
    priority: Optional[str] = None
    startDate: Optional[str] = None
    deadline: Optional[str] = None
    progress: Optional[int] = None
    timeSpent: Optional[int] = None
    activityType: Optional[str] = None
    subtasks: Optional[list[dict]] = None
    observations: Optional[list[dict]] = None
    timeLog: Optional[list[dict]] = None


# =============================================================================
# IN-MEMORY DATA STORE (use DB in production)
# =============================================================================

TASKS_DB: dict[str, Task] = {}


# =============================================================================
# FASTAPI APP SETUP
# =============================================================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler."""
    print(f"[INFO] Activity Tracker started")
    print(f"[INFO] Nextcloud URL: {NC_URL}")
    print(f"[INFO] OAuth Client ID configured: {'Yes' if OAUTH_CLIENT_ID else 'No'}")
    yield
    print("[INFO] Activity Tracker shutting down")


app = FastAPI(
    title="Activity Tracker API",
    description="Backend API with Nextcloud OAuth2 authentication",
    version="2.0.0",
    lifespan=lifespan,
)

# CORS Configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://test-project-management-nine.vercel.app",
        "http://localhost:3000",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# =============================================================================
# UTILITY FUNCTIONS
# =============================================================================

def get_current_timestamp() -> str:
    return datetime.utcnow().isoformat() + "Z"


def generate_task_id() -> str:
    return f"task-{int(datetime.utcnow().timestamp() * 1000)}"


def generate_subtask_id(index: int) -> str:
    return f"sub-{int(datetime.utcnow().timestamp() * 1000)}-{index}"


async def get_user_id_from_token(authorization: str) -> str:
    """Extract user_id from Nextcloud using the OAuth token."""
    async with httpx.AsyncClient(timeout=10.0) as client:
        response = await client.get(
            f"{NC_URL}/ocs/v1.php/cloud/user",
            headers={
                "Authorization": authorization,
                "OCS-APIREQUEST": "true",
                "Accept": "application/json",
            },
        )

        if response.status_code != 200:
            raise HTTPException(status_code=401, detail="Invalid or expired token")

        data = response.json()
        return data["ocs"]["data"]["id"]


# =============================================================================
# ROUTES - OAUTH2 AUTHENTICATION
# =============================================================================

@app.post("/auth/callback")
async def oauth_callback(body: OAuthCallback):
    """
    Exchange OAuth authorization code for access token.
    Called by frontend after Nextcloud redirects back with ?code=...
    """
    if not OAUTH_CLIENT_ID or not OAUTH_CLIENT_SECRET:
        raise HTTPException(
            status_code=500,
            detail="OAuth not configured on server"
        )

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            f"{NC_URL}/index.php/apps/oauth2/api/v1/token",
            data={
                "grant_type": "authorization_code",
                "code": body.code,
                "redirect_uri": body.redirect_uri,
                "client_id": OAUTH_CLIENT_ID,
                "client_secret": OAUTH_CLIENT_SECRET,
            },
        )

        if response.status_code != 200:
            raise HTTPException(
                status_code=response.status_code,
                detail=f"OAuth token exchange failed: {response.text}"
            )

        return response.json()


@app.get("/auth/me")
async def get_me(authorization: Annotated[str, Header()]):
    """
    Get current user info from Nextcloud using their OAuth token.
    Frontend sends: Authorization: Bearer <token>
    """
    async with httpx.AsyncClient(timeout=10.0) as client:
        response = await client.get(
            f"{NC_URL}/ocs/v1.php/cloud/user",
            headers={
                "Authorization": authorization,
                "OCS-APIREQUEST": "true",
                "Accept": "application/json",
            },
        )

        if response.status_code != 200:
            raise HTTPException(status_code=401, detail="Invalid or expired token")

        data = response.json()["ocs"]["data"]

        # Generate initials from display name
        displayname = data.get("displayname", data["id"])
        parts = displayname.split()
        initials = "".join(p[0].upper() for p in parts[:2]) if parts else "U"

        return {
            "id": data["id"],
            "displayname": displayname,
            "email": data.get("email", ""),
            "initials": initials,
        }


# =============================================================================
# ROUTES - DECK API (uses user's token)
# =============================================================================

@app.get("/api/deck/boards")
async def get_deck_boards(authorization: Annotated[str, Header()]):
    """
    Get all Deck boards accessible by the authenticated user.
    Each user sees only their own boards.
    """
    async with httpx.AsyncClient(timeout=15.0) as client:
        response = await client.get(
            f"{NC_URL}/index.php/apps/deck/api/v1.0/boards",
            headers={
                "Authorization": authorization,
                "OCS-APIREQUEST": "true",
                "Accept": "application/json",
            },
        )

        if response.status_code != 200:
            raise HTTPException(
                status_code=response.status_code,
                detail="Failed to fetch boards"
            )

        boards = response.json()
        return [{"id": b["id"], "title": b["title"]} for b in boards]


@app.get("/api/deck/boards/{board_id}/cards")
async def get_deck_cards_by_board(
    board_id: int,
    authorization: Annotated[str, Header()],
):
    """
    Get all cards from a specific board (flattened from stacks).
    User must have access to the board.
    """
    async with httpx.AsyncClient(timeout=15.0) as client:
        response = await client.get(
            f"{NC_URL}/index.php/apps/deck/api/v1.0/boards/{board_id}/stacks",
            headers={
                "Authorization": authorization,
                "OCS-APIREQUEST": "true",
                "Accept": "application/json",
            },
        )

        if response.status_code != 200:
            raise HTTPException(
                status_code=response.status_code,
                detail="Failed to fetch cards"
            )

        stacks = response.json()

        # Flatten cards from all stacks
        cards = []
        for stack in stacks:
            for card in stack.get("cards", []):
                cards.append({
                    "id": card["id"],
                    "title": card.get("title", "Untitled"),
                    "description": card.get("description", ""),
                    "duedate": card.get("duedate"),
                    "labels": [l["title"] for l in card.get("labels", [])],
                    "stack": stack.get("title", ""),
                })

        return cards


@app.post("/api/deck/import")
async def import_deck_cards(
    card_ids: list[int],
    authorization: Annotated[str, Header()],
):
    """
    Import selected Deck cards as tasks for the authenticated user.
    """
    user_id = await get_user_id_from_token(authorization)

    imported = []
    for card_id in card_ids:
        task_id = generate_task_id()
        new_task = Task(
            id=task_id,
            owner=user_id,
            title=f"Imported card #{card_id}",
            description="Imported from Nextcloud Deck",
            column="actively-working",
            type="project",
            priority="medium",
            startDate=get_current_timestamp()[:10],
        )
        TASKS_DB[task_id] = new_task
        imported.append(task_id)

    return {"success": True, "imported": len(imported), "task_ids": imported}


# =============================================================================
# ROUTES - TASKS API (filtered by user)
# =============================================================================


@app.patch("/api/proyectos/tareas/{task_id}")
async def patch_task(
    task_id: str,
    task_patch: TaskPatch,
    authorization: Annotated[str | None, Header()] = None,
):
    """Partially update a task."""
    if task_id not in TASKS_DB:
        raise HTTPException(status_code=404, detail=f"Task {task_id} not found")

    task = TASKS_DB[task_id]

    # Check ownership
    if authorization and task.owner:
        user_id = await get_user_id_from_token(authorization)
        if task.owner != user_id:
            raise HTTPException(status_code=403, detail="Access denied")

    # Update only provided fields
    update_data = task_patch.model_dump(exclude_unset=True)

    for field, value in update_data.items():
        if field == "subtasks" and value is not None:
            task.subtasks = [
                Subtask(
                    id=sub.get("id", f"sub-{idx}"),
                    text=sub.get("text", ""),
                    completed=sub.get("completed", False),
                    timeSpent=sub.get("timeSpent", 0),
                )
                for idx, sub in enumerate(value)
            ]
        elif field == "observations" and value is not None:
            task.observations = [
                Observation(date=obs.get("date", ""), text=obs.get("text", ""))
                for obs in value
            ]
        elif field == "timeLog" and value is not None:
            task.timeLog = [
                TimeLogEntry(date=entry.get("date", ""), seconds=entry.get("seconds", 0))
                for entry in value
            ]
        elif hasattr(task, field):
            setattr(task, field, value)

    return {"success": True, "task": task.model_dump()}


@app.get("/api/proyectos/tareas")
async def get_all_tasks(authorization: Annotated[str | None, Header()] = None):
    """
    Get all tasks for the authenticated user.
    If no auth, returns empty list (or could return demo tasks).
    """
    if not authorization:
        # Return demo tasks for unauthenticated users
        return []

    try:
        user_id = await get_user_id_from_token(authorization)
        user_tasks = [
            t.model_dump() for t in TASKS_DB.values()
            if t.owner == user_id or t.owner == ""  # Include legacy tasks without owner
        ]
        return user_tasks
    except HTTPException:
        return []


@app.get("/api/proyectos/tareas/{task_id}")
async def get_task_by_id(
    task_id: str,
    authorization: Annotated[str | None, Header()] = None,
):
    """Get a specific task (must belong to user)."""
    if task_id not in TASKS_DB:
        raise HTTPException(status_code=404, detail=f"Task {task_id} not found")

    task = TASKS_DB[task_id]

    # Check ownership if authenticated
    if authorization:
        try:
            user_id = await get_user_id_from_token(authorization)
            if task.owner and task.owner != user_id:
                raise HTTPException(status_code=403, detail="Access denied")
        except HTTPException as e:
            if e.status_code == 403:
                raise

    return JSONResponse(content=task.model_dump(), status_code=200)


@app.post("/api/proyectos/tareas")
async def create_task(
    task_data: TaskCreate,
    authorization: Annotated[str | None, Header()] = None,
):
    """Create a new task for the authenticated user."""
    user_id = ""
    if authorization:
        try:
            user_id = await get_user_id_from_token(authorization)
        except HTTPException:
            pass

    task_id = generate_task_id()
    subtasks = [
        Subtask(
            id=generate_subtask_id(idx),
            text=sub.get("text", f"Subtask {idx + 1}"),
            completed=sub.get("completed", False),
            timeSpent=sub.get("timeSpent", 0),
        )
        for idx, sub in enumerate(task_data.subtasks)
    ]

    new_task = Task(
        id=task_id,
        owner=user_id,
        title=task_data.title,
        description=task_data.description,
        column=task_data.column,
        type=task_data.type,
        priority=task_data.priority,
        startDate=task_data.startDate or get_current_timestamp()[:10],
        deadline=task_data.deadline,
        activityType=task_data.activityType,
        progress=0,
        timeSpent=0,
        subtasks=subtasks,
        observations=[],
    )
    TASKS_DB[task_id] = new_task

    return JSONResponse(
        content={"success": True, "task": new_task.model_dump()},
        status_code=201,
    )


@app.put("/api/proyectos/tareas/{task_id}")
async def update_task(
    task_id: str,
    task_data: TaskCreate,
    authorization: Annotated[str | None, Header()] = None,
):
    """Update an existing task."""
    if task_id not in TASKS_DB:
        raise HTTPException(status_code=404, detail=f"Task {task_id} not found")

    existing_task = TASKS_DB[task_id]

    # Check ownership
    if authorization and existing_task.owner:
        user_id = await get_user_id_from_token(authorization)
        if existing_task.owner != user_id:
            raise HTTPException(status_code=403, detail="Access denied")

    subtasks = [
        Subtask(
            id=generate_subtask_id(idx),
            text=sub.get("text", f"Subtask {idx + 1}"),
            completed=sub.get("completed", False),
            timeSpent=sub.get("timeSpent", 0),
        )
        for idx, sub in enumerate(task_data.subtasks)
    ]

    updated_task = Task(
        id=task_id,
        owner=existing_task.owner,
        title=task_data.title,
        description=task_data.description,
        column=task_data.column,
        type=task_data.type,
        priority=task_data.priority,
        startDate=task_data.startDate or existing_task.startDate,
        deadline=task_data.deadline,
        activityType=task_data.activityType,
        progress=existing_task.progress,
        timeSpent=existing_task.timeSpent,
        subtasks=subtasks if task_data.subtasks else existing_task.subtasks,
        observations=existing_task.observations,
    )
    TASKS_DB[task_id] = updated_task

    return JSONResponse(
        content={"success": True, "task": updated_task.model_dump()},
        status_code=200,
    )


@app.delete("/api/proyectos/tareas/{task_id}")
async def delete_task(
    task_id: str,
    authorization: Annotated[str | None, Header()] = None,
):
    """Delete a task."""
    if task_id not in TASKS_DB:
        raise HTTPException(status_code=404, detail=f"Task {task_id} not found")

    task = TASKS_DB[task_id]

    # Check ownership
    if authorization and task.owner:
        user_id = await get_user_id_from_token(authorization)
        if task.owner != user_id:
            raise HTTPException(status_code=403, detail="Access denied")

    del TASKS_DB[task_id]
    return {"success": True}


# =============================================================================
# ROUTES - TIME TRACKING
# =============================================================================


@app.post("/api/proyectos/tareas/{task_id}/time")
async def record_time_by_path(
    task_id: str,
    time_data: dict,
    authorization: Annotated[str | None, Header()] = None,
):
    """Record time spent on a task (alternative endpoint)."""
    if task_id not in TASKS_DB:
        raise HTTPException(status_code=404, detail=f"Task {task_id} not found")

    task = TASKS_DB[task_id]

    # Check ownership
    if authorization and task.owner:
        user_id = await get_user_id_from_token(authorization)
        if task.owner != user_id:
            raise HTTPException(status_code=403, detail="Access denied")

    # Extraer tiempo del body
    tiempo = time_data.get("tiempoInvertido", time_data.get("tiempo_invertido", 0))
    task.timeSpent += tiempo

    # Subtask si existe
    subtask_id = time_data.get("subtaskId", time_data.get("subtask_id"))
    if subtask_id and subtask_id != "none":
        for subtask in task.subtasks:
            if subtask.id == subtask_id:
                subtask.timeSpent += tiempo
                break

    # Feedback si existe
    feedback = time_data.get("feedback")
    if feedback:
        if "progress" in feedback:
            task.progress = feedback["progress"]
        if feedback.get("observation"):
            task.observations.append(
                Observation(
                    date=get_current_timestamp(),
                    text=feedback["observation"],
                )
            )

    return JSONResponse(
        content={"success": True, "task": task.model_dump()},
        status_code=200,
    )

# =============================================================================
# ROUTES - COLUMN MANAGEMENT
# =============================================================================

@app.patch("/api/proyectos/tareas/{task_id}/columna")
async def update_task_column(
    task_id: str,
    column_update: ColumnUpdate,
    authorization: Annotated[str | None, Header()] = None,
):
    """Update the column of a task (drag & drop)."""
    if task_id not in TASKS_DB:
        raise HTTPException(status_code=404, detail=f"Task {task_id} not found")

    valid_columns = ["actively-working", "working-now", "activities"]
    if column_update.column not in valid_columns:
        raise HTTPException(status_code=400, detail="Invalid column")

    task = TASKS_DB[task_id]

    # Check ownership
    if authorization and task.owner:
        user_id = await get_user_id_from_token(authorization)
        if task.owner != user_id:
            raise HTTPException(status_code=403, detail="Access denied")

    if column_update.column == "working-now":
        # Only one task per user in "working-now"
        user_id = task.owner
        existing = [
            t for t in TASKS_DB.values()
            if t.column == "working-now" and t.id != task_id and t.owner == user_id
        ]
        if existing:
            raise HTTPException(
                status_code=400,
                detail="Only one task can be in 'Working Right Now'",
            )

    if task.type == "activity" and column_update.column != "activities":
        raise HTTPException(
            status_code=400,
            detail="Activities can only be in 'Activities' column",
        )

    if task.type == "project" and column_update.column == "activities":
        raise HTTPException(
            status_code=400,
            detail="Projects cannot be in 'Activities'",
        )

    task.column = column_update.column
    return JSONResponse(
        content={"success": True, "task": task.model_dump()},
        status_code=200,
    )


# =============================================================================
# ROUTES - TASK COMPLETION
# =============================================================================

@app.post("/api/proyectos/tareas/{task_id}/finalizar")
async def finalize_task(
    task_id: str,
    authorization: Annotated[str | None, Header()] = None,
):
    """Mark a task as complete (100%)."""
    if task_id not in TASKS_DB:
        raise HTTPException(status_code=404, detail=f"Task {task_id} not found")

    task = TASKS_DB[task_id]

    # Check ownership
    if authorization and task.owner:
        user_id = await get_user_id_from_token(authorization)
        if task.owner != user_id:
            raise HTTPException(status_code=403, detail="Access denied")

    task.progress = 100
    for subtask in task.subtasks:
        subtask.completed = True
    task.column = "actively-working"

    return JSONResponse(
        content={"success": True, "task": task.model_dump()},
        status_code=200,
    )


# =============================================================================
# ROUTES - HEALTH
# =============================================================================

@app.get("/api/proyectos/health")
async def health_check():
    """Health check endpoint."""
    return JSONResponse(
        content={
            "status": "healthy",
            "service": "Activity Tracker API",
            "version": "2.0.0",
            "tasks_count": len(TASKS_DB),
            "oauth_configured": bool(OAUTH_CLIENT_ID),
        },
        status_code=200,
    )


@app.get("/health")
async def root_health():
    """Root health check."""
    return {"status": "ok"}


# =============================================================================
# MAIN ENTRY POINT
# =============================================================================

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8080))
    uvicorn.run(app, host="0.0.0.0", port=port)