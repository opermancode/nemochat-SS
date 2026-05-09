# NemoChat Setup Guide

## Prerequisites

- Node.js >= 18
- MySQL / MariaDB
- Ollama (with qwen2.5 model)

## 1. Clone & Install

```bash
git clone <repo-url> nemochat
cd nemochat
npm install
```

## 2. Database Setup

```bash
# Create the database user
sudo mysql -e "CREATE USER IF NOT EXISTS 'nemo_user'@'localhost' IDENTIFIED BY 'passwd';"
sudo mysql -e "GRANT ALL PRIVILEGES ON nemochat.* TO 'nemo_user'@'localhost'; FLUSH PRIVILEGES;"

# Import schema
sudo mysql < schema.sql
```

## 3. Configure Environment

Copy or edit `.env`:

```
DB_HOST=localhost
DB_USER=nemo_user
DB_PASS=passwd
DB_NAME=nemochat
PORT=3000
```

## 4. Install Ollama Model

```bash
# Install Ollama if not already installed:
curl -fsSL https://ollama.com/install.sh | sh

# Pull the model used by the app:
ollama pull qwen2.5:1.5b

# Verify it's installed:
ollama list
```

> Note: The model name in `server.js:195` must match what you pull. Default is `qwen2.5:1.5b`. Edit the model name there if you use a different one.

## 5. Run

### Development
```bash
node server.js
```

### Production (with PM2)
```bash
npm install -g pm2
pm2 start server.js --name nemochat
pm2 save
pm2 startup
```

## 6. Access

Open `http://<server-ip>:3000` in a browser.

## 7. Using /qwen

After logging in and connecting to another user (friend), type:

```
/qwen <your question>
```

The AI response will stream in real-time to both users in the chat.
