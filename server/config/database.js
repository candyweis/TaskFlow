const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, '../database/taskflow.db');
const dbDir = path.dirname(dbPath);

console.log('🔧 Looking for database at:', dbPath);

const dbExists = fs.existsSync(dbPath);
console.log('📊 Database exists:', dbExists);

if (!dbExists && !fs.existsSync(dbDir)) {
    console.log('📁 Creating database directory...');
    fs.mkdirSync(dbDir, { recursive: true });
}

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('❌ Error opening database:', err.message);
        process.exit(1);
    } else {
        console.log('✅ Connected to SQLite database');
        if (dbExists) {
            console.log('📊 Using existing database with your data');
        } else {
            console.log('📊 Created new database file');
        }
    }
});

db.serialize(() => {
    db.run('PRAGMA foreign_keys = ON');
    ensureTablesExist();
    runMigrations();
});

function ensureTablesExist() {
    console.log('🔧 Checking database structure...');
    
    const tables = [
        {
            name: 'users',
            sql: `CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                role TEXT DEFAULT 'worker' CHECK(role IN ('admin', 'manager', 'worker')),
                permissions TEXT DEFAULT '{}',
                telegram TEXT,
                phone TEXT,
                vk TEXT,
                telegram_chat_id TEXT,
                is_active BOOLEAN DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`
        },
        {
            name: 'projects',
            sql: `CREATE TABLE IF NOT EXISTS projects (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                description TEXT,
                created_by INTEGER,
                is_active BOOLEAN DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
            )`
        },
        {
            name: 'overleaf_projects',
            sql: `CREATE TABLE IF NOT EXISTS overleaf_projects (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                description TEXT,
                project_link TEXT,
                created_by INTEGER,
                is_active BOOLEAN DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
            )`
        },
        {
            name: 'tasks',
            sql: `CREATE TABLE IF NOT EXISTS tasks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                goal TEXT,
                description TEXT,
                project_link TEXT,
                overleaf_project_id INTEGER,
                project_id INTEGER,
                status TEXT DEFAULT 'unassigned' CHECK(status IN ('unassigned', 'in_progress', 'developed', 'review', 'deploy', 'done', 'archived')),
                priority TEXT DEFAULT 'medium' CHECK(priority IN ('low', 'medium', 'high')),
                complexity TEXT DEFAULT 'medium' CHECK(complexity IN ('easy', 'medium', 'hard', 'expert')),
                deadline DATETIME NOT NULL,
                created_by INTEGER,
                assignees TEXT DEFAULT '[]',
                role_assignments TEXT DEFAULT '{}',
                parent_task_id INTEGER,
                is_subtask BOOLEAN DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
                FOREIGN KEY (overleaf_project_id) REFERENCES overleaf_projects(id) ON DELETE SET NULL,
                FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
                FOREIGN KEY (parent_task_id) REFERENCES tasks(id) ON DELETE CASCADE
            )`
        },
        {
            name: 'task_comments',
            sql: `CREATE TABLE IF NOT EXISTS task_comments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                task_id INTEGER NOT NULL,
                user_id INTEGER NOT NULL,
                comment TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )`
        },
        {
            name: 'task_assignments',
            sql: `CREATE TABLE IF NOT EXISTS task_assignments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                task_id INTEGER NOT NULL,
                user_id INTEGER NOT NULL,
                role TEXT,
                assigned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                UNIQUE(task_id, user_id)
            )`
        },
        {
            name: 'task_time_logs',
            sql: `CREATE TABLE IF NOT EXISTS task_time_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                task_id INTEGER NOT NULL,
                user_id INTEGER NOT NULL,
                hours_spent REAL NOT NULL,
                comment TEXT,
                logged_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )`
        },
        {
            name: 'task_splits',
            sql: `CREATE TABLE IF NOT EXISTS task_splits (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                parent_task_id INTEGER NOT NULL,
                child_task_id INTEGER NOT NULL,
                split_by INTEGER NOT NULL,
                split_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (parent_task_id) REFERENCES tasks(id) ON DELETE CASCADE,
                FOREIGN KEY (child_task_id) REFERENCES tasks(id) ON DELETE CASCADE,
                FOREIGN KEY (split_by) REFERENCES users(id) ON DELETE SET NULL
            )`
        }
    ];

    let completedTables = 0;
    
    tables.forEach((table) => {
        db.run(table.sql, (err) => {
            if (err) {
                console.error(`❌ Error creating/checking table ${table.name}:`, err.message);
            } else {
                console.log(`✅ Table ${table.name} verified/created`);
            }
            
            completedTables++;
            if (completedTables === tables.length) {
                createIndexes();
                checkForMissingColumns();
            }
        });
    });
}

