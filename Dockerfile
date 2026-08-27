#
# The relayer, containerised. This image holds NO SECRETS — see `.dockerignore`, whose first
# entry is `.env` and whose comment explains why an image layer is not a place to put a key.
# `RELAYER_PRIVATE_KEY` and `RELAYER_AUTH_TOKEN` arrive at runtime from `fly secrets set`.
#
# WHY THE WHOLE WORKSPACE AND NOT JUST `packages/relayer`. The relayer imports the protocol
# package by RELATIVE path (`../../protocol/src/...`) and runs from TypeScript source through
# `tsx` — there is no build step and no published artifact to copy. The root manifest is also a
# real input: `starknet` and the privacy SDK are declared there, not in either package. So the
# unit that installs is the workspace, and `--filter` would only trade image size for a class of
# resolution failure that does not show up until the process is already listening.
#
FROM node:24-slim

# pnpm from npm rather than corepack: corepack is deprecated in this Node line and its version
# check adds a network round trip that can fail a build for a reason that has nothing to do with
# this repository. The version is pinned to the `packageManager` field in package.json — keep the
# two in step, a mismatch here is a lockfile format surprise at install time.
RUN npm install --global pnpm@11.24.0

WORKDIR /app

# Manifests first, sources second, so an edit to server.ts does not reinstall the dependency tree.
# Every workspace member's package.json must be present or pnpm refuses a frozen lockfile: the
# lockfile has an importer per member and a missing one is a lockfile that no longer describes the
# workspace. `apps/web` is here for exactly that reason and for no other — the web app builds and
# deploys on Vercel, never in this image.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/protocol/package.json packages/protocol/
COPY packages/relayer/package.json packages/relayer/
COPY apps/web/package.json apps/web/
# The privacy SDK installs from a tarball in the tree (`file:vendor/…` in the lockfile), so this
# has to land BEFORE the install, not with the sources. Without it the install fails outright.
COPY vendor/ vendor/

# `--frozen-lockfile` is the point: this image installs the audited tree or it fails. Nothing here
# may silently resolve a newer version of a dependency that signs transactions.
RUN pnpm install --frozen-lockfile

COPY tsconfig.json ./
COPY scripts/ scripts/
# The deployment records. The allowlist and the keeper read contract addresses from
# evidence/*.json at boot — an image without them starts with no MessageBook, no Markets and no
# Launch, which presents as "the relayer refuses my transaction" with the cause three layers
# away. Found live on 27 Aug: every production image to that date had shipped without them.
COPY evidence/ evidence/
COPY packages/protocol/ packages/protocol/
COPY packages/relayer/ packages/relayer/

# BINDING EVERY INTERFACE IS DELIBERATE HERE, and it is the one setting server.ts warns about.
# The default is loopback precisely so that exposure is an act rather than an accident; inside a
# container loopback would mean the process is reachable by nothing at all. What makes this safe
# is the control the README calls mandatory behind a proxy: `RELAYER_AUTH_TOKEN` must be set as a
# Fly secret. It is not defaulted here on purpose — a default token is not a token.
ENV RELAYER_HOST=0.0.0.0
ENV PORT=8080

# The ledgers live on the mounted volume (fly.toml `[mounts]`), not in the image. A container
# filesystem is discarded on every deploy, and these three files are the only thing standing
# between the funded key and a visitor who discovers that redeploying resets their spend cap.
ENV RELAYER_SPONSOR_STORE=/data/sponsorship.json
ENV RELAYER_SEND_STORE=/data/send-budget.json
# NO `RELAYER_INVITE_STORE` HERE, and it is not an omission. `resolveInviteConfig` refuses to start
# a server that has been given an invite store without `RELAYER_INVITE_ALLOWANCE`, because the
# feature would be OFF and the setting would quietly have no effect — this image was written with
# the path and without the allowance, and the first deploy crash-looped on exactly that refusal.
# Invites are off here, the same as a local run. Turning them on means setting BOTH.

EXPOSE 8080

# `pnpm exec` rather than `npx`: npx will happily reach the network for a package it cannot find
# locally, which in a container that has already installed everything can only ever mean the
# install went wrong. Failing loudly is the better outcome.
CMD ["pnpm", "exec", "tsx", "packages/relayer/src/server.ts"]
