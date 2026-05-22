# Changelog

## 1.3.0

- Added MeshCore 3-byte route copy support from selected phonebook paths.
- Added a Plot routes control for selecting two node endpoints and highlighting the shortest valid public route path.
- Added map-square route lookup by selecting two map corners, with matching routes highlighted and listed.
- Added decoded chatter history on selected node panels using sanitized public message text from the current live window.
- Documented the new route-copy privacy boundary: full public keys remain private, but six-character 3-byte route prefixes are public for verified path copy.

## 1.2.0

- Added node connectivity focus for repeaters, observers, rooms, companions, and sensors.
- Highlighted directly served routes and directly connected nodes when a node is selected.
- Added a reachable-node phonebook grouped by hop count, with path summaries and row-level path highlighting.
- Added close buttons, Escape dismissal, and empty-map-click dismissal for node and route panels.
- Kept the public HTTP and WebSocket API unchanged from 1.1.

## 1.1.0

- Added the MC-CartoLive project bar with MeshCore Canada, GitHub, version, and build links.
- Added a compact red Live Follow control that smoothly follows fresh packet movement.
- Stabilized the status bar so changing counters do not shift the toolbar.
- Improved mobile layout by hiding secondary panels and toasts, moving controls to the bottom, and keeping the map and packet motion as the focus.
- Kept the public API unchanged from 1.0.

## 1.0.0

- Initial public release of MeshCore MQTT Live Map, also known as MC-CartoLive.
- Added Docker Compose deployment, fixture replay mode, privacy-safe public APIs, route animation, cluster activity, observer bursts, message bubbles, and production documentation.
