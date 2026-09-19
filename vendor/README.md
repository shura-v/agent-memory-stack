# Third-party components

This directory contains third-party component inputs and dependency metadata.
AMS Dockerfiles and operating-system package sources remain in `deploy/`.

`upstream.lock.json` records verified source revisions, archive checksums and
base image identities. Sources and their original dependency manifests come
from the verified archives through the build cache.

Install these dependencies unchanged. Use supported APIs and configuration to
integrate them; do not add source replacements, build-time patches or preloads.
The MCP transport uses the official SDK directly and has no Supergateway layer.
AMS dependencies use the root `package.json` and `package-lock.json` for both
development and container builds; there is no separate MCP package or lock.
