const db = require('../config/database');

class TaskComment {
    constructor(data) {
        this.id = data.id;
        this.task_id = data.task_id;
        this.user_id = data.user_id;
        this.comment = data.comment;
        this.created_at = data.created_at;
        this.username = data.username;
    }

    // Создать комментарий
    static create(commentData) {
        return new Promise((resolve, reject) => {
            const { task_id, user_id, comment } = commentData;
            
            const query = `
                INSERT INTO task_comments (task_id, user_id, comment) 
                VALUES (?, ?, ?)
            `;
            
            db.run(query, [task_id, user_id, comment], function(err) {
                if (err) {
                    reject(err);
                } else {
                    resolve({ 
                        id: this.lastID, 
                        task_id, 
                        user_id, 
                        comment 
                    });
                }
            });
        });
    }

    // Получить комментарии к задаче
    static findByTaskId(taskId) {
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
                    const comments = rows.map(row => new TaskComment(row));
                    resolve(comments);
                }
            });
        });
    }

    // Удалить комментарий
    static delete(id) {
        return new Promise((resolve, reject) => {
            const query = 'DELETE FROM task_comments WHERE id = ?';
            
            db.run(query, [id], function(err) {
                if (err) {
                    reject(err);
                } else if (this.changes === 0) {
                    reject(new Error('Comment not found'));
                } else {
                    resolve(true);
                }
            });
        });
    }

    // Получить публичные данные комментария
    toPublic() {
        return {
            id: this.id,
            task_id: this.task_id,
            user_id: this.user_id,
            comment: this.comment,
            created_at: this.created_at,
            username: this.username
        };
    }
}

module.exports = TaskComment;
