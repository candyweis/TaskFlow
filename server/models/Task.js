const db = require('../config/database');

class Task {
    constructor(data) {
        this.id = data.id;
        this.title = data.title;
        this.goal = data.goal;
        this.description = data.description;
        this.project_link = data.project_link;
        this.overkill_project_id = data.overkill_project_id;
        this.project_id = data.project_id;
        this.status = data.status;
        this.priority = data.priority;
        this.deadline = data.deadline;
        this.created_by = data.created_by;
        this.created_at = data.created_at;
        this.updated_at = data.updated_at;
        this.project_name = data.project_name;
        this.overkill_project_name = data.overkill_project_name;
        this.overkill_project_link = data.overkill_project_link;
        this.assignees = data.assignees || [];
        this.assignees_names = data.assignees_names || [];
    }

    // Создать задачу
    static create(taskData) {
        return new Promise((resolve, reject) => {
            const { title, goal, description, project_link, overkill_project_id, project_id, priority, deadline, created_by, assignees } = taskData;
            
            db.serialize(() => {
                db.run('BEGIN TRANSACTION');
                
                const query = `
                    INSERT INTO tasks (title, goal, description, project_link, overkill_project_id, project_id, priority, deadline, created_by) 
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                `;
                
                db.run(query, [title, goal, description, project_link, overkill_project_id, project_id, priority, deadline, created_by], function(err) {
                    if (err) {
                        db.run('ROLLBACK');
                        reject(err);
                        return;
                    }
                    
                    const taskId = this.lastID;
                    
                    // Добавляем назначения
                    if (assignees && assignees.length > 0) {
                        const stmt = db.prepare('INSERT INTO task_assignments (task_id, user_id) VALUES (?, ?)');
                        
                        assignees.forEach(userId => {
                            stmt.run(taskId, userId, (err) => {
                                if (err) {
                                    db.run('ROLLBACK');
                                    reject(err);
                                    return;
                                }
                            });
                        });
                        
                        stmt.finalize((err) => {
                            if (err) {
                                db.run('ROLLBACK');
                                reject(err);
                            } else {
                                db.run('COMMIT');
                                resolve({ 
                                    id: taskId, 
                                    title, 
                                    goal,
                                    description, 
                                    project_link,
                                    overkill_project_id,
                                    project_id, 
                                    priority, 
                                    deadline, 
                                    created_by,
                                    assignees 
                                });
                            }
                        });
                    } else {
                        db.run('COMMIT');
                        resolve({ 
                            id: taskId, 
                            title, 
                            goal,
                            description, 
                            project_link,
                            overkill_project_id,
                            project_id, 
                            priority, 
                            deadline, 
                            created_by,
                            assignees: []
                        });
                    }
                });
            });
        });
    }

