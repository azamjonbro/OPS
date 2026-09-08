# Deploying Hadiya 2.0

How this application is meant to run in production, and how to operate it once
it is. Written for one person looking after one shop's deployment, because that
is what Hadiya is: a single business account, a single API process, a single
scheduler.

Nothing here contains a real credential, and none of the scripts prints one.

---

## 1. Architecture

The web client and the API live on different hosts, and that split decides most
of what follows.

```
   Browser
      │
      ├──────────────► Vercel                    the Vue app (static)
      │                 ops-web-lm3a.vercel.app
      │
      └──────────────► Cloudflare ──► home server
                        ops.sds-max.uz              Nginx :443
                                                      │
                                                    Hadiya API :4000  (PM2, one process)
                                                      │
                                                    MongoDB (replica set)

The API also reaches, outbound only:
  Billz · Notion · a user's MCP servers · OpenAI · STT · images
```

**Every request from the app is cross-origin.** The browser loads the page from
Vercel and calls `ops.sds-max.uz`, so each API call carries an `Authorization`
header, which is not CORS-safelisted, which means the browser sends a preflight
`OPTIONS` first. Two settings have to agree or nothing works:

| Where              | Variable            | Value                                                          |
| ------------------ | ------------------- | -------------------------------------------------------------- |
| Vercel             | `VITE_API_BASE_URL` | `https://ops.sds-max.uz/api`                                   |
| Home server `.env` | `CORS_ORIGINS`      | the app's exact origin, e.g. `https://ops-web-lm3a.vercel.app` |

A mismatch fails in a way that looks like the API being down. The smoke test
checks it directly — see §8.

Authentication is a bearer token in `localStorage`, not a cookie, so it crosses
origins without any cookie or `SameSite` consideration. There is nothing to
configure for it, and no CSRF surface either.

**Cloudflare is in front of the home server**, which is the right choice here:
the home connection's address is never exposed, and only Cloudflare's ranges
need to reach the router. It has three consequences, all handled:

- The visitor's real address arrives in `CF-Connecting-IP`, and Nginx must
  recover it — otherwise every request looks like Cloudflare and the API's
  rate limits become one shared bucket. `deploy/nginx/cloudflare-real-ip.conf`
  does this, and it is only safe because trust is restricted to Cloudflare's own
  ranges.
- The certificate on the home server is an _origin_ certificate the browser
  never sees. Use a **Cloudflare Origin Certificate**: fifteen years, no
  renewal, and so no certbot cron quietly failing and taking the site down.
- Streaming passes through. Cloudflare does not buffer `text/event-stream`, and
  the API's 20-second heartbeat keeps the connection under Cloudflare's
  inactivity timeout.

**One API process, deliberately.** The rate limiters and the agent run registry
live in this process's memory. A second worker would halve every limit's effect
and lose half the stream reconnections. `instances: 1` and `exec_mode: 'fork'`
in `ecosystem.config.cjs` are load-bearing.

**Why not Docker.** The Docker daemon was unavailable in the environment this
was prepared in, so an image could not be built or started even once. Shipping
an unverified Dockerfile as the recommended path would be worse than shipping
none. PM2 is what is configured and tested.

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
sudo mkdir -p /srv/hadiya /var/lib/hadiya/storage
sudo chown -R "$USER" /srv/hadiya /var/lib/hadiya

git clone <repository> /srv/hadiya
cd /srv/hadiya
cp .env.example .env && $EDITOR .env      # see §3
chmod 600 .env

npm ci
npm run build

npm run db:indexes -w @hadiya/api          # see §6
npm run create-owner -w @hadiya/api -- --username owner --password '…' --name 'Your Name'

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

## 7. Nginx, Cloudflare and the certificate

`deploy/nginx/ops.sds-max.uz.conf` serves the **API only** — no static files, no
SPA fallback, because the app is on Vercel.

```bash
sudo mkdir -p /etc/nginx/snippets
sudo cp deploy/nginx/cloudflare-real-ip.conf /etc/nginx/snippets/
sudo cp deploy/nginx/ops.sds-max.uz.conf /etc/nginx/sites-available/hadiya
sudo ln -s /etc/nginx/sites-available/hadiya /etc/nginx/sites-enabled/hadiya
sudo nginx -t && sudo systemctl reload nginx
```

### The certificate

Use a **Cloudflare Origin Certificate** rather than Let's Encrypt. Cloudflare
terminates TLS for the browser; this certificate only has to satisfy Cloudflare,
it is issued for fifteen years, and it removes the most common way a home server
goes dark — a renewal that quietly stopped.

1. Cloudflare dashboard → **SSL/TLS → Origin Server → Create Certificate**.
2. Save the certificate and key on the server:

   ```bash
   sudo mkdir -p /etc/ssl/cloudflare && sudo chmod 700 /etc/ssl/cloudflare
   sudo nano /etc/ssl/cloudflare/ops.sds-max.uz.pem   # the certificate
   sudo nano /etc/ssl/cloudflare/ops.sds-max.uz.key   # the private key
   sudo chmod 600 /etc/ssl/cloudflare/*
   ```

3. Cloudflare → **SSL/TLS → Overview → Full (strict)**. Anything less lets
   Cloudflare reach the origin over plain HTTP or without checking the
   certificate, which is not what you want on a home connection.

