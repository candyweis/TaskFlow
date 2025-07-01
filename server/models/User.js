const db = require('../config/database');
const bcrypt = require('bcryptjs');

class User {
    constructor(data) {
        this.id = data.id;
        this.username = data.username;
        this.password = data.password;
        this.role = data.role;
        this.permissions = data.permissions;
        this.telegram = data.telegram;
        this.phone = data.phone;
        this.vk = data.vk;
        this.telegram_chat_id = data.telegram_chat_id;
        this.created_at = data.created_at;
        this.is_active = data.is_active;
    }

    // Создать пользователя
    static create(userData) {
        return new Promise((resolve, reject) => {
            const { username, password, role, permissions, telegram, phone, vk } = userData;
            
            const query = `
                INSERT INTO users (username, password, role, permissions, telegram, phone, vk) 
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `;
            
            db.run(query, [username, password, role || 'worker', permissions || '{}', telegram, phone, vk], function(err) {
                if (err) {
                    reject(err);
                } else {
                    resolve({ 
                        id: this.lastID, 
                        username, 
                        role: role || 'worker',
                        permissions: permissions || '{}'
                    });
                }
            });
        });
    }

    // Найти пользователя по ID
    static findById(id) {
        return new Promise((resolve, reject) => {
            const query = 'SELECT * FROM users WHERE id = ?';
            db.get(query, [id], (err, row) => {
                if (err) {
                    reject(err);
                } else if (row) {
                    resolve(new User(row));
                } else {
                    resolve(null);
                }
            });
        });
    }

    // Найти пользователя по username
    static findByUsername(username) {
        return new Promise((resolve, reject) => {
            const query = 'SELECT * FROM users WHERE username = ?';
            db.get(query, [username], (err, row) => {
                if (err) {
                    reject(err);
                } else if (row) {
                    resolve(new User(row));
                } else {
                    resolve(null);
                }
            });
        });
    }

    // Найти пользователя по Telegram Chat ID
    static findByTelegramChatId(chatId) {
        return new Promise((resolve, reject) => {
            const query = 'SELECT * FROM users WHERE telegram_chat_id = ?';
            db.get(query, [chatId], (err, row) => {
                if (err) {
                    reject(err);
                } else if (row) {
                    resolve(new User(row));
                } else {
                    resolve(null);
                }
            });
        });
    }

    // Обновить Telegram Chat ID
    static updateTelegramChatId(userId, chatId) {
        return new Promise((resolve, reject) => {
            const query = 'UPDATE users SET telegram_chat_id = ? WHERE id = ?';
            db.run(query, [chatId, userId], function(err) {
                if (err) {
                    reject(err);
                } else {
                    resolve(this.changes > 0);
                }
            });
        });
    }

