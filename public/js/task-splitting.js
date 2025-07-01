class TaskSplittingModal {
    constructor() {
        this.currentTaskId = null;
        this.subtaskCount = 0;
        this.init();
    }

    init() {
        this.createModal();
        this.bindEvents();
    }

    createModal() {
        const modalHtml = `
            <div id="taskSplittingModal" class="modal">
                <div class="modal-content modal-large">
                    <div class="modal-header">
                        <h3>✂️ Разделение задачи на подзадачи</h3>
                        <p id="splitTaskTitle" class="modal-subtitle"></p>
                        <button class="close" data-modal="taskSplittingModal">&times;</button>
                    </div>
                    <div class="modal-body">
                        <div class="task-splitting-form">
                            <div class="split-info">
                                <div class="info-card">
                                    <h4>ℹ️ Как разделить задачу</h4>
                                    <ul>
                                        <li>Разбейте большую задачу на несколько маленьких</li>
                                        <li>Каждой подзадаче можно назначить отдельного исполнителя</li>
                                        <li>Родительская задача автоматически перейдет в статус "В работе"</li>
                                        <li>Все подзадачи наследуют проект от родительской задачи</li>
                                    </ul>
                                </div>
                            </div>
                            
                            <div class="subtasks-container">
                                <div class="subtasks-header">
                                    <h4>📋 Подзадачи</h4>
                                    <button type="button" id="addSubtaskBtn" class="btn btn-sm btn-primary">
                                        ➕ Добавить подзадачу
                                    </button>
                                </div>
                                <div id="subtasksList" class="subtasks-list">
                                    <!-- Подзадачи будут добавлены здесь -->
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="form-actions">
                        <button type="button" class="btn btn-secondary" onclick="taskSplitting.closeModal()">
                            ❌ Отмена
                        </button>
                        <button type="button" id="splitTaskBtn" class="btn btn-success">
                            ✂️ Разделить задачу
                        </button>
                    </div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHtml);
    }

    bindEvents() {
        document.getElementById('addSubtaskBtn').addEventListener('click', () => this.addSubtask());
        document.getElementById('splitTaskBtn').addEventListener('click', () => this.splitTask());
    }

    show(taskId, taskData) {
        this.currentTaskId = taskId;
        this.taskData = taskData;
        this.subtaskCount = 0;
        
        document.getElementById('splitTaskTitle').textContent = taskData.title;
        document.getElementById('subtasksList').innerHTML = '';
        
        // Добавляем первую подзадачу по умолчанию
        this.addSubtask();
        this.addSubtask();
        
        app.showModal('taskSplittingModal');
    }

    addSubtask() {
        this.subtaskCount++;
        const subtaskId = `subtask-${this.subtaskCount}`;
        
        const subtaskHtml = `
            <div class="subtask-item" data-subtask-id="${subtaskId}">
                <div class="subtask-header">
                    <h5>📝 Подзадача ${this.subtaskCount}</h5>
                    <button type="button" class="btn btn-sm btn-danger remove-subtask-btn" 
                            onclick="taskSplitting.removeSubtask('${subtaskId}')">
                        🗑️ Удалить
                    </button>
                </div>
                
                <div class="subtask-form">
                    <div class="form-row">
                        <div class="form-group">
                            <label>Название подзадачи *</label>
                            <input type="text" class="subtask-title" required 
                                   placeholder="Введите название подзадачи">
                        </div>
                        <div class="form-group">
                            <label>Сложность</label>
                            <select class="subtask-complexity">
                                <option value="easy">🟢 Легкая</option>
                                <option value="medium" selected>🟡 Средняя</option>
                                <option value="hard">🟠 Сложная</option>
                                <option value="expert">🔴 Только для экспертов</option>
                            </select>
                        </div>
                    </div>
                    
                    <div class="form-row">
                        <div class="form-group">
                            <label>Приоритет</label>
                            <select class="subtask-priority">
                                <option value="low">🟦 Низкий</option>
                                <option value="medium" selected>🟨 Средний</option>
                                <option value="high">🟥 Высокий</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label>Дедлайн *</label>
                            <input type="datetime-local" class="subtask-deadline" required>
                        </div>
                    </div>
                    
                    <div class="form-group">
                        <label>Описание</label>
                        <textarea class="subtask-description" rows="2" 
                                  placeholder="Описание подзадачи (опционально)"></textarea>
                    </div>
                    
                    <div class="form-group">
                        <label>Назначить исполнителя</label>
                        <select class="subtask-assignee">
                            <option value="">Выберите исполнителя</option>
                            ${this.renderUserOptions()}
                        </select>
                    </div>
                </div>
            </div>
        `;
        
        document.getElementById('subtasksList').insertAdjacentHTML('beforeend', subtaskHtml);
        
        // Устанавливаем дедлайн по умолчанию (как у родительской задачи)
        const deadlineInput = document.querySelector(`[data-subtask-id="${subtaskId}"] .subtask-deadline`);
        if (this.taskData.deadline) {
            deadlineInput.value = new Date(this.taskData.deadline).toISOString().slice(0, 16);
        }
    }

    removeSubtask(subtaskId) {
        const subtaskElement = document.querySelector(`[data-subtask-id="${subtaskId}"]`);
        if (subtaskElement) {
            subtaskElement.remove();
        }
        
        // Обновляем нумерацию
        this.updateSubtaskNumbers();
    }

    updateSubtaskNumbers() {
        const subtasks = document.querySelectorAll('.subtask-item');
        subtasks.forEach((subtask, index) => {
            const header = subtask.querySelector('.subtask-header h5');
            header.textContent = `📝 Подзадача ${index + 1}`;
        });
    }

    renderUserOptions() {
        if (!app.users || app.users.length === 0) {
            return '<option value="">Пользователи не загружены</option>';
        }
        
        return app.users
            .filter(user => user.role === 'worker' || user.role === 'manager')
            .map(user => `<option value="${user.id}">${user.username}</option>`)
            .join('');
    }

    async splitTask() {
        const subtaskElements = document.querySelectorAll('.subtask-item');
        
        if (subtaskElements.length === 0) {
            app.showNotification('Добавьте хотя бы одну подзадачу', 'error');
            return;
        }

        const subtasks = [];
        let hasErrors = false;
        
        // Собираем данные подзадач
        subtaskElements.forEach((element, index) => {
            const title = element.querySelector('.subtask-title').value.trim();
            const complexity = element.querySelector('.subtask-complexity').value;
            const priority = element.querySelector('.subtask-priority').value;
            const deadline = element.querySelector('.subtask-deadline').value;
            const description = element.querySelector('.subtask-description').value.trim();
            const assigneeId = element.querySelector('.subtask-assignee').value;
            
            if (!title) {
                app.showNotification(`Введите название для подзадачи ${index + 1}`, 'error');
                hasErrors = true;
                return;
            }
            
            if (!deadline) {
                app.showNotification(`Укажите дедлайн для подзадачи ${index + 1}`, 'error');
                hasErrors = true;
                return;
            }
            
            const subtask = {
                title,
                description,
                complexity,
                priority,
                deadline,
                project_id: this.taskData.project_id,
                overleaf_project_id: this.taskData.overleaf_project_id,
                assignees: assigneeId ? [parseInt(assigneeId)] : [],
                role_assignments: {}
            };
            
            subtasks.push(subtask);
        });

        if (hasErrors) {
            return;
        }

        const splitBtn = document.getElementById('splitTaskBtn');
        const originalText = splitBtn.innerHTML;
        splitBtn.disabled = true;
        splitBtn.innerHTML = '⏳ Разделение...';

        try {
            const response = await app.apiCall(`/api/tasks/${this.currentTaskId}/split`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ subtasks })
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Ошибка разделения задачи');
            }

            const result = await response.json();
            
            app.showNotification(`✅ Задача разделена на ${subtasks.length} подзадач`, 'success');
            this.closeModal();
            
            // Обновляем доску задач
            if (app.renderBoard) {
                app.renderBoard();
            }

        } catch (error) {
            console.error('Error splitting task:', error);
            app.showNotification(error.message || 'Ошибка разделения задачи', 'error');
        } finally {
            splitBtn.disabled = false;
            splitBtn.innerHTML = originalText;
        }
    }

    closeModal() {
        app.closeModal('taskSplittingModal');
        this.currentTaskId = null;
        this.taskData = null;
        this.subtaskCount = 0;
    }
}

// Инициализируем модуль разделения задач
window.taskSplitting = new TaskSplittingModal();