> **Set Full (strict) before enabling this config, or the site will loop.**
>
> In **Flexible** mode Cloudflare fetches from the origin over plain HTTP on
> port 80. The port-80 block here redirects everything to HTTPS — so Cloudflare
> returns that redirect to the browser, the browser asks Cloudflare again,
> Cloudflare fetches port 80 again, and the browser gives up with
> `ERR_TOO_MANY_REDIRECTS`.
>
> A stock Ubuntu nginx only listens on port 80, so a server that has never had
> a certificate installed is almost certainly on Flexible today. Install the
> origin certificate, switch the mode, _then_ enable the site.

Let's Encrypt still works if you prefer it — point `ssl_certificate` at
`/etc/letsencrypt/live/…` and keep the ACME block in the HTTP server. It needs
port 80 reachable through Cloudflare for renewal.

### Cloudflare settings that matter

| Setting                 | Value            | Why                                             |
| ----------------------- | ---------------- | ----------------------------------------------- |
| SSL/TLS mode            | Full (strict)    | the origin is verified, not just encrypted      |
| Cache rule for `/api/*` | Bypass cache     | an API response must never be served from cache |
| Proxy status            | Proxied (orange) | this is what hides the home address             |
| WebSockets              | On               | harmless, and covers future use                 |

Streaming needs nothing special at the edge: Cloudflare passes
`text/event-stream` through, and the API's 20-second heartbeat keeps the
connection inside Cloudflare's inactivity timeout.

### The router and the firewall

Forward TCP 80 and 443 from the router to this machine. Because Cloudflare
proxies everything, only its ranges need to reach you — worth enforcing so the
origin cannot be found and hit directly:

```bash
for range in $(curl -s https://www.cloudflare.com/ips-v4); do
  sudo ufw allow from "$range" to any port 443 proto tcp
done
sudo ufw deny 443/tcp
```

Refresh the trusted ranges a few times a year:

```bash
sudo deploy/scripts/update-cloudflare-ips.sh
sudo nginx -t && sudo systemctl reload nginx
```

---

## 7b. The web client on Vercel

`apps/web/vercel.json` carries the build, the SPA rewrite and the cache headers.
In the Vercel project:

- **Root directory**: `apps/web`
- **Environment variables** (Production):

  | Variable             | Value                        |
  | -------------------- | ---------------------------- |
  | `VITE_API_BASE_URL`  | `https://ops.sds-max.uz/api` |
  | `VITE_APP_NAME`      | `Hadiya`                     |
  | `VITE_AUTH_ENFORCED` | `true`                       |

Only `VITE_`-prefixed variables reach the browser, and none of them is a secret.
**Never put a server-side key in the Vercel project** — `OPENAI_API_KEY`,
`MONGO_URI`, the JWT secrets and `CREDENTIALS_ENCRYPTION_KEY` belong on the home
server and nowhere else.

After the first deploy, add the Vercel URL to `CORS_ORIGINS` on the home server
and restart the API. Every preview deployment gets its own URL, so preview
builds will not reach the API unless you add those origins too — usually you do
not want to.

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
SMOKE_ORIGIN=https://ops-web-lm3a.vercel.app \
SMOKE_USER=owner SMOKE_PASSWORD='…' \
deploy/scripts/smoke-test.sh https://ops.sds-max.uz
```

`SMOKE_ORIGIN` is what checks the cross-origin setup: it sends the preflight the
browser will send, confirms the app's origin is allowed, and confirms an
unconfigured one is not. That is the failure most likely to follow a redeploy of
the front end, and the one that looks least like what it is.

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

**The browser console says CORS — but check the API is answering first.**

A browser reports _any_ failed cross-origin request as a CORS error, because a
response without `Access-Control-Allow-Origin` is all it can see. A 404 from
Nginx, a 502 while the API is down, and a genuinely missing origin all look
identical from the console. So diagnose from outside the browser before
touching `CORS_ORIGINS`:

```bash
curl -i https://ops.sds-max.uz/api/health/live
```

- **`Welcome to nginx!` or a 404 in an HTML page** — Nginx never reached the
  API. The site config is not enabled, or the default site is winning. See §7.
- **502** — Nginx is proxying, but nothing is listening on :4000. `pm2 status`.
- **200 with JSON** — the API is fine and it really is CORS; carry on below.

**A real CORS failure: the origin is not allowed.** The app's origin is
not in `CORS_ORIGINS` on the home server, or the API was not restarted after it
was added. A new Vercel domain — a custom domain, or a preview deployment — is a
new origin. Confirm with:

```bash
SMOKE_ORIGIN=https://ops-web-lm3a.vercel.app deploy/scripts/smoke-test.sh https://ops.sds-max.uz
```

**Every visitor shares one rate limit, and the logs all show one address.**
Nginx is not recovering the real address from Cloudflare. Check that
`/etc/nginx/snippets/cloudflare-real-ip.conf` exists and is included, and that
`TRUST_PROXY=true` — both halves are needed.

**Cloudflare error 521 or 522.** Nothing is listening on the origin, or the
router is not forwarding, or the firewall is dropping Cloudflare. `pm2 status`
first, then `sudo nginx -t && sudo systemctl status nginx`.

**Cloudflare error 526.** The origin certificate is not valid for Cloudflare's
"Full (strict)" mode — usually it expired or the wrong file was pasted in.

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
- **The front end and the API deploy separately.** Nothing coordinates them, so
  a release that changes the API contract can briefly meet an older bundle
  cached in somebody's browser. `index.html` is served `no-cache`, which keeps
  that window to one reload.
- **A home server is a home server.** Power, the domestic connection and the
  router are all single points of failure that no configuration here can
  address. Cloudflare hides the address; it does not keep the machine up.