    // Получить всех пользователей
    static findAll() {
        return new Promise((resolve, reject) => {
            const query = 'SELECT * FROM users ORDER BY created_at DESC';
            db.all(query, [], (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    const users = rows.map(row => new User(row));
                    resolve(users);
                }
            });
        });
    }

    // Получить активных пользователей
    static findActive() {
        return new Promise((resolve, reject) => {
            const query = 'SELECT * FROM users WHERE is_active = 1 ORDER BY username';
            db.all(query, [], (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    const users = rows.map(row => new User(row));
                    resolve(users);
                }
            });
        });
    }

    // Получить пользователей по разрешениям
    static findByPermission(permission) {
        return new Promise((resolve, reject) => {
            const query = 'SELECT * FROM users WHERE is_active = 1';
            db.all(query, [], (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    const users = rows.map(row => new User(row))
                        .filter(user => {
                            try {
                                const permissions = JSON.parse(user.permissions || '{}');
                                return permissions[permission] === true || user.role === 'admin';
                            } catch (error) {
                                return user.role === 'admin';
                            }
                        });
                    resolve(users);
                }
            });
        });
    }

    // Получить пользователей с правом техаря
    static findTechUsers() {
        return this.findByPermission('canDevelop');
    }

    // Получить пользователей с правом проверки
    static findReviewUsers() {
        return this.findByPermission('canReview');
    }

    // Получить пользователей с правом загрузки
    static findDeployUsers() {
        return this.findByPermission('canDeploy');
    }

    // Получить пользователей по роли
    static findByRole(role) {
        return new Promise((resolve, reject) => {
            const query = 'SELECT * FROM users WHERE role = ? AND is_active = 1 ORDER BY username';
            db.all(query, [role], (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    const users = rows.map(row => new User(row));
                    resolve(users);
                }
            });
        });
    }

    // Обновить логин и пароль
    static updateCredentials(userId, newUsername, newPassword) {
        return new Promise(async (resolve, reject) => {
            try {
                const user = await User.findById(userId);
                if (!user) {
                    reject(new Error('User not found'));
                    return;
                }

                let query = 'UPDATE users SET ';
                let params = [];
                let updates = [];

                if (newUsername && newUsername !== user.username) {
                    // Проверяем уникальность нового логина
                    const existingUser = await User.findByUsername(newUsername);
                    if (existingUser && existingUser.id !== userId) {
                        reject(new Error('Username already exists'));
                        return;
                    }
                    updates.push('username = ?');
                    params.push(newUsername);
                }

                if (newPassword) {
                    const hashedPassword = await bcrypt.hash(newPassword, 10);
                    updates.push('password = ?');
                    params.push(hashedPassword);
                }

                if (updates.length === 0) {
                    resolve({ message: 'No changes to update' });
                    return;
                }

                query += updates.join(', ') + ' WHERE id = ?';
                params.push(userId);

                db.run(query, params, function(err) {
                    if (err) {
                        reject(err);
                    } else {
                        resolve({ 
                            message: 'Credentials updated successfully',
                            usernameChanged: newUsername && newUsername !== user.username,
                            passwordChanged: !!newPassword,
                            newUsername: newUsername || user.username
                        });
                    }
                });
            } catch (error) {
                reject(error);
            }
        });
    }

    // ИСПРАВЛЕНО: Обновить пользователя - правильная обработка VK поля
    static update(id, userData) {
        return new Promise((resolve, reject) => {
            console.log('🔄 User.update called with:', { id, userData });
            
            const { username, role, permissions, is_active, phone, telegram, vk } = userData;
            
            // Проверяем, что хотя бы одно поле для обновления передано
            if (username === undefined && role === undefined && permissions === undefined && 
                is_active === undefined && phone === undefined && telegram === undefined && vk === undefined) {
                reject(new Error('No fields to update'));
                return;
            }
            
            // Формируем запрос динамически
            let query = 'UPDATE users SET ';
            let params = [];
            let updates = [];

            if (username !== undefined && username !== null) {
                updates.push('username = ?');
                params.push(username);
                console.log('📝 Will update username to:', username);
            }
            
            if (role !== undefined && role !== null) {
                updates.push('role = ?');
                params.push(role);
                console.log('📝 Will update role to:', role);
            }
            
            if (permissions !== undefined) {
                updates.push('permissions = ?');
                params.push(permissions);
                console.log('📝 Will update permissions to:', permissions);
            }
            
            if (is_active !== undefined) {
                updates.push('is_active = ?');
                params.push(is_active ? 1 : 0);
                console.log('📝 Will update is_active to:', is_active);
            }
            
            if (phone !== undefined) {
                updates.push('phone = ?');
                params.push(phone);
                console.log('📝 Will update phone to:', phone);
            }
            
            if (telegram !== undefined) {
                updates.push('telegram = ?');
                params.push(telegram);
                console.log('📝 Will update telegram to:', telegram);
            }
            
            // ИСПРАВЛЕНО: правильная обработка VK поля
            if (vk !== undefined) {
                updates.push('vk = ?');
                params.push(vk);
                console.log('📝 Will update vk to:', vk);
            }

            if (updates.length === 0) {
                reject(new Error('No valid fields to update'));
                return;
            }

            query += updates.join(', ') + ' WHERE id = ?';
            params.push(id);
            
            console.log('🔄 Final SQL query:', query);
            console.log('🔄 Final params:', params);
            
            db.run(query, params, function(err) {
                if (err) {
                    console.error('❌ Database error:', err);
                    reject(err);
                } else {
                    console.log('✅ Database updated, changes:', this.changes);
                    if (this.changes === 0) {
                        reject(new Error('User not found or no changes made'));
                    } else {
                        resolve(true);
                    }
                }
            });
        });
    }

    // Изменить статус пользователя
    static updateStatus(id, isActive) {
        return new Promise((resolve, reject) => {
            const query = 'UPDATE users SET is_active = ? WHERE id = ?';
            db.run(query, [isActive ? 1 : 0, id], function(err) {
                if (err) {
                    reject(err);
                } else if (this.changes === 0) {
                    reject(new Error('User not found'));
                } else {
                    resolve(true);
                }
            });
        });
    }

    // Удалить пользователя
    static delete(id) {
        return new Promise((resolve, reject) => {
            db.serialize(() => {
                db.run('BEGIN TRANSACTION');
                
                // Удаляем связанные данные
                db.run('DELETE FROM task_assignments WHERE user_id = ?', [id]);
                db.run('DELETE FROM task_comments WHERE user_id = ?', [id]);
                
                // Обновляем ссылки на пользователя в задачах
                db.run('UPDATE tasks SET created_by = NULL WHERE created_by = ?', [id]);
                db.run('UPDATE projects SET created_by = NULL WHERE created_by = ?', [id]);
                db.run('UPDATE overleaf_projects SET created_by = NULL WHERE created_by = ?', [id]);
                
                // Удаляем пользователя
                db.run('DELETE FROM users WHERE id = ?', [id], function(err) {
                    if (err) {
                        db.run('ROLLBACK');
                        reject(err);
                    } else if (this.changes === 0) {
                        db.run('ROLLBACK');
                        reject(new Error('User not found'));
                    } else {
                        db.run('COMMIT');
                        resolve(true);
                    }
                });
            });
        });
    }

    // Проверить пароль
    async verifyPassword(password) {
        return await bcrypt.compare(password, this.password);
    }

    // Получить статистику пользователя
    static getUserStats(userId) {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT 
                    COUNT(CASE WHEN JSON_EXTRACT(assignees, '$') LIKE '%${userId}%' THEN 1 END) as assigned_tasks,
                    COUNT(CASE WHEN JSON_EXTRACT(assignees, '$') LIKE '%${userId}%' AND status = 'done' THEN 1 END) as completed_tasks,
                    COUNT(CASE WHEN JSON_EXTRACT(assignees, '$') LIKE '%${userId}%' AND status = 'in_progress' THEN 1 END) as active_tasks,
                    COUNT(CASE WHEN JSON_EXTRACT(assignees, '$') LIKE '%${userId}%' AND deadline < datetime('now') AND status NOT IN ('done', 'archived') THEN 1 END) as overdue_tasks,
                    COUNT(CASE WHEN created_by = ${userId} THEN 1 END) as created_tasks
                FROM tasks 
                WHERE status != 'archived'
            `;
            
            db.get(query, [], (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row);
                }
            });
        });
    }

    // Получить задачи пользователя
    static getUserTasks(userId, options = {}) {
        return new Promise((resolve, reject) => {
            let query = `
                SELECT t.*, p.name as project_name, op.name as overleaf_project_name, u.username as created_by_name
                FROM tasks t
                LEFT JOIN projects p ON t.project_id = p.id
                LEFT JOIN overleaf_projects op ON t.overleaf_project_id = op.id
                LEFT JOIN users u ON t.created_by = u.id
                WHERE (JSON_EXTRACT(t.assignees, '$') LIKE '%${userId}%' OR t.created_by = ${userId})
            `;
            
            const params = [];
            
            if (options.status) {
                query += ' AND t.status = ?';
                params.push(options.status);
            }
            
            if (options.exclude_archived) {
                query += ' AND t.status != "archived"';
            }
            
            query += ' ORDER BY t.created_at DESC';
            
            if (options.limit) {
                query += ' LIMIT ?';
                params.push(options.limit);
            }
            
            db.all(query, params, (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    }

    // Получить публичные данные пользователя
    toPublic() {
        return {
            id: this.id,
            username: this.username,
            role: this.role,
            permissions: this.getPermissionsObject(),
            telegram: this.telegram,
            phone: this.phone,
            vk: this.vk,
            telegram_linked: !!this.telegram_chat_id,
            is_active: this.is_active,
            created_at: this.created_at
        };
    }

    // Получить объект прав доступа
    getPermissionsObject() {
        try {
            return JSON.parse(this.permissions || '{}');
        } catch (error) {
            return {};
        }
    }

    // Проверить право доступа
    hasPermission(permission) {
        if (this.role === 'admin') return true;
        
        try {
            const permissions = JSON.parse(this.permissions || '{}');
            return permissions[permission] === true;
        } catch (error) {
            return false;
        }
    }

    // Проверить роль
    hasRole(role) {
        return this.role === role;
    }

    // Проверить множественные роли
    hasAnyRole(roles) {
        return roles.includes(this.role);
    }
}

module.exports = User;
