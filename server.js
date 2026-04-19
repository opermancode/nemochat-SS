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

        if (!username || !email || !password || !confirmPassword) {
            return res.status(400).json({ error: "Please fill all required fields" });
        }

        if (password !== confirmPassword) {
            return res.status(400).json({ error: "Passwords do not match" });
        }

        try {
            const hash = await bcrypt.hash(password, 10);
            
            await db.execute(
                "INSERT INTO users (username, email, password, phone) VALUES (?, ?, ?, ?)", 
                [username, email, hash, phone || null]
            );
            
            res.json({ success: true });
        } catch (err) {
            if (err.code === 'ER_DUP_ENTRY') {
                const isEmail = err.message.includes(email) || err.message.includes('email');
                return res.status(400).json({ error: isEmail ? "Email is already registered" : "Username is already taken" });
            }
            res.status(500).json({ error: "Registration failed on server" });
        }
    });

    // --- Login Logic ---
    app.post('/api/login', async (req, res) => {
        const { username, password } = req.body;
        try {
            const [rows] = await db.execute(
                `SELECT users.id, users.username, users.password, user_themes.theme_color
                 FROM users
                 LEFT JOIN user_themes ON user_themes.user_id = users.id
                 WHERE users.username = ?
                 LIMIT 1`,
                [username]
            );
            if (rows[0] && await bcrypt.compare(password, rows[0].password)) {
                res.json({
                    success: true,
                    userId: rows[0].id,
                    username: rows[0].username,
                    themeColor: rows[0].theme_color || null
                });
            } else {
                res.status(401).json({ error: "Invalid username or password" });
            }
        } catch (err) {
            res.status(500).json({ error: "Server error during login" });
        }
    });

    const themeRegex = /^#[0-9A-Fa-f]{6}$/;

    app.get('/api/users/:userId/theme', async (req, res) => {
        try {
            const [rows] = await db.execute(
                "SELECT theme_color FROM user_themes WHERE user_id = ? LIMIT 1",
                [req.params.userId]
            );
            res.json({ themeColor: rows[0]?.theme_color || null });
        } catch (err) {
            res.status(500).json({ error: "Failed to load theme" });
        }
    });

    app.post('/api/users/:userId/theme', async (req, res) => {
        const { themeColor } = req.body || {};
        if (!themeRegex.test(themeColor || '')) {
            return res.status(400).json({ error: "Invalid theme color" });
        }

        try {
            await db.execute(
                `INSERT INTO user_themes (user_id, theme_color)
                 VALUES (?, ?)
                 ON DUPLICATE KEY UPDATE theme_color = VALUES(theme_color)`,
                [req.params.userId, themeColor.toUpperCase()]
            );
            res.json({ success: true, themeColor: themeColor.toUpperCase() });
        } catch (err) {
            res.status(500).json({ error: "Failed to save theme" });
        }
    });

    // --- Socket Relay Logic ---
    const onlineUsers = new Map();

    // --- Friends List (Current Tunnels) ---
    app.get('/api/friends/:userId', async (req, res) => {
        try {
            const [rows] = await db.execute(
                `SELECT users.id, users.username FROM users 
                JOIN friends ON users.id = friends.user_id2 
                WHERE friends.user_id1 = ?`, 
                [req.params.userId]
            );
            const friends = rows.map((row) => ({
                ...row,
                isOnline: onlineUsers.has(String(row.id))
            }));
            res.json(friends);
        } catch (err) { res.status(500).json({ error: "Failed to load friends" }); }
    });

    // --- Global Search (Excluding existing friends) ---
    app.get('/api/users/search', async (req, res) => {
        const { q, currentId } = req.query;
        try {
            // SQL Filter: SELECT users NOT in the friends table for the current user
            const [rows] = await db.execute(
                `SELECT id, username FROM users 
                WHERE username LIKE ? 
                AND id != ? 
                AND id NOT IN (
                    SELECT user_id2 FROM friends WHERE user_id1 = ?
                )
                LIMIT 10`, 
                [`%${q}%`, currentId, currentId]
            );
            res.json(rows);
        } catch (err) { 
            console.error("Search Error:", err);
            res.status(500).json({ error: "Search failed" }); 
        }
    });

    io.on('connection', (socket) => {
        socket.on('register_online', (userId) => {
            if (userId) {
                const normalizedId = userId.toString();
                onlineUsers.set(normalizedId, socket.id);
                io.emit('presence_update', { userId: normalizedId, isOnline: true });
            }
        });

        socket.on('send_request', (data) => {
            const target = onlineUsers.get(data.toId.toString());
            if (target) io.to(target).emit('new_request', data);
        });

        socket.on('accept_chat', async (data) => {
            try {
                // INSERT IGNORE prevents primary key crashes
                await db.execute(
                    "INSERT IGNORE INTO friends (user_id1, user_id2) VALUES (?, ?), (?, ?)",
                    [data.myId, data.peerId, data.peerId, data.myId]
                );
                const target = onlineUsers.get(data.peerId.toString());
                if (target) {
                    io.to(target).emit('request_accepted', { fromId: data.myId, fromName: data.myName });
                }
            } catch (err) { console.error("Acceptance error", err); }
        });

        socket.on('private_message', (data) => {
            const target = onlineUsers.get(data.toId.toString());
            if (target) {
                io.to(target).emit('receive_message', data);
            }
        });

        socket.on('disconnect', () => {
            for (const [uid, sid] of onlineUsers.entries()) {
                if (sid === socket.id) {
                    onlineUsers.delete(uid);
                    io.emit('presence_update', { userId: uid, isOnline: false });
                    break;
                }
            }
        });
    });

    const PORT = process.env.PORT || 3000;
    server.listen(PORT, '0.0.0.0', () => console.log(`NemoChat running on port ${PORT}`));