function runMigrations() {
    console.log('🔄 Running database migrations...');
    
    // Проверяем, нужно ли добавить новые колонки
    db.all("PRAGMA table_info(tasks)", (err, columns) => {
        if (err) {
            console.error('❌ Error checking task table structure:', err);
            return;
        }
        
        const columnNames = columns.map(col => col.name);
        
        // Добавляем сложность, если её нет
        if (!columnNames.includes('complexity')) {
            db.run("ALTER TABLE tasks ADD COLUMN complexity TEXT DEFAULT 'medium' CHECK(complexity IN ('easy', 'medium', 'hard', 'expert'))", (err) => {
                if (err) {
                    console.error('❌ Error adding complexity column:', err.message);
                } else {
                    console.log('✅ Added complexity column to tasks table');
                }
            });
        }
        
        // Добавляем parent_task_id, если его нет
        if (!columnNames.includes('parent_task_id')) {
            db.run("ALTER TABLE tasks ADD COLUMN parent_task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE", (err) => {
                if (err) {
                    console.error('❌ Error adding parent_task_id column:', err.message);
                } else {
                    console.log('✅ Added parent_task_id column to tasks table');
                }
            });
        }
        
        // Добавляем is_subtask, если его нет
        if (!columnNames.includes('is_subtask')) {
            db.run("ALTER TABLE tasks ADD COLUMN is_subtask BOOLEAN DEFAULT 0", (err) => {
                if (err) {
                    console.error('❌ Error adding is_subtask column:', err.message);
                } else {
                    console.log('✅ Added is_subtask column to tasks table');
                }
            });
        }
    });
}

function createIndexes() {
    console.log('🔧 Creating/checking indexes...');
    
    const indexes = [
        'CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)',
        'CREATE INDEX IF NOT EXISTS idx_tasks_deadline ON tasks(deadline)',
        'CREATE INDEX IF NOT EXISTS idx_tasks_created_by ON tasks(created_by)',
        'CREATE INDEX IF NOT EXISTS idx_tasks_project_id ON tasks(project_id)',
        'CREATE INDEX IF NOT EXISTS idx_tasks_overleaf_project_id ON tasks(overleaf_project_id)',
        'CREATE INDEX IF NOT EXISTS idx_tasks_complexity ON tasks(complexity)',
        'CREATE INDEX IF NOT EXISTS idx_tasks_parent_task_id ON tasks(parent_task_id)',
        'CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)',
        'CREATE INDEX IF NOT EXISTS idx_users_role ON users(role)',
        'CREATE INDEX IF NOT EXISTS idx_users_is_active ON users(is_active)',
        'CREATE INDEX IF NOT EXISTS idx_users_telegram_chat_id ON users(telegram_chat_id)',
        'CREATE INDEX IF NOT EXISTS idx_projects_created_by ON projects(created_by)',
        'CREATE INDEX IF NOT EXISTS idx_overleaf_projects_created_by ON overleaf_projects(created_by)',
        'CREATE INDEX IF NOT EXISTS idx_task_comments_task_id ON task_comments(task_id)',
        'CREATE INDEX IF NOT EXISTS idx_task_comments_user_id ON task_comments(user_id)',
        'CREATE INDEX IF NOT EXISTS idx_task_assignments_task_id ON task_assignments(task_id)',
        'CREATE INDEX IF NOT EXISTS idx_task_assignments_user_id ON task_assignments(user_id)',
        'CREATE INDEX IF NOT EXISTS idx_task_time_logs_task_id ON task_time_logs(task_id)',
        'CREATE INDEX IF NOT EXISTS idx_task_time_logs_user_id ON task_time_logs(user_id)',
        'CREATE INDEX IF NOT EXISTS idx_task_splits_parent_task_id ON task_splits(parent_task_id)'
    ];
    
    indexes.forEach((indexSql) => {
        db.run(indexSql, (err) => {
            if (err) {
                console.error('❌ Error creating index:', err.message);
            }
        });
    });
    
    console.log('✅ Database indexes verified/created');
}

