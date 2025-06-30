const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '../taskflow.db');
const db = new sqlite3.Database(dbPath);

// Создаем таблицы
db.serialize(() => {
    // Пользователи
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'worker',
        permissions TEXT DEFAULT '{}',
        telegram TEXT,
        phone TEXT,
        telegram_chat_id TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        is_active BOOLEAN DEFAULT 1
    )`);

    // Проекты
    db.run(`CREATE TABLE IF NOT EXISTS projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT,
        created_by INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (created_by) REFERENCES users (id)
    )`);

    // Проекты оверлиф
    db.run(`CREATE TABLE IF NOT EXISTS overkill_projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT,
        project_link TEXT,
        created_by INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (created_by) REFERENCES users (id)
    )`);

    // Задачи
    db.run(`CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        goal TEXT,
        description TEXT,
        project_link TEXT,
        overkill_project_id INTEGER,
        project_id INTEGER,
        status TEXT DEFAULT 'unassigned',
        priority TEXT DEFAULT 'medium',
        deadline DATETIME,
        created_by INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (project_id) REFERENCES projects (id),
        FOREIGN KEY (overkill_project_id) REFERENCES overkill_projects (id),
        FOREIGN KEY (created_by) REFERENCES users (id)
    )`);

    // Назначения задач
    db.run(`CREATE TABLE IF NOT EXISTS task_assignments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id INTEGER,
        user_id INTEGER,
        role TEXT DEFAULT 'assignee',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (task_id) REFERENCES tasks (id),
        FOREIGN KEY (user_id) REFERENCES users (id)
    )`);

    // Комментарии к задачам
    db.run(`CREATE TABLE IF NOT EXISTS task_comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id INTEGER,
        user_id INTEGER,
        comment TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (task_id) REFERENCES tasks (id),
        FOREIGN KEY (user_id) REFERENCES users (id)
    )`);

    // Добавляем недостающие колонки в существующие таблицы
    db.run(`ALTER TABLE users ADD COLUMN telegram TEXT`, (err) => {
        // Игнорируем ошибку если колонка уже существует
    });
    
    db.run(`ALTER TABLE users ADD COLUMN phone TEXT`, (err) => {
        // Игнорируем ошибку если колонка уже существует
    });

    db.run(`ALTER TABLE users ADD COLUMN telegram_chat_id TEXT`, (err) => {
        // Игнорируем ошибку если колонка уже существует
    });

    db.run(`ALTER TABLE tasks ADD COLUMN goal TEXT`, (err) => {
        // Игнорируем ошибку если колонка уже существует
    });

    db.run(`ALTER TABLE tasks ADD COLUMN project_link TEXT`, (err) => {
        // Игнорируем ошибку если колонка уже существует
    });

    db.run(`ALTER TABLE tasks ADD COLUMN overkill_project_id INTEGER`, (err) => {
        // Игнорируем ошибку если колонка уже существует
    });

    // Создаем админа по умолчанию
    const bcrypt = require('bcryptjs');
    const adminPassword = bcrypt.hashSync('admin123', 10);
    
    db.run(`INSERT OR IGNORE INTO users (username, password, role, permissions) 
            VALUES ('admin', ?, 'admin', '{"canManageUsers": true, "canManageProjects": true, "canManageTasks": true}')`, 
            [adminPassword]);

    console.log('✅ Database tables created/updated successfully');
});

module.exports = db;
