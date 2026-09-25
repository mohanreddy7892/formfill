"""Bound HTTP uploads in memory and prevent multipart temporary-file spill.
Strip response caching and return generic errors without logging document content.
"""
import re
from contextlib import nullcontext
import anyio
import starlette.requests
from starlette.formparsers import MultiPartParser
from . import storage

MAX_REQUEST = 60 * 1024 * 1024

class MemoryMultipartParser(MultiPartParser):
    spool_max_size = MAX_REQUEST + 1
    max_file_size = MAX_REQUEST + 1  # compatibility with older Starlette versions

# Starlette Request._get_form resolves this class at parse time.
starlette.requests.MultiPartParser = MemoryMultipartParser

class PrivacyMiddleware:
    def __init__(self, app):
        self.app = app
        self.limit = anyio.CapacityLimiter(2)

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        headers = dict(scope.get("headers", []))
        session = headers.get(b"x-formfill-session", b"").decode("ascii", "ignore")
        context = storage.SESSION.set(session if re.fullmatch(r"[a-f0-9]{32}", session) else "")
        started = False
        async def private_send(message):
            nonlocal started
            if message["type"] == "http.response.start":
                started = True
                h = [(k, v) for k, v in message.get("headers", []) if k.lower() not in (b"cache-control", b"pragma")]
                message = {**message, "headers": h + [(b"cache-control", b"no-store"), (b"pragma", b"no-cache")]}
            await send(message)
        async def reject(status, body):
            await private_send({"type":"http.response.start", "status":status,
                                "headers":[(b"content-type", b"application/json")]})
            await private_send({"type":"http.response.body", "body":body})
        try:
            async with (self.limit if scope.get("method") in ("POST", "PUT", "PATCH") else nullcontext()):
                chunks, total = [], 0
                while True:
                    message = await receive()
                    if message["type"] == "http.disconnect":
                        return
                    data = message.get("body", b"")
                    total += len(data)
                    if total > MAX_REQUEST:
                        return await reject(413, b'{"detail":"Request exceeds 60 MB"}')
                    chunks.append(data)
                    if not message.get("more_body", False):
                        break
                body = b"".join(chunks)
                chunks.clear()
                delivered = False
                async def memory_receive():
                    nonlocal delivered, body
                    if not delivered:
                        delivered = True
                        payload, body = body, b""
                        return {"type":"http.request", "body":payload, "more_body":False}
                    return await receive()
                await self.app(scope, memory_receive, private_send)
        except Exception:
            if not started:
                await reject(500, b'{"detail":"Unable to process this request"}')
        finally:
            storage.SESSION.reset(context)
