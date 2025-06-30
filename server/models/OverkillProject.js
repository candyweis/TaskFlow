const db = require('../config/database');

class OverkillProject {
    constructor(data) {
        this.id = data.id;
        this.name = data.name;
        this.description = data.description;
        this.project_link = data.project_link;
        this.created_by = data.created_by;
        this.created_at = data.created_at;
        this.created_by_name = data.created_by_name;
    }

    // Создать проект оверлиф
    static create(projectData) {
        return new Promise((resolve, reject) => {
            const { name, description, project_link, created_by } = projectData;
            
            const query = `
                INSERT INTO overkill_projects (name, description, project_link, created_by) 
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
                FROM overkill_projects op
                LEFT JOIN users u ON op.created_by = u.id
                WHERE op.id = ?
            `;
            
            db.get(query, [id], (err, row) => {
                if (err) {
                    reject(err);
                } else if (row) {
                    resolve(new OverkillProject(row));
                } else {
                    resolve(null);
                }
            });
        });
    }

    // Получить все проекты оверлиф
    static findAll() {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT op.*, u.username as created_by_name
                FROM overkill_projects op
                LEFT JOIN users u ON op.created_by = u.id
                ORDER BY op.created_at DESC
            `;
            
            db.all(query, [], (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    const projects = rows.map(row => new OverkillProject(row));
                    resolve(projects);
                }
            });
        });
    }

    // Обновить проект оверлиф
    static update(id, projectData) {
        return new Promise((resolve, reject) => {
            const { name, description, project_link } = projectData;
            
            const query = `
                UPDATE overkill_projects 
                SET name = ?, description = ?, project_link = ?
                WHERE id = ?
            `;
            
            db.run(query, [name, description, project_link, id], function(err) {
                if (err) {
                    reject(err);
                } else if (this.changes === 0) {
                    reject(new Error('Overkill project not found'));
                } else {
                    resolve({ id, name, description, project_link });
                }
            });
        });
    }

    // Удалить проект оверлиф
    static delete(id) {
        return new Promise((resolve, reject) => {
            const query = 'DELETE FROM overkill_projects WHERE id = ?';
            
            db.run(query, [id], function(err) {
                if (err) {
                    reject(err);
                } else if (this.changes === 0) {
                    reject(new Error('Overkill project not found'));
                } else {
                    resolve(true);
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
            project_link: this.project_link,
            created_by: this.created_by,
            created_by_name: this.created_by_name,
            created_at: this.created_at
        };
    }
}

module.exports = OverkillProject;
