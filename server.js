const express = require("express");
const mysql = require("mysql2");
const cors = require("cors");
const { OAuth2Client } = require("google-auth-library");
require("dotenv").config();

const app = express();
const client = new OAuth2Client(
  "633033039034-louql75ipqo2dcquml83e85rds82gt26.apps.googleusercontent.com"
);

// Middleware
app.use(cors());
app.use(express.json());

// --- PERBAIKAN DI SINI: MENGGUNAKAN CREATEPOOL AGAR KONEKSI TIDAK GAMPANG PUTUS ---
const db = mysql.createPool({
  host: process.env.DB_HOST || "mysql-30504d1e-ac9613522-b60c.i.aivencloud.com",
  user: process.env.DB_USER || "avnadmin",
  password: process.env.DB_PASSWORD || "AVNS_uxW6XiQMivQG9Dd2z1_",
  database: process.env.DB_NAME || "defaultdb",
  port: process.env.DB_PORT || 16705,
  ssl: {
    rejectUnauthorized: false,
  },
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

// Tes Koneksi Pool
db.getConnection((err, connection) => {
  if (err) {
    console.error("Gagal terhubung ke Database Online:", err.message);
  } else {
    console.log("Database Terhubung ke Aiven Cloud (Sistem Pool)!");
    connection.release(); // Sangat penting untuk melepas koneksi kembali ke pool
  }
});

// --- AUTH (REGISTER & LOGIN) ---
app.post("/api/register", (req, res) => {
  const { name, email, password } = req.body;
  const sql =
    "INSERT INTO users (name, email, password, xp) VALUES (?, ?, ?, 0)";
  db.query(sql, [name, email, password], (err, result) => {
    if (err) {
      console.error("Error Register:", err);
      return res
        .status(500)
        .json({ error: "Email sudah terdaftar atau database error" });
    }
    res.json({ success: true });
  });
});

app.post("/api/login", (req, res) => {
  const { email, password } = req.body;
  db.query(
    "SELECT id, name, email, xp FROM users WHERE email = ? AND password = ?",
    [email, password],
    (err, results) => {
      if (err) return res.status(500).json(err);
      if (results && results.length > 0)
        res.json({ success: true, user: results[0] });
      else res.status(401).json({ error: "Email atau Password salah!" });
    }
  );
});

// --- TASKS ---
app.post("/api/tasks", (req, res) => {
  const { userId, title, description, priority } = req.body;
  db.query(
    "INSERT INTO tasks (user_id, title, description, priority, status) VALUES (?, ?, ?, ?, 'Pending')",
    [userId, title, description, priority],
    (err) => {
      if (err) return res.status(500).json(err);
      res.json({ success: true });
    }
  );
});

app.delete("/api/tasks/:id", (req, res) => {
  db.query("DELETE FROM tasks WHERE id = ?", [req.params.id], (err) => {
    if (err) return res.status(500).json(err);
    res.json({ success: true });
  });
});

app.put("/api/tasks/:id/complete", (req, res) => {
  const { userId } = req.body;
  db.query(
    "UPDATE tasks SET status = 'Completed' WHERE id = ?",
    [req.params.id],
    (err) => {
      if (err) return res.status(500).json(err);
      db.query(
        "UPDATE users SET xp = xp + 10 WHERE id = ?",
        [userId],
        (err) => {
          if (err) return res.status(500).json(err);
          res.json({ success: true });
        }
      );
    }
  );
});

app.get("/api/tasks-priority/:userId/:skorMood", (req, res) => {
  const { userId, skorMood } = req.params;
  let order = skorMood >= 4 ? "DESC" : "ASC";
  db.query(
    `SELECT * FROM tasks WHERE user_id = ? AND status != 'Completed' ORDER BY priority ${order}`,
    [userId],
    (err, tasks) => {
      if (err) return res.status(500).json(err);
      res.json({ tasks: tasks || [] });
    }
  );
});

// --- MOOD & STATS ---
app.post("/api/mood", (req, res) => {
  const { userId, skorMood, catatan } = req.body;
  db.query(
    "INSERT INTO mood_logs (user_id, mood_score, notes) VALUES (?, ?, ?)",
    [userId, skorMood, catatan],
    (err) => {
      if (err) return res.status(500).json(err);
      res.json({ success: true });
    }
  );
});

app.get("/api/mood-stats/:userId", (req, res) => {
  db.query(
    "SELECT mood_score, notes, logged_at FROM mood_logs WHERE user_id = ? ORDER BY logged_at DESC LIMIT 7",
    [req.params.userId],
    (err, results) => {
      if (err) return res.status(500).json(err);
      if (!results || results.length === 0)
        return res.json({
          rataRata: 0,
          moodSeringMuncul: "Belum ada data",
          riwayat: [],
        });

      const total = results.reduce((a, b) => a + b.mood_score, 0);
      const avg = (total / results.length).toFixed(1);

      let label = "Netral 😐";
      if (avg >= 4.5) label = "Sangat Senang 🤩";
      else if (avg >= 3.5) label = "Senang 😊";
      else if (avg >= 2.5) label = "Netral 😐";
      else label = "Sedih/Lelah 😟";

      res.json({ rataRata: avg, moodSeringMuncul: label, riwayat: results });
    }
  );
});

app.get("/api/user-status/:userId", (req, res) => {
  db.query(
    "SELECT mood_score FROM mood_logs WHERE user_id = ? ORDER BY logged_at DESC LIMIT 3",
    [req.params.userId],
    (err, results) => {
      if (err) return res.status(500).json(err);
      const avg =
        results.length > 0
          ? results.reduce((a, b) => a + b.mood_score, 0) / results.length
          : 3;
      if (avg >= 4)
        res.json({
          pesan: "Energi kamu sedang di puncak! 🔥",
          saran: "Waktunya sikat tugas-tugas sulit sekarang.",
        });
      else if (avg >= 3)
        res.json({
          pesan: "Kondisimu cukup stabil hari ini. ⚖️",
          saran: "Tetap fokus dan selesaikan tugas satu per satu.",
        });
      else
        res.json({
          pesan: "Sepertinya kamu butuh jeda sejenak. ☕",
          saran: "Mulai dari tugas yang paling ringan saja ya.",
        });
    }
  );
});

app.get("/api/user/:id", (req, res) => {
  db.query(
    "SELECT id, name, xp FROM users WHERE id = ?",
    [req.params.id],
    (err, results) => {
      if (err) return res.status(500).json(err);
      res.json(results[0] || { name: "Guest", xp: 0 });
    }
  );
});

app.get("/api/leaderboard", (req, res) => {
  db.query(
    "SELECT name, xp FROM users ORDER BY xp DESC LIMIT 5",
    (err, results) => {
      if (err) return res.status(500).json(err);
      res.json(results);
    }
  );
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
