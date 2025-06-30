class TaskFlowApp {
    constructor() {
        this.currentUser = null;
        this.token = localStorage.getItem('taskflow_token');
        this.projects = [];
        this.tasks = [];
        this.users = [];
        this.colleagues = [];
        this.overkillProjects = [];
        this.currentSection = 'projects';
        this.socket = null;
        this.currentEditingTaskId = null;
        this.currentCommentingTaskId = null;
        this.filteredColleagues = [];
        this.updateTaskStatusDebounce = new Map();
        this.isUpdatingTasks = false;
        
        this.init();
    }

    async init() {
        this.bindEvents();
        await this.checkAuth();
    }

    initSocket() {
        console.log('🔌 Initializing socket connection...');
        this.socket = io();
        
        this.socket.on('connect', () => {
            console.log('✅ Socket connected:', this.socket.id);
            // Присоединяемся к общей комнате для получения всех обновлений
            this.socket.emit('join_general');
        });

        this.socket.on('disconnect', () => {
            console.log('❌ Socket disconnected');
        });

        // ========== REAL-TIME ОБРАБОТЧИКИ ==========
        
        // Новый проект создан
        this.socket.on('project_created', (data) => {
            console.log('📋 New project created:', data);
            this.projects.push(data.project);
            this.populateSelects();
            this.renderProjects();
            this.showNotification(`Новый проект "${data.project.name}" создан пользователем ${data.createdBy.username}`, 'info');
        });

        // Проект удален
        this.socket.on('project_deleted', (data) => {
            console.log('🗑️ Project deleted:', data);
            this.projects = this.projects.filter(p => p.id !== data.projectId);
            this.populateSelects();
            this.renderProjects();
            this.showNotification(`Проект удален пользователем ${data.deletedBy.username}`, 'warning');
        });

        // Новый overkill проект создан
        this.socket.on('overkill_project_created', (data) => {
            console.log('🚀 New overkill project created:', data);
            this.overkillProjects.push(data.project);
            this.populateSelects();
            this.renderOverkillProjectsTable();
            this.showNotification(`Новый проект Overkill "${data.project.name}" создан`, 'info');
        });

        // Overkill проект удален
        this.socket.on('overkill_project_deleted', (data) => {
            console.log('🗑️ Overkill project deleted:', data);
            this.overkillProjects = this.overkillProjects.filter(p => p.id !== data.projectId);
            this.populateSelects();
            this.renderOverkillProjectsTable();
            this.showNotification(`Проект Overkill удален`, 'warning');
        });

        // Новая задача создана
        this.socket.on('task_created', (data) => {
            console.log('📝 New task created:', data);
            this.tasks.push(data.task);
            this.renderBoard();
            
            // Показываем уведомление только если задача не создана текущим пользователем
            if (data.createdBy.id !== this.currentUser.id) {
                this.showNotification(`Новая задача "${data.task.title}" создана пользователем ${data.createdBy.username}`, 'info');
            }
        });

        // Статус задачи изменен
        this.socket.on('task_status_changed', (data) => {
            console.log('🔄 Task status changed:', data);
            
            // Обновляем задачу в локальном массиве
            const taskIndex = this.tasks.findIndex(t => t.id === data.task.id);
            if (taskIndex !== -1) {
                this.tasks[taskIndex] = data.task;
            }
            
            this.renderBoard();
            
            // Показываем уведомление только если изменение не от текущего пользователя
            if (data.changedBy.id !== this.currentUser.id) {
                const statusTexts = {
                    unassigned: 'Неразобранные',
                    in_progress: 'В работе',
                    developed: 'Разработано',
                    review: 'На проверке',
                    deploy: 'На заливе',
                    done: 'Готово',
                    archived: 'Архивировано'
                };
                
                this.showNotification(
                    `Задача "${data.task.title}" перемещена в "${statusTexts[data.newStatus]}" пользователем ${data.changedBy.username}`, 
                    'info'
                );
            }
        });

        // Назначения задачи изменены
        this.socket.on('task_assignees_changed', (data) => {
            console.log('👥 Task assignees changed:', data);
            
            // Обновляем задачу в локальном массиве
            const taskIndex = this.tasks.findIndex(t => t.id === data.task.id);
            if (taskIndex !== -1) {
                this.tasks[taskIndex] = data.task;
            }
            
            this.renderBoard();
            
            // Показываем уведомление если текущий пользователь добавлен/удален
            const wasAssigned = data.oldAssignees.includes(this.currentUser.id);
            const isAssigned = data.newAssignees.includes(this.currentUser.id);
            
            if (!wasAssigned && isAssigned) {
                this.showNotification(`Вас назначили на задачу "${data.task.title}"`, 'success');
            } else if (wasAssigned && !isAssigned) {
                this.showNotification(`Вас сняли с задачи "${data.task.title}"`, 'warning');
            } else if (data.changedBy.id !== this.currentUser.id) {
                this.showNotification(`Участники задачи "${data.task.title}" изменены`, 'info');
            }
        });

        // Задача удалена
        this.socket.on('task_deleted', (data) => {
            console.log('🗑️ Task deleted:', data);
            this.tasks = this.tasks.filter(t => t.id !== data.taskId);
            this.renderBoard();
            
            if (data.deletedBy.id !== this.currentUser.id) {
                this.showNotification(`Задача удалена пользователем ${data.deletedBy.username}`, 'warning');
            }
        });

        // Новый комментарий к задаче
        this.socket.on('task_comment_added', (data) => {
            console.log('💬 Task comment added:', data);
            
            // Если открыто окно комментариев для этой задачи, обновляем его
            if (this.currentCommentingTaskId === data.taskId && data.comment.user_id !== this.currentUser.id) {
                this.loadTaskComments(data.taskId);
            }
            
            // Показываем уведомление если комментарий не от текущего пользователя
            if (data.comment.user_id !== this.currentUser.id) {
                const task = this.tasks.find(t => t.id === data.taskId);
                const taskTitle = task ? task.title : 'задаче';
                this.showNotification(`Новый комментарий к ${taskTitle} от ${data.comment.username}`, 'info');
            }
        });

        // Активность пользователя (опционально)
        this.socket.on('user_activity', (data) => {
            // Можно показывать кто сейчас онлайн, кто что делает и т.д.
            console.log('👤 User activity:', data);
        });
    }

    // Отправить активность пользователя
    sendUserActivity(action, details = {}) {
        if (this.socket && this.socket.connected) {
            this.socket.emit('user_activity', {
                action,
                details,
                user: {
                    id: this.currentUser.id,
                    username: this.currentUser.username
                }
            });
        }
    }

    // Debounced функция для обновления статуса задач
    debounceUpdateTaskStatus(taskId, newStatus, delay = 300) {
        // Очищаем предыдущий таймер для этой задачи
        if (this.updateTaskStatusDebounce.has(taskId)) {
            clearTimeout(this.updateTaskStatusDebounce.get(taskId));
        }

        // Устанавливаем новый таймер
        const timeoutId = setTimeout(() => {
            this.executeUpdateTaskStatus(taskId, newStatus);
            this.updateTaskStatusDebounce.delete(taskId);
        }, delay);

        this.updateTaskStatusDebounce.set(taskId, timeoutId);
    }

    async executeUpdateTaskStatus(taskId, newStatus) {
        if (this.isUpdatingTasks) {
            console.log('Update already in progress, skipping...');
            return;
        }

        try {
            this.isUpdatingTasks = true;
            
            const response = await this.apiCall(`/api/tasks/${taskId}/status`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ status: newStatus })
            });

            if (response.ok) {
                // Локально обновляем задачу
                const taskIndex = this.tasks.findIndex(t => t.id === taskId);
                if (taskIndex !== -1) {
                    this.tasks[taskIndex].status = newStatus;
                }
                
                this.renderBoard();
                
                // Отправляем активность пользователя
                this.sendUserActivity('move_task', {
                    taskId,
                    newStatus,
                    taskTitle: this.tasks.find(t => t.id === taskId)?.title
                });
                
            } else {
                const error = await response.json();
                this.showNotification(error.error || 'Ошибка обновления статуса', 'error');
                // При ошибке перезагружаем задачи для восстановления корректного состояния
                await this.loadTasks();
                this.renderBoard();
            }
        } catch (error) {
            this.showNotification('Ошибка соединения с сервером', 'error');
            await this.loadTasks();
            this.renderBoard();
        } finally {
            this.isUpdatingTasks = false;
        }
    }

    bindEvents() {
        // Авторизация
        document.getElementById('authForm').addEventListener('submit', (e) => this.handleAuth(e));
        
        // Навигация
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.addEventListener('click', () => this.switchSection(btn.dataset.section));
        });
        
        // Кнопки
        document.getElementById('logoutBtn').addEventListener('click', () => this.logout());
        document.getElementById('addProjectBtn').addEventListener('click', () => this.showModal('projectModal'));
        document.getElementById('addTaskBtn').addEventListener('click', () => this.showModal('taskModal'));
        document.getElementById('addOverkillProjectBtn').addEventListener('click', () => this.showModal('overkillProjectModal'));
        document.getElementById('viewArchivedBtn').addEventListener('click', () => this.showArchivedTasks());
        
        // Поиск и фильтрация коллег
        document.getElementById('searchColleagues').addEventListener('input', (e) => this.filterColleagues());
        document.getElementById('roleFilter').addEventListener('change', (e) => this.filterColleagues());
        
        // Формы
        document.getElementById('projectForm').addEventListener('submit', (e) => this.createProject(e));
        document.getElementById('overkillProjectForm').addEventListener('submit', (e) => this.createOverkillProject(e));
        document.getElementById('taskForm').addEventListener('submit', (e) => this.createTask(e));
        document.getElementById('saveTaskAssignees').addEventListener('click', () => this.saveTaskAssignees());
        document.getElementById('addTaskComment').addEventListener('click', () => this.addTaskComment());
        
        // Закрытие модальных окон
        document.querySelectorAll('.close').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const modal = e.target.closest('.modal');
                this.closeModal(modal.id);
            });
        });

        // Клик вне модального окна
        document.querySelectorAll('.modal').forEach(modal => {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    this.closeModal(modal.id);
                }
            });
        });
        
        // Фильтр проектов
        document.getElementById('projectFilter').addEventListener('change', () => this.renderBoard());
    }

    async checkAuth() {
        if (this.token) {
            try {
                const response = await this.apiCall('/api/projects');
                if (response.ok) {
                    await this.loadUserProfile();
                    this.showApp();
                } else {
                    this.logout();
                }
            } catch (error) {
                this.logout();
            }
        } else {
            this.showAuth();
        }
    }

    async loadUserProfile() {
        try {
            const tokenData = JSON.parse(atob(this.token.split('.')[1]));
            this.currentUser = {
                id: tokenData.id,
                username: tokenData.username,
                role: tokenData.role,
                permissions: JSON.parse(tokenData.permissions || '{}')
            };
        } catch (error) {
            console.error('Error loading user profile:', error);
            this.logout();
        }
    }

    showAuth() {
        document.getElementById('authModal').classList.add('show');
        document.getElementById('app').classList.add('d-none');
    }

    showApp() {
        document.getElementById('authModal').classList.remove('show');
        document.getElementById('app').classList.remove('d-none');
        
        document.getElementById('currentUser').textContent = this.currentUser.username;
        
        const roleElement = document.getElementById('currentRole');
        roleElement.textContent = this.getRoleText(this.currentUser.role);
        roleElement.className = `role-badge role-${this.currentUser.role}`;
        
        // Показываем админку только админам
        if (this.currentUser.role === 'admin') {
            document.getElementById('adminLink').style.display = 'flex';
        }
        
        this.updateUI();
        this.loadData();
        this.initSocket(); // Инициализируем сокет после авторизации
    }

    getRoleText(role) {
        const roles = {
            admin: 'Администратор',
            manager: 'Менеджер',
            worker: 'Исполнитель'
        };
        return roles[role] || role;
    }

    updateUI() {
        const permissions = this.currentUser.permissions;
        
        // Показываем кнопку добавления проектов для пользователей с правами на создание проектов или задач
        const canCreateProjects = permissions.canManageProjects || permissions.canManageTasks || this.currentUser.role === 'admin';
        document.getElementById('addProjectBtn').style.display = canCreateProjects ? 'flex' : 'none';
        
        document.getElementById('addTaskBtn').style.display = 
            permissions.canManageTasks ? 'flex' : 'none';
    }

    async handleAuth(e) {
        e.preventDefault();
        
        const submitButton = document.getElementById('authButton');
        const buttonText = document.getElementById('authButtonText');
        const loader = document.getElementById('authLoader');
        
        submitButton.disabled = true;
        buttonText.style.display = 'none';
        loader.style.display = 'block';
        
        try {
            const username = document.getElementById('username').value;
            const password = document.getElementById('password').value;
            
            await this.login(username, password);
        } finally {
            submitButton.disabled = false;
            buttonText.style.display = 'block';
            loader.style.display = 'none';
        }
    }

    async login(username, password) {
        try {
            const response = await fetch('/api/auth/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ username, password })
            });

            const data = await response.json();
            
            if (response.ok) {
                this.token = data.token;
                this.currentUser = data.user;
                localStorage.setItem('taskflow_token', this.token);
                this.showApp();
                this.showNotification('Добро пожаловать!', 'success');
            } else {
                this.showNotification(data.error || 'Ошибка входа', 'error');
            }
        } catch (error) {
            this.showNotification('Ошибка соединения с сервером', 'error');
        }
    }

    logout() {
        localStorage.removeItem('taskflow_token');
        this.token = null;
        this.currentUser = null;
        if (this.socket) {
            this.socket.disconnect();
        }
        this.showAuth();
        this.showNotification('Вы вышли из системы', 'info');
    }

    switchSection(section) {
        this.currentSection = section;
        
        // Обновляем активные кнопки
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.section === section);
        });
        
        // Показываем нужную секцию
        document.querySelectorAll('.content-section').forEach(sec => {
            sec.style.display = sec.id === section + 'Section' ? 'block' : 'none';
        });
        
        if (section === 'projects') {
            this.renderProjects();
        } else if (section === 'board') {
            this.renderBoard();
        } else if (section === 'colleagues') {
            this.loadColleaguesData();
        }
    }

    async loadData() {
        await Promise.all([
            this.loadProjects(),
            this.loadTasks(),
            this.loadUsers()
        ]);
        
        this.populateSelects();
        this.renderProjects();
        this.renderBoard();
    }

    async loadColleaguesData() {
        await Promise.all([
            this.loadColleagues(),
            this.loadOverkillProjects()
        ]);
        
        this.renderColleagues();
        this.renderOverkillProjectsTable();
    }

    async loadProjects() {
        try {
            const response = await this.apiCall('/api/projects');
            if (response.ok) {
                this.projects = await response.json();
            }
        } catch (error) {
            console.error('Error loading projects:', error);
        }
    }

    async loadTasks() {
        try {
            const response = await this.apiCall('/api/tasks');
            if (response.ok) {
                this.tasks = await response.json();
            }
        } catch (error) {
            console.error('Error loading tasks:', error);
        }
    }

    async loadUsers() {
        try {
            const response = await this.apiCall('/api/users/workers');
            if (response.ok) {
                this.users = await response.json();
            }
        } catch (error) {
            // Если нет прав, ничего не делаем
        }
    }

    async loadColleagues() {
        try {
            const response = await this.apiCall('/api/users/colleagues');
            if (response.ok) {
                this.colleagues = await response.json();
                this.filteredColleagues = [...this.colleagues];
            }
        } catch (error) {
            console.error('Error loading colleagues:', error);
        }
    }

    async loadOverkillProjects() {
        try {
            const response = await this.apiCall('/api/overkill-projects');
            if (response.ok) {
                this.overkillProjects = await response.json();
            }
        } catch (error) {
            console.error('Error loading overkill projects:', error);
        }
    }

    filterColleagues() {
        const searchTerm = document.getElementById('searchColleagues').value.toLowerCase();
        const roleFilter = document.getElementById('roleFilter').value;
        
        this.filteredColleagues = this.colleagues.filter(colleague => {
            const matchesSearch = colleague.username.toLowerCase().includes(searchTerm) ||
                                this.getRoleText(colleague.role).toLowerCase().includes(searchTerm);
            const matchesRole = !roleFilter || colleague.role === roleFilter;
            
            return matchesSearch && matchesRole;
        });
        
        this.renderColleagues();
    }

    renderColleagues() {
        const container = document.getElementById('colleaguesList');
        container.innerHTML = '';
        
        if (this.filteredColleagues.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-users"></i>
                    <h3>Коллеги не найдены</h3>
                    <p>Попробуйте изменить параметры поиска</p>
                </div>
            `;
            return;
        }
        
        this.filteredColleagues.forEach(colleague => {
            const card = document.createElement('div');
            card.className = 'colleague-card';
            
            const permissions = colleague.permissions || {};
            const skills = [];
            if (permissions.canDevelop) skills.push('Разработка');
            if (permissions.canReview) skills.push('Проверка');
            if (permissions.canDeploy) skills.push('Деплой');
            if (permissions.canManageProjects) skills.push('Управление проектами');
            if (permissions.canManageTasks) skills.push('Управление задачами');
            if (permissions.canManageUsers) skills.push('Управление пользователями');
            
            card.innerHTML = `
                <div class="colleague-header">
                    <div class="colleague-avatar">
                        ${colleague.username.charAt(0).toUpperCase()}
                    </div>
                    <div class="colleague-info">
                        <h3>${this.escapeHtml(colleague.username)}</h3>
                        <span class="role-badge role-${colleague.role}">${this.getRoleText(colleague.role)}</span>
                    </div>
                </div>
                <div class="colleague-contacts">
                    ${colleague.telegram ? `
                        <div class="contact-item">
                            <i class="fab fa-telegram"></i>
                            <a href="https://t.me/${colleague.telegram.replace('@', '')}" target="_blank">
                                ${colleague.telegram}
                            </a>
                        </div>
                    ` : ''}
                    ${colleague.phone ? `
                        <div class="contact-item">
                            <i class="fas fa-phone"></i>
                            <a href="tel:${colleague.phone}">${colleague.phone}</a>
                        </div>
                    ` : ''}
                    ${!colleague.telegram && !colleague.phone ? `
                        <div class="contact-item no-contacts">
                            <i class="fas fa-exclamation-circle"></i>
                            <span>Контакты не указаны</span>
                        </div>
                    ` : ''}
                </div>
                <div class="colleague-skills">
                    <h4>Навыки и права:</h4>
                    <div class="skills-list">
                        ${skills.length > 0 ? skills.map(skill => `<span class="skill-tag">${skill}</span>`).join('') : '<span class="no-skills">Базовые права</span>'}
                    </div>
                </div>
            `;
            
            container.appendChild(card);
        });
    }

    renderOverkillProjectsTable() {
        const tbody = document.getElementById('overkillProjectsTableBody');
        tbody.innerHTML = '';
        
        if (this.overkillProjects.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="5" class="empty-cell">
                        <div class="empty-state">
                            <i class="fas fa-external-link-alt"></i>
                            <p>Проекты Overkill не найдены</p>
                        </div>
                    </td>
                </tr>
            `;
            return;
        }
        
        this.overkillProjects.forEach(project => {
            const row = document.createElement('tr');
            
            row.innerHTML = `
                <td>
                    <strong>${this.escapeHtml(project.name)}</strong>
                </td>
                <td class="description-cell">
                    ${project.description ? this.escapeHtml(project.description) : '<em>Без описания</em>'}
                </td>
                <td>${this.escapeHtml(project.created_by_name || 'Неизвестен')}</td>
                <td class="center">
                    ${project.project_link ? `
                        <a href="${project.project_link}" target="_blank" class="btn btn-sm btn-primary">
                            <i class="fas fa-external-link-alt"></i>
                            Открыть
                        </a>
                    ` : '<em>Нет ссылки</em>'}
                </td>
                <td class="center">
                    <div style="display: flex; gap: 5px; justify-content: center;">
                        <button class="btn btn-sm btn-danger" onclick="app.deleteOverkillProject(${project.id})" title="Удалить">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </td>
            `;
            
            tbody.appendChild(row);
        });
    }

    populateSelects() {
        // Заполняем селект проектов
        const selects = ['taskProject', 'projectFilter'];
        selects.forEach(selectId => {
            const select = document.getElementById(selectId);
            if (!select) return;
            
            const currentValue = select.value;
            select.innerHTML = selectId === 'projectFilter' ? 
                '<option value="">Все проекты</option>' : 
                '<option value="">Выберите проект (опционально)</option>';
            
            this.projects.forEach(project => {
                const option = document.createElement('option');
                option.value = project.id;
                option.textContent = project.name;
                select.appendChild(option);
            });
            
            select.value = currentValue;
        });

        // Заполняем селект overkill проектов
        const overkillSelect = document.getElementById('taskOverkillProject');
        if (overkillSelect) {
            const currentValue = overkillSelect.value;
            overkillSelect.innerHTML = '<option value="">Выберите проект Overkill (опционально)</option>';
            
            this.overkillProjects.forEach(project => {
                const option = document.createElement('option');
                option.value = project.id;
                option.textContent = project.name;
                overkillSelect.appendChild(option);
            });
            
            overkillSelect.value = currentValue;
        }
        
        this.populateAssignees();
    }

    populateAssignees() {
        const assigneesList = document.getElementById('assigneesList');
        if (!assigneesList) return;
        
        const workers = this.users.filter(u => u.role === 'worker' || u.role === 'manager');
        
        if (workers.length === 0) {
            assigneesList.innerHTML = '<p class="text-center">Нет доступных исполнителей</p>';
            return;
        }
        
        assigneesList.innerHTML = '';
        
        workers.forEach(user => {
            const item = document.createElement('div');
            item.className = 'assignee-item';
            
            const permissions = user.permissions || {};
            const skills = [];
            if (permissions.canDevelop) skills.push('Разработка');
            if (permissions.canReview) skills.push('Проверка');
            if (permissions.canDeploy) skills.push('Деплой');
            
            item.innerHTML = `
                <input type="checkbox" class="assignee-checkbox" value="${user.id}">
                <div>
                    <strong>${user.username}</strong>
                    <div style="font-size: 12px; color: #666;">${skills.join(', ') || 'Базовые права'}</div>
                </div>
            `;
            assigneesList.appendChild(item);
        });
    }

    renderProjects() {
        const container = document.getElementById('projectsList');
        container.innerHTML = '';
        
        if (this.projects.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-project-diagram"></i>
                    <h3>Пока нет проектов</h3>
                    <p>Создайте первый проект для начала работы</p>
                </div>
            `;
            return;
        }
        
        this.projects.forEach(project => {
            const projectTasks = this.tasks.filter(t => t.project_id === project.id);
            const completedTasks = projectTasks.filter(t => t.status === 'done').length;
            
            const card = document.createElement('div');
            card.className = 'project-card';
            
            // Добавляем кнопки действий для менеджеров
            const permissions = this.currentUser.permissions;
            const canManageProjects = permissions.canManageProjects || permissions.canManageTasks || this.currentUser.role === 'admin';
            
            const actionsHtml = canManageProjects ? `
                <div class="project-actions">
                    <button class="btn btn-sm btn-danger" onclick="app.deleteProject(${project.id})" title="Удалить проект">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            ` : '';
            
            card.innerHTML = `
                ${actionsHtml}
                <h3>${this.escapeHtml(project.name)}</h3>
                <p>${this.escapeHtml(project.description || 'Без описания')}</p>
                <div class="project-stats">
                    <span>Задач: <span class="stat-value">${projectTasks.length}</span></span>
                    <span>Выполнено: <span class="stat-value">${completedTasks}</span></span>
                </div>
            `;
            container.appendChild(card);
        });
    }

    renderBoard() {
        const filter = document.getElementById('projectFilter').value;
        const filteredTasks = filter ? 
            this.tasks.filter(t => t.project_id == filter) : 
            this.tasks;
        
        const columns = ['unassigned', 'in_progress', 'developed', 'review', 'deploy', 'done'];
        
        columns.forEach(status => {
            const container = document.getElementById(status + '-tasks');
            if (!container) return;
            
            const columnTasks = filteredTasks.filter(t => t.status === status);
            
            container.innerHTML = '';
            
            if (columnTasks.length === 0) {
                container.innerHTML = `
                    <div class="empty-state" style="padding: 30px 10px;">
                        <i class="fas fa-inbox" style="font-size: 32px;"></i>
                        <p style="font-size: 14px; margin-top: 10px;">Нет задач</p>
                    </div>
                `;
            } else {
                columnTasks.forEach(task => {
                    const taskCard = this.createTaskCard(task);
                    container.appendChild(taskCard);
                });
            }
            
            // Обновляем счетчик
            const column = container.closest('.kanban-column');
            const countElement = column.querySelector('.task-count');
            if (countElement) {
                countElement.textContent = columnTasks.length;
            }
        });
        
        this.setupDragAndDrop();
    }

    createTaskCard(task) {
        const project = this.projects.find(p => p.id === task.project_id);
        const deadline = new Date(task.deadline);
        const now = new Date();
        const timeDiff = deadline.getTime() - now.getTime();
        const daysDiff = Math.ceil(timeDiff / (1000 * 3600 * 24));
        
        let deadlineClass = '';
        if (daysDiff < 0) deadlineClass = 'overdue';
        else if (daysDiff <= 2) deadlineClass = 'warning';
        
        const card = document.createElement('div');
        card.className = 'task-card';
        card.draggable = true;
        card.dataset.taskId = task.id;
        
        // Создаем аватары исполнителей
        const assigneesHtml = (task.assignees || []).map(assigneeId => {
            const user = this.users.find(u => u.id === assigneeId);
            return `<div class="assignee-avatar" title="${user?.username || 'Неизвестный пользователь'}">${user?.username.charAt(0).toUpperCase() || '?'}</div>`;
        }).join('');
        
        // Кнопки управления
        const isAssigned = task.assignees && task.assignees.includes(this.currentUser.id);
        const canManage = this.currentUser.permissions.canManageTasks || this.currentUser.role === 'admin' || this.currentUser.role === 'manager';
        
        const actionsHtml = `
            <div class="task-actions" style="position: absolute; top: 8px; right: 8px; opacity: 0; transition: opacity 0.3s; display: flex; gap: 4px;">
                ${canManage ? `
                    <button class="btn btn-sm btn-danger" onclick="app.deleteTask(${task.id})" title="Удалить задачу">
                        <i class="fas fa-times"></i>
                    </button>
                ` : ''}
                <button class="btn btn-sm btn-secondary" onclick="app.manageTaskAssignees(${task.id})" title="Управление участниками">
                    <i class="fas fa-users"></i>
                </button>
                ${(isAssigned || canManage) ? `
                    <button class="btn btn-sm btn-info" onclick="app.showTaskComments(${task.id})" title="Комментарии">
                        <i class="fas fa-comments"></i>
                    </button>
                ` : ''}
                ${task.status === 'done' ? `
                    <button class="btn btn-sm btn-warning" onclick="app.archiveTask(${task.id})" title="Архивировать">
                        <i class="fas fa-archive"></i>
                    </button>
                ` : ''}
            </div>
        `;
        
        // Определяем какую ссылку показывать
        let linkHtml = '';
        if (task.overkill_project_name && task.overkill_project_link) {
            linkHtml = `
                <div class="task-project-link">
                    <a href="${task.overkill_project_link}" target="_blank">
                        <i class="fas fa-external-link-alt"></i>
                        Overkill: ${this.escapeHtml(task.overkill_project_name)}
                    </a>
                </div>
            `;
        } else if (task.project_link) {
            linkHtml = `
                <div class="task-project-link">
                    <a href="${task.project_link}" target="_blank">
                        <i class="fas fa-external-link-alt"></i>
                        Ссылка на ресурс
                    </a>
                </div>
            `;
        }
        
        card.innerHTML = `
            ${actionsHtml}
            <div class="task-title">${this.escapeHtml(task.title)}</div>
            ${task.goal ? `<div class="task-goal"><i class="fas fa-bullseye"></i> ${this.escapeHtml(task.goal)}</div>` : ''}
            <div class="task-description">${this.escapeHtml(task.description)}</div>
            ${linkHtml}
            <div class="task-meta">
                <div class="task-deadline ${deadlineClass}">
                    <i class="fas fa-clock"></i>
                    ${deadline.toLocaleDateString('ru-RU')}
                </div>
                <div class="priority-badge priority-${task.priority}">
                    ${this.getPriorityText(task.priority)}
                </div>
            </div>
            <div class="task-footer">
                <div class="task-project">${this.escapeHtml(project?.name || 'Без проекта')}</div>
                <div class="task-assignees">${assigneesHtml}</div>
            </div>
        `;
        
        // Показываем кнопки при наведении
        card.addEventListener('mouseenter', () => {
            const actions = card.querySelector('.task-actions');
            if (actions) actions.style.opacity = '1';
        });
        
        card.addEventListener('mouseleave', () => {
            const actions = card.querySelector('.task-actions');
            if (actions) actions.style.opacity = '0';
        });
        
        return card;
    }

    manageTaskAssignees(taskId) {
        this.currentEditingTaskId = taskId;
        const task = this.tasks.find(t => t.id === taskId);
        if (!task) return;
        
        // Заполняем модальное окно
        document.getElementById('taskAssigneesTitle').textContent = task.title;
        
        // Текущие участники
        const currentList = document.getElementById('currentAssigneesList');
        currentList.innerHTML = '';
        
        if (task.assignees && task.assignees.length > 0) {
            task.assignees.forEach(assigneeId => {
                const user = this.users.find(u => u.id === assigneeId);
                if (user) {
                    const item = document.createElement('div');
                    item.className = 'current-assignee-item';
                    item.innerHTML = `
                        <div class="assignee-info">
                            <div class="assignee-avatar">${user.username.charAt(0).toUpperCase()}</div>
                            <span>${user.username}</span>
                        </div>
                        <button class="btn btn-sm btn-danger" onclick="app.removeAssignee(${assigneeId})" title="Удалить">
                            <i class="fas fa-times"></i>
                        </button>
                    `;
                    currentList.appendChild(item);
                }
            });
        } else {
            currentList.innerHTML = '<p class="text-center">Нет назначенных участников</p>';
        }
        
        // Доступные участники
        const availableList = document.getElementById('availableAssigneesList');
        availableList.innerHTML = '';
        
        const availableUsers = this.users.filter(u => 
            !task.assignees || !task.assignees.includes(u.id)
        );
        
        availableUsers.forEach(user => {
            const item = document.createElement('div');
            item.className = 'assignee-item';
            
            const permissions = user.permissions || {};
            const skills = [];
            if (permissions.canDevelop) skills.push('Разработка');
            if (permissions.canReview) skills.push('Проверка');
            if (permissions.canDeploy) skills.push('Деплой');
            
            item.innerHTML = `
                <input type="checkbox" class="available-assignee-checkbox" value="${user.id}">
                <div>
                    <strong>${user.username}</strong>
                    <div style="font-size: 12px; color: #666;">${skills.join(', ') || 'Базовые права'}</div>
                </div>
            `;
            availableList.appendChild(item);
        });
        
        this.showModal('taskAssigneesModal');
    }

    removeAssignee(assigneeId) {
        const task = this.tasks.find(t => t.id === this.currentEditingTaskId);
        if (task && task.assignees) {
            task.assignees = task.assignees.filter(id => id !== assigneeId);
        }
        this.manageTaskAssignees(this.currentEditingTaskId); // Обновляем отображение
    }

    async saveTaskAssignees() {
        const task = this.tasks.find(t => t.id === this.currentEditingTaskId);
        if (!task) return;
        
        // Получаем текущих участников
        let currentAssignees = task.assignees || [];
        
        // Добавляем новых участников
        const newAssignees = Array.from(document.querySelectorAll('.available-assignee-checkbox:checked'))
            .map(cb => parseInt(cb.value));
        
        const allAssignees = [...currentAssignees, ...newAssignees];
        
        try {
            const response = await this.apiCall(`/api/tasks/${this.currentEditingTaskId}/assign`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ user_ids: allAssignees })
            });

            if (response.ok) {
                this.closeModal('taskAssigneesModal');
                this.showNotification('Участники обновлены', 'success');
                // Real-time обновление произойдет автоматически через socket
            } else {
                const error = await response.json();
                this.showNotification(error.error || 'Ошибка обновления участников', 'error');
            }
        } catch (error) {
            this.showNotification('Ошибка соединения с сервером', 'error');
        }
    }

    async showTaskComments(taskId) {
        this.currentCommentingTaskId = taskId;
        const task = this.tasks.find(t => t.id === taskId);
        if (!task) return;
        
        document.getElementById('taskCommentsTitle').textContent = task.title;
        await this.loadTaskComments(taskId);
        this.showModal('taskCommentsModal');
    }

    async loadTaskComments(taskId) {
        try {
            const response = await this.apiCall(`/api/tasks/${taskId}/comments`);
            if (response.ok) {
                const comments = await response.json();
                this.renderTaskComments(comments);
            }
        } catch (error) {
            console.error('Error loading task comments:', error);
        }
    }

    renderTaskComments(comments) {
        const container = document.getElementById('taskCommentsList');
        container.innerHTML = '';
        
        if (comments.length === 0) {
            container.innerHTML = '<p class="text-center">Нет комментариев</p>';
            return;
        }
        
        comments.forEach(comment => {
            const item = document.createElement('div');
            item.className = 'comment-item';
            
            const date = new Date(comment.created_at).toLocaleString('ru-RU');
            
            item.innerHTML = `
                <div class="comment-header">
                    <div class="comment-avatar">${comment.username.charAt(0).toUpperCase()}</div>
                    <div class="comment-meta">
                        <strong>${this.escapeHtml(comment.username)}</strong>
                        <span class="comment-date">${date}</span>
                    </div>
                </div>
                <div class="comment-text">${this.escapeHtml(comment.comment)}</div>
            `;
            container.appendChild(item);
        });
        
        // Прокручиваем к последнему комментарию
        container.scrollTop = container.scrollHeight;
    }

    async addTaskComment() {
        const comment = document.getElementById('newTaskComment').value.trim();
        if (!comment) return;
        
        try {
            const response = await this.apiCall(`/api/tasks/${this.currentCommentingTaskId}/comments`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    comment
                })
            });

            if (response.ok) {
                document.getElementById('newTaskComment').value = '';
                // Real-time обновление произойдет автоматически через socket
            } else {
                const error = await response.json();
                this.showNotification(error.error || 'Ошибка добавления комментария', 'error');
            }
        } catch (error) {
            this.showNotification('Ошибка соединения с сервером', 'error');
        }
    }

    async archiveTask(taskId) {
        if (!confirm('Вы уверены, что хотите архивировать эту задачу?')) {
            return;
        }
        
        try {
            const response = await this.apiCall(`/api/tasks/${taskId}/archive`, {
                method: 'PATCH'
            });

            if (response.ok) {
                this.showNotification('Задача архивирована', 'success');
                // Real-time обновление произойдет автоматически через socket
            } else {
                const error = await response.json();
                this.showNotification(error.error || 'Ошибка архивирования задачи', 'error');
            }
        } catch (error) {
            this.showNotification('Ошибка соединения с сервером', 'error');
        }
    }

    async showArchivedTasks() {
        try {
            const response = await this.apiCall('/api/tasks/archived');
            if (response.ok) {
                const archivedTasks = await response.json();
                this.renderArchivedTasks(archivedTasks);
                this.showModal('archiveModal');
            }
        } catch (error) {
            console.error('Error loading archived tasks:', error);
        }
    }

    renderArchivedTasks(tasks) {
        const container = document.getElementById('archivedTasksList');
        container.innerHTML = '';
        
        if (tasks.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-archive"></i>
                    <h3>Нет архивированных задач</h3>
                </div>
            `;
            return;
        }
        
        tasks.forEach(task => {
            const item = document.createElement('div');
            item.className = 'archived-task-item';
            
            const project = this.projects.find(p => p.id === task.project_id);
            const deadline = new Date(task.deadline).toLocaleDateString('ru-RU');
            
            item.innerHTML = `
                <div class="archived-task-header">
                    <h4>${this.escapeHtml(task.title)}</h4>
                    <div class="archived-task-actions">
                        <button class="btn btn-sm btn-secondary" onclick="app.unarchiveTask(${task.id})" title="Восстановить">
                            <i class="fas fa-undo"></i>
                        </button>
                    </div>
                </div>
                <div class="archived-task-meta">
                    <span>Проект: ${this.escapeHtml(project?.name || 'Без проекта')}</span>
                    <span>Дедлайн: ${deadline}</span>
                </div>
                <div class="archived-task-description">${this.escapeHtml(task.description)}</div>
            `;
            container.appendChild(item);
        });
    }

    async unarchiveTask(taskId) {
        try {
            const response = await this.apiCall(`/api/tasks/${taskId}/unarchive`, {
                method: 'PATCH'
            });

            if (response.ok) {
                this.showArchivedTasks(); // Обновляем список архива
                this.showNotification('Задача восстановлена', 'success');
                // Real-time обновление произойдет автоматически через socket
            } else {
                const error = await response.json();
                this.showNotification(error.error || 'Ошибка восстановления задачи', 'error');
            }
        } catch (error) {
            this.showNotification('Ошибка соединения с сервером', 'error');
        }
    }

    getPriorityText(priority) {
        const priorities = {
            low: 'Низкий',
            medium: 'Средний',
            high: 'Высокий'
        };
        return priorities[priority] || priority;
    }

    setupDragAndDrop() {
        const cards = document.querySelectorAll('.task-card');
        const columns = document.querySelectorAll('.column-content');
        
        cards.forEach(card => {
            const taskId = parseInt(card.dataset.taskId);
            const task = this.tasks.find(t => t.id === taskId);
            
            // Проверяем, может ли пользователь перетаскивать эту задачу
            const canDrag = this.canUserDragTask(task);
            card.draggable = canDrag;
            
            if (!canDrag) {
                card.style.cursor = 'default';
                card.style.opacity = '0.7';
            }
            
            card.addEventListener('dragstart', (e) => {
                if (!canDrag) {
                    e.preventDefault();
                    return;
                }
                e.dataTransfer.setData('text/plain', card.dataset.taskId);
                card.classList.add('dragging');
            });
            
            card.addEventListener('dragend', () => {
                card.classList.remove('dragging');
            });
        });
        
        columns.forEach(column => {
            column.addEventListener('dragover', (e) => {
                e.preventDefault();
                column.classList.add('drag-over');
            });
            
            column.addEventListener('dragleave', () => {
                column.classList.remove('drag-over');
            });
            
            column.addEventListener('drop', async (e) => {
                e.preventDefault();
                column.classList.remove('drag-over');
                
                const taskId = parseInt(e.dataTransfer.getData('text/plain'));
                const newStatus = column.id.replace('-tasks', '');
                
                // Используем debounced версию
                this.debounceUpdateTaskStatus(taskId, newStatus);
            });
        });
    }

    canUserDragTask(task) {
        // Админы и менеджеры могут перетаскивать любые задачи
        if (this.currentUser.permissions.canManageTasks || this.currentUser.role === 'admin') {
            return true;
        }
        
        // Пользователи могут перетаскивать только назначенные им задачи
        return task.assignees && task.assignees.includes(this.currentUser.id);
    }

    async deleteProject(projectId) {
        if (!confirm('Вы уверены, что хотите удалить этот проект? Все связанные задачи также будут удалены.')) {
            return;
        }
        
        try {
            const response = await this.apiCall(`/api/projects/${projectId}`, {
                method: 'DELETE'
            });

            if (response.ok) {
                this.showNotification('Проект удален', 'success');
                // Real-time обновление произойдет автоматически через socket
            } else {
                const error = await response.json();
                this.showNotification(error.error || 'Ошибка удаления проекта', 'error');
            }
        } catch (error) {
            this.showNotification('Ошибка соединения с сервером', 'error');
        }
    }

    async deleteTask(taskId) {
        if (!confirm('Вы уверены, что хотите удалить эту задачу?')) {
            return;
        }
        
        try {
            const response = await this.apiCall(`/api/tasks/${taskId}`, {
                method: 'DELETE'
            });

            if (response.ok) {
                this.showNotification('Задача удалена', 'success');
                // Real-time обновление произойдет автоматически через socket
            } else {
                const error = await response.json();
                this.showNotification(error.error || 'Ошибка удаления задачи', 'error');
            }
        } catch (error) {
            this.showNotification('Ошибка соединения с сервером', 'error');
        }
    }

    async createProject(e) {
        e.preventDefault();
        
        const name = document.getElementById('projectName').value;
        const description = document.getElementById('projectDescription').value;
        
        try {
            const response = await this.apiCall('/api/projects', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ name, description })
            });

            if (response.ok) {
                this.closeModal('projectModal');
                this.showNotification('Проект создан успешно!', 'success');
                
                // Очищаем форму
                document.getElementById('projectForm').reset();
                
                // Real-time обновление произойдет автоматически через socket
            } else {
                const error = await response.json();
                this.showNotification(error.error || 'Ошибка создания проекта', 'error');
            }
        } catch (error) {
            this.showNotification('Ошибка соединения с сервером', 'error');
        }
    }

    async createOverkillProject(e) {
        e.preventDefault();
        
        const name = document.getElementById('overkillProjectName').value;
        const description = document.getElementById('overkillProjectDescription').value;
        const project_link = document.getElementById('overkillProjectLink').value;
        
        try {
            const response = await this.apiCall('/api/overkill-projects', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ name, description, project_link })
            });

            if (response.ok) {
                this.closeModal('overkillProjectModal');
                this.showNotification('Проект Overkill создан успешно!', 'success');
                
                // Очищаем форму
                document.getElementById('overkillProjectForm').reset();
                
                // Real-time обновление произойдет автоматически через socket
            } else {
                const error = await response.json();
                this.showNotification(error.error || 'Ошибка создания проекта Overkill', 'error');
            }
        } catch (error) {
            this.showNotification('Ошибка соединения с сервером', 'error');
        }
    }

    async deleteOverkillProject(projectId) {
        if (!confirm('Вы уверены, что хотите удалить этот проект Overkill?')) {
            return;
        }
        
        try {
            const response = await this.apiCall(`/api/overkill-projects/${projectId}`, {
                method: 'DELETE'
            });

            if (response.ok) {
                this.showNotification('Проект Overkill удален', 'success');
                // Real-time обновление произойдет автоматически через socket
            } else {
                const error = await response.json();
                this.showNotification(error.error || 'Ошибка удаления проекта Overkill', 'error');
            }
        } catch (error) {
            this.showNotification('Ошибка соединения с сервером', 'error');
        }
    }

    async createTask(e) {
        e.preventDefault();
        
        const title = document.getElementById('taskTitle').value;
        const goal = document.getElementById('taskGoal').value;
        const description = document.getElementById('taskDescription').value;
        const project_id = document.getElementById('taskProject').value ? parseInt(document.getElementById('taskProject').value) : null;
        const overkill_project_id = document.getElementById('taskOverkillProject').value ? parseInt(document.getElementById('taskOverkillProject').value) : null;
        const project_link = document.getElementById('taskProjectLink').value;
        const deadline = document.getElementById('taskDeadline').value;
        const priority = document.getElementById('taskPriority').value;
        
        const assignees = Array.from(document.querySelectorAll('.assignee-checkbox:checked'))
            .map(cb => parseInt(cb.value));
        
        try {
            const response = await this.apiCall('/api/tasks', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    title,
                    goal,
                    description,
                    project_id,
                    overkill_project_id,
                    project_link,
                    deadline,
                    priority,
                    assignees
                })
            });

            if (response.ok) {
                this.closeModal('taskModal');
                this.showNotification('Задача создана успешно!', 'success');
                
                // Очищаем форму
                document.getElementById('taskForm').reset();
                document.querySelectorAll('.assignee-checkbox').forEach(cb => cb.checked = false);
                
                // Real-time обновление произойдет автоматически через socket
            } else {
                const error = await response.json();
                this.showNotification(error.error || 'Ошибка создания задачи', 'error');
            }
        } catch (error) {
            this.showNotification('Ошибка соединения с сервером', 'error');
        }
    }

    showModal(modalId) {
        const modal = document.getElementById(modalId);
        modal.classList.add('show');
        
        // Фокус на первое поле ввода
        setTimeout(() => {
            const firstInput = modal.querySelector('input, select, textarea');
            if (firstInput) firstInput.focus();
        }, 100);
    }

    closeModal(modalId) {
        document.getElementById(modalId).classList.remove('show');
    }

    showNotification(message, type = 'success') {
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        
        const icons = {
            success: 'fas fa-check-circle',
            error: 'fas fa-exclamation-triangle',
            warning: 'fas fa-exclamation-circle',
            info: 'fas fa-info-circle'
        };
        
        notification.innerHTML = `
            <i class="${icons[type]}"></i>
            ${this.escapeHtml(message)}
        `;
        
        document.body.appendChild(notification);
        
        // Показываем уведомление
        setTimeout(() => notification.classList.add('show'), 100);
        
        // Скрываем и удаляем
        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => notification.remove(), 300);
        }, 4000);
    }

    async apiCall(url, options = {}) {
        const defaultOptions = {
            headers: {
                'Authorization': `Bearer ${this.token}`,
                ...options.headers
            }
        };
        
        return fetch(url, { ...options, ...defaultOptions });
    }

    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Глобальные функции для использования в HTML
window.closeModal = function(modalId) {
    if (window.app) {
        window.app.closeModal(modalId);
    }
};

// Инициализация приложения
document.addEventListener('DOMContentLoaded', () => {
    window.app = new TaskFlowApp();
});
