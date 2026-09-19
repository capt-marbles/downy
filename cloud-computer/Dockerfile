FROM ghcr.io/cloudflare/computer-computerd-linux-x64:0.3.1 AS computerd
FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends fuse3 libfuse2 ca-certificates git \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g @openai/codex@0.154.0
COPY --from=computerd /usr/local/bin/computerd /usr/local/bin/computerd
COPY *.mjs /opt/downy/
RUN mkdir -m 700 /private-codex
ENV PORT=8080 MOUNT_POINT=/workspace FUSE_MOUNT=auto
EXPOSE 8080 8789
ENTRYPOINT ["/usr/local/bin/computerd"]
