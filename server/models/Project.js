const db = require('../config/database');

class Project {
    constructor(data) {
        this.id = data.id;
        this.name = data.name;
        this.description = data.description;
        this.created_by = data.created_by;
        this.created_at = data.created_at;
        this.created_by_name = data.created_by_name;
        this.total_tasks = data.total_tasks || 0;
        this.completed_tasks = data.completed_tasks || 0;
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
                    resolve({ 
                        id: this.lastID, 
                        name, 
                        description, 
                        created_by 
                    });
                }
            });
        });
    }

    // Найти проект по ID
    static findById(id) {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT p.*, u.username as created_by_name,
                       COUNT(t.id) as total_tasks,
                       COUNT(CASE WHEN t.status = 'done' THEN 1 END) as completed_tasks
                FROM projects p
                LEFT JOIN users u ON p.created_by = u.id
                LEFT JOIN tasks t ON p.id = t.project_id
                WHERE p.id = ?
                GROUP BY p.id
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

    // Получить все проекты
    static findAll() {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT p.*, u.username as created_by_name,
                       COUNT(t.id) as total_tasks,
                       COUNT(CASE WHEN t.status = 'done' THEN 1 END) as completed_tasks
                FROM projects p
                LEFT JOIN users u ON p.created_by = u.id
                LEFT JOIN tasks t ON p.id = t.project_id
                GROUP BY p.id
                ORDER BY p.created_at DESC
            `;
            
            db.all(query, [], (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    const projects = rows.map(row => new Project(row));
                    resolve(projects);
                }
            });
        });
    }

    // Получить проекты пользователя
    static findByUser(userId) {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT p.*, u.username as created_by_name,
                       COUNT(t.id) as total_tasks,
                       COUNT(CASE WHEN t.status = 'done' THEN 1 END) as completed_tasks
                FROM projects p
                LEFT JOIN users u ON p.created_by = u.id
                LEFT JOIN tasks t ON p.id = t.project_id
                WHERE p.created_by = ?
                GROUP BY p.id
                ORDER BY p.created_at DESC
            `;
            
            db.all(query, [userId], (err, rows) => {
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
            const { name, description } = projectData;
            
            const query = `
                UPDATE projects 
                SET name = ?, description = ?
                WHERE id = ?
            `;
            
            db.run(query, [name, description, id], function(err) {
                if (err) {
                    reject(err);
                } else if (this.changes === 0) {
                    reject(new Error('Project not found'));
                } else {
                    resolve({ id, name, description });
                }
            });
        });
    }

    // Удалить проект
    static delete(id) {
        return new Promise((resolve, reject) => {
            // Начинаем транзакцию для удаления проекта и связанных задач
            db.serialize(() => {
                db.run('BEGIN TRANSACTION');
                
                // Удаляем комментарии задач
                db.run('DELETE FROM task_comments WHERE task_id IN (SELECT id FROM tasks WHERE project_id = ?)', [id]);
                
                // Удаляем назначения задач
                db.run('DELETE FROM task_assignments WHERE task_id IN (SELECT id FROM tasks WHERE project_id = ?)', [id]);
                
                // Удаляем задачи проекта
                db.run('DELETE FROM tasks WHERE project_id = ?', [id]);
                
                // Удаляем сам проект
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
    static getStats(id) {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT 
                    COUNT(*) as total_tasks,
                    COUNT(CASE WHEN status = 'done' THEN 1 END) as completed_tasks,
                    COUNT(CASE WHEN status = 'archived' THEN 1 END) as archived_tasks,
                    COUNT(CASE WHEN status = 'in_progress' THEN 1 END) as in_progress_tasks,
                    COUNT(CASE WHEN status = 'review' THEN 1 END) as review_tasks,
                    COUNT(CASE WHEN deadline < datetime('now') AND status != 'done' AND status != 'archived' THEN 1 END) as overdue_tasks
                FROM tasks 
                WHERE project_id = ?
            `;
            
            db.get(query, [id], (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row);
                }
            });
        });
    }

    // Получить участников проекта (пользователи с задачами в проекте)
    static getParticipants(id) {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT DISTINCT u.id, u.username, u.role
                FROM users u
                INNER JOIN task_assignments ta ON u.id = ta.user_id
                INNER JOIN tasks t ON ta.task_id = t.id
                WHERE t.project_id = ?
                ORDER BY u.username
            `;
            
            db.all(query, [id], (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    }

    // Проверить, может ли пользователь редактировать проект
    canEdit(userId, userRole) {
        return userRole === 'admin' || 
               userRole === 'manager' || 
               this.created_by === userId;
    }

    // Получить прогресс проекта в процентах
    getProgress() {
        if (this.total_tasks === 0) return 0;
        return Math.round((this.completed_tasks / this.total_tasks) * 100);
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
            total_tasks: this.total_tasks,
            completed_tasks: this.completed_tasks,
            progress: this.getProgress()
        };
    }
}

module.exports = Project;
