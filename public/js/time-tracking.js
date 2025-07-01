class TimeTrackingModal {
    constructor() {
        this.currentTaskId = null;
        this.targetStatus = null;
        this.init();
    }

    init() {
        this.createModal();
        this.bindEvents();
    }

    createModal() {
        const modalHtml = `
            <div id="timeTrackingModal" class="modal">
                <div class="modal-content">
                    <div class="modal-header">
                        <h3>📊 Учет времени работы</h3>
                        <p id="timeTaskTitle" class="modal-subtitle"></p>
                        <button class="close" data-modal="timeTrackingModal">&times;</button>
                    </div>
                    <div class="modal-body">
                        <div class="time-tracking-form">
                            <div class="form-group">
                                <label>⏱️ Потрачено времени (часов)</label>
                                <input type="number" id="hoursSpent" min="0.1" max="100" step="0.1" 
                                       placeholder="Например: 2.5">
                                <small class="form-hint">Укажите количество часов в десятичном формате (например, 1.5 = 1 час 30 минут)</small>
                            </div>
                            
                            <div class="form-group">
                                <label>💬 Комментарий к работе</label>
                                <textarea id="timeComment" rows="4" 
                                          placeholder="Опишите, что было сделано (опционально)..."></textarea>
                            </div>
                            
                            <div class="time-info">
                                <div class="info-card">
                                    <h4>ℹ️ Информация о задаче</h4>
                                    <div id="taskComplexityInfo"></div>
                                    <div id="taskPriorityInfo"></div>
                                    <div id="taskAssigneesInfo"></div>
                                    <div id="taskStatusChange"></div>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="form-actions">
                        <button type="button" class="btn btn-secondary" onclick="timeTracking.closeModal()">
                            ❌ Отмена
                        </button>
                        <button type="button" id="moveWithoutTimeBtn" class="btn btn-warning">
                            🚀 Переместить без времени
                        </button>
                        <button type="button" id="saveTimeBtn" class="btn btn-success">
                            ✅ Сохранить время и переместить
                        </button>
                    </div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHtml);
    }

    bindEvents() {
        document.getElementById('saveTimeBtn').addEventListener('click', () => this.saveTime());
        document.getElementById('moveWithoutTimeBtn').addEventListener('click', () => this.moveWithoutTime());
        
        // Автофокус на поле времени
        document.addEventListener('DOMContentLoaded', () => {
            const modal = document.getElementById('timeTrackingModal');
            if (modal) {
                modal.addEventListener('show', () => {
                    setTimeout(() => {
                        document.getElementById('hoursSpent').focus();
                    }, 100);
                });
            }
        });
    }

    show(taskId, taskData, targetStatus = 'done') {
        this.currentTaskId = taskId;
        this.targetStatus = targetStatus;
        
        // Заполняем информацию о задаче
        document.getElementById('timeTaskTitle').textContent = taskData.title;
        
        // Информация о сложности
        const complexityTexts = {
            easy: '🟢 Легкая',
            medium: '🟡 Средняя', 
            hard: '🟠 Сложная',
            expert: '🔴 Только для экспертов'
        };
        
        if (taskData.complexity) {
            document.getElementById('taskComplexityInfo').innerHTML = 
                `<strong>Сложность:</strong> ${complexityTexts[taskData.complexity] || taskData.complexity}`;
        } else {
            document.getElementById('taskComplexityInfo').innerHTML = 
                `<strong>Сложность:</strong> ${complexityTexts['medium']}`;
        }
        
        // Информация о приоритете  
        const priorityTexts = {
            low: '🟦 Низкий',
            medium: '🟨 Средний',
            high: '🟥 Высокий'
        };
        document.getElementById('taskPriorityInfo').innerHTML = 
            `<strong>Приоритет:</strong> ${priorityTexts[taskData.priority] || taskData.priority}`;
        
        // Информация об исполнителях
        const assigneesCount = taskData.assignees ? taskData.assignees.length : 0;
        document.getElementById('taskAssigneesInfo').innerHTML = 
            `<strong>Исполнителей:</strong> ${assigneesCount}`;

        // Информация о смене статуса
        const statusTexts = {
            unassigned: 'Неразобранные',
            in_progress: 'В работе',
            developed: 'Техарь',
            review: 'На проверке',
            deploy: 'Загружать',
            done: 'Готово'
        };
        
        const currentStatusText = statusTexts[taskData.status] || taskData.status;
        const targetStatusText = statusTexts[this.targetStatus] || this.targetStatus;
        
        document.getElementById('taskStatusChange').innerHTML = 
            `<strong>Изменение статуса:</strong> ${currentStatusText} → ${targetStatusText}`;

        // Очищаем форму
        document.getElementById('hoursSpent').value = '';
        document.getElementById('timeComment').value = '';
        
        // Показываем модальное окно
        app.showModal('timeTrackingModal');
    }

    async moveWithoutTime() {
        const moveBtn = document.getElementById('moveWithoutTimeBtn');
        const originalText = moveBtn.innerHTML;
        moveBtn.disabled = true;
        moveBtn.innerHTML = '⏳ Перемещение...';

        try {
            // Просто обновляем статус задачи без записи времени
            const statusResponse = await app.apiCall(`/api/tasks/${this.currentTaskId}/status`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ status: this.targetStatus })
            });

            if (!statusResponse.ok) {
                const error = await statusResponse.json();
                throw new Error(error.error || 'Ошибка обновления статуса');
            }

            const statusTexts = {
                unassigned: 'Неразобранные',
                in_progress: 'В работе',
                developed: 'Техарь',
                review: 'На проверке',
                deploy: 'Загружать',
                done: 'Готово'
            };

            app.showNotification(`✅ Задача перемещена в "${statusTexts[this.targetStatus]}"`, 'success');
            this.closeModal();
            
            // Обновляем доску задач
            if (app.renderBoard) {
                app.renderBoard();
            }

        } catch (error) {
            console.error('Error moving task:', error);
            app.showNotification(error.message || 'Ошибка перемещения задачи', 'error');
        } finally {
            moveBtn.disabled = false;
            moveBtn.innerHTML = originalText;
        }
    }

    async saveTime() {
        const hoursSpent = parseFloat(document.getElementById('hoursSpent').value);
        const comment = document.getElementById('timeComment').value.trim();

        if (!hoursSpent || hoursSpent <= 0) {
            app.showNotification('Укажите количество потраченных часов', 'error');
            return;
        }

        if (hoursSpent > 100) {
            app.showNotification('Слишком большое количество часов. Максимум 100 часов.', 'error');
            return;
        }

        const saveBtn = document.getElementById('saveTimeBtn');
        const originalText = saveBtn.innerHTML;
        saveBtn.disabled = true;
        saveBtn.innerHTML = '⏳ Сохранение...';

        try {
            // Сначала логируем время
            const timeResponse = await app.apiCall('/api/tasks/time-logs', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    task_id: this.currentTaskId,
                    hours_spent: hoursSpent,
                    comment: comment
                })
            });

            if (!timeResponse.ok) {
                const error = await timeResponse.json();
                throw new Error(error.error || 'Ошибка сохранения времени');
            }

            // Затем обновляем статус задачи на целевой статус
            const statusResponse = await app.apiCall(`/api/tasks/${this.currentTaskId}/status`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ status: this.targetStatus })
            });

            if (!statusResponse.ok) {
                const error = await statusResponse.json();
                throw new Error(error.error || 'Ошибка обновления статуса');
            }

            const statusTexts = {
                unassigned: 'Неразобранные',
                in_progress: 'В работе',
                developed: 'Техарь',
                review: 'На проверке',
                deploy: 'Загружать',
                done: 'Готово'
            };

            app.showNotification(`✅ Задача перемещена в "${statusTexts[this.targetStatus]}"! Зафиксировано ${hoursSpent} ч.`, 'success');
            this.closeModal();
            
            // Обновляем доску задач
            if (app.renderBoard) {
                app.renderBoard();
            }

        } catch (error) {
            console.error('Error saving time:', error);
            app.showNotification(error.message || 'Ошибка сохранения времени', 'error');
        } finally {
            saveBtn.disabled = false;
            saveBtn.innerHTML = originalText;
        }
    }

    closeModal() {
        app.closeModal('timeTrackingModal');
        this.currentTaskId = null;
        this.targetStatus = null;
    }
}

// Инициализируем модуль учета времени
window.timeTracking = new TimeTrackingModal();