    // Найти задачу по ID
    static findById(id) {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT t.*, p.name as project_name, op.name as overkill_project_name, op.project_link as overkill_project_link,
                       GROUP_CONCAT(u.username) as assignees_names,
                       GROUP_CONCAT(ta.user_id) as assignee_ids
                FROM tasks t
                LEFT JOIN projects p ON t.project_id = p.id
                LEFT JOIN overkill_projects op ON t.overkill_project_id = op.id
                LEFT JOIN task_assignments ta ON t.id = ta.task_id
                LEFT JOIN users u ON ta.user_id = u.id
                WHERE t.id = ?
                GROUP BY t.id
            `;
            
            db.get(query, [id], (err, row) => {
                if (err) {
                    reject(err);
                } else if (row) {
                    const task = new Task(row);
                    task.assignees = row.assignee_ids ? 
                        row.assignee_ids.split(',').map(id => parseInt(id)) : [];
                    task.assignees_names = row.assignees_names ? 
                        row.assignees_names.split(',') : [];
                    resolve(task);
                } else {
                    resolve(null);
                }
            });
        });
    }

    // Получить все задачи
    static findAll(filters = {}) {
        return new Promise((resolve, reject) => {
            let query = `
                SELECT t.*, p.name as project_name, op.name as overkill_project_name, op.project_link as overkill_project_link,
                       GROUP_CONCAT(u.username) as assignees_names,
                       GROUP_CONCAT(ta.user_id) as assignee_ids
                FROM tasks t
                LEFT JOIN projects p ON t.project_id = p.id
                LEFT JOIN overkill_projects op ON t.overkill_project_id = op.id
                LEFT JOIN task_assignments ta ON t.id = ta.task_id
                LEFT JOIN users u ON ta.user_id = u.id
            `;
            
            const conditions = [];
            const params = [];
            
            if (filters.project_id) {
                conditions.push('t.project_id = ?');
                params.push(filters.project_id);
            }
            
            if (filters.status) {
                conditions.push('t.status = ?');
                params.push(filters.status);
            }

            if (filters.exclude_archived) {
                conditions.push('t.status != ?');
                params.push('archived');
            }
            
            if (filters.assignee_id) {
                conditions.push('ta.user_id = ?');
                params.push(filters.assignee_id);
            }
            
            if (filters.priority) {
                conditions.push('t.priority = ?');
                params.push(filters.priority);
            }
            
            if (conditions.length > 0) {
                query += ' WHERE ' + conditions.join(' AND ');
            }
            
            query += ' GROUP BY t.id ORDER BY t.created_at DESC';
            
            db.all(query, params, (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    const tasks = rows.map(row => {
                        const task = new Task(row);
                        task.assignees = row.assignee_ids ? 
                            row.assignee_ids.split(',').map(id => parseInt(id)) : [];
                        task.assignees_names = row.assignees_names ? 
                            row.assignees_names.split(',') : [];
                        return task;
                    });
                    resolve(tasks);
                }
            });
        });
    }

    // Получить задачи пользователя
    static findByAssignee(userId) {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT t.*, p.name as project_name, op.name as overkill_project_name, op.project_link as overkill_project_link,
                       GROUP_CONCAT(u.username) as assignees_names,
                       GROUP_CONCAT(ta.user_id) as assignee_ids
                FROM tasks t
                LEFT JOIN projects p ON t.project_id = p.id
                LEFT JOIN overkill_projects op ON t.overkill_project_id = op.id
                LEFT JOIN task_assignments ta ON t.id = ta.task_id
                LEFT JOIN users u ON ta.user_id = u.id
                WHERE t.id IN (
                    SELECT DISTINCT task_id 
                    FROM task_assignments 
                    WHERE user_id = ?
                ) AND t.status != 'archived'
                GROUP BY t.id
                ORDER BY t.deadline ASC
            `;
            
            db.all(query, [userId], (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    const tasks = rows.map(row => {
                        const task = new Task(row);
                        task.assignees = row.assignee_ids ? 
                            row.assignee_ids.split(',').map(id => parseInt(id)) : [];
                        task.assignees_names = row.assignees_names ? 
                            row.assignees_names.split(',') : [];
                        return task;
                    });
                    resolve(tasks);
                }
            });
        });
    }

    // Обновить статус задачи
    static updateStatus(id, status) {
        return new Promise((resolve, reject) => {
            const query = `
                UPDATE tasks 
                SET status = ?, updated_at = CURRENT_TIMESTAMP 
                WHERE id = ?
            `;
            
            db.run(query, [status, id], function(err) {
                if (err) {
                    reject(err);
                } else if (this.changes === 0) {
                    reject(new Error('Task not found'));
                } else {
                    resolve(true);
                }
            });
        });
    }

    // Обновить задачу
    static update(id, taskData) {
        return new Promise((resolve, reject) => {
            const { title, goal, description, project_link, overkill_project_id, priority, deadline, assignees } = taskData;
            
            db.serialize(() => {
                db.run('BEGIN TRANSACTION');
                
                // Обновляем основные данные задачи
                const updateQuery = `
                    UPDATE tasks 
                    SET title = ?, goal = ?, description = ?, project_link = ?, overkill_project_id = ?, priority = ?, deadline = ?, updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                `;
                
                db.run(updateQuery, [title, goal, description, project_link, overkill_project_id, priority, deadline, id], function(err) {
                    if (err) {
                        db.run('ROLLBACK');
                        reject(err);
                        return;
                    }
                    
                    if (this.changes === 0) {
                        db.run('ROLLBACK');
                        reject(new Error('Task not found'));
                        return;
                    }
                    
                    // Удаляем старые назначения
                    db.run('DELETE FROM task_assignments WHERE task_id = ?', [id], (err) => {
                        if (err) {
                            db.run('ROLLBACK');
                            reject(err);
                            return;
                        }
                        
                        // Добавляем новые назначения
                        if (assignees && assignees.length > 0) {
                            const stmt = db.prepare('INSERT INTO task_assignments (task_id, user_id) VALUES (?, ?)');
                            
                            assignees.forEach(userId => {
                                stmt.run(id, userId);
                            });
                            
                            stmt.finalize((err) => {
                                if (err) {
                                    db.run('ROLLBACK');
                                    reject(err);
                                } else {
                                    db.run('COMMIT');
                                    resolve(true);
                                }
                            });
                        } else {
                            db.run('COMMIT');
                            resolve(true);
                        }
                    });
                });
            });
        });
    }

    // Удалить задачу
    static delete(id) {
        return new Promise((resolve, reject) => {
            db.serialize(() => {
                db.run('BEGIN TRANSACTION');
                
                // Удаляем комментарии задачи
                db.run('DELETE FROM task_comments WHERE task_id = ?', [id]);
                
                // Удаляем назначения задачи
                db.run('DELETE FROM task_assignments WHERE task_id = ?', [id]);
                
                // Удаляем саму задачу
                db.run('DELETE FROM tasks WHERE id = ?', [id], function(err) {
                    if (err) {
                        db.run('ROLLBACK');
                        reject(err);
                    } else if (this.changes === 0) {
                        db.run('ROLLBACK');
                        reject(new Error('Task not found'));
                    } else {
                        db.run('COMMIT');
                        resolve(true);
                    }
                });
            });
        });
    }

    // Получить просроченные задачи
    static findOverdue() {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT t.*, p.name as project_name, op.name as overkill_project_name, op.project_link as overkill_project_link,
                       GROUP_CONCAT(u.username) as assignees_names,
                       GROUP_CONCAT(ta.user_id) as assignee_ids
                FROM tasks t
                LEFT JOIN projects p ON t.project_id = p.id
                LEFT JOIN overkill_projects op ON t.overkill_project_id = op.id
                LEFT JOIN task_assignments ta ON t.id = ta.task_id
                LEFT JOIN users u ON ta.user_id = u.id
                WHERE t.deadline < datetime('now') AND t.status != 'done' AND t.status != 'archived'
                GROUP BY t.id
                ORDER BY t.deadline ASC
            `;
            
            db.all(query, [], (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    const tasks = rows.map(row => {
                        const task = new Task(row);
                        task.assignees = row.assignee_ids ? 
                            row.assignee_ids.split(',').map(id => parseInt(id)) : [];
                        task.assignees_names = row.assignees_names ? 
                            row.assignees_names.split(',') : [];
                        return task;
                    });
                    resolve(tasks);
                }
            });
        });
    }

    // Получить комментарии к задаче
    static getComments(taskId) {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT tc.*, u.username
                FROM task_comments tc
                LEFT JOIN users u ON tc.user_id = u.id
                WHERE tc.task_id = ?
                ORDER BY tc.created_at ASC
            `;
            
            db.all(query, [taskId], (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    }

    // Добавить комментарий к задаче
    static addComment(taskId, userId, comment) {
        return new Promise((resolve, reject) => {
            const query = `
                INSERT INTO task_comments (task_id, user_id, comment) 
                VALUES (?, ?, ?)
            `;
            
            db.run(query, [taskId, userId, comment], function(err) {
                if (err) {
                    reject(err);
                } else {
                    resolve({ 
                        id: this.lastID, 
                        task_id: taskId, 
                        user_id: userId, 
                        comment 
                    });
                }
            });
        });
    }

    // Проверить дедлайн задачи
    getDeadlineStatus() {
        const now = new Date();
        const deadline = new Date(this.deadline);
        const timeDiff = deadline.getTime() - now.getTime();
        const daysDiff = Math.ceil(timeDiff / (1000 * 3600 * 24));
        
        if (daysDiff < 0) return 'overdue';
        if (daysDiff <= 2) return 'warning';
        return 'normal';
    }

    // Получить публичные данные задачи
    toPublic() {
        return {
            id: this.id,
            title: this.title,
            goal: this.goal,
            description: this.description,
            project_link: this.project_link,
            overkill_project_id: this.overkill_project_id,
            overkill_project_name: this.overkill_project_name,
            overkill_project_link: this.overkill_project_link,
            project_id: this.project_id,
            project_name: this.project_name,
            status: this.status,
            priority: this.priority,
            deadline: this.deadline,
            created_by: this.created_by,
            created_at: this.created_at,
            updated_at: this.updated_at,
            assignees: this.assignees,
            assignees_names: this.assignees_names,
            deadline_status: this.getDeadlineStatus()
        };
    }
}

module.exports = Task;
