const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const bcrypt = require('bcryptjs');
const db = require('./db');
const path = require('path');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" } // Useful if you ever use a different domain for frontend
});

app.use(express.json());
app.use(express.static('public'));

// --- User Auth & Global Search (MariaDB) ---
app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;
    try {
        const hash = await bcrypt.hash(password, 10);
        await db.execute("INSERT INTO users (username, password) VALUES (?, ?)", [username, hash]);
        res.json({ success: true });
    } catch (err) { 
        res.status(400).json({ error: "Username already exists" }); 
    }
});

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const [rows] = await db.execute("SELECT * FROM users WHERE username = ?", [username]);
        if (rows[0] && await bcrypt.compare(password, rows[0].password)) {
            res.json({ success: true, userId: rows[0].id, username: rows[0].username });
        } else { 
            res.status(401).json({ error: "Invalid credentials" }); 
        }
    } catch (err) {
        res.status(500).json({ error: "Server error" });
    }
});

app.get('/api/users/search', async (req, res) => {
    const { q, currentId } = req.query;
    try {
        const [rows] = await db.execute(
            "SELECT id, username FROM users WHERE username LIKE ? AND id != ? LIMIT 10", 
            [`%${q}%`, currentId]
        );
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: "Search failed" });
    }
});

// --- Socket Relay (Ephemeral) ---
const onlineUsers = new Map(); // Key: userId, Value: socketId

io.on('connection', (socket) => {
    socket.on('register_online', (userId) => {
        if (userId) {
            onlineUsers.set(userId.toString(), socket.id);
            console.log(`User ${userId} is now online.`);
        }
    });

    socket.on('send_request', (data) => {
        const target = onlineUsers.get(data.toId.toString());
        if (target) {
            io.to(target).emit('new_request', data);
        }
    });

    socket.on('private_message', (data) => {
        const target = onlineUsers.get(data.toId.toString());
        if (target) {
            io.to(target).emit('receive_message', data);
        }
    });

    socket.on('disconnect', () => {
        // More efficient cleanup
        for (const [uid, sid] of onlineUsers.entries()) {
            if (sid === socket.id) {
                onlineUsers.delete(uid);
                break;
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`NemoChat Relay active on http://localhost:${PORT}`);
});