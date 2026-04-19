# NemoChat — Single Server Deployment Guide (Ubuntu)

> **Target:** One Ubuntu 22.04 LTS server running both the Node.js app and MySQL DB.  
> **Stack:** Node.js + Express + Socket.IO + MySQL  
> **App port:** 3000 (exposed via Nginx reverse proxy on port 80/443)

---

## What's Inside the App

| File | Role |
|------|------|
| `server.js` | Express + Socket.IO server, all API routes |
| `db.js` | MySQL2 connection pool (reads from `.env`) |
| `schema.sql` | DB schema — `users` and `friends` tables |
| `.env` | DB credentials + port config |
| `public/` | Static frontend files (HTML, CSS, JS) |

---

## Step 1 — Update the System

```bash
sudo apt update && sudo apt upgrade -y
```

---

## Step 2 — Install Node.js (v20 LTS)

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v   # should print v20.x.x
npm -v
```

---

## Step 3 — Install MySQL Server

```bash
sudo apt install -y mysql-server
sudo systemctl start mysql
sudo systemctl enable mysql   # auto-start on reboot
```

### Secure MySQL

```bash
sudo mysql_secure_installation
# Follow prompts: set root password, remove anon users, disable remote root login
```

---

## Step 4 — Create the Database & User

```bash
sudo mysql -u root -p
```

Inside MySQL shell:

```sql
CREATE DATABASE nemochat;
CREATE USER 'nemo_user'@'localhost' IDENTIFIED BY 'passwd';
GRANT ALL PRIVILEGES ON nemochat.* TO 'nemo_user'@'localhost';
FLUSH PRIVILEGES;
EXIT;
```

> Change `passwd` to a strong password in production. Update `.env` to match.

---

## Step 5 — Import the Schema

```bash
mysql -u nemo_user -p nemochat < /path/to/schema.sql
# Enter the password when prompted
```

Verify tables:

```bash
mysql -u nemo_user -p -e "USE nemochat; SHOW TABLES;"
# Should show: friends, users
```

---

## Step 6 — Upload & Set Up the App

```bash
# Create an app directory
sudo mkdir -p /var/www/nemochat
sudo chown $USER:$USER /var/www/nemochat

# Copy your project files into it (from local machine):
# scp -r ./nemochat-SS/* user@your-server-ip:/var/www/nemochat/

cd /var/www/nemochat
npm install
```

---

## Step 7 — Configure the .env File

```bash
nano /var/www/nemochat/.env
```

Contents:

```env
DB_HOST=localhost
DB_USER=nemo_user
DB_PASS=passwd
DB_NAME=nemochat
PORT=3000
```

> `DB_HOST=localhost` is correct — app and DB are on the same machine.

---

## Step 8 — Install PM2 (Process Manager)

PM2 keeps the Node app running after you log out and restarts it on crashes.

```bash
sudo npm install -g pm2

# Start the app
pm2 start /var/www/nemochat/server.js --name nemochat

# Save the process list so it survives reboots
pm2 save
pm2 startup   # run the command it outputs (starts PM2 on boot)
```

Useful PM2 commands:

```bash
pm2 status          # check if app is running
pm2 logs nemochat   # view live logs
pm2 restart nemochat
pm2 stop nemochat
```

---

## Step 9 — Install Nginx (Reverse Proxy)

Instead of exposing port 3000 directly, Nginx sits in front on port 80.

```bash
sudo apt install -y nginx
sudo systemctl enable nginx
```

Create a site config:

```bash
sudo nano /etc/nginx/sites-available/nemochat
```

Paste this:

```nginx
server {
    listen 80;
    server_name your-domain.com;   # or your server IP

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;

        # Required for Socket.IO WebSocket upgrade
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Enable the site:

```bash
sudo ln -s /etc/nginx/sites-available/nemochat /etc/nginx/sites-enabled/
sudo nginx -t          # test config — should say "ok"
sudo systemctl reload nginx
```

---

## Step 10 — Open Firewall Ports

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'   # opens 80 and 443
sudo ufw enable
sudo ufw status
```

---

## Step 11 — (Optional but Recommended) Add HTTPS with Certbot

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
# Follow prompts — it auto-edits your Nginx config for SSL
```

Certbot auto-renews. Test renewal:

```bash
sudo certbot renew --dry-run
```

---

## Verification Checklist

```bash
# 1. MySQL running?
sudo systemctl status mysql

# 2. App running via PM2?
pm2 status

# 3. Nginx running?
sudo systemctl status nginx

# 4. App responding locally?
curl http://localhost:3000

# 5. App accessible from browser?
# Open: http://your-server-ip  (or https://your-domain.com)
```

---

## Full Software List

| Software | Purpose | Install via |
|----------|---------|------------|
| Node.js v20 | Run server.js | NodeSource repo |
| npm | Install dependencies | Comes with Node |
| MySQL 8 | Database | `apt` |
| PM2 | Keep app alive, auto-restart | `npm -g` |
| Nginx | Reverse proxy (port 80/443) | `apt` |
| Certbot | Free SSL (HTTPS) | `apt` |
| UFW | Firewall | pre-installed on Ubuntu |

---

## Architecture on the Server

```
Internet
   │
   ▼
Nginx (port 80/443)
   │  reverse proxy
   ▼
Node.js / server.js (port 3000)  ◄── PM2 manages this
   │
   ▼
MySQL (localhost:3306)
   └── database: nemochat
       ├── users
       └── friends
```

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `pm2 logs` shows DB connection error | Check `.env` credentials match MySQL user |
| Nginx returns 502 Bad Gateway | App not running — do `pm2 restart nemochat` |
| Socket.IO disconnects frequently | Ensure `proxy_set_header Upgrade` lines are in Nginx config |
| Port 3000 not accessible | That's expected — access via port 80 through Nginx |
| MySQL access denied | Re-run `GRANT ALL PRIVILEGES` step |
