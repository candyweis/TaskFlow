const db = require('../config/database');

class Project {
    constructor(data) {
        this.id = data.id;
        this.name = data.name;
        this.description = data.description;
        this.created_by = data.created_by;
        this.created_at = data.created_at;
        this.updated_at = data.updated_at;
        this.is_active = data.is_active;
        this.created_by_name = data.created_by_name;
    }

    // Создать проект
    static create(projectData) {
        return new Promise((resolve, reject) => {
            const { name, description, created_by } = projectData;
            
            const query = `
                INSERT INTO projects (name, description, created_by) 
                VALUES (?, ?, ?)
            `;
            
            db.run(query, [name, description, created_by], function(err) {
                if (err) {
                    reject(err);
                } else {
                    resolve({ id: this.lastID, name, description, created_by });
                }
            });
        });
    }

    // Найти проект по ID
    static findById(id) {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT p.*, u.username as created_by_name 
                FROM projects p
                LEFT JOIN users u ON p.created_by = u.id
                WHERE p.id = ?
            `;
            
            db.get(query, [id], (err, row) => {
                if (err) {
                    reject(err);
                } else if (row) {
                    resolve(new Project(row));
                } else {
                    resolve(null);
                }
            });
        });
    }

    // Найти проект по имени
    static findByName(name) {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT p.*, u.username as created_by_name 
                FROM projects p
                LEFT JOIN users u ON p.created_by = u.id
                WHERE p.name = ?
            `;
            
            db.get(query, [name], (err, row) => {
                if (err) {
                    reject(err);
                } else if (row) {
                    resolve(new Project(row));
                } else {
                    resolve(null);
                }
            });
        });
    }

    // Получить все проекты
    static findAll(options = {}) {
        return new Promise((resolve, reject) => {
            let query = `
                SELECT p.*, u.username as created_by_name 
                FROM projects p
                LEFT JOIN users u ON p.created_by = u.id
            `;
            
            const params = [];
            const conditions = [];
            
            if (options.active_only) {
                conditions.push('p.is_active = 1');
            }
            
            if (options.created_by) {
                conditions.push('p.created_by = ?');
                params.push(options.created_by);
            }
            
            if (conditions.length > 0) {
                query += ' WHERE ' + conditions.join(' AND ');
            }
            
            query += ' ORDER BY p.created_at DESC';
            
            if (options.limit) {
                query += ' LIMIT ?';
                params.push(options.limit);
            }
            
            db.all(query, params, (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    const projects = rows.map(row => new Project(row));
                    resolve(projects);
                }
            });
        });
    }

    // Получить активные проекты
    static findActive() {
        return this.findAll({ active_only: true });
    }

    // Поиск проектов
    static search(searchTerm, options = {}) {
        return new Promise((resolve, reject) => {
            let query = `
                SELECT p.*, u.username as created_by_name 
                FROM projects p
                LEFT JOIN users u ON p.created_by = u.id
                WHERE (p.name LIKE ? OR p.description LIKE ?)
            `;
            
            const params = [`%${searchTerm}%`, `%${searchTerm}%`];
            
            if (options.active_only) {
                query += ' AND p.is_active = 1';
            }
            
            query += ' ORDER BY p.created_at DESC';
            
            if (options.limit) {
                query += ' LIMIT ?';
                params.push(options.limit);
            }
            
            db.all(query, params, (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    const projects = rows.map(row => new Project(row));
                    resolve(projects);
                }
            });
        });
    }

    // Обновить проект
    static update(id, projectData) {
        return new Promise((resolve, reject) => {
            const { name, description, is_active } = projectData;
            
            let query = 'UPDATE projects SET updated_at = CURRENT_TIMESTAMP';
            let params = [];
            let updates = [];

            if (name !== undefined && name !== null) {
                updates.push('name = ?');
                params.push(name);
            }
            
            if (description !== undefined) {
                updates.push('description = ?');
                params.push(description);
            }
            
            if (is_active !== undefined) {
                updates.push('is_active = ?');
                params.push(is_active ? 1 : 0);
            }

            if (updates.length === 0) {
                reject(new Error('No fields to update'));
                return;
            }

            query += ', ' + updates.join(', ') + ' WHERE id = ?';
            params.push(id);
            
            db.run(query, params, function(err) {
                if (err) {
                    reject(err);
                } else if (this.changes === 0) {
                    reject(new Error('Project not found'));
                } else {
                    resolve(true);
                }
            });
        });
    }

    // Архивировать проект
    static archive(id) {
        return this.update(id, { is_active: false });
    }

    // Восстановить проект
    static restore(id) {
        return this.update(id, { is_active: true });
    }

    // Удалить проект
    static delete(id) {
        return new Promise((resolve, reject) => {
            db.serialize(() => {
                db.run('BEGIN TRANSACTION');
                
                // Удаляем связанные задачи
                db.run('DELETE FROM task_assignments WHERE task_id IN (SELECT id FROM tasks WHERE project_id = ?)', [id]);
                db.run('DELETE FROM task_comments WHERE task_id IN (SELECT id FROM tasks WHERE project_id = ?)', [id]);
                db.run('DELETE FROM tasks WHERE project_id = ?', [id]);
                
                // Удаляем проект
                db.run('DELETE FROM projects WHERE id = ?', [id], function(err) {
                    if (err) {
                        db.run('ROLLBACK');
                        reject(err);
                    } else if (this.changes === 0) {
                        db.run('ROLLBACK');
                        reject(new Error('Project not found'));
                    } else {
                        db.run('COMMIT');
                        resolve(true);
                    }
                });
            });
        });
    }

    // Получить статистику проекта
    static getProjectStats(projectId) {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT 
                    COUNT(*) as total_tasks,
                    SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as completed_tasks,
                    SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as in_progress_tasks,
                    SUM(CASE WHEN status = 'developed' THEN 1 ELSE 0 END) as developed_tasks,
                    SUM(CASE WHEN status = 'review' THEN 1 ELSE 0 END) as review_tasks,
                    SUM(CASE WHEN status = 'deploy' THEN 1 ELSE 0 END) as deploy_tasks,
                    SUM(CASE WHEN status = 'unassigned' THEN 1 ELSE 0 END) as unassigned_tasks,
                    SUM(CASE WHEN deadline < datetime('now') AND status != 'done' AND status != 'archived' THEN 1 ELSE 0 END) as overdue_tasks,
                    SUM(CASE WHEN status = 'archived' THEN 1 ELSE 0 END) as archived_tasks,
                    AVG(CASE WHEN status = 'done' THEN 
                        (julianday(updated_at) - julianday(created_at)) 
                        ELSE NULL END) as avg_completion_days
                FROM tasks 
                WHERE project_id = ?
            `;
            
            db.get(query, [projectId], (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row);
                }
            });
        });
    }

    // Получить задачи проекта
    static getProjectTasks(projectId, options = {}) {
        return new Promise((resolve, reject) => {
            let query = `
                SELECT t.*, u.username as created_by_name,
                       op.name as overleaf_project_name,
                       op.project_link as overleaf_project_link
                FROM tasks t
                LEFT JOIN users u ON t.created_by = u.id
                LEFT JOIN overleaf_projects op ON t.overleaf_project_id = op.id
                WHERE t.project_id = ?
            `;
            
            const params = [projectId];
            
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

    // Получить участников проекта
    static getProjectMembers(projectId) {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT DISTINCT u.id, u.username, u.role, u.permissions, u.telegram, u.phone, u.is_active
                FROM users u
                JOIN tasks t ON JSON_EXTRACT(t.assignees, '$') LIKE '%' || u.id || '%'
                WHERE t.project_id = ? AND u.is_active = 1
                ORDER BY u.username
            `;
            
            db.all(query, [projectId], (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    }

    // Получить проекты пользователя
    static getUserProjects(userId, options = {}) {
        return new Promise((resolve, reject) => {
            let query = `
                SELECT DISTINCT p.*, u.username as created_by_name
                FROM projects p
                LEFT JOIN users u ON p.created_by = u.id
                LEFT JOIN tasks t ON t.project_id = p.id
                WHERE (p.created_by = ? OR JSON_EXTRACT(t.assignees, '$') LIKE '%' || ? || '%')
            `;
            
            const params = [userId, userId];
            
            if (options.active_only) {
                query += ' AND p.is_active = 1';
            }
            
            query += ' ORDER BY p.created_at DESC';
            
            db.all(query, params, (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    const projects = rows.map(row => new Project(row));
                    resolve(projects);
                }
            });
        });
    }

    // Проверить доступ к проекту
    static checkAccess(projectId, userId) {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT COUNT(*) as has_access
                FROM projects p
                LEFT JOIN tasks t ON t.project_id = p.id
                WHERE p.id = ? AND (
                    p.created_by = ? OR 
                    JSON_EXTRACT(t.assignees, '$') LIKE '%' || ? || '%'
                )
            `;
            
            db.get(query, [projectId, userId, userId], (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row.has_access > 0);
                }
            });
        });
    }

    // Получить популярные проекты (по количеству задач)
    static getPopularProjects(limit = 10) {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT p.*, u.username as created_by_name, COUNT(t.id) as task_count
                FROM projects p
                LEFT JOIN users u ON p.created_by = u.id
                LEFT JOIN tasks t ON t.project_id = p.id AND t.status != 'archived'
                WHERE p.is_active = 1
                GROUP BY p.id
                ORDER BY task_count DESC, p.created_at DESC
                LIMIT ?
            `;
            
            db.all(query, [limit], (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    const projects = rows.map(row => new Project(row));
                    resolve(projects);
                }
            });
        });
    }

    // Получить публичные данные проекта
    toPublic() {
        return {
            id: this.id,
            name: this.name,
            description: this.description,
            created_by: this.created_by,
            created_by_name: this.created_by_name,
            created_at: this.created_at,
            updated_at: this.updated_at,
            is_active: this.is_active
        };
    }

    // Получить расширенные данные проекта
    toExtended() {
        return {
            ...this.toPublic(),
            // Дополнительные поля будут добавлены при получении статистики
        };
    }
}

module.exports = Project;
