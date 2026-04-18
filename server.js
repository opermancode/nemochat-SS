const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const bcrypt = require('bcryptjs');
const db = require('./db');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.json());
app.use(express.static('public'));

// --- Enhanced Registration ---
app.post('/api/register', async (req, res) => {
    const { username, email, password, confirmPassword, phone } = req.body;

    // 1. Basic Validation
    if (!username || !email || !password || !confirmPassword) {
        return res.status(400).json({ error: "Please fill all required fields" });
    }

    if (password !== confirmPassword) {
        return res.status(400).json({ error: "Passwords do not match" });
    }

    try {
        const hash = await bcrypt.hash(password, 10);
        
        // 2. Insert with optional phone field
        await db.execute(
            "INSERT INTO users (username, email, password, phone) VALUES (?, ?, ?, ?)", 
            [username, email, hash, phone || null]
        );
        
        res.json({ success: true });
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
            const field = err.message.includes('email') ? 'Email' : 'Username';
            return res.status(400).json({ error: `${field} is already registered` });
        }
        res.status(500).json({ error: "Registration failed on server" });
    }
});

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const [rows] = await db.execute("SELECT * FROM users WHERE username = ?", [username]);
        if (rows[0] && await bcrypt.compare(password, rows[0].password)) {
            res.json({ success: true, userId: rows[0].id, username: rows[0].username });
        } else {
            res.status(401).json({ error: "Invalid username or password" });
        }
    } catch (err) {
        res.status(500).json({ error: "Server error during login" });
    }
});

// --- Friends & Search Logic ---
app.get('/api/friends/:userId', async (req, res) => {
    try {
        const [rows] = await db.execute(
            `SELECT users.id, users.username FROM users 
             JOIN friends ON users.id = friends.user_id2 
             WHERE friends.user_id1 = ?`, 
            [req.params.userId]
        );
        res.json(rows);
    } catch (err) { res.status(500).json({ error: "Failed to load friends" }); }
});

app.get('/api/users/search', async (req, res) => {
    const { q, currentId } = req.query;
    try {
        const [rows] = await db.execute(
            "SELECT id, username FROM users WHERE username LIKE ? AND id != ? LIMIT 10", 
            [`%${q}%`, currentId]
        );
        res.json(rows);
    } catch (err) { res.status(500).json({ error: "Search failed" }); }
});

// --- Socket Relay ---
const onlineUsers = new Map();

io.on('connection', (socket) => {
    socket.on('register_online', (userId) => {
        if (userId) onlineUsers.set(userId.toString(), socket.id);
    });

    socket.on('send_request', (data) => {
        const target = onlineUsers.get(data.toId.toString());
        if (target) io.to(target).emit('new_request', data);
    });

    socket.on('accept_chat', async (data) => {
        try {
            await db.execute(
                "INSERT IGNORE INTO friends (user_id1, user_id2) VALUES (?, ?), (?, ?)",
                [data.myId, data.peerId, data.peerId, data.myId]
            );
            const target = onlineUsers.get(data.peerId.toString());
            if (target) io.to(target).emit('request_accepted', { fromId: data.myId, fromName: data.myName });
        } catch (err) { console.error("Acceptance error", err); }
    });

    socket.on('private_message', (data) => {
        const target = onlineUsers.get(data.toId.toString());
        if (target) io.to(target).emit('receive_message', data);
    });

    socket.on('disconnect', () => {
        for (const [uid, sid] of onlineUsers.entries()) {
            if (sid === socket.id) { onlineUsers.delete(uid); break; }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log(`NemoChat running on port ${PORT}`));