function checkForMissingColumns() {
    console.log('🔧 Checking for missing columns...');
    
    function checkTableColumns(tableName, requiredColumns, callback) {
        db.all(`PRAGMA table_info(${tableName})`, (err, columns) => {
            if (err) {
                console.error(`❌ Error getting columns for ${tableName}:`, err.message);
                if (callback) callback();
                return;
            }
            
            const existingColumns = columns.map(col => col.name.toLowerCase());
            console.log(`📋 ${tableName} columns:`, existingColumns);
            
            let addedColumns = 0;
            const missingColumns = requiredColumns.filter(c => !existingColumns.includes(c.name.toLowerCase()));
            
            if (missingColumns.length === 0) {
                console.log(`✅ All columns exist in ${tableName}`);
                if (callback) callback();
                return;
            }
            
            missingColumns.forEach(column => {
                console.log(`➕ Adding missing column to ${tableName}: ${column.name}`);
                db.run(column.sql, (err) => {
                    if (err) {
                        console.error(`❌ Error adding column ${column.name} to ${tableName}:`, err.message);
                    } else {
                        console.log(`✅ Column ${column.name} added to ${tableName} successfully`);
                    }
                    addedColumns++;
                    if (addedColumns === missingColumns.length && callback) {
                        callback();
                    }
                });
            });
        });
    }
    
    checkTableColumns('users', [
        { name: 'vk', sql: 'ALTER TABLE users ADD COLUMN vk TEXT' },
        { name: 'telegram_chat_id', sql: 'ALTER TABLE users ADD COLUMN telegram_chat_id TEXT' },
        { name: 'phone', sql: 'ALTER TABLE users ADD COLUMN phone TEXT' }
    ], () => {
        checkTableColumns('tasks', [
            { name: 'goal', sql: 'ALTER TABLE tasks ADD COLUMN goal TEXT' },
            { name: 'overleaf_project_id', sql: 'ALTER TABLE tasks ADD COLUMN overleaf_project_id INTEGER REFERENCES overleaf_projects(id)' },
            { name: 'complexity', sql: "ALTER TABLE tasks ADD COLUMN complexity TEXT DEFAULT 'medium' CHECK(complexity IN ('easy', 'medium', 'hard', 'expert'))" },
            { name: 'parent_task_id', sql: 'ALTER TABLE tasks ADD COLUMN parent_task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE' },
            { name: 'is_subtask', sql: 'ALTER TABLE tasks ADD COLUMN is_subtask BOOLEAN DEFAULT 0' }
        ], () => {
            console.log('🎉 Database structure check completed!');
        });
    });
}

db.on('error', (err) => {
    console.error('❌ Database error:', err.message);
});

process.on('SIGINT', () => {
    console.log('\n🔄 Shutting down database connection...');
    db.close((err) => {
        if (err) {
            console.error('❌ Error closing database:', err.message);
        } else {
            console.log('✅ Database connection closed');
        }
        process.exit(0);
    });
});

process.on('SIGTERM', () => {
    console.log('\n🔄 Shutting down database connection...');
    db.close((err) => {
        if (err) {
            console.error('❌ Error closing database:', err.message);
        } else {
            console.log('✅ Database connection closed');
        }
        process.exit(0);
    });
});

module.exports = db;
