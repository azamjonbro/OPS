# Deploying Hadiya 2.0

How this application is meant to run in production, and how to operate it once
it is. Written for one person looking after one shop's deployment, because that
is what Hadiya is: a single business account, a single API process, a single
scheduler.

Nothing here contains a real credential, and none of the scripts prints one.

---

## 1. Architecture

```
                    Internet
                       │  443
                       ▼
              ┌──────────────────┐
              │      Nginx       │  TLS, static files, reverse proxy
              └────────┬─────────┘
                 /     │      \
     static files      │ /api  │ /api/v1/ai/*  (streamed, unbuffered)
                       ▼       ▼
              ┌──────────────────┐
              │   Hadiya API     │  one Node process, supervised by PM2
              │   :4000          │  · HTTP · scheduler · agent
              └────────┬─────────┘
                       │
                  ┌────┴────┐
                  │ MongoDB │  replica set (transactions)
                  └─────────┘

The API also reaches, outbound only:
  Billz · Notion · a user's MCP servers · the model provider · STT · images
```

**One API process, deliberately.** Two things live in this process's memory:
the rate limiters and the agent run registry a reconnecting browser rejoins a
stream through. A second worker would halve every rate limit's effectiveness
and lose half the reconnections. The scheduler is safe either way — it claims
jobs by a database lease — but the other two are not. Scaling out means giving
those a shared store first; until then, `instances: 1` and `exec_mode: 'fork'`
in `ecosystem.config.cjs` are load-bearing, not incidental.

**Why not Docker.** It would be a reasonable choice, and it is deliberately not
made here: the Docker daemon was not available in the environment this phase was
prepared in, so an image could not be built or started even once. Shipping an
unverified Dockerfile as the recommended path would be worse than not shipping
one. PM2 is what is configured, documented and tested.

---

## 2. Prerequisites

| Thing                  | Version     | Notes                                      |
| ---------------------- | ----------- | ------------------------------------------ |
| Node.js                | ≥ 22.12     | `.nvmrc` pins 22                           |
| npm                    | ≥ 10        |                                            |
| MongoDB                | 6+          | **replica set**, even single-node — see §5 |
| Nginx                  | any current | TLS and static files                       |
| PM2                    | 5+          | `npm i -g pm2`                             |
| mongodb-database-tools | any         | `mongodump` / `mongorestore` for backups   |

A small VPS is enough: 2 vCPU and 2 GB of memory runs this comfortably. Document
extraction is the memory-hungry part — a large spreadsheet is read whole.

---

## 3. Environment

Configuration lives in one `.env` at the repository root, read by both the API
and the frontend build. Only `VITE_`-prefixed variables reach the browser.

Generate the secrets on the host:

```bash
openssl rand -hex 32      # JWT_ACCESS_SECRET
openssl rand -hex 32      # JWT_REFRESH_SECRET
openssl rand -base64 32   # CREDENTIALS_ENCRYPTION_KEY
```

`CREDENTIALS_ENCRYPTION_KEY` encrypts stored integration tokens. Rotating it
makes every existing one unreadable and each integration has to be reconnected,
so keep it with the backups.

Production refuses to start on a value it could have inherited from a
developer's machine. It will not accept the default `MONGO_URI`, a `CORS_ORIGINS`
that is unset, wildcard, plain HTTP or localhost, JWT secrets under 32
characters, a missing encryption key, or `MCP_ALLOW_PRIVATE_HOSTS=true`. Check a
file before you deploy it:

```bash
npm run check:production -w @hadiya/api -- --env-file /srv/hadiya/.env
```

It reports errors and warnings, exits non-zero on an error, and never prints a
value. `.env.example` documents every variable.

Set `TRUST_PROXY=true` — behind Nginx, without it every request looks like it
came from the proxy and the rate limits apply to everyone at once.

---

## 4. First install

```bash
sudo mkdir -p /srv/hadiya /var/www/hadiya /var/lib/hadiya/storage
sudo chown -R "$USER" /srv/hadiya /var/www/hadiya /var/lib/hadiya

git clone <repository> /srv/hadiya
cd /srv/hadiya
cp .env.example .env && $EDITOR .env      # see §3
chmod 600 .env

npm ci
npm run build

npm run db:indexes -w @hadiya/api          # see §6
npm run create-owner -w @hadiya/api -- --username owner --password '…' --name 'Your Name'

rsync -a --delete apps/web/dist/ /var/www/hadiya/
pm2 start ecosystem.config.cjs
pm2 save && pm2 startup                    # survive a reboot
```

