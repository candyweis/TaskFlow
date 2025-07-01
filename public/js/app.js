class TaskFlowApp {
    constructor() {
        this.currentUser = null;
        this.token = localStorage.getItem('taskflow_token');
        this.projects = [];
        this.overleafProjects = [];
        this.tasks = [];
        this.users = [];
        this.colleagues = [];
        this.currentSection = 'projects';
        this.socket = null;
        this.currentEditingTaskId = null;
        this.currentCommentingTaskId = null;
        this.currentViewingTaskId = null;
        this.filteredColleagues = [];
        this.filteredUsers = [];
        this.filteredAssignees = [];
        this.updateTaskStatusDebounce = new Map();
        this.isUpdatingTasks = false;
        this.isMobile = this.detectMobileDevice();
        this.taskStatuses = ['unassigned', 'in_progress', 'developed', 'review', 'deploy', 'done'];
        this.statusNames = {
            unassigned: 'Неразобранные',
            in_progress: 'В работе', 
            developed: 'Техарь',
            review: 'На проверке',
            deploy: 'Загружать',
            done: 'Готово'
        };
        
        this.init();
    }

    detectMobileDevice() {
        return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || 
               window.innerWidth <= 768;
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
            this.socket.emit('join_general');
        });

        this.socket.on('disconnect', () => {
            console.log('❌ Socket disconnected');
        });

        // ========== REAL-TIME СОБЫТИЯ ==========
        
        // новый проект создан
        this.socket.on('project_created', (data) => {
            console.log('📁 New project created:', data);
            this.projects.push(data.project);
            this.populateSelects();
            this.renderProjects();
            this.showNotification(`Новый проект "${data.project.name}" создан пользователем ${data.createdBy.username}`, 'info');
        });

        // проект обновлен
        this.socket.on('project_updated', (data) => {
            console.log('📁 Project updated:', data);
            const index = this.projects.findIndex(p => p.id === data.project.id);
            if (index !== -1) {
                this.projects[index] = data.project;
            }
            this.populateSelects();
            this.renderProjects();
            this.showNotification(`Проект "${data.project.name}" обновлен пользователем ${data.updatedBy.username}`, 'info');
        });

        // проект удален
        this.socket.on('project_deleted', (data) => {
            console.log('🗑️ Project deleted:', data);
            this.projects = this.projects.filter(p => p.id !== data.projectId);
            this.populateSelects();
            this.renderProjects();
            this.showNotification(`Проект удален пользователем ${data.deletedBy.username}`, 'warning');
        });

        // Overleaf проект создан
        this.socket.on('overleaf_project_created', (data) => {
            console.log('📁 New Overleaf project created:', data);
            this.overleafProjects.push(data.project);
            this.populateSelects();
            this.showNotification(`Новый проект Overleaf "${data.project.name}" создан пользователем ${data.createdBy.username}`, 'info');
        });

        // Overleaf проект обновлен
        this.socket.on('overleaf_project_updated', (data) => {
            console.log('📁 Overleaf project updated:', data);
            const index = this.overleafProjects.findIndex(p => p.id === data.project.id);
            if (index !== -1) {
                this.overleafProjects[index] = data.project;
            }
            this.populateSelects();
            this.showNotification(`Проект Overleaf "${data.project.name}" обновлен пользователем ${data.updatedBy.username}`, 'info');
        });

        // Overleaf проект удален
        this.socket.on('overleaf_project_deleted', (data) => {
            console.log('🗑️ Overleaf project deleted:', data);
            this.overleafProjects = this.overleafProjects.filter(p => p.id !== data.projectId);
            this.populateSelects();
            this.showNotification(`Проект Overleaf удален пользователем ${data.deletedBy.username}`, 'warning');
        });

        // новая задача создана
        this.socket.on('task_created', (data) => {
            console.log('📋 New task created:', data);
            this.tasks.push(data.task);
            this.renderBoard();
            
            if (data.createdBy.id !== this.currentUser.id) {
                this.showNotification(`Новая задача "${data.task.title}" создана пользователем ${data.createdBy.username}`, 'info');
            }
        });

        // статус задачи изменен
        this.socket.on('task_status_changed', (data) => {
            console.log('🔄 Task status changed:', data);
            
            const taskIndex = this.tasks.findIndex(t => t.id === data.task.id);
            if (taskIndex !== -1) {
                this.tasks[taskIndex] = data.task;
            }
            
            this.renderBoard();
            
            if (data.changedBy.id !== this.currentUser.id) {
                const statusTexts = {
                    unassigned: 'Неразобранные',
                    in_progress: 'В работе',
                    developed: 'Техарь',
                    review: 'На проверке',
                    deploy: 'Загружать',
                    done: 'Готово',
                    archived: 'Архивировано'
                };
                
                this.showNotification(
                    `Задача "${data.task.title}" перемещена в "${statusTexts[data.newStatus]}" пользователем ${data.changedBy.username}`, 
                    'info'
                );
            }

            // обновляем модальное окно просмотра если оно открыто
            if (this.currentViewingTaskId === data.task.id) {
                this.showTaskDetails(data.task.id);
            }
        });

        // назначения задачи изменены
        this.socket.on('task_assignees_changed', (data) => {
            console.log('👥 Task assignees changed:', data);
            
            const taskIndex = this.tasks.findIndex(t => t.id === data.task.id);
            if (taskIndex !== -1) {
                this.tasks[taskIndex] = data.task;
            }
            
            this.renderBoard();
            
            const wasAssigned = data.oldAssignees.includes(this.currentUser.id);
            const isAssigned = data.newAssignees.includes(this.currentUser.id);
            
            if (!wasAssigned && isAssigned) {
                this.showNotification(`Вас назначили на задачу "${data.task.title}"`, 'success');
            } else if (wasAssigned && !isAssigned) {
                this.showNotification(`Вас сняли с задачи "${data.task.title}"`, 'warning');
            } else if (data.changedBy.id !== this.currentUser.id) {
                this.showNotification(`Участники задачи "${data.task.title}" изменены`, 'info');
            }

            // обновляем модальное окно просмотра если оно открыто
            if (this.currentViewingTaskId === data.task.id) {
                this.showTaskDetails(data.task.id);
            }
        });

        // задача удалена
        this.socket.on('task_deleted', (data) => {
            console.log('🗑️ Task deleted:', data);
            this.tasks = this.tasks.filter(t => t.id !== data.taskId);
            this.renderBoard();
            
            if (data.deletedBy.id !== this.currentUser.id) {
                this.showNotification(`Задача удалена пользователем ${data.deletedBy.username}`, 'warning');
            }

            // закрываем модальное окно если была удалена просматриваемая задача
            if (this.currentViewingTaskId === data.taskId) {
                this.closeModal('taskViewModal');
                this.currentViewingTaskId = null;
            }
        });

        // новый комментарий к задаче
        this.socket.on('task_comment_added', (data) => {
            console.log('💬 Task comment added:', data);
            
            if (this.currentCommentingTaskId === data.taskId && data.comment.user_id !== this.currentUser.id) {
                this.loadTaskComments(data.taskId);
            }
            
            if (data.comment.user_id !== this.currentUser.id) {
                const task = this.tasks.find(t => t.id === data.taskId);
                const taskTitle = task ? task.title : 'задаче';
                this.showNotification(`Новый комментарий к ${taskTitle} от ${data.comment.username}`, 'info');
            }
        });

        // разделение задачи
        this.socket.on('task_split', (data) => {
            console.log('✂️ Task split:', data);
            // перезагружаем задачи для обновления
            this.loadTasks().then(() => {
                this.renderBoard();
                if (data.splitBy.id !== this.currentUser.id) {
                    this.showNotification(`Задача разделена на подзадачи пользователем ${data.splitBy.username}`, 'info');
                }
            });
        });
    }

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

    debounceUpdateTaskStatus(taskId, newStatus, delay = 300) {
        if (this.updateTaskStatusDebounce.has(taskId)) {
            clearTimeout(this.updateTaskStatusDebounce.get(taskId));
        }

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

        // Показываем учет времени при переносе в ЛЮБУЮ колонку (кроме исходной)
        const task = this.tasks.find(t => t.id === taskId);
        if (task && task.status !== newStatus && window.timeTracking) {
            console.log('🕐 Showing time tracking for task status change:', { from: task.status, to: newStatus });
            window.timeTracking.show(taskId, task, newStatus);
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
                const taskIndex = this.tasks.findIndex(t => t.id === taskId);
                if (taskIndex !== -1) {
                    this.tasks[taskIndex].status = newStatus;
                }
                
                this.renderBoard();
                
                this.sendUserActivity('move_task', {
                    taskId,
                    newStatus,
                    taskTitle: this.tasks.find(t => t.id === taskId)?.title
                });
                
            } else {
                const error = await response.json();
                this.showNotification(error.error || 'Ошибка обновления статуса', 'error');
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
        // авторизация
        document.getElementById('authForm').addEventListener('submit', (e) => this.handleAuth(e));
        
        // навигация
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.addEventListener('click', () => this.switchSection(btn.dataset.section));
        });
        
        // кнопки
        document.getElementById('logoutBtn').addEventListener('click', () => this.logout());
        document.getElementById('addProjectBtn').addEventListener('click', () => this.showModal('projectModal'));
        document.getElementById('addTaskBtn').addEventListener('click', () => this.showModal('taskModal'));
        document.getElementById('viewArchivedBtn').addEventListener('click', () => this.showArchivedTasks());
        
        // поиск и фильтрация коллег
        document.getElementById('searchColleagues').addEventListener('input', (e) => this.filterColleagues());
        document.getElementById('roleFilter').addEventListener('change', (e) => this.filterColleagues());
        
        // поиск пользователей в модальных окнах
        const userSearchInput = document.getElementById('userSearchInput');
        if (userSearchInput) {
            userSearchInput.addEventListener('input', (e) => this.filterUsers());
        }
        
        const taskUserSearchInput = document.getElementById('taskUserSearchInput');
        if (taskUserSearchInput) {
            taskUserSearchInput.addEventListener('input', (e) => this.filterTaskUsers());
        }
        
        // формы
        document.getElementById('projectForm').addEventListener('submit', (e) => this.createProject(e));
        document.getElementById('taskForm').addEventListener('submit', (e) => this.createTask(e));
        document.getElementById('saveTaskAssignees').addEventListener('click', () => this.saveTaskAssignees());
        document.getElementById('addTaskComment').addEventListener('click', () => this.addTaskComment());
        
        // кнопки в модальном окне просмотра задачи
        document.getElementById('taskEditAssignees').addEventListener('click', () => this.manageTaskAssignees(this.currentViewingTaskId));
        document.getElementById('taskViewComments').addEventListener('click', () => this.showTaskComments(this.currentViewingTaskId));
        document.getElementById('taskArchiveBtn').addEventListener('click', () => this.archiveTask(this.currentViewingTaskId));
        document.getElementById('taskDeleteBtn').addEventListener('click', () => this.deleteTask(this.currentViewingTaskId));
        
        // табы в формах
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => this.switchTab(e));
        });
        
        // закрытие модальных окон
        document.querySelectorAll('.close').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                const modalId = btn.getAttribute('data-modal') || btn.closest('.modal').id;
                this.closeModal(modalId);
            });
        });

        // кнопки закрытия через data-close-modal
        document.querySelectorAll('[data-close-modal]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                const modalId = btn.getAttribute('data-close-modal');
                this.closeModal(modalId);
            });
        });

        // клик вне модального окна
        document.querySelectorAll('.modal').forEach(modal => {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    this.closeModal(modal.id);
                }
            });
        });
        
        // фильтр проектов
        document.getElementById('projectFilter').addEventListener('change', () => this.renderBoard());

        // установка минимальной даты дедлайна на текущее время
        this.setMinDeadlineDate();

        // обновляем при изменении размера окна
        window.addEventListener('resize', () => {
            const wasMobile = this.isMobile;
            this.isMobile = this.detectMobileDevice();
            
            // если изменился тип устройства, перерисовываем доску
            if (wasMobile !== this.isMobile) {
                this.renderBoard();
            }
        });
    }

    switchTab(e) {
        e.preventDefault();
        const btn = e.target;
        const container = btn.closest('.assignees-container, .assignees-management');
        const tabName = btn.dataset.tab;
        
        // обновляем активные кнопки
        container.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        // показываем соответствующий контент
        container.querySelectorAll('.tab-content').forEach(content => {
            content.classList.toggle('active', content.id === tabName + '-tab');
        });
    }

    setMinDeadlineDate() {
        const deadlineInput = document.getElementById('taskDeadline');
        if (deadlineInput) {
            const now = new Date();
            now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
            deadlineInput.min = now.toISOString().slice(0, 16);
            
            // устанавливаем значение по умолчанию через неделю
            const defaultDate = new Date();
            defaultDate.setDate(defaultDate.getDate() + 7);
            defaultDate.setMinutes(defaultDate.getMinutes() - defaultDate.getTimezoneOffset());
            deadlineInput.value = defaultDate.toISOString().slice(0, 16);
        }
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
        
        if (this.currentUser.role === 'admin') {
            document.getElementById('adminLink').style.display = 'flex';
        }
        
        this.updateUI();
        this.loadData();
        this.initSocket();
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
        
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.section === section);
        });
        
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
            this.loadOverleafProjects(),
            this.loadTasks(),
            this.loadUsers()
        ]);
        
        this.populateSelects();
        this.renderProjects();
        this.renderBoard();
    }

    async loadColleaguesData() {
        await this.loadColleagues();
        this.renderColleagues();
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

    async loadOverleafProjects() {
        try {
            const response = await this.apiCall('/api/overleaf-projects');
            if (response.ok) {
                this.overleafProjects = await response.json();
            }
        } catch (error) {
            console.error('Error loading overleaf projects:', error);
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
                this.filteredUsers = [...this.users];
                this.filteredAssignees = [...this.users];
            }
        } catch (error) {
            // если нет прав, ничего не делаем
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

    filterUsers() {
        const searchTerm = document.getElementById('userSearchInput').value.toLowerCase();
        const task = this.tasks.find(t => t.id === this.currentEditingTaskId);
        
        const availableUsers = this.users.filter(u => 
            (!task || !task.assignees || !task.assignees.includes(u.id)) &&
            u.username.toLowerCase().includes(searchTerm)
        );
        
        this.renderAvailableUsers(availableUsers);
    }

    filterTaskUsers() {
        const searchTerm = document.getElementById('taskUserSearchInput').value.toLowerCase();
        
        this.filteredAssignees = this.users.filter(u => 
            u.username.toLowerCase().includes(searchTerm)
        );
        
        this.renderTaskAssignees();
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
            if (permissions.canDevelop) skills.push('Техарь');
            if (permissions.canReview) skills.push('Проверка');
            if (permissions.canDeploy) skills.push('Загружать');
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
                    ${colleague.vk ? `
                        <div class="contact-item">
                            <i class="fab fa-vk"></i>
                            <a href="https://vk.com/${colleague.vk.replace('@', '').replace('vk.com/', '')}" target="_blank">
                                ${colleague.vk}
                            </a>
                        </div>
                    ` : ''}
                    ${!colleague.telegram && !colleague.phone && !colleague.vk ? `
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

    populateSelects() {
        // заполняем селект проектов
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

        // заполняем селект Overleaf проектов
        const overleafSelect = document.getElementById('taskOverleafProject');
        if (overleafSelect) {
            const currentValue = overleafSelect.value;
            overleafSelect.innerHTML = '<option value="">Выберите проект Overleaf (опционально)</option>';
            
            this.overleafProjects.forEach(project => {
                const option = document.createElement('option');
                option.value = project.id;
                option.textContent = project.name;
                overleafSelect.appendChild(option);
            });
            
            overleafSelect.value = currentValue;
        }
        
        this.populateAssignees();
    }

    populateAssignees() {
        this.renderTaskAssignees();
    }

    renderTaskAssignees() {
        const assigneesList = document.getElementById('assigneesList');
        if (!assigneesList) return;
        
        const workers = this.filteredAssignees.filter(u => u.role === 'worker' || u.role === 'manager');
        
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
            if (permissions.canDevelop) skills.push('Техарь');
            if (permissions.canReview) skills.push('Проверка');
            if (permissions.canDeploy) skills.push('Загружать');
            
            item.innerHTML = `
                <div class="assignee-checkbox-container">
                    <input type="checkbox" class="assignee-checkbox" value="${user.id}">
                </div>
                <div class="assignee-info">
                    <div class="assignee-avatar">${user.username.charAt(0).toUpperCase()}</div>
                    <div class="assignee-details">
                        <strong>${user.username}</strong>
                        <div class="assignee-skills">${skills.join(', ') || 'Базовые права'}</div>
                    </div>
                </div>
            `;
            assigneesList.appendChild(item);
        });
    }

    renderAvailableUsers(users) {
        const availableList = document.getElementById('availableAssigneesList');
        availableList.innerHTML = '';
        
        users.forEach(user => {
            const item = document.createElement('div');
            item.className = 'assignee-item-with-role';
            
            const permissions = user.permissions || {};
            const skills = [];
            if (permissions.canDevelop) skills.push('Техарь');
            if (permissions.canReview) skills.push('Проверка');
            if (permissions.canDeploy) skills.push('Загружать');
            
            item.innerHTML = `
                <div class="assignee-checkbox-container">
                    <input type="checkbox" class="available-assignee-checkbox" value="${user.id}">
                </div>
                <div class="assignee-info">
                    <div class="assignee-avatar">${user.username.charAt(0).toUpperCase()}</div>
                    <div class="assignee-details">
                        <strong>${user.username}</strong>
                        <div class="assignee-skills">${skills.join(', ') || 'Базовые права'}</div>
                    </div>
                </div>
                <div class="role-selector">
                    <select class="user-role-select" data-user-id="${user.id}">
                        <option value="">Без роли</option>
                        <option value="tech">Техарь</option>
                        <option value="review">Проверка</option>
                        <option value="deploy">Загружать</option>
                    </select>
                </div>
            `;
            availableList.appendChild(item);
        });
    }

    renderProjects() {
        const container = document.getElementById('projectsList');
        container.className = 'projects-grid';
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
            
            const permissions = this.currentUser.permissions;
            const canManageProjects = permissions.canManageProjects || permissions.canManageTasks || this.currentUser.role === 'admin';
            
            const actionsHtml = canManageProjects ? `
                <div class="project-actions">
                    <button class="btn btn-sm btn-secondary" onclick="app.editProject(${project.id})" title="Редактировать проект">
                        <i class="fas fa-edit"></i>
                    </button>
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
        card.className = `task-card ${this.isMobile ? 'mobile-task-card' : ''}`;
        card.draggable = !this.isMobile; // отключаем drag на мобильных
        card.dataset.taskId = task.id;
        
        // клик по карточке для открытия деталей
        card.addEventListener('click', (e) => {
            if (!e.target.closest('.task-actions') && 
                !e.target.closest('.mobile-task-controls') && 
                !e.target.closest('button') &&
                !e.target.closest('.task-context-menu')) {
                this.showTaskDetails(task.id);
            }
        });
        
        // создаем аватары исполнителей
        const assigneesHtml = (task.assignees || []).map(assigneeId => {
            const user = this.users.find(u => u.id === assigneeId);
            return `<div class="assignee-avatar" title="${user?.username || 'Неизвестный пользователь'}">${user?.username.charAt(0).toUpperCase() || '?'}</div>`;
        }).join('');
        
        // кнопки управления
        const isAssigned = task.assignees && task.assignees.includes(this.currentUser.id);
        const canManage = this.currentUser.permissions.canManageTasks || this.currentUser.role === 'admin' || this.currentUser.role === 'manager';
        
        // отображение сложности
        const complexityTexts = {
            easy: '🟢 Легкая',
            medium: '🟡 Средняя',
            hard: '🟠 Сложная',
            expert: '🔴 Эксперт'
        };
        
        const complexityHtml = task.complexity ? `
            <div class="task-complexity">
                <span class="complexity-badge complexity-${task.complexity}">
                    ${complexityTexts[task.complexity] || task.complexity}
                </span>
            </div>
        ` : '';

        // информация о подзадачах, если это родительская задача
        let subtasksHtml = '';
        if (task.subtasks_count && task.subtasks_count > 0) {
            subtasksHtml = `
                <div class="task-subtasks-info">
                    📝 ${task.subtasks_count} подзадач
                </div>
            `;
        }

        // информация о родительской задаче, если это подзадача
        let parentHtml = '';
        if (task.is_subtask && task.parent_task_title) {
            parentHtml = `
                <div class="task-parent-info">
                    🔗 Подзадача: ${task.parent_task_title}
                </div>
            `;
        }

        // контекстное меню
        const contextMenuHtml = `
            <div class="task-context-menu">
                <button class="context-menu-btn" onclick="app.showTaskContextMenu(event, ${task.id})">
                    ⋮
                </button>
                <div class="context-dropdown" id="context-${task.id}">
                    ${canManage ? `
                        <button class="dropdown-item" onclick="app.splitTask(${task.id}); app.hideContextMenu(${task.id})">
                            ✂️ Разделить задачу
                        </button>
                    ` : ''}
                    ${task.status === 'done' ? `
                        <button class="dropdown-item" onclick="app.showTimeTracking(${task.id}); app.hideContextMenu(${task.id})">
                            ⏱️ Добавить время
                        </button>
                    ` : ''}
                    <button class="dropdown-item" onclick="app.showTaskDetails(${task.id}); app.hideContextMenu(${task.id})">
                        👁️ Просмотреть
                    </button>
                    ${canManage ? `
                        <button class="dropdown-item" onclick="app.deleteTask(${task.id}); app.hideContextMenu(${task.id})">
                            🗑️ Удалить
                        </button>
                    ` : ''}
                </div>
            </div>
        `;
        
        const actionsHtml = `
            <div class="task-actions" style="${this.isMobile ? 'position: static; opacity: 1; display: flex; justify-content: center; margin-top: 8px; background: rgba(255,255,255,0.9); border-radius: 4px; padding: 4px;' : 'position: absolute; top: 8px; right: 8px; opacity: 0; transition: opacity 0.3s; display: flex; gap: 4px;'}">
                ${canManage ? `
                    <button class="btn btn-sm btn-danger" onclick="app.deleteTask(${task.id}); event.stopPropagation();" title="Удалить задачу">
                        <i class="fas fa-times"></i>
                    </button>
                ` : ''}
                <button class="btn btn-sm btn-secondary" onclick="app.manageTaskAssignees(${task.id}); event.stopPropagation();" title="Управление участниками">
                    <i class="fas fa-users"></i>
                </button>
                ${(isAssigned || canManage) ? `
                    <button class="btn btn-sm btn-info" onclick="app.showTaskComments(${task.id}); event.stopPropagation();" title="Комментарии">
                        <i class="fas fa-comments"></i>
                    </button>
                ` : ''}
                ${task.status === 'done' ? `
                    <button class="btn btn-sm btn-warning" onclick="app.archiveTask(${task.id}); event.stopPropagation();" title="Архивировать">
                        <i class="fas fa-archive"></i>
                    </button>
                ` : ''}
            </div>
        `;
        
        // мобильные стрелочки для перемещения
        const mobileControlsHtml = this.isMobile ? this.createMobileTaskControls(task) : '';
        
        // определяем какую ссылку показывать
        let linkHtml = '';
        if (task.overleaf_project_name && task.overleaf_project_link) {
            linkHtml = `
                <div class="task-project-link">
                    <a href="${task.overleaf_project_link}" target="_blank" onclick="event.stopPropagation();">
                        <i class="fas fa-external-link-alt"></i>
                        Overleaf: ${this.escapeHtml(task.overleaf_project_name)}
                    </a>
                </div>
            `;
        } else if (task.project_link) {
            linkHtml = `
                <div class="task-project-link">
                    <a href="${task.project_link}" target="_blank" onclick="event.stopPropagation();">
                        <i class="fas fa-external-link-alt"></i>
                        Ссылка на ресурс
                    </a>
                </div>
            `;
        }
        
        card.innerHTML = `
            ${contextMenuHtml}
            ${actionsHtml}
            <div class="task-title">${this.escapeHtml(task.title)}</div>
            ${task.goal ? `<div class="task-goal"><i class="fas fa-bullseye"></i> ${this.escapeHtml(task.goal)}</div>` : ''}
            ${complexityHtml}
            ${parentHtml}
            ${subtasksHtml}
            <div class="task-description">${this.escapeHtml(task.description)}</div>
            ${linkHtml}
            <div class="task-meta">
                <div class="task-deadline ${deadlineClass}">
                    <i class="fas fa-clock"></i>
                    ${deadline.toLocaleString('ru-RU')}
                </div>
                <div class="priority-badge priority-${task.priority}">
                    ${this.getPriorityText(task.priority)}
                </div>
            </div>
            <div class="task-footer">
                <div class="task-project">${this.escapeHtml(project?.name || 'Без проекта')}</div>
                <div class="task-assignees">${assigneesHtml}</div>
            </div>
            ${mobileControlsHtml}
        `;
        
        // показываем кнопки при наведении только на десктопе
        if (!this.isMobile) {
            card.addEventListener('mouseenter', () => {
                const actions = card.querySelector('.task-actions');
                if (actions) actions.style.opacity = '1';
            });
            
            card.addEventListener('mouseleave', () => {
                const actions = card.querySelector('.task-actions');
                if (actions) actions.style.opacity = '0';
            });
        }
        
        return card;
    }

    showTaskContextMenu(event, taskId) {
        event.stopPropagation();
        
        // скрываем все открытые меню
        document.querySelectorAll('.context-dropdown').forEach(menu => {
            menu.classList.remove('show');
        });
        
        // показываем нужное меню
        const menu = document.getElementById(`context-${taskId}`);
        if (menu) {
            menu.classList.add('show');
            
            // закрываем меню при клике вне его
            setTimeout(() => {
                document.addEventListener('click', () => this.hideContextMenu(taskId), { once: true });
            }, 100);
        }
    }

    hideContextMenu(taskId) {
        const menu = document.getElementById(`context-${taskId}`);
        if (menu) {
            menu.classList.remove('show');
        }
    }

    showTimeTracking(taskId, taskData = null) {
        if (!taskData) {
            taskData = this.tasks.find(t => t.id === taskId);
        }
        
        if (!taskData) {
            this.showNotification('Задача не найдена', 'error');
            return;
        }
        
        if (window.timeTracking) {
            window.timeTracking.show(taskId, taskData);
        }
    }

    splitTask(taskId) {
        const taskData = this.tasks.find(t => t.id === taskId);
        
        if (!taskData) {
            this.showNotification('Задача не найдена', 'error');
            return;
        }
        
        if (window.taskSplitting) {
            window.taskSplitting.show(taskId, taskData);
        }
    }

    createMobileTaskControls(task) {
        const currentStatusIndex = this.taskStatuses.indexOf(task.status);
        const canMoveLeft = currentStatusIndex > 0;
        const canMoveRight = currentStatusIndex < this.taskStatuses.length - 1;
        
        const canChangeStatus = this.currentUser.permissions.canManageTasks || 
                               this.currentUser.role === 'admin' ||
                               (task.assignees && task.assignees.includes(this.currentUser.id));
        
        if (!canChangeStatus) {
            return `
                <div class="mobile-task-controls">
                    <div class="mobile-task-status">
                        <i class="fas fa-info-circle"></i>
                        Статус: ${this.statusNames[task.status]}
                    </div>
                </div>
            `;
        }
        
        return `
            <div class="mobile-task-controls">
                <div class="mobile-task-status">
                    <i class="fas fa-exchange-alt"></i>
                    ${this.statusNames[task.status]}
                </div>
                <div class="mobile-task-arrows">
                    <button class="mobile-arrow-btn" 
                            onclick="app.moveTaskMobile(${task.id}, 'left'); event.stopPropagation();"
                            ${!canMoveLeft ? 'disabled' : ''}
                            title="Переместить назад">
                        <i class="fas fa-chevron-left"></i>
                    </button>
                    <button class="mobile-arrow-btn"
                            onclick="app.moveTaskMobile(${task.id}, 'right'); event.stopPropagation();"
                            ${!canMoveRight ? 'disabled' : ''}
                            title="Переместить вперед">
                        <i class="fas fa-chevron-right"></i>
                    </button>
                </div>
            </div>
        `;
    }

    async moveTaskMobile(taskId, direction) {
        const task = this.tasks.find(t => t.id === taskId);
        if (!task) return;
        
        const currentStatusIndex = this.taskStatuses.indexOf(task.status);
        let newStatusIndex;
        
        if (direction === 'left' && currentStatusIndex > 0) {
            newStatusIndex = currentStatusIndex - 1;
        } else if (direction === 'right' && currentStatusIndex < this.taskStatuses.length - 1) {
            newStatusIndex = currentStatusIndex + 1;
        } else {
            return; // нельзя переместить
        }
        
        const newStatus = this.taskStatuses[newStatusIndex];
        
        // показываем анимацию нажатия
        const button = event.target.closest('.mobile-arrow-btn');
        if (button) {
            button.style.transform = 'scale(0.9)';
            setTimeout(() => {
                button.style.transform = 'scale(1)';
            }, 150);
        }
        
        try {
            const response = await this.apiCall(`/api/tasks/${taskId}/status`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ status: newStatus })
            });

            if (response.ok) {
                // обновляем локально
                const taskIndex = this.tasks.findIndex(t => t.id === taskId);
                if (taskIndex !== -1) {
                    this.tasks[taskIndex].status = newStatus;
                }
                
                this.renderBoard();
                
                // показываем уведомление
                this.showNotification(`Задача перемещена в "${this.statusNames[newStatus]}"`, 'success');
                
            } else {
                const error = await response.json();
                this.showNotification(error.error || 'Ошибка перемещения задачи', 'error');
            }
        } catch (error) {
            this.showNotification('Ошибка соединения с сервером', 'error');
        }
    }

    async showTaskDetails(taskId) {
        try {
            const response = await this.apiCall(`/api/tasks/${taskId}`);
            if (!response.ok) return;
            
            const task = await response.json();
            this.currentViewingTaskId = taskId;
            
            // заполняем модальное окно
            document.getElementById('taskViewTitle').textContent = `Детали задачи #${task.id}`;
            document.getElementById('taskViewName').textContent = task.title;
            document.getElementById('taskViewPriority').innerHTML = `<span class="priority-badge priority-${task.priority}">${this.getPriorityText(task.priority)}</span>`;
            
            // цель
            const goalGroup = document.getElementById('taskViewGoalGroup');
            if (task.goal) {
                goalGroup.style.display = 'block';
                document.getElementById('taskViewGoal').textContent = task.goal;
            } else {
                goalGroup.style.display = 'none';
            }
            
            document.getElementById('taskViewDescription').textContent = task.description || 'Описание отсутствует';
            
            // проект
            const projectGroup = document.getElementById('taskViewProjectGroup');
            if (task.project_name) {
                projectGroup.style.display = 'block';
                document.getElementById('taskViewProject').textContent = task.project_name;
            } else {
                projectGroup.style.display = 'none';
            }
            
            // Overleaf проект
            const overleafGroup = document.getElementById('taskViewOverleafGroup');
            if (task.overleaf_project_name) {
                overleafGroup.style.display = 'block';
                const overleafContent = task.overleaf_project_link ? 
                    `<a href="${task.overleaf_project_link}" target="_blank">${task.overleaf_project_name}</a>` :
                    task.overleaf_project_name;
                document.getElementById('taskViewOverleaf').innerHTML = overleafContent;
            } else {
                overleafGroup.style.display = 'none';
            }
            
            // ссылка
            const linkGroup = document.getElementById('taskViewLinkGroup');
            if (task.project_link) {
                linkGroup.style.display = 'block';
                document.getElementById('taskViewLink').innerHTML = `<a href="${task.project_link}" target="_blank">${task.project_link}</a>`;
            } else {
                linkGroup.style.display = 'none';
            }
            
            document.getElementById('taskViewDeadline').textContent = new Date(task.deadline).toLocaleString('ru-RU');
            
            const statusTexts = {
                unassigned: 'Неразобранные',
                in_progress: 'В работе',
                developed: 'Техарь',
                review: 'На проверке',
                deploy: 'Загружать',
                done: 'Готово',
                archived: 'Архивировано'
            };
            document.getElementById('taskViewStatus').innerHTML = `<span class="status-badge status-${task.status}">${statusTexts[task.status]}</span>`;
            
            // исполнители
            const assigneesHtml = (task.assignees || []).map(assigneeId => {
                const user = this.users.find(u => u.id === assigneeId);
                return `<span class="assignee-tag">${user ? user.username : 'Неизвестный'}</span>`;
            }).join('');
            document.getElementById('taskViewAssignees').innerHTML = assigneesHtml || 'Не назначено';
            
            document.getElementById('taskViewCreator').textContent = task.created_by_name || 'Неизвестно';
            
            // кнопки действий
            const permissions = this.currentUser.permissions;
            const isAssigned = task.assignees && task.assignees.includes(this.currentUser.id);
            const canManage = permissions.canManageTasks || this.currentUser.role === 'admin' || this.currentUser.role === 'manager';
            
            document.getElementById('taskArchiveBtn').style.display = (task.status === 'done' && (canManage || isAssigned)) ? 'block' : 'none';
            document.getElementById('taskDeleteBtn').style.display = canManage ? 'block' : 'none';
            
            this.showModal('taskViewModal');
        } catch (error) {
            console.error('Error loading task details:', error);
            this.showNotification('Ошибка загрузки деталей задачи', 'error');
        }
    }

    editProject(projectId) {
        const project = this.projects.find(p => p.id === projectId);
        if (!project) return;
        
        document.getElementById('projectName').value = project.name;
        document.getElementById('projectDescription').value = project.description || '';
        
        // меняем заголовок и кнопку
        document.querySelector('#projectModal .modal-header h3').textContent = 'Редактировать проект';
        const form = document.getElementById('projectForm');
        form.dataset.editingId = projectId;
        
        this.showModal('projectModal');
    }

    manageTaskAssignees(taskId) {
        this.currentEditingTaskId = taskId;
        const task = this.tasks.find(t => t.id === taskId);
        if (!task) return;
        
        document.getElementById('taskAssigneesTitle').textContent = task.title;
        
        // очищаем поиск
        const searchInput = document.getElementById('userSearchInput');
        if (searchInput) {
            searchInput.value = '';
        }
        
        // текущие участники
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
        
        // доступные участники
        const availableUsers = this.users.filter(u => 
            !task.assignees || !task.assignees.includes(u.id)
        );
        this.renderAvailableUsers(availableUsers);
        
        // заполняем назначения по ролям
        const roleAssignments = task.role_assignments || {};
        document.querySelectorAll('.role-assignment-checkbox').forEach(checkbox => {
            checkbox.checked = roleAssignments[checkbox.value] || false;
        });
        
        this.showModal('taskAssigneesModal');
    }

    removeAssignee(assigneeId) {
        const task = this.tasks.find(t => t.id === this.currentEditingTaskId);
        if (task && task.assignees) {
            task.assignees = task.assignees.filter(id => id !== assigneeId);
        }
        this.manageTaskAssignees(this.currentEditingTaskId);
    }

    async saveTaskAssignees() {
        const task = this.tasks.find(t => t.id === this.currentEditingTaskId);
        if (!task) return;
        
        // получаем текущих участников
        let currentAssignees = task.assignees || [];
        
        // получаем новых участников с их ролями
        const newAssignees = [];
        const userRoles = {};
        
        document.querySelectorAll('.available-assignee-checkbox:checked').forEach(checkbox => {
            const userId = parseInt(checkbox.value);
            const roleSelect = document.querySelector(`.user-role-select[data-user-id="${userId}"]`);
            const role = roleSelect ? roleSelect.value : '';
            
            newAssignees.push(userId);
            if (role) {
                userRoles[userId] = role;
            }
        });
        
        const allAssignees = [...currentAssignees, ...newAssignees];
        
        // получаем назначения по ролям
        const roleAssignments = {};
        document.querySelectorAll('.role-assignment-checkbox').forEach(checkbox => {
            roleAssignments[checkbox.value] = checkbox.checked;
        });
        
        try {
            const response = await this.apiCall(`/api/tasks/${this.currentEditingTaskId}/assign`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ 
                    user_ids: allAssignees,
                    role_assignments: roleAssignments,
                    user_roles: userRoles
                })
            });

            if (response.ok) {
                this.closeModal('taskAssigneesModal');
                this.showNotification('Участники обновлены', 'success');
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
                this.closeModal('taskViewModal');
                this.currentViewingTaskId = null;
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
            } else {
                const error = await response.json();
                this.showNotification(error.error || 'Ошибка загрузки архивированных задач', 'error');
            }
        } catch (error) {
            console.error('Error loading archived tasks:', error);
            this.showNotification('Ошибка соединения с сервером', 'error');
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
            const deadline = new Date(task.deadline).toLocaleString('ru-RU');
            
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
                this.showArchivedTasks();
                this.showNotification('Задача восстановлена', 'success');
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
        if (this.isMobile) {
            // на мобильных отключаем drag and drop
            return;
        }
        
        // существующий код drag and drop для десктопа
        const cards = document.querySelectorAll('.task-card');
        const columns = document.querySelectorAll('.column-content');
        
        cards.forEach(card => {
            const taskId = parseInt(card.dataset.taskId);
            const task = this.tasks.find(t => t.id === taskId);
            
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
                
                this.debounceUpdateTaskStatus(taskId, newStatus);
            });
        });
    }

    canUserDragTask(task) {
        if (this.currentUser.permissions.canManageTasks || this.currentUser.role === 'admin') {
            return true;
        }
        
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
                if (this.currentViewingTaskId === taskId) {
                    this.closeModal('taskViewModal');
                    this.currentViewingTaskId = null;
                }
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
        const editingId = e.target.dataset.editingId;
        
        try {
            let response;
            if (editingId) {
                // обновляем существующий проект
                response = await this.apiCall(`/api/projects/${editingId}`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ name, description })
                });
            } else {
                // создаем новый проект
                response = await this.apiCall('/api/projects', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ name, description })
                });
            }

            if (response.ok) {
                this.closeModal('projectModal');
                this.showNotification(editingId ? 'Проект обновлен успешно!' : 'Проект создан успешно!', 'success');
                
                document.getElementById('projectForm').reset();
                delete e.target.dataset.editingId;
                document.querySelector('#projectModal .modal-header h3').textContent = 'Добавить проект';
            } else {
                const error = await response.json();
                this.showNotification(error.error || 'Ошибка сохранения проекта', 'error');
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
        const overleaf_project_id = document.getElementById('taskOverleafProject').value ? parseInt(document.getElementById('taskOverleafProject').value) : null;
        const project_link = document.getElementById('taskProjectLink').value;
        const deadline = document.getElementById('taskDeadline').value;
        const priority = document.getElementById('taskPriority').value;
        
        // получаем назначения пользователей
        const assignees = Array.from(document.querySelectorAll('.assignee-checkbox:checked'))
            .map(cb => parseInt(cb.value));
        
        // получаем назначения по ролям
        const role_assignments = {
            tech: document.getElementById('assignTechRole').checked,
            review: document.getElementById('assignReviewRole').checked,
            deploy: document.getElementById('assignDeployRole').checked
        };
        
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
                    overleaf_project_id,
                    project_link,
                    deadline,
                    priority,
                    assignees,
                    role_assignments
                })
            });

            if (response.ok) {
                this.closeModal('taskModal');
                this.showNotification('Задача создана успешно!', 'success');
                
                document.getElementById('taskForm').reset();
                document.querySelectorAll('.assignee-checkbox').forEach(cb => cb.checked = false);
                document.querySelectorAll('#taskForm input[type="checkbox"]').forEach(cb => cb.checked = false);
                this.setMinDeadlineDate();
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
        
        setTimeout(() => {
            const firstInput = modal.querySelector('input, select, textarea');
            if (firstInput) firstInput.focus();
        }, 100);
    }

    closeModal(modalId) {
        document.getElementById(modalId).classList.remove('show');
        
        // сброс состояния для проектной формы
        if (modalId === 'projectModal') {
            const form = document.getElementById('projectForm');
            delete form.dataset.editingId;
            document.querySelector('#projectModal .modal-header h3').textContent = 'Добавить проект';
        }
        
        // сброс состояния для просмотра задач
        if (modalId === 'taskViewModal') {
            this.currentViewingTaskId = null;
        }
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
        
        setTimeout(() => notification.classList.add('show'), 100);
        
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

// инициализация приложения
document.addEventListener('DOMContentLoaded', () => {
    window.app = new TaskFlowApp();
});
