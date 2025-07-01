const db = require('../config/database');

class Task {
    constructor(data) {
        this.id = data.id;
        this.title = data.title;
        this.goal = data.goal;
        this.description = data.description;
        this.project_link = data.project_link;
        this.overleaf_project_id = data.overleaf_project_id;
        this.project_id = data.project_id;
        this.status = data.status;
        this.priority = data.priority;
        this.complexity = data.complexity || 'medium';
        this.deadline = data.deadline;
        this.created_by = data.created_by;
        this.parent_task_id = data.parent_task_id;
        this.is_subtask = data.is_subtask || false;
        this.created_at = data.created_at;
        this.updated_at = data.updated_at;
        this.assignees = data.assignees ? (typeof data.assignees === 'string' ? JSON.parse(data.assignees) : data.assignees) : [];
        this.role_assignments = data.role_assignments ? (typeof data.role_assignments === 'string' ? JSON.parse(data.role_assignments) : data.role_assignments) : {};
        this.project_name = data.project_name;
        this.overleaf_project_name = data.overleaf_project_name;
        this.overleaf_project_link = data.overleaf_project_link;
        this.created_by_name = data.created_by_name;
        this.parent_task_title = data.parent_task_title;
    }

    // Создать задачу
    static create(taskData) {
        return new Promise((resolve, reject) => {
            const { 
                title, goal, description, project_link, overleaf_project_id, 
                project_id, priority, complexity, deadline, created_by, assignees, 
                role_assignments, parent_task_id, is_subtask 
            } = taskData;
            
            const query = `
                INSERT INTO tasks (
                    title, goal, description, project_link, overleaf_project_id, 
                    project_id, priority, complexity, deadline, created_by, assignees, 
                    role_assignments, parent_task_id, is_subtask
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;
            
            const assigneesJson = JSON.stringify(assignees || []);
            const roleAssignmentsJson = JSON.stringify(role_assignments || {});
            
            db.run(query, [
                title, goal, description, project_link, overleaf_project_id,
                project_id, priority, complexity || 'medium', deadline, created_by, 
                assigneesJson, roleAssignmentsJson, parent_task_id || null, is_subtask || false
            ], function(err) {
                if (err) {
                    reject(err);
                } else {
                    resolve({ 
                        id: this.lastID, 
                        title, 
                        goal,
                        description, 
                        project_id, 
                        overleaf_project_id,
                        priority, 
                        complexity: complexity || 'medium',
                        deadline, 
                        created_by,
                        assignees: assignees || [],
                        role_assignments: role_assignments || {},
                        parent_task_id: parent_task_id || null,
                        is_subtask: is_subtask || false
                    });
                }
            });
        });
    }

    // Найти задачу по ID
    static findById(id) {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT t.*, 
                       p.name as project_name,
                       op.name as overleaf_project_name,
                       op.project_link as overleaf_project_link,
                       u.username as created_by_name,
                       pt.title as parent_task_title
                FROM tasks t
                LEFT JOIN projects p ON t.project_id = p.id
                LEFT JOIN overleaf_projects op ON t.overleaf_project_id = op.id
                LEFT JOIN users u ON t.created_by = u.id
                LEFT JOIN tasks pt ON t.parent_task_id = pt.id
                WHERE t.id = ?
            `;
            
            db.get(query, [id], (err, row) => {
                if (err) {
                    console.error('❌ Error finding task by ID:', err);
                    reject(err);
                } else if (row) {
                    console.log('✅ Found task:', row.title);
                    resolve(new Task(row));
                } else {
                    console.log('❌ Task not found with ID:', id);
                    resolve(null);
                }
            });
        });
    }

