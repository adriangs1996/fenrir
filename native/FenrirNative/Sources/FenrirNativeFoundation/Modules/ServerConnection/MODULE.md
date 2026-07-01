# ServerConnection

Owns authenticated Fenrir server endpoint/session contracts, health summaries,
request/stream adapter ports, and stable transport error tags.

This module does not supervise local server processes, store bearer secrets, or
own workspace/runtime replay semantics.