---

## 5. MongoDB

**Use a replica set, even with one node.** Multi-document writes are only atomic
inside a transaction, and transactions need one. On a standalone the application
falls back to non-atomic writes and says so loudly at boot.

```yaml
# /etc/mongod.conf
replication:
  replSetName: rs0
security:
  authorization: enabled
net:
  bindIp: 127.0.0.1 # never 0.0.0.0 without a firewall in front
```

```js
rs.initiate({ _id: 'rs0', members: [{ _id: 0, host: '127.0.0.1:27017' }] });
db.getSiblingDB('admin').createUser({
  user: 'hadiya',
  pwd: '…',
  roles: [{ role: 'readWrite', db: 'hadiya' }],
});
```

```
MONGO_URI=mongodb://hadiya:…@127.0.0.1:27017/hadiya?authSource=admin&replicaSet=rs0
```

Bound to loopback and authenticated. The database name must differ from the test
one — the suite drops collections between tests.

---

## 6. Indexes

`autoIndex` is off in production: Mongoose would otherwise issue index builds on
every boot, competing with live traffic exactly when a deployment is most
fragile. So indexes are created explicitly:

```bash
npm run db:indexes -w @hadiya/api
```

It creates what the schemas declare, leaves what already exists, and **never
drops anything**. Indexes no longer declared are listed for you to decide about;
`-- --drop-extra` removes them once you have. Run it after any deploy that
changes a schema. On an empty database it creates 35 indexes across 18 models.

It is not run automatically by the deploy script, on purpose. Building an index
on a large collection is a decision about when, not just whether.

---

## 7. Nginx and HTTPS

`deploy/nginx/hadiya.conf` is the configuration. Replace the hostname, then:

```bash
sudo cp deploy/nginx/hadiya.conf /etc/nginx/sites-available/hadiya
sudo ln -s /etc/nginx/sites-available/hadiya /etc/nginx/sites-enabled/hadiya
sudo nginx -t && sudo systemctl reload nginx
```

Get a certificate **before** enabling the TLS block, or `nginx -t` fails on a
path that does not exist yet:

```bash
sudo certbot --nginx -d hadiya.example.com
sudo systemctl status certbot.timer      # renewal is automatic; check it is armed
```

Two things in that file matter more than the rest:

- **Streaming.** `proxy_buffering off` is set for `/api/v1/ai/(chat|runs/…/stream)`
  and nowhere else. With buffering on, the browser sees nothing until the whole
  turn finishes and the assistant looks broken. It is scoped to those routes
  because every other response is small JSON that benefits from buffering. The
  API also sends `X-Accel-Buffering: no` on each stream, which Nginx honours on
  its own — belt and braces.
- **Timeouts.** `proxy_read_timeout 600s` on the streaming routes. A turn with
  several model calls and a dozen tools legitimately takes minutes; the API's own
  budgets are the real limit and Nginx must not cut in first.

`client_max_body_size 25m` clears the API's own 20 MB document limit. Keep them
in step, or Nginx rejects a large upload with a bare 413 the application never
sees.

HSTS is set by Nginx so it also covers static files and Nginx's own error pages.
Do not enable it until HTTPS is known to work — a browser that has seen it will
refuse plain HTTP for the whole `max-age`.

---

## 8. Deploying

```bash
cd /srv/hadiya && deploy/scripts/deploy.sh
```

It checks the configuration, fetches, `npm ci`, builds, publishes the frontend,
restarts the API, and waits for `/api/health/ready`. **If the new version never
becomes ready it checks the previous revision back out, rebuilds and restarts
it**, then reports which state you are in.

It does not touch the database. No migration, no index build — those are §6, run
deliberately.

**This is not zero-downtime.** One process means a restart is a gap of a second
or two during which Nginx answers 502. In-flight requests are drained first and
open answer streams are ended cleanly, so nothing is corrupted — but a turn
being watched at that moment is interrupted and has to be asked again. Deploy
when the shop is quiet.

Afterwards:

```bash
deploy/scripts/smoke-test.sh https://hadiya.example.com
SMOKE_USER=owner SMOKE_PASSWORD='…' deploy/scripts/smoke-test.sh https://hadiya.example.com
```