    // Получить все задачи с фильтрами
    static findAll(filters = {}) {
        return new Promise((resolve, reject) => {
            let query = `
                SELECT t.*, 
                       p.name as project_name,
                       op.name as overleaf_project_name,
                       op.project_link as overleaf_project_link,
                       u.username as created_by_name,
                       pt.title as parent_task_title
                FROM tasks t
                LEFT JOIN projects p ON t.project_id = p.id
                LEFT JOIN overleaf_projects op ON t.overleaf_project_id = op.id
                LEFT JOIN users u ON t.created_by = u.id
                LEFT JOIN tasks pt ON t.parent_task_id = pt.id
                WHERE 1=1
            `;
            
            const params = [];
            
            console.log('🔧 Task filters:', filters);
            
            if (filters.project_id) {
                query += ' AND t.project_id = ?';
                params.push(filters.project_id);
            }
            
            if (filters.overleaf_project_id) {
                query += ' AND t.overleaf_project_id = ?';
                params.push(filters.overleaf_project_id);
            }
            
            if (filters.status) {
                if (Array.isArray(filters.status)) {
                    query += ' AND t.status IN (' + filters.status.map(() => '?').join(',') + ')';
                    params.push(...filters.status);
                } else {
                    query += ' AND t.status = ?';
                    params.push(filters.status);
                    console.log('🔧 Filtering by status:', filters.status);
                }
            }
            
            if (filters.priority) {
                if (Array.isArray(filters.priority)) {
                    query += ' AND t.priority IN (' + filters.priority.map(() => '?').join(',') + ')';
                    params.push(...filters.priority);
                } else {
                    query += ' AND t.priority = ?';
                    params.push(filters.priority);
                }
            }

            // Новый фильтр по сложности
            if (filters.complexity) {
                if (Array.isArray(filters.complexity)) {
                    query += ' AND t.complexity IN (' + filters.complexity.map(() => '?').join(',') + ')';
                    params.push(...filters.complexity);
                } else {
                    query += ' AND t.complexity = ?';
                    params.push(filters.complexity);
                }
            }

            // Фильтр для родительских задач / подзадач
            if (filters.parent_only) {
                query += ' AND t.parent_task_id IS NULL';
            }

            if (filters.subtasks_only) {
                query += ' AND t.is_subtask = 1';
            }

            if (filters.parent_task_id) {
                query += ' AND t.parent_task_id = ?';
                params.push(filters.parent_task_id);
            }
            
            if (filters.assignee_id) {
                query += ' AND JSON_EXTRACT(t.assignees, "$") LIKE ?';
                params.push(`%${filters.assignee_id}%`);
            }
            
            if (filters.created_by) {
                query += ' AND t.created_by = ?';
                params.push(filters.created_by);
            }
            
            if (filters.exclude_archived && !filters.status) {
                query += ' AND t.status != "archived"';
                console.log('🔧 Excluding archived tasks');
            }
            
            if (filters.overdue) {
                query += ' AND t.deadline < datetime("now") AND t.status NOT IN ("done", "archived")';
            }
            
            if (filters.deadline_from) {
                query += ' AND t.deadline >= ?';
                params.push(filters.deadline_from);
            }
            
            if (filters.deadline_to) {
                query += ' AND t.deadline <= ?';
                params.push(filters.deadline_to);
            }
            
            if (filters.search) {
                query += ' AND (t.title LIKE ? OR t.description LIKE ? OR t.goal LIKE ?)';
                const searchTerm = `%${filters.search}%`;
                params.push(searchTerm, searchTerm, searchTerm);
            }
            
            // Сортировка
            let orderBy = 't.created_at DESC';
            if (filters.sort_by) {
                switch (filters.sort_by) {
                    case 'deadline':
                        orderBy = 't.deadline ASC';
                        break;
                    case 'priority':
                        orderBy = 'CASE t.priority WHEN "high" THEN 1 WHEN "medium" THEN 2 WHEN "low" THEN 3 END ASC, t.created_at DESC';
                        break;
                    case 'complexity':
                        orderBy = 'CASE t.complexity WHEN "expert" THEN 1 WHEN "hard" THEN 2 WHEN "medium" THEN 3 WHEN "easy" THEN 4 END ASC, t.created_at DESC';
                        break;
                    case 'status':
                        orderBy = 't.status ASC, t.created_at DESC';
                        break;
                    case 'title':
                        orderBy = 't.title ASC';
                        break;
                    default:
                        orderBy = 't.created_at DESC';
                }
            }
            
            query += ` ORDER BY ${orderBy}`;
            
            if (filters.limit) {
                query += ' LIMIT ?';
                params.push(filters.limit);
            }
            
            if (filters.offset) {
                query += ' OFFSET ?';
                params.push(filters.offset);
            }
            
            console.log('🔧 Final query:', query);
            console.log('🔧 Final params:', params);
            
            db.all(query, params, (err, rows) => {
                if (err) {
                    console.error('❌ Error executing task query:', err);
                    reject(err);
                } else {
                    console.log('✅ Found tasks:', rows.length);
                    const tasks = rows.map(row => new Task(row));
                    resolve(tasks);
                }
            });
        });
    }

