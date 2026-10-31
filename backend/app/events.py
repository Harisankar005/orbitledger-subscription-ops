import asyncio
import json
from typing import Any, AsyncGenerator, Dict

import structlog

logger = structlog.get_logger()


class EventBroadcaster:
    """In-memory event broadcaster for Server-Sent Events (SSE).

    In scaled production setups, this can be backed by Postgres LISTEN/NOTIFY or Redis Pub/Sub.
    """

    def __init__(self):
        self._subscribers: set[asyncio.Queue] = set()

    async def subscribe(self) -> AsyncGenerator[str, None]:
        queue: asyncio.Queue = asyncio.Queue()
        self._subscribers.add(queue)
        try:
            # Yield initial connection greeting event
            init_event = json.dumps({"event": "connected", "data": {"status": "ok"}})
            yield f"data: {init_event}\n\n"

            while True:
                msg = await queue.get()
                yield f"data: {msg}\n\n"
        except asyncio.CancelledError:
            pass
        finally:
            self._subscribers.discard(queue)

    async def broadcast(self, event_name: str, payload: Dict[str, Any]):
        if not self._subscribers:
            return
        message = json.dumps({"event": event_name, "data": payload})
        for q in list(self._subscribers):
            try:
                q.put_nowait(message)
            except Exception:
                self._subscribers.discard(q)


broadcaster = EventBroadcaster()
