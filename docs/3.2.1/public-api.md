# 3.2.1 Public API Notes

3.2.1 is additive and keeps the 3.2.0 sanitized HTTP and WebSocket schemas.

## Event cursor semantics

`seq` is a durable, strictly increasing cursor when present. Consumers must not
assume consecutive values: SQLite deduplication and retention can leave valid
holes. A consumer should apply every event whose sequence is greater than its
last applied cursor and then advance to that event's sequence.

Recovery is required after reconnect, an explicit WebSocket lag/overflow
signal, an invalid/expired/ahead cursor reset, or a proven non-monotonic stream.
A numeric gap by itself is not packet loss.

An event with omitted/zero `seq` is a live-only fallback emitted when durable
event persistence is unavailable or disabled. Apply it to the current display
without advancing the durable resume cursor. A later snapshot remains the
authoritative recovery boundary.

## Privacy and route truth

No new raw or internal field is exposed. Full keys, packet hashes, payload/path
hex, resolver reasons, broker data, and operator configuration remain absent.
Only resolver-backed high-confidence RF routes may appear publicly, and the
only public route-copy identifier remains `pathHash3`.