Read-only apart from creating one conversation. It never runs a destructive
tool, confirms a pending action, or writes to Billz.

### Rollback

Automatic on a failed health check, as above. By hand:

```bash
cd /srv/hadiya
git checkout <previous-sha>
npm ci && npm run build
rsync -a --delete apps/web/dist/ /var/www/hadiya/
pm2 restart hadiya-api
```

Rolling back the application is safe. Rolling back **across a schema change is
not** — an older build may not understand documents a newer one wrote. Nothing
here migrates data, so this is rare, but check before crossing a release that
changed a model.

---

## 9. Storage

Documents and generated images live on disk under `STORAGE_LOCAL_DIR`. In
production make it an absolute path outside the checkout — `/var/lib/hadiya/storage`
— so a deploy that replaces the application directory does not take every
uploaded file with it. `check:production` warns about a relative path and fails
on `/tmp`.

Uploads are never written to a temporary directory: multipart bodies are held in
memory and written to the store only once validated, so there is nothing to clean
up after a failed request.

Back it up with the database — §10 does.

---

## 10. Backups

```bash
deploy/scripts/backup.sh
17 * * * * cd /srv/hadiya && deploy/scripts/backup.sh >> /var/log/hadiya-backup.log 2>&1
```

Hourly, keeping 14 days (`BACKUP_RETENTION_DAYS`). Each backup is a gzipped
`mongodump` archive, a tar of the storage directory, and a manifest recording the
time, host, database name and application revision — never the URI, which
carries the password. The archive's integrity is verified before the backup is
called a success.

Both halves matter: a database restored without its files gives every upload a
card that cannot be opened.

Keep a copy off the machine. A backup on the disk that dies is not a backup.

### Restoring, and proving a backup is real

```bash
# A drill — restore into a scratch database and verify it.
deploy/scripts/restore.sh backups/20260907T120000Z mongodb://127.0.0.1:27017/hadiya-drill

# A real recovery — stop the API first.
pm2 stop hadiya-api
deploy/scripts/restore.sh backups/20260907T120000Z "$MONGO_URI" --force
tar -xzf backups/20260907T120000Z/storage.tar.gz -C /var/lib/hadiya
pm2 start hadiya-api
```

The target is a required argument with no default, so the script cannot pick the
live database on its own, and it refuses a target matching the backup's own
database unless `--force` is given.

Every restore is verified: `verify-restore.mjs` checks the collections a running
system needs are present, that `users` has rows, that indexes survived, and reads
a document back. **A restore that produced nothing at all fails loudly** — that
is the most likely way for one to go wrong and the easiest to miss.

**Do a drill monthly.** A backup nobody has restored is a hope.

---

## 11. Logs

| Where                          | What                             |
| ------------------------------ | -------------------------------- |
| `/srv/hadiya/logs/api.out.log` | the API's JSON lines             |
| `/srv/hadiya/logs/api.err.log` | crashes and PM2's own errors     |
| `/var/log/nginx/access.log`    | requests, minus the health probe |
| `journalctl -u mongod`         | the database                     |

The API writes structured JSON with a level, a timestamp and a request id. Pino
redacts `authorization`, cookies, passwords, tokens and API keys before anything
reaches a sink, and the model provider's error bodies have credential-shaped
values stripped — providers quote your key back at you when they reject it.

Rotation is not automatic. Install it once:

```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 50M
pm2 set pm2-logrotate:retain 14
pm2 set pm2-logrotate:compress true
```

Without this the logs grow until the disk is full, which takes the database down
with it. Nginx's own logs are rotated by the distribution's logrotate.

Keep `LOG_LEVEL=info` and `LOG_PRETTY=false` in production — `debug` fills a disk
faster than rotation expects, and pretty output is not JSON a collector can read.

---

## 12. Monitoring

Deliberately small. An uptime check and a disk alarm catch most of what actually
goes wrong.

**Externally**, poll `GET /api/health/live` every minute from something that is
not this machine (Uptime Kuma, Better Stack, a cron on another host). Liveness
answers 200 whenever the process is running and never depends on Mongo, so it
tells you the process is up.

**`GET /api/health/ready`** reports dependencies and answers 503 when one is
down. Use it for a deploy gate, not for a restart trigger — a brief Mongo blip
should not kill a healthy process.

