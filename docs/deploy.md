# Deployment

Example deployment using nginx + systemd + Let's Encrypt on a Linux VPS.

## Architecture

```
Browser ──HTTPS──▶ nginx (:443)
                    ├── /api/*          ──proxy──▶ voicechat (:8080)
                    ├── /ws             ──proxy──▶ voicechat (:8080)  [WebSocket]
                    ├── /uploads/*      ──alias──▶ /opt/lefauxpain/data/uploads/
                    ├── /thumbs/*       ──alias──▶ /opt/lefauxpain/data/thumbs/
                    ├── /avatars/*      ──alias──▶ /opt/lefauxpain/data/avatars/
                    └── /*              ──files──▶ /opt/lefauxpain/static/  [SPA]
```

**Important**: Nginx serves the frontend static files directly from disk. The Go
binary also embeds the SPA via `go:embed`, but that is only used when running
without nginx (e.g. local dev or desktop mode). When deploying, you must update
**both** the binary and the static files on the server.

## Prerequisites

On your server:

- Ubuntu or Debian with systemd
- nginx installed (`sudo apt install nginx`)
- Certbot for Let's Encrypt (`sudo apt install certbot python3-certbot-nginx`)
- Go 1.24+ and Node.js 18+ on your build machine (or build locally and upload)

## Directory Setup

```bash
sudo mkdir -p /opt/lefauxpain/{bin,static,data}
```

## Deploy Procedure

### 1. Build the frontend

```bash
cd client
npm run build
```

This outputs to `client/dist/`.

### 2. Build the Go binary

The Go binary embeds `server/static/` at compile time. Copy the frontend build
there first, then compile:

```bash
# Copy frontend into embed directory
rm -rf server/static/assets/* server/static/index.html
cp -r client/dist/* server/static/

# Build
cd server
go build -o voicechat .
```

### 3. Upload to server

```bash
# Upload binary
scp server/voicechat youruser@YOUR_SERVER_IP:/tmp/voicechat-new

# Upload frontend static files
scp -r client/dist/* youruser@YOUR_SERVER_IP:/tmp/static-new/
```

### 4. Install on server

```bash
ssh youruser@YOUR_SERVER_IP

# Replace binary
sudo systemctl stop lefauxpain
sudo cp /tmp/voicechat-new /opt/lefauxpain/bin/voicechat
sudo chmod +x /opt/lefauxpain/bin/voicechat

# Replace frontend static files (served by nginx)
sudo rm -rf /opt/lefauxpain/static/assets/*
sudo cp -r /tmp/static-new/* /opt/lefauxpain/static/

# Restart
sudo systemctl start lefauxpain

# Verify
sudo systemctl is-active lefauxpain
curl -s http://localhost:8080/ | grep 'index-'
```

### 5. Verify in browser

Hard-refresh (`Ctrl+Shift+R`) to bypass the browser cache and confirm the new
JS bundle hash matches what `curl` reported.

## Frontend-Only Deploy

If only frontend code changed (no Go changes):

```bash
cd client && npm run build
scp -r dist/* youruser@YOUR_SERVER_IP:/tmp/static-new/
ssh youruser@YOUR_SERVER_IP 'sudo rm -rf /opt/lefauxpain/static/assets/* && sudo cp -r /tmp/static-new/* /opt/lefauxpain/static/'
```

No service restart needed — nginx picks up the new files immediately.

## Backend-Only Deploy

If only Go code changed (no frontend changes):

```bash
cd server && go build -o voicechat .
scp server/voicechat youruser@YOUR_SERVER_IP:/tmp/voicechat-new
ssh youruser@YOUR_SERVER_IP 'sudo systemctl stop lefauxpain && sudo cp /tmp/voicechat-new /opt/lefauxpain/bin/voicechat && sudo chmod +x /opt/lefauxpain/bin/voicechat && sudo systemctl start lefauxpain'
```

## Server Configuration Reference

### systemd (`/etc/systemd/system/lefauxpain.service`)

```ini
[Unit]
Description=Le Faux Pain Chat Server
After=network.target

[Service]
Type=simple
User=lefauxpain
Group=lefauxpain
WorkingDirectory=/opt/lefauxpain
ExecStart=/opt/lefauxpain/bin/voicechat --port 8080 --data-dir /opt/lefauxpain/data --public-ip YOUR_SERVER_IP
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Replace `YOUR_SERVER_IP` with your server's public IP. This is required for WebRTC voice chat to work through NAT.

### nginx (`/etc/nginx/sites-enabled/lefauxpain`)

```nginx
server {
    server_name your-domain.com;

    location /api/ {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /ws {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400s;
    }

    location /uploads/ {
        alias /opt/lefauxpain/data/uploads/;
        expires 30d;
        add_header Cache-Control "public, immutable";
    }

    location /thumbs/ {
        alias /opt/lefauxpain/data/thumbs/;
        expires 30d;
        add_header Cache-Control "public, immutable";
    }

    location /avatars/ {
        alias /opt/lefauxpain/data/avatars/;
        expires 30d;
        add_header Cache-Control "public, immutable";
    }

    location / {
        root /opt/lefauxpain/static;
        try_files $uri $uri/ /index.html;
    }

    listen 443 ssl;
    ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
}
```

Run `sudo certbot --nginx -d your-domain.com` to set up Let's Encrypt certificates.

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Browser shows old UI after deploy | Old JS cached in browser | Hard-refresh (`Ctrl+Shift+R`) |
| `curl localhost:8080` shows old JS hash | Deployed to wrong path | Frontend goes to `/opt/lefauxpain/static/`, not into the binary |
| Binary has right files but browser doesn't | Nginx serves from disk, not binary | Update `/opt/lefauxpain/static/` |
| Service won't start | Check logs | `sudo journalctl -u lefauxpain -n 50` |
| WebSocket won't connect | nginx config | Ensure `/ws` location has `proxy_http_version 1.1` and `Upgrade` headers |
