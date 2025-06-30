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
        this.telegram_chat_id = data.telegram_chat_id;
        this.created_at = data.created_at;
        this.is_active = data.is_active;
    }

    // Создать пользователя
    static create(userData) {
        return new Promise((resolve, reject) => {
            const { username, password, role, permissions, telegram, phone } = userData;
            
            const query = `
                INSERT INTO users (username, password, role, permissions, telegram, phone) 
                VALUES (?, ?, ?, ?, ?, ?)
            `;
            
            db.run(query, [username, password, role || 'worker', permissions || '{}', telegram, phone], function(err) {
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

    // Поиск пользователей
    static search(searchTerm) {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT * FROM users 
                WHERE username LIKE ? OR telegram LIKE ? OR phone LIKE ?
                ORDER BY username
            `;
            const searchPattern = `%${searchTerm}%`;
            
            db.all(query, [searchPattern, searchPattern, searchPattern], (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    const users = rows.map(row => new User(row));
                    resolve(users);
                }
            });
        });
    }

    // Обновить пользователя
    static update(id, userData) {
        return new Promise((resolve, reject) => {
            const { role, permissions, is_active, phone, telegram, username } = userData;
            
            let query = `UPDATE users SET `;
            let params = [];
            let updates = [];

            if (role !== undefined) {
                updates.push('role = ?');
                params.push(role);
            }
            if (permissions !== undefined) {
                updates.push('permissions = ?');
                params.push(permissions);
            }
            if (is_active !== undefined) {
                updates.push('is_active = ?');
                params.push(is_active);
            }
            if (phone !== undefined) {
                updates.push('phone = ?');
                params.push(phone);
            }
            if (telegram !== undefined) {
                updates.push('telegram = ?');
                params.push(telegram);
            }
            if (username !== undefined) {
                updates.push('username = ?');
                params.push(username);
            }

            if (updates.length === 0) {
                reject(new Error('No fields to update'));
                return;
            }

            query += updates.join(', ') + ' WHERE id = ?';
            params.push(id);
            
            db.run(query, params, function(err) {
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

    // Обновить пароль
    static updatePassword(id, newPassword) {
        return new Promise(async (resolve, reject) => {
            try {
                const hashedPassword = await bcrypt.hash(newPassword, 10);
                const query = 'UPDATE users SET password = ? WHERE id = ?';
                
                db.run(query, [hashedPassword, id], function(err) {
                    if (err) {
                        reject(err);
                    } else if (this.changes === 0) {
                        reject(new Error('User not found'));
                    } else {
                        resolve(true);
                    }
                });
            } catch (error) {
                reject(error);
            }
        });
    }

    // Деактивировать пользователя
    static deactivate(id) {
        return new Promise((resolve, reject) => {
            const query = 'UPDATE users SET is_active = 0 WHERE id = ?';
            db.run(query, [id], function(err) {
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

    // Активировать пользователя
    static activate(id) {
        return new Promise((resolve, reject) => {
            const query = 'UPDATE users SET is_active = 1 WHERE id = ?';
            db.run(query, [id], function(err) {
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

    // Удалить пользователя (мягкое удаление)
    static softDelete(id) {
        return new Promise((resolve, reject) => {
            const query = 'UPDATE users SET is_active = 0, username = ? WHERE id = ?';
            const deletedUsername = `deleted_user_${id}_${Date.now()}`;
            
            db.run(query, [deletedUsername, id], function(err) {
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

    // Удалить пользователя (жесткое удаление)
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
                db.run('UPDATE overkill_projects SET created_by = NULL WHERE created_by = ?', [id]);
                
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

    // Получить статистику пользователя
    static getStats(userId) {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT 
                    (SELECT COUNT(*) FROM task_assignments WHERE user_id = ?) as assigned_tasks,
                    (SELECT COUNT(*) FROM tasks t 
                     JOIN task_assignments ta ON t.id = ta.task_id 
                     WHERE ta.user_id = ? AND t.status = 'done') as completed_tasks,
                    (SELECT COUNT(*) FROM task_comments WHERE user_id = ?) as comments_count,
                    (SELECT COUNT(*) FROM tasks WHERE created_by = ?) as created_tasks
            `;
            
            db.get(query, [userId, userId, userId, userId], (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row);
                }
            });
        });
    }

    // Получить задачи пользователя
    async getUserTasks() {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT t.*, p.name as project_name 
                FROM tasks t
                LEFT JOIN projects p ON t.project_id = p.id
                JOIN task_assignments ta ON t.id = ta.task_id
                WHERE ta.user_id = ? AND t.status != 'archived'
                ORDER BY t.deadline ASC
            `;
            
            db.all(query, [this.id], (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    }

    // Проверить пароль
    async verifyPassword(password) {
        return await bcrypt.compare(password, this.password);
    }

    // Проверить права доступа
    hasPermission(permission) {
        try {
            const permissions = JSON.parse(this.permissions || '{}');
            return permissions[permission] === true || this.role === 'admin';
        } catch (error) {
            return this.role === 'admin';
        }
    }

    // Проверить роль
    hasRole(role) {
        if (Array.isArray(role)) {
            return role.includes(this.role);
        }
        return this.role === role;
    }

    // Получить полное имя роли
    getRoleName() {
        const roleNames = {
            admin: 'Администратор',
            manager: 'Менеджер',
            worker: 'Исполнитель'
        };
        return roleNames[this.role] || this.role;
    }

    // Проверить активность
    isActive() {
        return this.is_active === 1 || this.is_active === true;
    }

    // Получить контактную информацию
    getContactInfo() {
        const contacts = {};
        if (this.telegram) contacts.telegram = this.telegram;
        if (this.phone) contacts.phone = this.phone;
        if (this.telegram_chat_id) contacts.telegram_linked = true;
        return contacts;
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
            telegram_linked: !!this.telegram_chat_id,
            is_active: this.is_active,
            created_at: this.created_at,
            role_name: this.getRoleName()
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

    // Получить безопасные данные (без чувствительной информации)
    toSafe() {
        return {
            id: this.id,
            username: this.username,
            role: this.role,
            role_name: this.getRoleName(),
            is_active: this.is_active,
            telegram_linked: !!this.telegram_chat_id
        };
    }
}

module.exports = User;
