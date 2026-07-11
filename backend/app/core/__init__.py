"""Pure core logic for ResQOS.

Everything in this package is pure computation on the in-memory road graph
and related state. No FastAPI imports, no I/O, no network calls. app/api
and app/ws are the only adapters allowed to call into this package.
"""