Worth watching, in rough order of how often it matters:

| Signal            | Where                                     | Act when                              |
| ----------------- | ----------------------------------------- | ------------------------------------- |
| Disk usage        | `df -h`                                   | over 80%                              |
| Log directory     | `du -sh /srv/hadiya/logs`                 | over 1 GB — rotation is not working   |
| Storage directory | `du -sh /var/lib/hadiya/storage`          | growing unexpectedly                  |
| Memory            | `pm2 status`                              | near the 900 MB restart ceiling       |
| Restarts          | `pm2 status`                              | the count climbing means a crash loop |
| Mongo storage     | `db.stats()`                              | against the volume's size             |
| Errors            | `grep '"level":"error"' logs/api.out.log` | a rate you have not seen before       |
| Scheduler         | `grep 'scheduler tick failed'`            | ever                                  |
| Agent             | `grep 'agent run failed'`                 | a rate you have not seen before       |

A disk that fills is the most likely way this deployment dies, and the logs are
the most likely thing to fill it. That is why §11 is not optional.

---

## 13. Health, shutdown and the scheduler

`GET /api/health/live` — the process is up. Never touches Mongo.
`GET /api/health/ready` — every required dependency is usable; 503 if not.
`GET /api/health` — the same detail, for a person.

None reports configuration or a secret.

On `SIGTERM` the API ends open answer streams, stops accepting connections,
drains in-flight requests, stops the scheduler and closes Mongo, then exits 0.
Verified locally: a clean shutdown takes milliseconds, and `SHUTDOWN_TIMEOUT_MS`
(10s) is the deadline before it gives up. PM2's `kill_timeout` is set longer than
that on purpose — a supervisor that kills the process mid-shutdown makes the
graceful path decorative.

Ending the streams first matters: an SSE response is in flight for as long as
somebody is watching, so without it `server.close()` waited out the entire budget
and the process was killed — an ordinary restart recorded as a crash.

**The scheduler is restart-safe.** Jobs are database rows with a lease, not
timers in memory. A restart mid-job leaves the lease to expire and the job is
retried; a job that already ran is not run again, because the row records that it
did. Reminders are additionally keyed by occurrence, so a redelivery cannot
produce a second notification. Run **one** scheduler — that is one API process —
until there is distributed locking.

---

## 14. Rate limits

Process-local, in memory. They are real limits for this deployment because there
is one process; they are **not** distributed and would multiply by the instance
count if that ever changed. Making them shared means a Redis store, which is not
worth adding for a single-instance product.

They reset on restart, so a deploy gives everyone a fresh budget. For a
single-user product that is a non-event.

---

## 15. Troubleshooting

**502 from Nginx.** The API is not listening. `pm2 status`, then
`pm2 logs hadiya-api --lines 100`. If it is restarting in a loop the cause is
almost always configuration — run `check:production`.

**The API will not start.** It prints exactly which variables are wrong and
exits. `npm run check:production -w @hadiya/api` says the same thing without
starting anything.

**The assistant answers 503.** No model credential, or the provider rejected it.
`GET /api/v1/ai/status` reports the resolved provider and whether it is
available, and never the key.

**Answers arrive all at once instead of streaming.** A proxy is buffering. Check
the `location ~ ^/api/v1/ai/…` block is present and matched — Nginx takes the
first matching regex location, so a broader one added above it wins.

**Uploads fail at about 1 MB.** `client_max_body_size` in Nginx, not the API.

**Sign-in fails after a restore.** The restore may have landed in the wrong
database. Run `verify-restore.mjs` against the URI the API is actually using.

**Everything is slow.** Check the indexes exist — a restore that dropped them
leaves a system that runs and degrades. `npm run db:indexes -w @hadiya/api` is
safe to re-run.

---

## 16. What this deployment does not do

Stated plainly, because assuming otherwise is how outages happen.

- **No zero-downtime deploys.** One process; a restart is a brief 502.
- **No automatic database migration or rollback.** Application rollback is by
  git revision. Data is not versioned.
- **No horizontal scaling.** Rate limits and the run registry are in memory.
- **No distributed scheduler.** One instance only.
- **Backups are not off-site** unless you copy them somewhere. The script writes
  to local disk.
- **Docker is not provided.** See §1.