    // Обновить задачу
    static update(id, taskData) {
        return new Promise((resolve, reject) => {
            const { 
                title, goal, description, project_link, overleaf_project_id,
                project_id, priority, complexity, deadline, assignees, role_assignments,
                parent_task_id, is_subtask
            } = taskData;
            
            let query = 'UPDATE tasks SET updated_at = CURRENT_TIMESTAMP';
            let params = [];
            let updates = [];

            if (title !== undefined) {
                updates.push('title = ?');
                params.push(title);
            }
            
            if (goal !== undefined) {
                updates.push('goal = ?');
                params.push(goal);
            }
            
            if (description !== undefined) {
                updates.push('description = ?');
                params.push(description);
            }
            
            if (project_link !== undefined) {
                updates.push('project_link = ?');
                params.push(project_link);
            }
            
            if (overleaf_project_id !== undefined) {
                updates.push('overleaf_project_id = ?');
                params.push(overleaf_project_id);
            }
            
            if (project_id !== undefined) {
                updates.push('project_id = ?');
                params.push(project_id);
            }
            
            if (priority !== undefined) {
                updates.push('priority = ?');
                params.push(priority);
            }

            if (complexity !== undefined) {
                updates.push('complexity = ?');
                params.push(complexity);
            }
            
            if (deadline !== undefined) {
                updates.push('deadline = ?');
                params.push(deadline);
            }
            
            if (assignees !== undefined) {
                updates.push('assignees = ?');
                params.push(JSON.stringify(assignees));
            }
            
            if (role_assignments !== undefined) {
                updates.push('role_assignments = ?');
                params.push(JSON.stringify(role_assignments));
            }

            if (parent_task_id !== undefined) {
                updates.push('parent_task_id = ?');
                params.push(parent_task_id);
            }

            if (is_subtask !== undefined) {
                updates.push('is_subtask = ?');
                params.push(is_subtask ? 1 : 0);
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
                    reject(new Error('Task not found'));
                } else {
                    resolve(true);
                }
            });
        });
    }

    // Обновить статус задачи
    static updateStatus(id, status) {
        return new Promise((resolve, reject) => {
            console.log('🔄 Updating task status:', { id, status });
            
            const query = 'UPDATE tasks SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?';
            
            db.run(query, [status, id], function(err) {
                if (err) {
                    console.error('❌ Error updating task status:', err);
                    reject(err);
                } else if (this.changes === 0) {
                    console.error('❌ Task not found for status update:', id);
                    reject(new Error('Task not found'));
                } else {
                    console.log('✅ Task status updated successfully');
                    resolve(true);
                }
            });
        });
    }

    // Разделить задачу на подзадачи
    static splitTask(parentTaskId, subtasks, splitBy) {
        return new Promise((resolve, reject) => {
            db.serialize(() => {
                db.run('BEGIN TRANSACTION');
                
                const createdSubtasks = [];
                let completedSubtasks = 0;
                
                if (subtasks.length === 0) {
                    db.run('ROLLBACK');
                    reject(new Error('No subtasks provided'));
                    return;
                }
                
                subtasks.forEach((subtaskData, index) => {
                    const query = `
                        INSERT INTO tasks (
                            title, goal, description, project_link, overleaf_project_id, 
                            project_id, priority, complexity, deadline, created_by, assignees, 
                            role_assignments, parent_task_id, is_subtask, status
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'unassigned')
                    `;
                    
                    const assigneesJson = JSON.stringify(subtaskData.assignees || []);
                    const roleAssignmentsJson = JSON.stringify(subtaskData.role_assignments || {});
                    
                    db.run(query, [
                        subtaskData.title,
                        subtaskData.goal || '',
                        subtaskData.description || '',
                        subtaskData.project_link || '',
                        subtaskData.overleaf_project_id || null,
                        subtaskData.project_id || null,
                        subtaskData.priority || 'medium',
                        subtaskData.complexity || 'medium',
                        subtaskData.deadline,
                        subtaskData.created_by || splitBy,
                        assigneesJson,
                        roleAssignmentsJson,
                        parentTaskId
                    ], function(err) {
                        if (err) {
                            console.error('❌ Error creating subtask:', err);
                            db.run('ROLLBACK');
                            reject(err);
                            return;
                        }
                        
                        const subtaskId = this.lastID;
                        createdSubtasks.push(subtaskId);
                        
                        // Записываем связь в таблицу splits
                        db.run('INSERT INTO task_splits (parent_task_id, child_task_id, split_by) VALUES (?, ?, ?)', 
                               [parentTaskId, subtaskId, splitBy], (err) => {
                            if (err) {
                                console.error('❌ Error recording task split:', err);
                            }
                            
                            completedSubtasks++;
                            if (completedSubtasks === subtasks.length) {
                                // Обновляем родительскую задачу
                                db.run('UPDATE tasks SET status = "in_progress", updated_at = CURRENT_TIMESTAMP WHERE id = ?', 
                                       [parentTaskId], (err) => {
                                    if (err) {
                                        console.error('❌ Error updating parent task:', err);
                                        db.run('ROLLBACK');
                                        reject(err);
                                    } else {
                                        db.run('COMMIT');
                                        console.log('✅ Task split completed successfully');
                                        resolve(createdSubtasks);
                                    }
                                });
                            }
                        });
                    });
                });
            });
        });
    }

    // Получить подзадачи
    static getSubtasks(parentTaskId) {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT t.*, 
                       p.name as project_name,
                       op.name as overleaf_project_name,
                       op.project_link as overleaf_project_link,
                       u.username as created_by_name
                FROM tasks t
                LEFT JOIN projects p ON t.project_id = p.id
                LEFT JOIN overleaf_projects op ON t.overleaf_project_id = op.id
                LEFT JOIN users u ON t.created_by = u.id
                WHERE t.parent_task_id = ? AND t.is_subtask = 1
                ORDER BY t.created_at ASC
            `;
            
            db.all(query, [parentTaskId], (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    const subtasks = rows.map(row => new Task(row));
                    resolve(subtasks);
                }
            });
        });
    }

    // Логировать время выполнения
    static logTime(taskId, userId, hoursSpent, comment = '') {
        return new Promise((resolve, reject) => {
            const query = `
                INSERT INTO task_time_logs (task_id, user_id, hours_spent, comment)
                VALUES (?, ?, ?, ?)
            `;
            
            db.run(query, [taskId, userId, hoursSpent, comment], function(err) {
                if (err) {
                    reject(err);
                } else {
                    resolve({ 
                        id: this.lastID, 
                        task_id: taskId, 
                        user_id: userId, 
                        hours_spent: hoursSpent, 
                        comment 
                    });
                }
            });
        });
    }

    // Получить логи времени для задачи
    static getTimeLogs(taskId) {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT tl.*, u.username
                FROM task_time_logs tl
                LEFT JOIN users u ON tl.user_id = u.id
                WHERE tl.task_id = ?
                ORDER BY tl.logged_at DESC
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

    // Получить общее время по задаче
    static getTotalTimeSpent(taskId) {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT SUM(hours_spent) as total_hours,
                       COUNT(*) as log_count,
                       MIN(logged_at) as first_log,
                       MAX(logged_at) as last_log
                FROM task_time_logs
                WHERE task_id = ?
            `;
            
            db.get(query, [taskId], (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve({
                        total_hours: row.total_hours || 0,
                        log_count: row.log_count || 0,
                        first_log: row.first_log,
                        last_log: row.last_log
                    });
                }
            });
        });
    }

    // Получить статистику по сложности
    static getComplexityStats(filters = {}) {
        return new Promise((resolve, reject) => {
            let query = `
                SELECT 
                    complexity,
                    COUNT(*) as count,
                    AVG(CASE WHEN status = 'done' THEN 
                        (julianday(updated_at) - julianday(created_at)) 
                        ELSE NULL END) as avg_completion_days,
                    (SELECT COALESCE(SUM(hours_spent), 0) 
                     FROM task_time_logs 
                     WHERE task_id IN (
                         SELECT id FROM tasks t2 
                         WHERE t2.complexity = t.complexity AND t2.status = 'done'
                     )) as total_hours_spent
                FROM tasks t
                WHERE 1=1
            `;
            
            const params = [];
            
            if (filters.project_id) {
                query += ' AND project_id = ?';
                params.push(filters.project_id);
            }
            
            if (filters.exclude_archived) {
                query += ' AND status != "archived"';
            }
            
            if (filters.date_from) {
                query += ' AND created_at >= ?';
                params.push(filters.date_from);
            }
            
            if (filters.date_to) {
                query += ' AND created_at <= ?';
                params.push(filters.date_to);
            }
            
            query += ' GROUP BY complexity ORDER BY CASE complexity WHEN "easy" THEN 1 WHEN "medium" THEN 2 WHEN "hard" THEN 3 WHEN "expert" THEN 4 END';
            
            db.all(query, params, (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    }

    // Удалить задачу
    static delete(id) {
        return new Promise((resolve, reject) => {
            db.serialize(() => {
                db.run('BEGIN TRANSACTION');
                
                // Удаляем связанные данные
                db.run('DELETE FROM task_assignments WHERE task_id = ?', [id]);
                db.run('DELETE FROM task_comments WHERE task_id = ?', [id]);
                db.run('DELETE FROM task_time_logs WHERE task_id = ?', [id]);
                db.run('DELETE FROM task_splits WHERE parent_task_id = ? OR child_task_id = ?', [id, id]);
                
                // Обновляем подзадачи (убираем связь с родителем)
                db.run('UPDATE tasks SET parent_task_id = NULL, is_subtask = 0 WHERE parent_task_id = ?', [id]);
                
                // Удаляем задачу
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

    // Получить комментарии к задаче
    static getComments(taskId) {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT tc.*, u.username 
                FROM task_comments tc
                JOIN users u ON tc.user_id = u.id
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
                    resolve({ id: this.lastID, task_id: taskId, user_id: userId, comment });
                }
            });
        });
    }

    // Получить публичные данные задачи
    toPublic() {
        return {
            id: this.id,
            title: this.title,
            goal: this.goal,
            description: this.description,
            project_link: this.project_link,
            overleaf_project_id: this.overleaf_project_id,
            overleaf_project_name: this.overleaf_project_name,
            overleaf_project_link: this.overleaf_project_link,
            project_id: this.project_id,
            project_name: this.project_name,
            status: this.status,
            priority: this.priority,
            complexity: this.complexity,
            deadline: this.deadline,
            created_by: this.created_by,
            created_by_name: this.created_by_name,
            parent_task_id: this.parent_task_id,
            parent_task_title: this.parent_task_title,
            is_subtask: this.is_subtask,
            created_at: this.created_at,
            updated_at: this.updated_at,
            assignees: this.assignees,
            role_assignments: this.role_assignments
        };
    }

    // Проверить права доступа к задаче
    hasAccess(userId, userRole, userPermissions) {
        if (userRole === 'admin') return true;
        if (this.created_by === userId) return true;
        if (this.assignees && this.assignees.includes(userId)) return true;
        if (userPermissions && userPermissions.canManageTasks) return true;
        
        return false;
    }

    // Проверить возможность редактирования
    canEdit(userId, userRole, userPermissions) {
        if (userRole === 'admin') return true;
        if (userPermissions && userPermissions.canManageTasks) return true;
        if (this.created_by === userId) return true;
        
        return false;
    }

    // Проверить возможность изменения статуса
    canChangeStatus(userId, userRole, userPermissions) {
        if (userRole === 'admin') return true;
        if (userPermissions && userPermissions.canManageTasks) return true;
        if (this.assignees && this.assignees.includes(userId)) return true;
        
        return false;
    }
}

module.exports = Task;
