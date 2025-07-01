const db = require('../config/database');

class OverleafProject {
    constructor(data) {
        this.id = data.id;
        this.name = data.name;
        this.description = data.description;
        this.project_link = data.project_link;
        this.created_by = data.created_by;
        this.created_at = data.created_at;
        this.updated_at = data.updated_at;
        this.is_active = data.is_active;
        this.created_by_name = data.created_by_name;
    }

    // Создать проект Overleaf
    static create(projectData) {
        return new Promise((resolve, reject) => {
            const { name, description, project_link, created_by } = projectData;
            
            const query = `
                INSERT INTO overleaf_projects (name, description, project_link, created_by) 
                VALUES (?, ?, ?, ?)
            `;
            
            db.run(query, [name, description, project_link, created_by], function(err) {
                if (err) {
                    reject(err);
                } else {
                    resolve({ 
                        id: this.lastID, 
                        name, 
                        description, 
                        project_link, 
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
                SELECT op.*, u.username as created_by_name 
                FROM overleaf_projects op
                LEFT JOIN users u ON op.created_by = u.id
                WHERE op.id = ?
            `;
            
            db.get(query, [id], (err, row) => {
                if (err) {
                    reject(err);
                } else if (row) {
                    resolve(new OverleafProject(row));
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
                SELECT op.*, u.username as created_by_name 
                FROM overleaf_projects op
                LEFT JOIN users u ON op.created_by = u.id
                WHERE op.name = ?
            `;
            
            db.get(query, [name], (err, row) => {
                if (err) {
                    reject(err);
                } else if (row) {
                    resolve(new OverleafProject(row));
                } else {
                    resolve(null);
                }
            });
        });
    }

    // Получить все проекты Overleaf
    static findAll(options = {}) {
        return new Promise((resolve, reject) => {
            let query = `
                SELECT op.*, u.username as created_by_name 
                FROM overleaf_projects op
                LEFT JOIN users u ON op.created_by = u.id
            `;
            
            const params = [];
            const conditions = [];
            
            if (options.active_only) {
                conditions.push('op.is_active = 1');
            }
            
            if (options.created_by) {
                conditions.push('op.created_by = ?');
                params.push(options.created_by);
            }
            
            if (options.search) {
                conditions.push('(op.name LIKE ? OR op.description LIKE ?)');
                const searchTerm = `%${options.search}%`;
                params.push(searchTerm, searchTerm);
            }
            
            if (conditions.length > 0) {
                query += ' WHERE ' + conditions.join(' AND ');
            }
            
            query += ' ORDER BY op.created_at DESC';
            
            if (options.limit) {
                query += ' LIMIT ?';
                params.push(options.limit);
            }
            
            db.all(query, params, (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    const projects = rows.map(row => new OverleafProject(row));
                    resolve(projects);
                }
            });
        });
    }

    // Получить активные проекты Overleaf
    static findActive() {
        return this.findAll({ active_only: true });
    }

    // Поиск проектов Overleaf
    static search(searchTerm, options = {}) {
        return new Promise((resolve, reject) => {
            let query = `
                SELECT op.*, u.username as created_by_name 
                FROM overleaf_projects op
                LEFT JOIN users u ON op.created_by = u.id
                WHERE (op.name LIKE ? OR op.description LIKE ?)
            `;
            
            const params = [`%${searchTerm}%`, `%${searchTerm}%`];
            
            if (options.active_only) {
                query += ' AND op.is_active = 1';
            }
            
            if (options.created_by) {
                query += ' AND op.created_by = ?';
                params.push(options.created_by);
            }
            
            query += ' ORDER BY op.created_at DESC';
            
            if (options.limit) {
                query += ' LIMIT ?';
                params.push(options.limit);
            }
            
            db.all(query, params, (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    const projects = rows.map(row => new OverleafProject(row));
                    resolve(projects);
                }
            });
        });
    }

    // Обновить проект Overleaf
    static update(id, projectData) {
        return new Promise((resolve, reject) => {
            const { name, description, project_link, is_active } = projectData;
            
            let query = 'UPDATE overleaf_projects SET updated_at = CURRENT_TIMESTAMP';
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

            if (project_link !== undefined) {
                updates.push('project_link = ?');
                params.push(project_link);
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
                    reject(new Error('Overleaf project not found'));
                } else {
                    resolve(true);
                }
            });
        });
    }

    // Архивировать проект Overleaf
    static archive(id) {
        return this.update(id, { is_active: false });
    }

    // Восстановить проект Overleaf
    static restore(id) {
        return this.update(id, { is_active: true });
    }

    // Удалить проект Overleaf
    static delete(id) {
        return new Promise((resolve, reject) => {
            db.serialize(() => {
                db.run('BEGIN TRANSACTION');
                
                // Обновляем связанные задачи (убираем ссылку на проект)
                db.run('UPDATE tasks SET overleaf_project_id = NULL WHERE overleaf_project_id = ?', [id]);
                
                // Удаляем проект
                db.run('DELETE FROM overleaf_projects WHERE id = ?', [id], function(err) {
                    if (err) {
                        db.run('ROLLBACK');
                        reject(err);
                    } else if (this.changes === 0) {
                        db.run('ROLLBACK');
                        reject(new Error('Overleaf project not found'));
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
                WHERE overleaf_project_id = ?
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

    // Получить связанные задачи
    static getRelatedTasks(projectId, options = {}) {
        return new Promise((resolve, reject) => {
            let query = `
                SELECT t.*, u.username as created_by_name, p.name as project_name
                FROM tasks t
                LEFT JOIN users u ON t.created_by = u.id
                LEFT JOIN projects p ON t.project_id = p.id
                WHERE t.overleaf_project_id = ?
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

    // Получить участников проекта Overleaf
    static getProjectMembers(projectId) {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT DISTINCT u.id, u.username, u.role, u.permissions, u.telegram, u.phone, u.is_active
                FROM users u
                JOIN tasks t ON JSON_EXTRACT(t.assignees, '$') LIKE '%' || u.id || '%'
                WHERE t.overleaf_project_id = ? AND u.is_active = 1
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

    // Получить проекты Overleaf пользователя
    static getUserProjects(userId, options = {}) {
        return new Promise((resolve, reject) => {
            let query = `
                SELECT DISTINCT op.*, u.username as created_by_name
                FROM overleaf_projects op
                LEFT JOIN users u ON op.created_by = u.id
                LEFT JOIN tasks t ON t.overleaf_project_id = op.id
                WHERE (op.created_by = ? OR JSON_EXTRACT(t.assignees, '$') LIKE '%' || ? || '%')
            `;
            
            const params = [userId, userId];
            
            if (options.active_only) {
                query += ' AND op.is_active = 1';
            }
            
            query += ' ORDER BY op.created_at DESC';
            
            if (options.limit) {
                query += ' LIMIT ?';
                params.push(options.limit);
            }
            
            db.all(query, params, (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    const projects = rows.map(row => new OverleafProject(row));
                    resolve(projects);
                }
            });
        });
    }

    // Проверить доступ к проекту Overleaf
    static checkAccess(projectId, userId) {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT COUNT(*) as has_access
                FROM overleaf_projects op
                LEFT JOIN tasks t ON t.overleaf_project_id = op.id
                WHERE op.id = ? AND (
                    op.created_by = ? OR 
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

    // Получить популярные проекты Overleaf (по количеству задач)
    static getPopularProjects(limit = 10) {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT op.*, u.username as created_by_name, COUNT(t.id) as task_count
                FROM overleaf_projects op
                LEFT JOIN users u ON op.created_by = u.id
                LEFT JOIN tasks t ON t.overleaf_project_id = op.id AND t.status != 'archived'
                WHERE op.is_active = 1
                GROUP BY op.id
                ORDER BY task_count DESC, op.created_at DESC
                LIMIT ?
            `;
            
            db.all(query, [limit], (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    const projects = rows.map(row => new OverleafProject(row));
                    resolve(projects);
                }
            });
        });
    }

    // Клонировать проект Overleaf
    static clone(id, overrides = {}) {
        return new Promise(async (resolve, reject) => {
            try {
                const originalProject = await OverleafProject.findById(id);
                if (!originalProject) {
                    reject(new Error('Overleaf project not found'));
                    return;
                }

                const newProjectData = {
                    name: overrides.name || `Копия: ${originalProject.name}`,
                    description: overrides.description || originalProject.description,
                    project_link: overrides.project_link || originalProject.project_link,
                    created_by: overrides.created_by || originalProject.created_by
                };

                const newProject = await OverleafProject.create(newProjectData);
                resolve(newProject);
            } catch (error) {
                reject(error);
            }
        });
    }

    // Проверить валидность ссылки Overleaf
    static validateOverleafLink(link) {
        if (!link) return true; // Ссылка не обязательна
        
        // Базовая проверка URL Overleaf
        const overleafPattern = /^https?:\/\/(www\.)?overleaf\.com\/.+/i;
        return overleafPattern.test(link);
    }

    // Извлечь ID проекта из ссылки Overleaf
    static extractProjectIdFromLink(link) {
        if (!link) return null;
        
        const match = link.match(/\/project\/([a-f0-9]+)/i);
        return match ? match[1] : null;
    }

    // Получить публичные данные проекта
    toPublic() {
        return {
            id: this.id,
            name: this.name,
            description: this.description,
            project_link: this.project_link,
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

    // Проверить права доступа к проекту
    hasAccess(userId, userRole, userPermissions) {
        // Админы имеют доступ ко всем проектам
        if (userRole === 'admin') return true;
        
        // Создатель проекта имеет доступ
        if (this.created_by === userId) return true;
        
        // Менеджеры с правом управления проектами имеют доступ
        if (userPermissions && userPermissions.canManageProjects) return true;
        
        return false;
    }

    // Проверить возможность редактирования
    canEdit(userId, userRole, userPermissions) {
        if (userRole === 'admin') return true;
        if (userPermissions && userPermissions.canManageProjects) return true;
        if (this.created_by === userId) return true;
        
        return false;
    }
}

module.exports = OverleafProject;
